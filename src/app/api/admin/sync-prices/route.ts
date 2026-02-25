import { NextResponse } from "next/server";
import axios from "axios";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 텍스트에서 할인율/정가 추출
function parsePriceHints(text: string, salePrice: number): {
    originalPrice: number;
    discountPercent: number;
} {
    // 할인율 추출 (5~90% 범위만 유효)
    const pctMatch = text.match(/(\d+)%/g) || [];
    const discountPercent = pctMatch
        .map(s => parseInt(s))
        .filter(n => n >= 5 && n <= 90)[0] || 0;

    // 숫자+원 패턴 추출
    const priceMatches = text.match(/[\d,]+원/g) || [];
    const prices = priceMatches
        .map(s => parseInt(s.replace(/[,원]/g, "")))
        .filter(n => n > 1000 && n < 10_000_000);

    // salePrice보다 5% 이상 높은 가격 중 가장 작은 값 = 정가
    const higherPrices = prices.filter(p => p > salePrice * 1.05);
    let originalPrice = higherPrices.length > 0 ? Math.min(...higherPrices) : 0;

    // 정가를 못 찾았지만 할인율이 있으면 역산
    if (originalPrice === 0 && discountPercent > 0 && salePrice > 0) {
        const calc = Math.round(salePrice / (1 - discountPercent / 100) / 100) * 100;
        if (calc > salePrice && calc < salePrice * 10) {
            originalPrice = calc;
        }
    }

    const computedDiscount = originalPrice > 0 && salePrice > 0
        ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
        : discountPercent;

    return { originalPrice, discountPercent: computedDiscount };
}

// 네이버 웹검색 스니펫에서 정가/할인율 추출 (쿠팡 전용 결과 우선)
async function getOriginalPriceFromNaverWeb(title: string, salePrice: number): Promise<{
    originalPrice: number;
    discountPercent: number;
}> {
    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;
    if (!id || !secret || !title || salePrice <= 0) return { originalPrice: 0, discountPercent: 0 };
    try {
        const { data } = await axios.get("https://openapi.naver.com/v1/search/webkr.json", {
            params: { query: `쿠팡 ${title}`, display: 5 },
            headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
            timeout: 5000,
        });
        for (const item of (data.items || [])) {
            if (!(item.link || "").includes("coupang.com")) continue;
            const text = [item.title, item.description].join(" ")
                .replace(/<[^>]+>/g, "")
                .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
            const hints = parsePriceHints(text, salePrice);
            if (hints.originalPrice > 0 || hints.discountPercent > 0) {
                console.log(`[sync] webkr hint: orig=${hints.originalPrice} disc=${hints.discountPercent}%`);
                return hints;
            }
        }
    } catch (e: any) {
        console.error("[sync] webkr price error:", e.message);
    }
    return { originalPrice: 0, discountPercent: 0 };
}

// Naver Shopping에서 쿠팡 전용 리스팅 가격 조회
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
        let originalPrice = Number(item.hprice) > salePrice ? Number(item.hprice) : 0;
        const img = item.image;
        const image = img ? (img.startsWith("//") ? "https:" + img : img) : null;

        // hprice가 없으면 Naver 웹검색 스니펫에서 정가/할인율 추출 시도
        let discountPercent = 0;
        if (originalPrice === 0 && salePrice > 0) {
            const hints = await getOriginalPriceFromNaverWeb(title, salePrice);
            originalPrice = hints.originalPrice;
            discountPercent = hints.discountPercent;
        }

        if (originalPrice === 0) {
            discountPercent = 0;
        } else {
            discountPercent = Math.round(((originalPrice - salePrice) / originalPrice) * 100);
        }

        console.log(`[sync] "${title.substring(0, 30)}" → mall="${item.mallName}" sale=${salePrice} orig=${originalPrice} disc=${discountPercent}%`);
        return { salePrice, originalPrice, discountPercent, image };
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
            select: { id: true, title: true, salePrice: true, originalPrice: true, discountPercent: true, imageUrl: true },
        });

        let updated = 0;
        const changes: string[] = [];

        for (const p of products) {
            const priceData = await getCoupangPriceFromNaver(p.title);
            if (!priceData || priceData.salePrice === 0) continue;

            const priceChanged = priceData.salePrice !== p.salePrice;
            const discountChanged = priceData.discountPercent > 0 && priceData.discountPercent !== p.discountPercent;
            const imgChanged = !p.imageUrl && priceData.image;

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
            } else if (discountChanged) {
                changes.push(`"${p.title.substring(0, 25)}": 할인율 ${p.discountPercent}% → ${priceData.discountPercent}%`);
            }

            // API 레이트리밋 방지
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
