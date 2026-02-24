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

// 쇼핑몰 상품 페이지에서 og:image 추출
// 커뮤니티 사이트 이미지는 핫링크 차단되어 사용 불가 → 쇼핑몰만 사용
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

export async function POST() {
    try {
        // imageUrl이 없는 상품 중 affiliateLink가 실제 쇼핑몰인 것만 처리
        const products = await prisma.product.findMany({
            where: { imageUrl: null },
            select: { id: true, affiliateLink: true },
            take: 30,
        });

        let updated = 0;
        let skipped = 0;

        for (const p of products) {
            // 커뮤니티 링크면 스킵 (이미지 핫링크 차단)
            if (!isShopLink(p.affiliateLink)) {
                skipped++;
                continue;
            }
            try {
                const imageUrl = await fetchShopImage(p.affiliateLink);
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
            skipped,
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
