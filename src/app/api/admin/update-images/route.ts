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

// 핫링크 차단으로 액박 뜨는 커뮤니티 도메인들
const BROKEN_IMAGE_DOMAINS = ["clien.net", "ppomppu.co.kr"];

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

export async function POST() {
    try {
        // Step 1: 핫링크 차단 도메인의 imageUrl을 null로 초기화
        let cleared = 0;
        for (const domain of BROKEN_IMAGE_DOMAINS) {
            const result = await prisma.product.updateMany({
                where: { imageUrl: { contains: domain } },
                data: { imageUrl: null },
            });
            cleared += result.count;
        }

        // Step 2: imageUrl이 없는 상품 처리 (최대 30개)
        const products = await prisma.product.findMany({
            where: { imageUrl: null },
            select: { id: true, sourceUrl: true, affiliateLink: true },
            take: 30,
        });

        let updated = 0;

        for (const p of products) {
            try {
                let imageUrl: string | null = null;

                if (isShopLink(p.affiliateLink)) {
                    // 이미 쇼핑몰 링크 → 상품 페이지에서 바로 이미지 추출
                    imageUrl = await fetchShopImage(p.affiliateLink);
                } else {
                    // 커뮤니티 링크 → 원본 포스트에서 쇼핑몰 링크 찾은 후 이미지 추출
                    const shopLink = await fetchShopLink(p.sourceUrl);
                    if (shopLink) {
                        imageUrl = await fetchShopImage(shopLink);
                        // 쇼핑몰 링크도 함께 업데이트
                        if (shopLink) {
                            await prisma.product.update({
                                where: { id: p.id },
                                data: { affiliateLink: shopLink },
                            });
                        }
                    }
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
