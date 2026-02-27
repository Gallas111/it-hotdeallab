import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9",
};

const SHOP_DOMAINS = [
    "coupang.com", "link.coupang.com", "11st.co.kr",
    "gmarket.co.kr", "auction.co.kr", "interpark.com",
    "ssg.com", "lotteon.com", "danawa.com",
    "tmon.co.kr", "smartstore.naver.com", "brand.naver.com",
    "amazon.com", "amazon.co.jp", "aliexpress.com", "aliexpress.kr",
    "ebay.com", "newegg.com",
];

function extractKeywords(text: string): string[] {
    return text
        .replace(/\[.*?\]/g, "")
        .replace(/[0-9,]+원/g, "")
        .replace(/\$[\d,.]+/g, "")
        .replace(/만원대?|역대|최저가?|특가|할인|초특가|오픈박스|리퍼|정품|새제품|미개봉|사전예약|예약판매|KB페이|카드|혜택/gi, "")
        .replace(/[^\w가-힣a-zA-Z]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter(w => w.length >= 2);
}

async function checkLinkMatch(shopUrl: string, dealTitle: string): Promise<{ match: boolean; shopTitle: string | null; error?: string }> {
    // 커뮤니티 링크(쇼핑몰 아닌 링크)는 스킵
    const isShop = SHOP_DOMAINS.some(d => shopUrl.includes(d));
    if (!isShop) return { match: false, shopTitle: null, error: "쇼핑몰 링크 아님" };

    try {
        const { data: html, status } = await axios.get(shopUrl, {
            headers: { ...HEADERS, Referer: shopUrl },
            timeout: 8000,
            maxRedirects: 5,
            validateStatus: (s) => s < 500,
        });

        if (status === 404) return { match: false, shopTitle: null, error: "404 Not Found" };

        const $ = cheerio.load(html);

        // 품절/삭제 체크
        const lower = (html as string).toLowerCase();
        const SOLD_OUT = ["품절", "판매종료", "판매완료", "구매불가", "soldout", "sold out", "out of stock", "상품이 존재하지 않", "삭제된 상품"];
        if (SOLD_OUT.some(kw => lower.includes(kw.toLowerCase()))) {
            return { match: false, shopTitle: null, error: "품절/삭제" };
        }

        const shopTitle =
            $('meta[property="og:title"]').attr("content")?.trim() ||
            $("h1.prod-buy__title").text().trim() ||
            $("h1#productName").text().trim() ||
            $("h2.itemtit").text().trim() ||
            $("h1.product-name").text().trim() ||
            $("title").text().trim() ||
            null;

        if (!shopTitle) return { match: true, shopTitle: null };

        const dealKeywords = extractKeywords(dealTitle);
        const shopKeywords = extractKeywords(shopTitle);

        if (dealKeywords.length === 0 || shopKeywords.length === 0) return { match: true, shopTitle };

        const matchCount = dealKeywords.filter(kw =>
            shopKeywords.some(sk => sk.includes(kw) || kw.includes(sk))
        ).length;

        const matchRatio = matchCount / dealKeywords.length;
        const isMatch = matchCount >= 2 || matchRatio >= 0.3;

        return { match: isMatch, shopTitle };
    } catch {
        return { match: true, shopTitle: null }; // 요청 실패 → 보존
    }
}

export async function POST() {
    const products = await prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, title: true, affiliateLink: true },
        orderBy: { createdAt: "desc" },
        take: 30, // 최근 30개만 검사 (API 타임아웃 방지)
    });

    const mismatched: { id: string; title: string; link: string; shopTitle: string | null; error?: string }[] = [];

    // 5개씩 배치 처리
    for (let i = 0; i < products.length; i += 5) {
        const batch = products.slice(i, i + 5);
        const results = await Promise.allSettled(
            batch.map(p => checkLinkMatch(p.affiliateLink, p.title))
        );

        for (let j = 0; j < batch.length; j++) {
            const result = results[j];
            if (result.status === "fulfilled" && !result.value.match) {
                mismatched.push({
                    id: batch[j].id,
                    title: batch[j].title,
                    link: batch[j].affiliateLink,
                    shopTitle: result.value.shopTitle,
                    error: result.value.error,
                });
            }
        }
    }

    // 불일치 딜 삭제
    if (mismatched.length > 0) {
        await prisma.product.deleteMany({
            where: { id: { in: mismatched.map(m => m.id) } },
        });
    }

    return NextResponse.json({
        checked: products.length,
        removed: mismatched.length,
        details: mismatched.map(m => ({
            title: m.title,
            shopTitle: m.shopTitle,
            error: m.error,
        })),
    });
}
