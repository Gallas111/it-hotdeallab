import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SHOP_DOMAINS = [
    "coupang.com",
    "link.coupang.com",
    "11st.co.kr",
    "gmarket.co.kr",
    "auction.co.kr",
    "interpark.com",
    "ssg.com",
    "lotteon.com",
    "danawa.com",
    "amazon.com",
    "amazon.co.jp",
    "aliexpress.com",
    "tmon.co.kr",
    "wemakeprice.com",
    "smartstore.naver.com",
    "brand.naver.com",
];

async function extractShopLinkFromClienPost(postUrl: string): Promise<string | null> {
    try {
        const { data: html } = await axios.get(postUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "ko-KR,ko;q=0.9",
                "Referer": "https://www.clien.net/service/board/jirum",
            },
            timeout: 8000,
        });

        const $ = cheerio.load(html);

        // 클리앙 게시글 본문: .post_content
        const postContent = $(".post_content, .post-content, article .content");

        const links: string[] = [];

        // 본문 내 링크 우선 검색
        postContent.find("a[href]").each((_, el) => {
            const href = $(el).attr("href") || "";
            if (!href.startsWith("http")) return;
            const isShop = SHOP_DOMAINS.some(d => href.includes(d));
            if (isShop) links.push(href);
        });

        // 본문에 없으면 클리앙 리다이렉트 링크 확인
        // clien redirect: /service/redirect?url=...
        if (links.length === 0) {
            $("a[href*='/service/redirect']").each((_, el) => {
                const href = $(el).attr("href") || "";
                const match = href.match(/[?&]url=([^&]+)/);
                if (match) {
                    try {
                        const decoded = decodeURIComponent(match[1]);
                        const isShop = SHOP_DOMAINS.some(d => decoded.includes(d));
                        if (isShop) links.push(decoded);
                    } catch { /* ignore */ }
                }
            });
        }

        // 전체 페이지에서도 검색
        if (links.length === 0) {
            $("a[href]").each((_, el) => {
                const href = $(el).attr("href") || "";
                if (!href.startsWith("http")) return;
                const isShop = SHOP_DOMAINS.some(d => href.includes(d));
                if (isShop) links.push(href);
            });
        }

        return links[0] || null;
    } catch {
        return null;
    }
}

export async function POST() {
    try {
        // affiliateLink가 clien.net인 상품들 조회
        const clienProducts = await prisma.product.findMany({
            where: { affiliateLink: { contains: "clien.net" } },
            select: { id: true, affiliateLink: true, sourceUrl: true },
        });

        let updated = 0;

        for (const product of clienProducts) {
            const shopLink = await extractShopLinkFromClienPost(product.sourceUrl);
            if (shopLink) {
                await prisma.product.update({
                    where: { id: product.id },
                    data: { affiliateLink: shopLink },
                });
                updated++;
            }
            // Rate limiting: 클리앙 서버 부담 최소화
            await new Promise(r => setTimeout(r, 1000));
        }

        return NextResponse.json({
            success: true,
            total: clienProducts.length,
            updated,
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
