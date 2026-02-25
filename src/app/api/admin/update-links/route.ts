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
    "tmon.co.kr", "wemakeprice.com",
    "smartstore.naver.com", "brand.naver.com",
];

const COMMUNITY_DOMAINS = ["clien.net", "ppomppu.co.kr", "ruliweb.com", "bbs.ruliweb"];
const isShopLink = (url: string) => SHOP_DOMAINS.some(d => url.includes(d));
const isCommunityLink = (url: string) => COMMUNITY_DOMAINS.some(d => url.includes(d));

async function extractShopLink(postUrl: string): Promise<string | null> {
    try {
        const referer = `https://${new URL(postUrl).hostname}/`;
        const { data: html } = await axios.get(postUrl, {
            headers: { ...HEADERS, Referer: referer },
            timeout: 10000,
        });
        const $ = cheerio.load(html);
        let found: string | null = null;

        // 1. 본문 내 직접 쇼핑몰 링크
        $(".post_content, .post-content, .view-content, .cont, .fr-view, article").find("a[href]").each((_, el) => {
            if (found) return;
            const href = $(el).attr("href") || "";
            if (href.startsWith("http") && isShopLink(href)) found = href;
        });

        // 2. 뽐뿌 s.ppomppu.co.kr base64 인코딩 링크 해독
        if (!found) {
            $("a[href*='s.ppomppu.co.kr']").each((_, el) => {
                if (found) return;
                const href = $(el).attr("href") || "";
                const m = href.match(/[?&]target=([^&]+)/);
                if (m) {
                    try {
                        const decoded = Buffer.from(m[1], "base64").toString("utf-8");
                        if (decoded.startsWith("http") && isShopLink(decoded)) found = decoded;
                    } catch { /* skip */ }
                }
            });
        }

        // 3. 클리앙 /service/redirect 링크
        if (!found) {
            $("a[href*='/service/redirect'], a[href*='redirect'], a[href*='go.php']").each((_, el) => {
                if (found) return;
                const href = $(el).attr("href") || "";
                const m = href.match(/[?&]url=([^&]+)/);
                if (m) {
                    try {
                        const decoded = decodeURIComponent(m[1]);
                        if (isShopLink(decoded)) found = decoded;
                    } catch { /* skip */ }
                }
            });
        }

        // 4. 전체 페이지 href
        if (!found) {
            $("a[href]").each((_, el) => {
                if (found) return;
                const href = $(el).attr("href") || "";
                if (href.startsWith("http") && isShopLink(href)) found = href;
            });
        }

        // 5. 페이지 텍스트에서 URL 직접 추출 (뽐뿌 텍스트 노출 URL)
        if (!found) {
            const bodyText = $.root().text();
            const urlMatches = bodyText.match(/https?:\/\/[^\s"'<>]+/g) || [];
            for (const url of urlMatches) {
                if (isShopLink(url)) { found = url; break; }
            }
        }

        return found;
    } catch {
        return null;
    }
}

export async function POST() {
    try {
        // 커뮤니티 URL이 affiliateLink로 남아있는 상품 전체 조회
        const products = await prisma.product.findMany({
            where: {
                OR: COMMUNITY_DOMAINS.map(d => ({ affiliateLink: { contains: d } })),
            },
            select: { id: true, title: true, affiliateLink: true, sourceUrl: true },
        });

        let updated = 0;

        for (const product of products) {
            const shopLink = await extractShopLink(product.affiliateLink);
            if (shopLink) {
                await prisma.product.update({
                    where: { id: product.id },
                    data: { affiliateLink: shopLink },
                });
                updated++;
            }
            await new Promise(r => setTimeout(r, 500));
        }

        return NextResponse.json({
            success: true,
            total: products.length,
            updated,
            message: `${products.length}개 커뮤니티 링크 처리 → ${updated}개 쇼핑몰 링크로 업데이트`,
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
