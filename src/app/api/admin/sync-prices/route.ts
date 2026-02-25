import { NextResponse } from "next/server";
import axios from "axios";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Naver Shopping: 쿠팡 할인가 + 정가 추정 (비쿠팡 판매자 가격 활용)
async function getCoupangPriceFromNaver(title: string): Promise<{
    salePrice: number;
    originalPrice: number;
    discountPercent: number;
    image: string | null;
} | null> {
    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;
    if (!id || !secret || !title) return null;

    try {
        const { data } = await axios.get("https://openapi.naver.com/v1/search/shop.json", {
            params: { query: title, display: 20, sort: "sim" },
            headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
            timeout: 6000,
        });

        const items: any[] = data.items || [];
        if (items.length === 0) return null;

        // 쿠팡 vs 비쿠팡 분리
        const coupangItems = items.filter(i =>
            i.mallName?.includes("쿠팡") || (i.link || "").includes("coupang.com")
        );
        const nonCoupangItems = items.filter(i =>
            !i.mallName?.includes("쿠팡") && !(i.link || "").includes("coupang.com")
        );

        const coupangItem = coupangItems[0] ?? items[0];
        const salePrice = Number(coupangItem.lprice) || 0;
        if (salePrice === 0) return null;

        const img = coupangItem.image;
        const image = img ? (img.startsWith("//") ? "https:" + img : img) : null;

        // 정가 추정 순서:
        // 1) 쿠팡 hprice (가격비교 상품인 경우)
        let originalPrice = Number(coupangItem.hprice) > salePrice ? Number(coupangItem.hprice) : 0;

        // 2) 비쿠팡 판매자들 중 쿠팡보다 10% 이상 비싸고 3배 이하인 최솟값
        if (originalPrice === 0 && nonCoupangItems.length > 0) {
            const otherPrices = nonCoupangItems
                .map(i => Number(i.lprice))
                .filter(p => p > salePrice * 1.1 && p < salePrice * 3);
            if (otherPrices.length > 0) {
                originalPrice = Math.min(...otherPrices);
                console.log(`[sync] "${title.substring(0, 25)}" 비쿠팡 정가 추정: ${originalPrice}원`);
            }
        }

        // 3) 전체 hprice 중 합리적인 값
        if (originalPrice === 0) {
            const allHprices = items
                .map(i => Number(i.hprice))
                .filter(p => p > salePrice * 1.05 && p < salePrice * 3);
            if (allHprices.length > 0) {
                originalPrice = Math.min(...allHprices);
            }
        }

        const discountPercent = originalPrice > 0
            ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
            : 0;

        console.log(`[sync] "${title.substring(0, 25)}" sale=${salePrice} orig=${originalPrice} disc=${discountPercent}%`);
        return { salePrice, originalPrice, discountPercent, image };
    } catch (e: any) {
        console.error("[sync] naver error:", e.message);
        return null;
    }
}

export async function POST() {
    try {
        const products = await prisma.product.findMany({
            where: { affiliateLink: { contains: "coupang.com" } },
            select: { id: true, title: true, salePrice: true, originalPrice: true, discountPercent: true, imageUrl: true },
        });

        let updated = 0;
        const changes: string[] = [];

        for (const p of products) {
            const priceData = await getCoupangPriceFromNaver(p.title);
            if (!priceData || priceData.salePrice === 0) continue;

            const priceChanged = priceData.salePrice !== p.salePrice;
            // discountPercent 또는 originalPrice 중 하나라도 달라지면 업데이트
            const discountChanged = priceData.discountPercent !== p.discountPercent
                || priceData.originalPrice !== p.originalPrice;
            const imgChanged = !p.imageUrl && !!priceData.image;

            if (!priceChanged && !discountChanged && !imgChanged) continue;

            const updateData: Record<string, any> = {
                salePrice: priceData.salePrice,
                originalPrice: priceData.originalPrice,
                discountPercent: priceData.discountPercent,
            };
            if (imgChanged) updateData.imageUrl = priceData.image;

            await prisma.product.update({ where: { id: p.id }, data: updateData });
            updated++;

            const discStr = priceData.discountPercent > 0 ? ` (${priceData.discountPercent}% 할인)` : "";
            if (priceChanged) {
                changes.push(`"${p.title.substring(0, 25)}": ${p.salePrice.toLocaleString()}원 → ${priceData.salePrice.toLocaleString()}원${discStr}`);
            } else {
                changes.push(`"${p.title.substring(0, 25)}": 정가 ${priceData.originalPrice.toLocaleString()}원${discStr}`);
            }

            await new Promise(r => setTimeout(r, 200));
        }

        return NextResponse.json({
            success: true,
            total: products.length,
            updated,
            changes,
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
