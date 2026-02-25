import { NextResponse } from "next/server";
import axios from "axios";
import { prisma } from "@/lib/prisma";
import { getCoupangProductInfo } from "@/lib/coupang-scraper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Naver Shopping: 쿠팡 할인가 + 정가 추정
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
            params: { query: title, display: 20, sort: "sim" },
            headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
            timeout: 6000,
        });

        const items: any[] = data.items || [];
        if (items.length === 0) return null;

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

        let originalPrice = Number(coupangItem.hprice) > salePrice ? Number(coupangItem.hprice) : 0;

        if (originalPrice === 0 && nonCoupangItems.length > 0) {
            const otherPrices = nonCoupangItems
                .map(i => Number(i.lprice))
                .filter(p => p > salePrice * 1.1 && p < salePrice * 3);
            if (otherPrices.length > 0) originalPrice = Math.min(...otherPrices);
        }

        if (originalPrice === 0) {
            const allHprices = items
                .map(i => Number(i.hprice))
                .filter(p => p > salePrice * 1.05 && p < salePrice * 3);
            if (allHprices.length > 0) originalPrice = Math.min(...allHprices);
        }

        return { salePrice, originalPrice, image };
    } catch (e: any) {
        console.error("[sync] naver error:", e.message);
        return null;
    }
}

export async function POST() {
    try {
        const products = await prisma.product.findMany({
            where: { affiliateLink: { contains: "coupang.com" } },
            select: {
                id: true, title: true,
                salePrice: true, originalPrice: true, discountPercent: true,
                imageUrl: true, affiliateLink: true,
            },
        });

        // 1단계: 전체 네이버 조회 (빠름)
        const naverResults = await Promise.all(
            products.map(p => getCoupangPriceFromNaver(p.title))
        );

        // 2단계: 정가 없는 상품만 직접 스크래핑 (Scrape.do → ScraperAPI 순)
        const needsDirect = products
            .map((p, i) => ({ p, naver: naverResults[i] }))
            .filter(({ naver }) => !naver || naver.originalPrice === 0);

        const directResults = await Promise.allSettled(
            needsDirect.map(({ p }) => getCoupangProductInfo(p.affiliateLink))
        );

        const directMap = new Map<string, { salePrice: number; originalPrice: number; image: string | null } | null>();
        needsDirect.forEach(({ p }, i) => {
            const r = directResults[i];
            directMap.set(p.id, r.status === "fulfilled" ? r.value : null);
        });

        // 3단계: 결과 합산 후 DB 업데이트
        let updated = 0;
        const changes: string[] = [];

        for (let i = 0; i < products.length; i++) {
            const p = products[i];
            const naver = naverResults[i];
            const direct = directMap.get(p.id);

            // 가격 결정: 직접 스크래핑 우선 (실제 상품 페이지 직접 조회라 더 정확)
            const salePrice = direct?.salePrice || naver?.salePrice || 0;
            if (salePrice === 0) continue;

            // 정가: 직접 스크래핑 우선, 없으면 Naver
            const originalPrice = (direct?.originalPrice || 0) > 0
                ? direct!.originalPrice
                : (naver?.originalPrice || 0);

            const image = direct?.image || naver?.image || null;

            const discountPercent = originalPrice > 0 && originalPrice > salePrice
                ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
                : 0;

            const priceChanged = salePrice !== p.salePrice;
            const discountChanged = discountPercent !== p.discountPercent || originalPrice !== p.originalPrice;
            const imgChanged = !p.imageUrl && !!image;

            if (!priceChanged && !discountChanged && !imgChanged) continue;

            const updateData: Record<string, any> = { salePrice, originalPrice, discountPercent };
            if (imgChanged) updateData.imageUrl = image;

            await prisma.product.update({ where: { id: p.id }, data: updateData });
            updated++;

            const discStr = discountPercent > 0 ? ` (${discountPercent}% 할인)` : "";
            if (priceChanged) {
                changes.push(`"${p.title.substring(0, 25)}": ${p.salePrice.toLocaleString()}원 → ${salePrice.toLocaleString()}원${discStr}`);
            } else {
                changes.push(`"${p.title.substring(0, 25)}": 정가 ${originalPrice.toLocaleString()}원${discStr}`);
            }
        }

        return NextResponse.json({ success: true, total: products.length, updated, changes });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
