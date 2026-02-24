import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";
import { OpenAI } from "openai";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─── 공통 설정 ──────────────────────────────────────────────
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

type RawDeal = { title: string; link: string; mallName: string; source: string };

// ─── 쇼핑몰 링크 추출 ────────────────────────────────────────
async function fetchShopLink(postUrl: string, referer: string): Promise<string | null> {
    try {
        const { data: html } = await axios.get(postUrl, {
            headers: { ...HEADERS, Referer: referer },
            timeout: 8000,
        });
        const $ = cheerio.load(html);
        let found: string | null = null;

        // 1. 본문 영역 우선
        $(".post_content, .post-content, .view-content, .cont, .fr-view").find("a[href]").each((_, el) => {
            if (found) return;
            const href = $(el).attr("href") || "";
            if (href.startsWith("http") && isShopLink(href)) found = href;
        });

        // 2. 리다이렉트 링크 (클리앙 등)
        if (!found) {
            $("a[href*='redirect'], a[href*='go.php']").each((_, el) => {
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

        // 3. 전체 페이지
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

// ─── URL-safe slug 생성 ──────────────────────────────────────
function generateSlug(title: string): string {
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

// ═══════════════════════════════════════════════════════════
// 소스 1: 클리앙 알뜰구매
// ═══════════════════════════════════════════════════════════
async function scrapeClien(): Promise<RawDeal[]> {
    try {
        const { data: html } = await axios.get(
            "https://www.clien.net/service/board/jirum?category=1000236",
            { headers: { ...HEADERS, Referer: "https://www.clien.net/" }, timeout: 10000 }
        );
        const $ = cheerio.load(html);
        const deals: RawDeal[] = [];

        $(".list_item").each((i, el) => {
            if (i >= 15) return;
            const title = $(el).find(".list_subject .subject_fixed, .list_subject a").first().text().trim();
            if (!title || title.length < 5) return;
            const href = $(el).find(".list_subject a").attr("href");
            if (!href) return;
            const link = href.startsWith("http") ? href : "https://www.clien.net" + href;
            const mallMatch = title.match(/\[(.*?)\]/);
            deals.push({ title, link, mallName: mallMatch?.[1] || "기타", source: "클리앙" });
        });

        // 폴백: 링크 패턴 직접 파싱
        if (deals.length === 0) {
            const seen = new Set<string>();
            $("a[href]").each((_, el) => {
                const href = $(el).attr("href") || "";
                const text = $(el).text().trim();
                if (!href.includes("/service/board/jirum/")) return;
                if (text.length < 5 || /알뜰구매|이용규칙/.test(text)) return;
                const link = href.startsWith("http") ? href : "https://www.clien.net" + href;
                const clean = link.split("?")[0];
                if (seen.has(clean)) return;
                seen.add(clean);
                const mallMatch = text.match(/\[(.*?)\]/);
                deals.push({ title: text, link, mallName: mallMatch?.[1] || "기타", source: "클리앙" });
            });
            deals.splice(15);
        }

        return deals;
    } catch {
        return [];
    }
}

// ═══════════════════════════════════════════════════════════
// 소스 2: 뽐뿌 IT/컴퓨터 게시판
// ═══════════════════════════════════════════════════════════
async function scrapePpomppu(): Promise<RawDeal[]> {
    try {
        const { data: html } = await axios.get(
            "https://www.ppomppu.co.kr/zboard/zboard.php?id=computer",
            { headers: { ...HEADERS, Referer: "https://www.ppomppu.co.kr/" }, timeout: 10000 }
        );
        const $ = cheerio.load(html);
        const deals: RawDeal[] = [];

        // 뽐뿌 게시글 행: .list0, .list1
        $("tr.list0, tr.list1").each((i, el) => {
            if (i >= 15) return;

            const titleEl = $(el).find("a.title, .title a, td.title a").first();
            const title = titleEl.text().trim();
            if (!title || title.length < 5) return;

            const href = titleEl.attr("href") || $(el).find("a[href*='view.php']").attr("href") || "";
            if (!href) return;
            const link = href.startsWith("http") ? href : "https://www.ppomppu.co.kr" + href;

            // 뽐뿌는 쇼핑몰 이름이 별도 컬럼에 없으므로 제목에서 추출
            const mallMatch = title.match(/\[([^\]]+)\]/);
            const mallName = mallMatch?.[1] || "뽐뿌";

            deals.push({ title, link, mallName, source: "뽐뿌" });
        });

        return deals;
    } catch {
        return [];
    }
}

// ═══════════════════════════════════════════════════════════
// 소스 3: 퀘이사존 세일정보 (IT 전문)
// ═══════════════════════════════════════════════════════════
async function scrapeQuasarzone(): Promise<RawDeal[]> {
    try {
        const { data: html } = await axios.get(
            "https://quasarzone.com/bbs/qb_saleinfo",
            { headers: { ...HEADERS, Referer: "https://quasarzone.com/" }, timeout: 10000 }
        );
        const $ = cheerio.load(html);
        const deals: RawDeal[] = [];

        // 퀘이사존 목록 아이템
        $(".market-info-list li, .list-box .item").each((i, el) => {
            if (i >= 15) return;
            const titleEl = $(el).find(".tit, .title, a.subject").first();
            const title = titleEl.text().trim();
            if (!title || title.length < 5) return;

            const href = titleEl.closest("a").attr("href") || titleEl.attr("href") || $(el).find("a").first().attr("href") || "";
            if (!href) return;
            const link = href.startsWith("http") ? href : "https://quasarzone.com" + href;

            const priceEl = $(el).find(".sale-price, .price").first().text().trim();
            const mallMatch = title.match(/\[([^\]]+)\]/);
            const mallName = mallMatch?.[1] || "퀘이사존";

            deals.push({ title: title + (priceEl ? ` ${priceEl}` : ""), link, mallName, source: "퀘이사존" });
        });

        // 폴백: 일반 링크 패턴
        if (deals.length === 0) {
            const seen = new Set<string>();
            $("a[href*='/bbs/qb_saleinfo/views/']").each((_, el) => {
                const href = $(el).attr("href") || "";
                const text = $(el).text().trim();
                if (text.length < 5) return;
                const link = href.startsWith("http") ? href : "https://quasarzone.com" + href;
                if (seen.has(link)) return;
                seen.add(link);
                const mallMatch = text.match(/\[([^\]]+)\]/);
                deals.push({ title: text, link, mallName: mallMatch?.[1] || "퀘이사존", source: "퀘이사존" });
            });
            deals.splice(15);
        }

        return deals;
    } catch {
        return [];
    }
}

// ═══════════════════════════════════════════════════════════
// 소스 4: 네이버 쇼핑 API (API 키 설정 시 활성화)
// ═══════════════════════════════════════════════════════════
async function scrapeNaverShopping(): Promise<RawDeal[]> {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) return [];

    const queries = ["노트북 할인", "모니터 특가", "무선이어폰 최저가", "SSD 할인", "키보드 마우스 할인"];
    const deals: RawDeal[] = [];
    const seen = new Set<string>();

    for (const query of queries) {
        try {
            const { data } = await axios.get("https://openapi.naver.com/v1/search/shop.json", {
                params: { query, display: 5, sort: "sim" },
                headers: {
                    "X-Naver-Client-Id": clientId,
                    "X-Naver-Client-Secret": clientSecret,
                },
                timeout: 5000,
            });

            for (const item of data.items || []) {
                const link = item.link || item.mallUrl;
                if (!link || seen.has(link)) continue;
                seen.add(link);

                const title = item.title?.replace(/<[^>]+>/g, "") || "";
                if (!title) continue;

                deals.push({
                    title: `[${item.mallName || "네이버"}] ${title} ${item.lprice ? item.lprice + "원" : ""}`,
                    link,
                    mallName: item.mallName || "네이버쇼핑",
                    source: "네이버쇼핑",
                });
            }
        } catch { /* 개별 쿼리 실패 시 건너뜀 */ }
    }

    return deals;
}

// ═══════════════════════════════════════════════════════════
// 메인 핸들러
// ═══════════════════════════════════════════════════════════
export async function GET() {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    try {
        // 모든 소스 병렬 크롤링
        const [clienDeals, ppomppuDeals, quasarDeals, naverDeals] = await Promise.all([
            scrapeClien(),
            scrapePpomppu(),
            scrapeQuasarzone(),
            scrapeNaverShopping(),
        ]);

        const allDeals = [...clienDeals, ...ppomppuDeals, ...quasarDeals, ...naverDeals];
        const sourceStats = {
            클리앙: clienDeals.length,
            뽐뿌: ppomppuDeals.length,
            퀘이사존: quasarDeals.length,
            네이버쇼핑: naverDeals.length,
        };

        if (allDeals.length === 0) {
            return NextResponse.json({ success: true, added: [], sourceStats, message: "수집된 게시글 없음" });
        }

        const results: string[] = [];

        for (const deal of allDeals) {
            // 중복 체크
            const exists = await prisma.product.findFirst({ where: { sourceUrl: deal.link } });
            if (exists) continue;

            // OpenAI: IT 핫딜 여부 판별
            let aiData: any = {};
            try {
                const completion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: `IT/가전 핫딜 큐레이터. 제목 보고 판별 후 JSON으로만 응답.
IT 아니면: {"isIT":false}
IT 맞으면:
{"isIT":true,"refinedTitle":"매력적 제목(50자이내)","category":"Apple|삼성/LG|노트북/PC|모니터/주변기기|음향/스마트기기 중 하나","originalPrice":숫자,"salePrice":숫자,"aiSummary":"한줄요약(60자이내)","aiPros":"장점1, 장점2, 장점3","aiTarget":"추천대상(40자이내)","seoContent":"500자이상 상세설명"}`,
                        },
                        { role: "user", content: `출처:${deal.source} 제목:${deal.title}` },
                    ],
                    response_format: { type: "json_object" },
                    max_tokens: 1000,
                });
                aiData = JSON.parse(completion.choices[0].message.content || "{}");
            } catch {
                continue;
            }

            if (!aiData.isIT) continue;

            // 실제 쇼핑몰 링크 추출 (네이버 쇼핑은 이미 쇼핑몰 링크)
            let affiliateLink = deal.link;
            if (!isShopLink(deal.link)) {
                const shopLink = await fetchShopLink(deal.link, `https://${new URL(deal.link).hostname}/`);
                affiliateLink = shopLink || deal.link;
            }

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
            results.push(`[${deal.source}] ${newProduct.title}`);
        }

        return NextResponse.json({ success: true, added: results, sourceStats });
    } catch (error: any) {
        console.error("Scrape Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
