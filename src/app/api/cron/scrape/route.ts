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

// 쿠팡 URL을 파트너스 어필리에이트 링크로 변환
function toCoupangAffiliateLink(url: string): string {
    const COUPANG_PARTNERS_ID = process.env.COUPANG_PARTNERS_ID || "";
    if (!COUPANG_PARTNERS_ID) return url;
    if (!url.includes("coupang.com")) return url;
    if (url.includes("link.coupang.com")) return url;
    try {
        const u = new URL(url);
        u.searchParams.set("partnerCode", COUPANG_PARTNERS_ID);
        return u.toString();
    } catch {
        return url;
    }
}

// ─── 이미지 URL 정규화 (//, /, http 모두 처리) ──────────────
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

type RawDeal = { title: string; link: string; mallName: string; source: string; imageUrl?: string };

// ─── 포스트 단일 페치 → 쇼핑몰 링크 + 이미지 동시 추출 ─────
async function fetchShopLinkAndImage(
    postUrl: string,
    referer: string
): Promise<{ shopLink: string | null; imageUrl: string | null }> {
    try {
        const { data: html } = await axios.get(postUrl, {
            headers: { ...HEADERS, Referer: referer },
            timeout: 10000,
        });
        const $ = cheerio.load(html);

        // ── 이미지: og:image 우선, 본문 이미지 폴백 ──────────
        let imageUrl: string | null = null;
        const ogRaw = $('meta[property="og:image"]').attr("content")
            || $('meta[name="og:image"]').attr("content");
        imageUrl = normalizeImgUrl(ogRaw, postUrl);

        if (!imageUrl) {
            const selectors = [
                ".post_content img", ".view-content img", ".fr-view img",
                ".cont img", ".board_view img", "article img", ".article-body img",
            ];
            for (const sel of selectors) {
                const raw = $(sel).first().attr("src");
                const normalized = normalizeImgUrl(raw, postUrl);
                if (normalized) { imageUrl = normalized; break; }
            }
        }

        // ── 쇼핑몰 링크 ──────────────────────────────────────
        let shopLink: string | null = null;

        // 1. 본문 내 링크 우선
        $(".post_content, .post-content, .view-content, .cont, .fr-view, .board_view, article").find("a[href]").each((_, el) => {
            if (shopLink) return;
            const href = $(el).attr("href") || "";
            if (href.startsWith("http") && isShopLink(href)) shopLink = href;
        });

        // 2. 리다이렉트/go.php 패턴
        if (!shopLink) {
            $("a[href*='redirect'], a[href*='go.php'], a[href*='link?']").each((_, el) => {
                if (shopLink) return;
                const href = $(el).attr("href") || "";
                const m = href.match(/[?&]url=([^&]+)/);
                if (m) {
                    try {
                        const decoded = decodeURIComponent(m[1]);
                        if (isShopLink(decoded)) shopLink = decoded;
                    } catch { /* skip */ }
                }
            });
        }

        // 3. 전체 페이지 링크
        if (!shopLink) {
            $("a[href]").each((_, el) => {
                if (shopLink) return;
                const href = $(el).attr("href") || "";
                if (href.startsWith("http") && isShopLink(href)) shopLink = href;
            });
        }

        return { shopLink, imageUrl };
    } catch {
        return { shopLink: null, imageUrl: null };
    }
}

// ─── 쇼핑몰 상품 페이지의 og:image 추출 (폴백용) ────────────
async function fetchShopPageImage(shopUrl: string): Promise<string | null> {
    try {
        const { data: html } = await axios.get(shopUrl, {
            headers: { ...HEADERS, Referer: shopUrl },
            timeout: 8000,
            maxRedirects: 5,
        });
        const $ = cheerio.load(html);
        const raw = $('meta[property="og:image"]').attr("content")
            || $('meta[name="og:image"]').attr("content");
        return normalizeImgUrl(raw, shopUrl);
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

            // 목록 페이지 썸네일 직접 추출 (추가 요청 불필요)
            const thumbRaw = $(el).find(".list_thumbnail img, .thumb img, img.thumb, .thumbnail img").attr("src");
            const imageUrl = normalizeImgUrl(thumbRaw, "https://www.clien.net") || undefined;

            deals.push({ title, link, mallName: mallMatch?.[1] || "기타", source: "클리앙", imageUrl });
        });

        // 폴백
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

        $("tr.list0, tr.list1").each((i, el) => {
            if (i >= 15) return;

            const titleEl = $(el).find("a.title, .title a, td.title a").first();
            const title = titleEl.text().trim();
            if (!title || title.length < 5) return;

            const href = titleEl.attr("href") || $(el).find("a[href*='view.php']").attr("href") || "";
            if (!href) return;
            const link = href.startsWith("http") ? href : "https://www.ppomppu.co.kr" + href;

            const mallMatch = title.match(/\[([^\]]+)\]/);
            const mallName = mallMatch?.[1] || "뽐뿌";

            // 목록 썸네일
            const thumbRaw = $(el).find("img.thumb, td.thumb img, img[src*='thumb']").attr("src")
                || $(el).find("img").first().attr("src");
            const imageUrl = normalizeImgUrl(thumbRaw, "https://www.ppomppu.co.kr") || undefined;

            deals.push({ title, link, mallName, source: "뽐뿌", imageUrl });
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

            // 목록 썸네일
            const thumbRaw = $(el).find("img").first().attr("src");
            const imageUrl = normalizeImgUrl(thumbRaw, "https://quasarzone.com") || undefined;

            deals.push({ title: title + (priceEl ? ` ${priceEl}` : ""), link, mallName, source: "퀘이사존", imageUrl });
        });

        // 폴백
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
// 소스 4: 네이버 쇼핑 API
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
                    imageUrl: normalizeImgUrl(item.image, link) || undefined,
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

            // 이미지 + 쇼핑몰 링크 처리
            const referer = `https://${new URL(deal.link).hostname}/`;
            let affiliateLink = deal.link;
            let imageUrl: string | null = deal.imageUrl || null;

            if (!isShopLink(deal.link)) {
                // 포스트 단일 fetch → 쇼핑몰 링크 + 이미지 동시 추출
                const { shopLink, imageUrl: postImage } = await fetchShopLinkAndImage(deal.link, referer);
                affiliateLink = shopLink || deal.link;
                if (!imageUrl) imageUrl = postImage;

                // 포스트에서 이미지 못 찾으면 쇼핑몰 상품 페이지 og:image 시도
                if (!imageUrl && shopLink) {
                    imageUrl = await fetchShopPageImage(shopLink);
                }
            } else if (!imageUrl) {
                // 이미 쇼핑몰 링크인 경우 (네이버쇼핑 이미지 없는 케이스) 상품 페이지에서 추출
                imageUrl = await fetchShopPageImage(deal.link);
            }

            affiliateLink = toCoupangAffiliateLink(affiliateLink);

            const originalPrice = Number(aiData.originalPrice) || 0;
            const salePrice = Number(aiData.salePrice) || 0;
            const discountPercent = originalPrice > 0 && salePrice > 0 && originalPrice > salePrice
                ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
                : 0;

            const newProduct = await prisma.product.create({
                data: {
                    title: aiData.refinedTitle || deal.title,
                    slug: generateSlug(deal.title),
                    imageUrl: imageUrl || undefined,
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
