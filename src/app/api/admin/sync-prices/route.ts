import { NextResponse } from "next/server";
import axios from "axios";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ScraperAPI premium으로 쿠팡 페이지 직접 스크래핑
// JSON-LD의 StrikethroughPrice = 정가, offers.price = 할인가
async function getCoupangPricesDirect(affiliateLink: string): Promise<{
    salePrice: number;
    originalPrice: number;
    image: string | null;
} | null> {
    const apiKey = process.env.SCRAPERAPI_KEY;
    if (!apiKey || !affiliateLink) return null;

    try {
        const scraperUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(affiliateLink)}&premium=true&country_code=kr`;
        const { data: html } = await axios.get(scraperUrl, { timeout: 55000 });

        if (typeof html !== "string" || html.length < 10000) return null;

        let salePrice = 0;
        let originalPrice = 0;
        let image: string | null = null;

        // JSON-LD에서 가격 추출 (가장 신뢰할 수 있는 소스)
        const ldBlocks = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g) || [];
        for (const block of ldBlocks) {
            try {
                const ld = JSON.parse(block.replace(/<script[^>]*>/, "").replace(/<\/script>/, ""));
                const offers = ld?.offers;
                if (!offers) continue;

                // 할인가 (현재가)
                const price = Number(offers.price || 0);
                if (price > 0) salePrice = price;

                // 정가: StrikethroughPrice = 쿠팡 취소선 가격 = 원래 정가
                const priceSpec = offers.priceSpecification;
                if (priceSpec && (priceSpec.priceType || "").includes("StrikethroughPrice")) {
                    const orig = Number(priceSpec.price || 0);
                    if (orig > price) originalPrice = orig;
                }

                // 이미지
                const imgs = ld?.image;
                if (Array.isArray(imgs) && imgs.length > 0) image = imgs[0];
                else if (typeof imgs === "string") image = imgs;

                if (salePrice > 0) break;
            } catch {}
        }

        console.log(`[scraperapi] sale=${salePrice} orig=${originalPrice} img=${!!image}`);
        if (salePrice === 0) return null;
        return { salePrice, originalPrice, image };
    } catch (e: any) {
        console.error("[scraperapi] error:", e.message);
        return null;
    }
}

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

        // 2단계: 정가 없는 상품만 ScraperAPI 병렬 조회
        const needsDirect = products
            .map((p, i) => ({ p, naver: naverResults[i] }))
            .filter(({ naver }) => !naver || naver.originalPrice === 0);

        const directResults = await Promise.allSettled(
            needsDirect.map(({ p }) => getCoupangPricesDirect(p.affiliateLink))
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

            // 가격 결정: Naver 우선, 없으면 ScraperAPI
            const salePrice = naver?.salePrice || direct?.salePrice || 0;
            if (salePrice === 0) continue;

            // 정가: Naver 우선, 없으면 ScraperAPI
            const originalPrice = (naver?.originalPrice || 0) > 0
                ? naver!.originalPrice
                : (direct?.originalPrice || 0);

            const image = naver?.image || direct?.image || null;

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
