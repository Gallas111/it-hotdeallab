import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9",
};

const SHOP_DOMAINS = [
    "coupang.com", "link.coupang.com", "11st.co.kr",
    "gmarket.co.kr", "auction.co.kr", "interpark.com",
    "ssg.com", "lotteon.com", "danawa.com",
    "amazon.com", "amazon.co.jp", "aliexpress.com",
    "tmon.co.kr", "smartstore.naver.com", "brand.naver.com",
    "lotteimall.com",
];

// 핫링크 차단으로 액박 뜨는 커뮤니티 도메인들 (scrape/route.ts와 동기화)
const BROKEN_IMAGE_DOMAINS = ["clien.net", "ppomppu.co.kr", "ruliweb.com", "quasarzone.com"];

const isShopLink = (url: string) => SHOP_DOMAINS.some(d => url.includes(d));
const isBrokenImageDomain = (url: string) => BROKEN_IMAGE_DOMAINS.some(d => url.includes(d));

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

// 쇼핑몰 상품 페이지 og:image 추출
async function fetchShopImage(shopUrl: string): Promise<string | null> {
    try {
        const { data: html } = await axios.get(shopUrl, {
            headers: { ...HEADERS, Referer: shopUrl },
            timeout: 10000,
            maxRedirects: 5,
        });
        const $ = cheerio.load(html);
        const raw = $('meta[property="og:image"]').attr("content")
            || $('meta[name="og:image"]').attr("content")
            || $('meta[property="product:image"]').attr("content");
        return normalizeImgUrl(raw, shopUrl);
    } catch {
        return null;
    }
}

// 네이버 쇼핑 API로 상품명 검색 → 이미지 (최후 폴백)
// CDN 이미지라 핫링크 없음, 가장 안정적
async function searchNaverImage(title: string): Promise<string | null> {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    try {
        // 가격/퍼센트 정보 제거 후 핵심 상품명만 검색
        const query = title.replace(/\d[\d,]*원|\d+%|특가|할인|최저가|정품/g, "").trim().substring(0, 40);
        const { data } = await axios.get("https://openapi.naver.com/v1/search/shop.json", {
            params: { query, display: 1, sort: "sim" },
            headers: {
                "X-Naver-Client-Id": clientId,
                "X-Naver-Client-Secret": clientSecret,
            },
            timeout: 5000,
        });
        const img = data.items?.[0]?.image;
        return normalizeImgUrl(img, "https://shopping.naver.com");
    } catch {
        return null;
    }
}

// 커뮤니티 포스트에서 쇼핑몰 링크 추출
async function fetchShopLink(postUrl: string): Promise<string | null> {
    try {
        const referer = `https://${new URL(postUrl).hostname}/`;
        const { data: html } = await axios.get(postUrl, {
            headers: { ...HEADERS, Referer: referer },
            timeout: 10000,
        });
        const $ = cheerio.load(html);
        let found: string | null = null;

        $(".post_content, .post-content, .view-content, .cont, .fr-view, .board_view, article").find("a[href]").each((_, el) => {
            if (found) return;
            const href = $(el).attr("href") || "";
            if (href.startsWith("http") && isShopLink(href)) found = href;
        });

        if (!found) {
            $("a[href]").each((_, el) => {
                if (found) return;
                const href = $(el).attr("href") || "";
                if (href.startsWith("http") && isShopLink(href)) found = href;
            });
        }

        return found;
    } catch {
        return null;
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const forceId: string | undefined = body.id;

        // Step 1: 핫링크 차단 도메인의 imageUrl을 null로 초기화
        let cleared = 0;
        for (const domain of BROKEN_IMAGE_DOMAINS) {
            const result = await prisma.product.updateMany({
                where: { imageUrl: { contains: domain } },
                data: { imageUrl: null },
            });
            cleared += result.count;
        }

        // 특정 ID 강제 초기화 (잘못된 이미지 재수집용)
        if (forceId) {
            await prisma.product.update({
                where: { id: forceId },
                data: { imageUrl: null },
            });
        }

        // Step 2: imageUrl이 없는 상품 처리 (최대 30개)
        const products = await prisma.product.findMany({
            where: { imageUrl: null },
            select: { id: true, title: true, sourceUrl: true, affiliateLink: true },
            take: 30,
        });

        let updated = 0;

        for (const p of products) {
            try {
                let imageUrl: string | null = null;

                if (isShopLink(p.affiliateLink)) {
                    // 1차: 쇼핑몰 상품 페이지 og:image
                    imageUrl = await fetchShopImage(p.affiliateLink);
                } else {
                    // 1차: 커뮤니티 원본 포스트에서 쇼핑몰 링크 탐색
                    const shopLink = await fetchShopLink(p.sourceUrl);
                    if (shopLink) {
                        imageUrl = await fetchShopImage(shopLink);
                        await prisma.product.update({
                            where: { id: p.id },
                            data: { affiliateLink: shopLink },
                        });
                    }
                }

                // 2차 폴백: 네이버 쇼핑 API로 상품명 검색
                // 봇 차단 / 쇼핑몰 링크 없는 경우에도 이미지 확보 가능
                if (!imageUrl) {
                    imageUrl = await searchNaverImage(p.title);
                }

                if (imageUrl) {
                    await prisma.product.update({
                        where: { id: p.id },
                        data: { imageUrl },
                    });
                    updated++;
                }
            } catch { /* 개별 실패 무시 */ }
        }

        return NextResponse.json({
            success: true,
            cleared,
            total: products.length,
            updated,
            message: `${cleared}개 깨진 이미지 초기화 → ${products.length}개 처리 → ${updated}개 업데이트 완료`,
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
