import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";
import { OpenAI } from "openai";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CLIEN_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://www.clien.net/service/",
};

const SHOP_DOMAINS = [
    "coupang.com", "link.coupang.com",
    "11st.co.kr", "gmarket.co.kr", "auction.co.kr",
    "interpark.com", "ssg.com", "lotteon.com",
    "danawa.com", "amazon.com", "amazon.co.jp",
    "aliexpress.com", "tmon.co.kr", "wemakeprice.com",
    "smartstore.naver.com", "brand.naver.com",
];

function isShopLink(url: string) {
    return SHOP_DOMAINS.some(d => url.includes(d));
}

async function fetchShopLinkFromPost(postUrl: string): Promise<string | null> {
    try {
        const { data: html } = await axios.get(postUrl, {
            headers: CLIEN_HEADERS,
            timeout: 8000,
        });
        const $ = cheerio.load(html);

        // 1. 게시글 본문 영역에서 우선 추출
        const postContent = $(".post_content, .post-content, .article_content");
        let found: string | null = null;

        postContent.find("a[href]").each((_, el) => {
            if (found) return;
            const href = $(el).attr("href") || "";
            if (href.startsWith("http") && isShopLink(href)) found = href;
        });

        // 2. 클리앙 리다이렉트 링크
        if (!found) {
            $("a[href*='/service/redirect']").each((_, el) => {
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

        // 3. 페이지 전체에서 탐색
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

function generateSlug(title: string): string {
    // URL-safe slug: 한글 제거하고 영숫자 + 타임스탬프만 사용
    const ascii = title
        .replace(/\[.*?\]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 60);
    return `${ascii || "deal"}-${Date.now()}`;
}

export async function GET() {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    try {
        // 클리앙 알뜰구매 크롤링
        const { data: html } = await axios.get(
            "https://www.clien.net/service/board/jirum?category=1000236",
            { headers: CLIEN_HEADERS }
        );

        const $ = cheerio.load(html);
        const deals: { title: string; link: string; mallName: string }[] = [];

        // 방법 1: .list_item 셀렉터
        $(".list_item").each((i, el) => {
            if (i >= 20) return;
            const titleEl = $(el).find(".list_subject .subject_fixed, .list_subject a");
            const title = titleEl.text().trim();
            if (!title || title.length < 5) return;

            const href = $(el).find(".list_subject a").attr("href");
            if (!href) return;
            const link = href.startsWith("http") ? href : "https://www.clien.net" + href;

            const mallMatch = title.match(/\[(.*?)\]/);
            deals.push({ title, link, mallName: mallMatch ? mallMatch[1] : "기타" });
        });

        // 방법 2: 링크 패턴 직접 파싱 (방법 1 실패 시)
        if (deals.length === 0) {
            const seen = new Set<string>();
            $("a[href]").each((_, el) => {
                const href = $(el).attr("href") || "";
                const text = $(el).text().trim();
                if (!href.includes("/service/board/jirum/")) return;
                if (text.length < 5 || text.includes("알뜰구매") || text.includes("이용규칙")) return;

                const link = href.startsWith("http") ? href : "https://www.clien.net" + href;
                const cleanLink = link.split("?")[0];
                if (seen.has(cleanLink)) return;
                seen.add(cleanLink);

                const mallMatch = text.match(/\[(.*?)\]/);
                deals.push({ title: text, link, mallName: mallMatch ? mallMatch[1] : "기타" });
            });
            deals.splice(20);
        }

        if (deals.length === 0) {
            return NextResponse.json({ success: true, added: [], message: "게시글을 찾지 못했습니다." });
        }

        const results: string[] = [];

        for (const deal of deals) {
            // 중복 체크
            const exists = await prisma.product.findFirst({ where: { sourceUrl: deal.link } });
            if (exists) continue;

            // OpenAI: IT 핫딜 여부 판별
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: `너는 IT/가전 핫딜 전문 큐레이터야. 게시글 제목을 보고 IT 전자제품, PC, 주변기기, 가전제품 관련 핫딜인지 판별해.
반드시 JSON으로만 응답해.
IT제품이 아니면: {"isIT": false}
IT제품이면:
{
  "isIT": true,
  "refinedTitle": "매력적인 한국어 제목 (50자 이내)",
  "category": "Apple|삼성/LG|노트북/PC|모니터/주변기기|음향/스마트기기 중 하나",
  "originalPrice": 숫자(원, 없으면 0),
  "salePrice": 숫자(원, 없으면 0),
  "aiSummary": "한 줄 핵심 요약 (60자 이내)",
  "aiPros": "장점1, 장점2, 장점3",
  "aiTarget": "추천 대상 (40자 이내)",
  "seoContent": "상세 설명 및 구매 가이드 (500자 이상)"
}`,
                    },
                    { role: "user", content: `제목: ${deal.title}` },
                ],
                response_format: { type: "json_object" },
                max_tokens: 1000,
            });

            const aiData = JSON.parse(completion.choices[0].message.content || "{}");
            if (!aiData.isIT) continue;

            // 클리앙 게시글에서 실제 쇼핑몰 링크 추출
            const shopLink = await fetchShopLinkFromPost(deal.link);
            const affiliateLink = shopLink || deal.link;

            const originalPrice = Number(aiData.originalPrice) || 0;
            const salePrice = Number(aiData.salePrice) || 0;
            const discountPercent = originalPrice > 0 && salePrice > 0 && originalPrice > salePrice
                ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
                : 0;

            const newProduct = await prisma.product.create({
                data: {
                    title: aiData.refinedTitle || deal.title,
                    slug: generateSlug(deal.title),
                    originalPrice,
                    salePrice,
                    discountPercent,
                    category: aiData.category || "기타",
                    mallName: deal.mallName,
                    sourceUrl: deal.link,
                    aiSummary: aiData.aiSummary || "",
                    aiPros: aiData.aiPros || "",
                    aiTarget: aiData.aiTarget || "",
                    seoContent: aiData.seoContent || "",
                    affiliateLink,
                    isActive: true,
                },
            });
            results.push(newProduct.title);
        }

        return NextResponse.json({ success: true, added: results });
    } catch (error: any) {
        console.error("Scrape Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
