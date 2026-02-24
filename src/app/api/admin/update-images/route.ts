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
];

const isShopLink = (url: string) => SHOP_DOMAINS.some(d => url.includes(d));

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

async function fetchImageForProduct(
    sourceUrl: string,
    affiliateLink: string
): Promise<string | null> {
    const referer = `https://${new URL(sourceUrl).hostname}/`;

    // 1. 포스트 페이지에서 og:image 추출
    try {
        const { data: html } = await axios.get(sourceUrl, {
            headers: { ...HEADERS, Referer: referer },
            timeout: 10000,
        });
        const $ = cheerio.load(html);

        // og:image
        const ogRaw = $('meta[property="og:image"]').attr("content")
            || $('meta[name="og:image"]').attr("content");
        const ogImg = normalizeImgUrl(ogRaw, sourceUrl);
        if (ogImg) return ogImg;

        // 본문 이미지
        const selectors = [
            ".post_content img", ".view-content img", ".fr-view img",
            ".cont img", ".board_view img", "article img",
        ];
        for (const sel of selectors) {
            const raw = $(sel).first().attr("src");
            const normalized = normalizeImgUrl(raw, sourceUrl);
            if (normalized) return normalized;
        }
    } catch { /* 포스트 요청 실패 시 쇼핑몰 페이지 시도 */ }

    // 2. 쇼핑몰 상품 페이지 og:image (affiliateLink가 실제 쇼핑몰인 경우)
    if (isShopLink(affiliateLink)) {
        try {
            const { data: html } = await axios.get(affiliateLink, {
                headers: { ...HEADERS, Referer: affiliateLink },
                timeout: 8000,
                maxRedirects: 5,
            });
            const $ = cheerio.load(html);
            const raw = $('meta[property="og:image"]').attr("content")
                || $('meta[name="og:image"]').attr("content");
            const normalized = normalizeImgUrl(raw, affiliateLink);
            if (normalized) return normalized;
        } catch { /* skip */ }
    }

    return null;
}

export async function POST() {
    try {
        const products = await prisma.product.findMany({
            where: { imageUrl: null },
            select: { id: true, sourceUrl: true, affiliateLink: true },
            take: 30,
        });

        let updated = 0;

        for (const p of products) {
            try {
                const imageUrl = await fetchImageForProduct(p.sourceUrl, p.affiliateLink);
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
            total: products.length,
            updated,
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
