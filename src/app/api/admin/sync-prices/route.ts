import { NextResponse } from "next/server";
import axios from "axios";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Naver Shopping에서 쿠팡 전용 리스팅 가격 조회
async function getCoupangPriceFromNaver(title: string): Promise<{
    salePrice: number;
    originalPrice: number;
    image: string | null;
} | null> {
    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;
    if (!id || !secret || !title) return null;

    try {
        const { data } = await axios.get("https://openapi.naver.com/v1/search/shop.json", {
            params: { query: title, display: 10, sort: "sim" },
            headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
            timeout: 6000,
        });

        const items: any[] = data.items || [];

        // 쿠팡 리스팅만 필터 (mallName에 "쿠팡" 포함하거나 link에 coupang.com 포함)
        const coupangItem = items.find(i =>
            i.mallName?.includes("쿠팡") || (i.link || "").includes("coupang.com")
        );
        const item = coupangItem ?? items[0];
        if (!item) return null;

        const salePrice = Number(item.lprice) || 0;
        // hprice가 salePrice보다 높을 때만 정가로 인정
        const originalPrice = Number(item.hprice) > salePrice ? Number(item.hprice) : 0;
        const img = item.image;
        const image = img ? (img.startsWith("//") ? "https:" + img : img) : null;

        console.log(`[sync] "${title.substring(0, 30)}" → mall="${item.mallName}" sale=${salePrice} orig=${originalPrice}`);
        return { salePrice, originalPrice, image };
    } catch (e: any) {
        console.error("[sync] naver error:", e.message);
        return null;
    }
}

export async function POST() {
    try {
        // 쿠팡 상품만 대상
        const products = await prisma.product.findMany({
            where: { affiliateLink: { contains: "coupang.com" } },
            select: { id: true, title: true, salePrice: true, imageUrl: true },
        });

        let updated = 0;
        const changes: string[] = [];

        for (const p of products) {
            const priceData = await getCoupangPriceFromNaver(p.title);
            if (!priceData || priceData.salePrice === 0) continue;

            const discountPercent =
                priceData.originalPrice > 0 && priceData.salePrice > 0 && priceData.originalPrice > priceData.salePrice
                    ? Math.round(((priceData.originalPrice - priceData.salePrice) / priceData.originalPrice) * 100)
                    : 0;

            const changed = priceData.salePrice !== p.salePrice;
            const imgChanged = !p.imageUrl && priceData.image;

            if (!changed && !imgChanged) continue;

            const updateData: Record<string, any> = {
                salePrice: priceData.salePrice,
                originalPrice: priceData.originalPrice,
                discountPercent,
            };
            if (imgChanged) updateData.imageUrl = priceData.image;

            await prisma.product.update({ where: { id: p.id }, data: updateData });
            updated++;

            if (changed) {
                changes.push(`"${p.title.substring(0, 25)}": ${p.salePrice.toLocaleString()}원 → ${priceData.salePrice.toLocaleString()}원${discountPercent > 0 ? ` (${discountPercent}% 할인)` : ""}`);
            }

            // API 레이트리밋 방지
            await new Promise(r => setTimeout(r, 150));
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
