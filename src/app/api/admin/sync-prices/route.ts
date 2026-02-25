import { NextResponse } from "next/server";
import axios from "axios";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ScraperAPI로 쿠팡 페이지 직접 가져와서 정가/할인가 추출
async function getCoupangPricesDirect(affiliateLink: string): Promise<{
    salePrice: number;
    originalPrice: number;
    image: string | null;
} | null> {
    const apiKey = process.env.SCRAPERAPI_KEY;
    if (!apiKey || !affiliateLink) return null;

    try {
        const scraperUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(affiliateLink)}&country_code=kr&device_type=desktop`;
        const { data: html } = await axios.get(scraperUrl, { timeout: 30000 });

        if (typeof html !== "string" || html.length < 500) return null;

        let salePrice = 0;
        let originalPrice = 0;
        let image: string | null = null;

        // 1. 쿠팡 JS 내장 데이터에서 가격 추출
        const salePriceMatch = html.match(/"salePrice"\s*:\s*(\d+)/)
            || html.match(/"finalPrice"\s*:\s*(\d+)/)
            || html.match(/"currentPrice"\s*:\s*(\d+)/);
        if (salePriceMatch) salePrice = parseInt(salePriceMatch[1]);

        const origPriceMatch = html.match(/"originalPrice"\s*:\s*(\d+)/)
            || html.match(/"basePrice"\s*:\s*(\d+)/)
            || html.match(/"listPrice"\s*:\s*(\d+)/)
            || html.match(/"regularPrice"\s*:\s*(\d+)/);
        if (origPriceMatch) originalPrice = parseInt(origPriceMatch[1]);

        // 2. 할인율로 정가 역산 (정가 못 찾았을 때)
        if (originalPrice === 0 && salePrice > 0) {
            const discMatch = html.match(/"discountRate"\s*:\s*(\d+)/)
                || html.match(/(\d+)%\s*할인/);
            if (discMatch) {
                const disc = parseInt(discMatch[1]);
                if (disc >= 5 && disc <= 90) {
                    originalPrice = Math.round(salePrice / (1 - disc / 100) / 100) * 100;
                }
            }
        }

        // 3. JSON-LD structured data
        if (salePrice === 0) {
            const ldBlocks = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g) || [];
            for (const block of ldBlocks) {
                try {
                    const ld = JSON.parse(block.replace(/<script[^>]*>/, "").replace(/<\/script>/, ""));
                    const price = Number(ld?.offers?.price || 0);
                    if (price > 0) { salePrice = price; break; }
                } catch {}
            }
        }

        // 4. HTML 패턴 fallback
        if (salePrice === 0) {
            const m = html.match(/<strong[^>]*class="[^"]*total-price[^"]*"[^>]*>([\d,]+)/)
                || html.match(/id="productPrice"[^>]*>\s*([\d,]+)/);
            if (m) salePrice = parseInt(m[1].replace(/,/g, ""));
        }
        if (originalPrice === 0) {
            const m = html.match(/<del[^>]*>([\d,]+)원?<\/del>/)
                || html.match(/class="[^"]*origin-price[^"]*"[^>]*>([\d,]+)/);
            if (m) originalPrice = parseInt(m[1].replace(/,/g, ""));
        }

        // 5. OG 이미지
        const imgMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);
        if (imgMatch) image = imgMatch[1];

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

        // 정가 추정 순서
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

        let updated = 0;
        const changes: string[] = [];

        for (const p of products) {
            // 1단계: Naver Shopping으로 가격 조회 (빠름, 크레딧 소모 없음)
            const naverData = await getCoupangPriceFromNaver(p.title);
            let salePrice = naverData?.salePrice || 0;
            let originalPrice = naverData?.originalPrice || 0;
            let image = naverData?.image || null;

            if (salePrice === 0) continue;

            // 2단계: 정가가 없으면 ScraperAPI로 쿠팡 페이지 직접 스크래핑
            if (originalPrice === 0 && p.affiliateLink) {
                console.log(`[sync] ScraperAPI fallback for "${p.title.substring(0, 25)}"`);
                const direct = await getCoupangPricesDirect(p.affiliateLink);
                if (direct) {
                    if (direct.originalPrice > 0) originalPrice = direct.originalPrice;
                    if (direct.salePrice > 0 && !naverData) salePrice = direct.salePrice;
                    if (!image && direct.image) image = direct.image;
                }
            }

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

            await new Promise(r => setTimeout(r, 300));
        }

        return NextResponse.json({ success: true, total: products.length, updated, changes });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
