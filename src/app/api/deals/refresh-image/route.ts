import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9",
};

function normalizeImgUrl(url: string | undefined, baseUrl: string): string | null {
    if (!url) return null;
    const u = url.trim();
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("http")) return u;
    try {
        const base = new URL(baseUrl);
        if (u.startsWith("/")) return `${base.protocol}//${base.host}${u}`;
    } catch { /* ignore */ }
    return null;
}

// 쇼핑몰 상품 페이지에서 이미지 추출 (og:image 우선)
async function fetchShopImage(shopUrl: string): Promise<string | null> {
    try {
        const { data: html } = await axios.get(shopUrl, {
            headers: { ...HEADERS, Referer: shopUrl },
            timeout: 10000,
            maxRedirects: 5,
        });
        const $ = cheerio.load(html);

        // 주요 상품 이미지 선택자
        const selectors = [
            ".prod-image__detail img", "#repImage",
            "#mainProductImage", ".prd_img_area img",
            "#itemImgArea img", ".photo_slide img",
            ".prod_img img", ".main_image img",
            '[class*="product-image"] img', '[class*="main-image"] img',
            '[id*="mainImage"]', '[id*="productImage"]',
        ];
        for (const sel of selectors) {
            const src = $(sel).first().attr("src") || $(sel).first().attr("data-src");
            const img = normalizeImgUrl(src, shopUrl);
            if (img) return img;
        }

        const raw = $('meta[property="product:image"]').attr("content")
            || $('meta[property="og:image"]').attr("content")
            || $('meta[name="og:image"]').attr("content");
        return normalizeImgUrl(raw, shopUrl);
    } catch {
        return null;
    }
}

// 네이버 쇼핑 API 이미지 (CDN, 핫링크 없음)
async function fetchNaverShoppingImage(title: string): Promise<string | null> {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    try {
        const query = title
            .replace(/\[.*?\]/g, "")
            .replace(/[0-9,]+원|\d+%|특가|할인|최저가|정품|무료배송/g, "")
            .trim()
            .substring(0, 40);
        const { data } = await axios.get("https://openapi.naver.com/v1/search/shop.json", {
            params: { query, display: 5, sort: "sim" },
            headers: { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret },
            timeout: 5000,
        });
        // 제목 키워드 겹침 기반으로 최적 이미지 선택
        const titleTokens = title.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
        let bestImg: string | null = null;
        let bestScore = 0;
        for (const item of data.items || []) {
            const itemTitle = (item.title || "").replace(/<[^>]+>/g, "").toLowerCase();
            const matched = titleTokens.filter(t => itemTitle.includes(t)).length;
            const score = titleTokens.length > 0 ? matched / titleTokens.length : 0;
            if (score > bestScore && item.image) {
                bestScore = score;
                bestImg = item.image;
            }
        }
        // 유사도 낮아도 첫 번째 결과 이미지 사용 (아예 없는 것보다 나음)
        if (!bestImg && data.items?.[0]?.image) bestImg = data.items[0].image;
        return normalizeImgUrl(bestImg, "https://shopping.naver.com");
    } catch {
        return null;
    }
}

// 네이버 이미지 검색 폴백
async function fetchNaverImageSearch(title: string): Promise<string | null> {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    try {
        const query = title.replace(/\[.*?\]/g, "").replace(/[0-9,]+원|\d+%/g, "").trim().substring(0, 40);
        const { data } = await axios.get("https://openapi.naver.com/v1/search/image", {
            params: { query: query + " 제품", display: 5, sort: "sim" },
            headers: { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret },
            timeout: 5000,
        });
        for (const item of data.items || []) {
            const url = normalizeImgUrl(item.thumbnail || item.link, "https://search.naver.com");
            if (url && !url.includes("blog") && !url.includes("cafe")) return url;
        }
    } catch { /* 무시 */ }
    return null;
}

// GET /api/deals/refresh-image?id=xxx
// 이미지 로딩 실패 시 클라이언트에서 호출 → 새 이미지 URL 반환 + DB 업데이트
export async function GET(request: NextRequest) {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ imageUrl: null }, { status: 400 });

    try {
        const product = await prisma.product.findUnique({
            where: { id },
            select: { id: true, title: true, affiliateLink: true },
        });
        if (!product) return NextResponse.json({ imageUrl: null }, { status: 404 });

        let newImageUrl: string | null = null;

        // 1차: affiliateLink(쇼핑몰 페이지) og:image
        if (product.affiliateLink) {
            newImageUrl = await fetchShopImage(product.affiliateLink);
        }

        // 2차: 네이버 쇼핑 API (CDN 이미지, 가장 안정적)
        if (!newImageUrl) {
            newImageUrl = await fetchNaverShoppingImage(product.title);
        }

        // 3차: 네이버 이미지 검색
        if (!newImageUrl) {
            newImageUrl = await fetchNaverImageSearch(product.title);
        }

        // 찾으면 DB 업데이트 (다음 로드부터는 바로 정상 표시)
        if (newImageUrl) {
            await prisma.product.update({
                where: { id },
                data: { imageUrl: newImageUrl },
            });
        }

        return NextResponse.json({ imageUrl: newImageUrl });
    } catch {
        return NextResponse.json({ imageUrl: null });
    }
}
