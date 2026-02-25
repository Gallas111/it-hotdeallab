import { NextResponse } from "next/server";
import axios from "axios";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NAV_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

// 네이버 쇼핑 카탈로그 페이지에서 정가 추출 (쿠팡 전용 상품용 fallback)
async function getOriginalPriceFromNaverCatalog(naverProductId: string, salePrice: number): Promise<number> {
    if (!naverProductId || salePrice <= 0) return 0;
    try {
        const { data: html } = await axios.get(
            `https://search.shopping.naver.com/catalog/${naverProductId}`,
            {
                headers: {
                    "User-Agent": NAV_UA,
                    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
                    "Accept-Language": "ko-KR,ko;q=0.9",
                    "Referer": "https://search.shopping.naver.com/",
                },
                timeout: 8000,
            }
        );

        // __NEXT_DATA__ JSON에서 highestPrice / normalPrice / originalPrice 탐색
        const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (nextMatch) {
            try {
                const nd = JSON.parse(nextMatch[1]);
                const str = JSON.stringify(nd);
                for (const key of ["highestPrice", "normalPrice", "originalPrice", "regularPrice", "highPrice"]) {
                    const m = str.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
                    if (m) {
                        const p = parseInt(m[1]);
                        if (p > salePrice * 1.05 && p < salePrice * 5) {
                            console.log(`[catalog] ${key}=${p} for productId=${naverProductId}`);
                            return p;
                        }
                    }
                }
            } catch {}
        }

        // JSON-LD 탐색 (highPrice)
        const ldMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g) || [];
        for (const block of ldMatches) {
            try {
                const ld = JSON.parse(block.replace(/<script[^>]*>/, "").replace(/<\/script>/, ""));
                const highPrice = Number(ld?.offers?.highPrice || ld?.offers?.price || 0);
                if (highPrice > salePrice * 1.05 && highPrice < salePrice * 5) {
                    console.log(`[catalog] ld+json highPrice=${highPrice}`);
                    return highPrice;
                }
            } catch {}
        }

        // 정규식 fallback: HTML 전체에서 패턴 탐색
        for (const key of ["highestPrice", "normalPrice", "originalPrice", "regularPrice"]) {
            const m = html.match(new RegExp(`"${key}"[:\\s]*"?(\\d{4,8})"?`));
            if (m) {
                const p = parseInt(m[1]);
                if (p > salePrice * 1.05 && p < salePrice * 5) {
                    console.log(`[catalog] regex ${key}=${p}`);
                    return p;
                }
            }
        }
    } catch (e: any) {
        console.error(`[catalog] error for ${naverProductId}:`, e.message);
    }
    return 0;
}

// Naver Shopping: 쿠팡 할인가 + 정가 추정
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
        // 1) 쿠팡 hprice (가격비교 상품)
        let originalPrice = Number(coupangItem.hprice) > salePrice ? Number(coupangItem.hprice) : 0;

        // 2) 비쿠팡 판매자 중 10%~3배 범위 최솟값
        if (originalPrice === 0 && nonCoupangItems.length > 0) {
            const otherPrices = nonCoupangItems
                .map(i => Number(i.lprice))
                .filter(p => p > salePrice * 1.1 && p < salePrice * 3);
            if (otherPrices.length > 0) {
                originalPrice = Math.min(...otherPrices);
                console.log(`[sync] "${title.substring(0, 25)}" 비쿠팡 정가=${originalPrice}`);
            }
        }

        // 3) 전체 hprice fallback
        if (originalPrice === 0) {
            const allHprices = items
                .map(i => Number(i.hprice))
                .filter(p => p > salePrice * 1.05 && p < salePrice * 3);
            if (allHprices.length > 0) originalPrice = Math.min(...allHprices);
        }

        // 4) 네이버 카탈로그 페이지 직접 파싱 (쿠팡 전용 상품 최종 fallback)
        if (originalPrice === 0 && coupangItem.productId) {
            originalPrice = await getOriginalPriceFromNaverCatalog(coupangItem.productId, salePrice);
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

            await new Promise(r => setTimeout(r, 300));
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
