import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import axios from "axios";
import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";
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

// URL 정규화 (//, /, http 모두 처리)
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

// ─── 커뮤니티 포스트에서 쇼핑몰 링크 추출 ─────────────────────
async function fetchShopLink(postUrl: string, referer: string): Promise<string | null> {
    try {
        const { data: html } = await axios.get(postUrl, {
            headers: { ...HEADERS, Referer: referer },
            timeout: 10000,
        });
        const $ = cheerio.load(html);
        let found: string | null = null;

        // 1. 본문 내 링크 우선
        $(".post_content, .post-content, .view-content, .cont, .fr-view, .board_view, article").find("a[href]").each((_, el) => {
            if (found) return;
            const href = $(el).attr("href") || "";
            if (href.startsWith("http") && isShopLink(href)) found = href;
        });

        // 2. 뽐뿌 s.ppomppu.co.kr base64 링크 해독 (unquoted href 대비 raw HTML 파싱)
        if (!found) {
            const rawMatches = (typeof html === "string" ? html : "")
                .match(/s\.ppomppu\.co\.kr[^"'\s>]*target=([A-Za-z0-9+/=]+)/g) || [];
            for (const raw of rawMatches) {
                const m = raw.match(/target=([A-Za-z0-9+/=]+)/);
                if (m) {
                    try {
                        const decoded = Buffer.from(m[1], "base64").toString("utf-8");
                        if (decoded.startsWith("http") && isShopLink(decoded)) { found = decoded; break; }
                    } catch { /* skip */ }
                }
            }
        }

        // 3. 리다이렉트 패턴 (url= 파라미터)
        if (!found) {
            $("a[href*='redirect'], a[href*='go.php'], a[href*='link?']").each((_, el) => {
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

        // 5. 페이지 텍스트에서 쇼핑몰 URL 직접 추출 (뽐뿌 등 텍스트로 URL 노출하는 경우)
        if (!found) {
            const bodyText = $.root().text();
            const urlMatch = bodyText.match(/https?:\/\/[^\s"'<>]+/g);
            if (urlMatch) {
                for (const url of urlMatch) {
                    if (isShopLink(url)) { found = url; break; }
                }
            }
        }

        return found;
    } catch {
        return null;
    }
}

// ─── 쇼핑몰 상품 페이지 이미지 추출 ──────────────────────────
// 우선순위: 상품 메인 이미지 선택자 → og:image 순으로 시도
async function fetchShopImage(shopUrl: string): Promise<string | null> {
    try {
        const { data: html } = await axios.get(shopUrl, {
            headers: { ...HEADERS, Referer: shopUrl },
            timeout: 10000,
            maxRedirects: 5,
        });
        const $ = cheerio.load(html);

        // 1. 주요 쇼핑몰 상품 메인 이미지 선택자 (실제 보이는 제품 이미지)
        const productSelectors = [
            // 쿠팡
            ".prod-image__detail img",
            "#repImage",
            // 11번가
            "#mainProductImage",
            ".prd_img_area img",
            // G마켓/옥션
            "#itemImgArea img",
            ".photo_slide img",
            // SSG
            ".prod_img img",
            // 네이버 스마트스토어
            ".main_image img",
            "._1LeBnZqGbM img",
            // 다나와
            ".prod_img img",
            "#imgArea img",
            // 공통 패턴
            '[class*="product-image"] img',
            '[class*="main-image"] img',
            '[class*="mainImage"] img',
            '[id*="mainImage"]',
            '[id*="productImage"]',
        ];

        for (const selector of productSelectors) {
            const src = $(selector).first().attr("src")
                || $(selector).first().attr("data-src");
            const img = normalizeImgUrl(src, shopUrl);
            if (img && img.startsWith("http")) return img;
        }

        // 2. product 메타 이미지
        const productMeta = $('meta[property="product:image"]').attr("content");
        const productNorm = normalizeImgUrl(productMeta, shopUrl);
        if (productNorm) return productNorm;

        // 3. og:image (마지막 폴백 - 기획전/배너 이미지 가능성 있음)
        const ogRaw = $('meta[property="og:image"]').attr("content")
            || $('meta[name="og:image"]').attr("content");
        return normalizeImgUrl(ogRaw, shopUrl);

    } catch {
        return null;
    }
}

// ─── 텔레그램 알림 ───────────────────────────────────────────
async function sendTelegramAlert(newDeals: string[]) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId || newDeals.length === 0) return;

    const lines = newDeals.map(d => `• ${d}`).join("\n");
    const text = `⚡ IT핫딜랩 새 딜 등록!\n\n📦 ${newDeals.length}개의 새 핫딜이 등록됐습니다.\n\n${lines}\n\n🔗 https://ithotdealab.com`;

    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: "HTML",
        });
    } catch { /* 알림 실패는 무시 */ }
}

// ─── 네이버 쇼핑 API 이미지 폴백 ────────────────────────────
// 쇼핑몰 og:image 수집 실패 시 네이버 CDN 이미지로 대체 (핫링크 차단 없음)
async function fetchNaverFallbackImage(title: string): Promise<string | null> {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    // 제목에서 쇼핑몰명·가격 제거하고 핵심 키워드만 추출
    const keyword = title
        .replace(/\[.*?\]/g, "")
        .replace(/[0-9,]+원/g, "")
        .replace(/[^\w\s가-힣]/g, " ")
        .trim()
        .substring(0, 30);

    if (keyword.length < 3) return null;

    try {
        const { data } = await axios.get("https://openapi.naver.com/v1/search/shop.json", {
            params: { query: keyword, display: 1 },
            headers: {
                "X-Naver-Client-Id": clientId,
                "X-Naver-Client-Secret": clientSecret,
            },
            timeout: 5000,
        });
        const img = data.items?.[0]?.image;
        return normalizeImgUrl(img, "https://shopping.naver.com") || null;
    } catch {
        return null;
    }
}

// ─── 텔레그램 모니터링 경고 ──────────────────────────────────
async function sendTelegramMonitorAlert(sourceStats: Record<string, number>, totalDeals: number) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const sourceLines = Object.entries(sourceStats)
        .map(([src, cnt]) => `${cnt === 0 ? "🔴" : "✅"} ${src}: ${cnt}개 수집`)
        .join("\n");

    const text = [
        `⚠️ IT핫딜랩 크롤러 이상 감지!`,
        ``,
        sourceLines,
        ``,
        `📊 현재 활성 딜: ${totalDeals}개`,
        `🔗 https://ithotdealab.com/admin`,
    ].join("\n");

    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: "HTML",
        });
    } catch { /* 무시 */ }
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
        const seen = new Set<string>();

        // 클리앙은 게시글 링크가 /service/board/jirum/[ID] 패턴으로 직접 렌더링됨
        $('a[href*="/service/board/jirum/"]').each((_, el) => {
            if (deals.length >= 15) return;
            const href = $(el).attr("href") || "";
            const text = $(el).text().replace(/\s+/g, " ").trim();
            if (text.length < 8) return;
            if (/알뜰구매|이용규칙|목록|더보기|카테고리/.test(text)) return;
            const link = "https://www.clien.net" + href.split("?")[0];
            if (seen.has(link)) return;
            seen.add(link);
            const mallMatch = text.match(/\[(.*?)\]/);
            deals.push({ title: text, link, mallName: mallMatch?.[1] || "기타", source: "클리앙" });
        });

        return deals;
    } catch {
        return [];
    }
}

// ═══════════════════════════════════════════════════════════
// 소스 2: 뽐뿌 핫딜 (RSS 피드 사용 - 봇 차단 우회)
// ═══════════════════════════════════════════════════════════
async function scrapePpomppu(): Promise<RawDeal[]> {
    try {
        const { data: xml } = await axios.get(
            "https://www.ppomppu.co.kr/rss.php?id=ppomppu",
            { headers: { ...HEADERS, Referer: "https://www.ppomppu.co.kr/" }, timeout: 10000 }
        );
        const $ = cheerio.load(xml, { xmlMode: true });
        const deals: RawDeal[] = [];

        $("item").each((i, el) => {
            if (i >= 20) return;
            const title = $(el).find("title").text().trim();
            if (!title || title.length < 5) return;
            let link = $(el).find("link").text().trim();
            if (!link) link = $(el).find("guid").text().trim();
            if (!link || !link.startsWith("http")) return;
            const mallMatch = title.match(/\[([^\]]+)\]/);
            deals.push({ title, link, mallName: mallMatch?.[1] || "뽐뿌", source: "뽐뿌" });
        });

        return deals;
    } catch {
        return [];
    }
}

// ═══════════════════════════════════════════════════════════
// 소스 3: 루리웹 핫딜 (RSS 피드 사용 - 봇 차단 우회)
// ═══════════════════════════════════════════════════════════
async function scrapeRuliweb(): Promise<RawDeal[]> {
    try {
        const { data: xml } = await axios.get(
            "https://bbs.ruliweb.com/market/board/1020.rss/rss",
            {
                headers: {
                    ...HEADERS,
                    Referer: "https://bbs.ruliweb.com/",
                    Accept: "application/rss+xml, text/xml, application/xml, */*",
                },
                timeout: 10000,
            }
        );
        const $ = cheerio.load(xml, { xmlMode: true });
        const deals: RawDeal[] = [];

        $("item").each((i, el) => {
            if (i >= 15) return;
            const title = $(el).find("title").text().trim();
            if (!title || title.length < 5) return;

            // cheerio가 <link>를 HTML void 요소로 처리할 수 있어 직접 정규식으로 추출
            const itemXml = $.html(el);
            const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
            let link = linkMatch?.[1]?.trim()
                || $(el).find("link").text().trim()
                || $(el).find("guid").text().trim();

            if (!link || !link.startsWith("http")) return;
            // RSS URL에 .rss가 섞인 경우 정리
            link = link.replace("/board/1020.rss/", "/board/1020/");

            // description CDATA에서 이미지 URL 추출
            const desc = $(el).find("description").html() || "";
            const imgMatch = desc.match(/src=["'](https?:\/\/[^"'\s]+\.(?:webp|jpe?g|png)[^"'\s]*?)["']/i);
            const imageUrl = imgMatch?.[1] || undefined;

            const mallMatch = title.match(/\[([^\]]+)\]/);
            deals.push({ title, link, mallName: mallMatch?.[1] || "루리웹", source: "루리웹", imageUrl });
        });

        return deals;
    } catch {
        return [];
    }
}


// ═══════════════════════════════════════════════════════════
// 소스 5: 네이버 쇼핑 API (병렬 처리)
// ═══════════════════════════════════════════════════════════
async function scrapeNaverShopping(): Promise<RawDeal[]> {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) return [];

    const queries = [
        "노트북 할인", "모니터 특가", "무선이어폰 최저가", "SSD 할인",
        "키보드 마우스 할인", "스마트폰 특가", "태블릿 할인",
        "그래픽카드 특가", "스마트워치 할인", "충전기 멀티탭 할인",
        "공기청정기 특가", "로봇청소기 할인", "스마트TV 최저가",
        "냉장고 특가", "세탁기 할인", "에어컨 최저가",
        "블루투스스피커 할인", "전기면도기 특가", "드라이어 고데기 할인", "전동칫솔 특가",
    ];
    const seen = new Set<string>();
    const deals: RawDeal[] = [];

    // 병렬로 모든 쿼리 동시 요청
    const results = await Promise.allSettled(
        queries.map(query =>
            axios.get("https://openapi.naver.com/v1/search/shop.json", {
                params: { query, display: 5, sort: "sim" },
                headers: {
                    "X-Naver-Client-Id": clientId,
                    "X-Naver-Client-Secret": clientSecret,
                },
                timeout: 5000,
            })
        )
    );

    for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const item of result.value.data.items || []) {
            const link = item.link || item.mallUrl;
            if (!link || seen.has(link)) continue;
            seen.add(link);
            const title = item.title?.replace(/<[^>]+>/g, "") || "";
            if (!title) continue;
            // 네이버 쇼핑 API 이미지는 CDN URL → 핫링크 없음
            deals.push({
                title: `[${item.mallName || "네이버"}] ${title} ${item.lprice ? item.lprice + "원" : ""}`,
                link,
                mallName: item.mallName || "네이버쇼핑",
                source: "네이버쇼핑",
                imageUrl: normalizeImgUrl(item.image, link) || undefined,
            });
        }
    }

    return deals;
}

// ─── 소스별 균등 배분 (interleave) ──────────────────────────
// 각 소스에서 1개씩 번갈아 배치해 특정 소스에 치우치지 않게 함
function interleaveDeals(...sources: RawDeal[][]): RawDeal[] {
    const result: RawDeal[] = [];
    const maxLen = Math.max(...sources.map(s => s.length));
    for (let i = 0; i < maxLen; i++) {
        for (const src of sources) {
            if (src[i]) result.push(src[i]);
        }
    }
    return result;
}

// ═══════════════════════════════════════════════════════════
// 메인 핸들러
// ═══════════════════════════════════════════════════════════
async function runScrape() {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    // ── 1. 만료 딜 자동 삭제 (3일 이상 된 핫딜) ─────────────
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expired = await prisma.product.deleteMany({
        where: { createdAt: { lt: threeDaysAgo } },
    });

    const [clienDeals, ppomppuDeals, ruliwebDeals, naverDeals] = await Promise.all([
        scrapeClien(),
        scrapePpomppu(),
        scrapeRuliweb(),
        scrapeNaverShopping(),
    ]);

    const allDeals = interleaveDeals(clienDeals, ppomppuDeals, ruliwebDeals, naverDeals);
    const sourceStats = {
        클리앙: clienDeals.length,
        뽐뿌: ppomppuDeals.length,
        루리웹: ruliwebDeals.length,
        네이버쇼핑: naverDeals.length,
    };

    if (allDeals.length === 0) return;

    const results: string[] = [];
    const MAX_NEW_PER_RUN = 15;
    let newProcessed = 0;

    for (const deal of allDeals) {
        if (newProcessed >= MAX_NEW_PER_RUN) break;
        const exists = await prisma.product.findFirst({ where: { sourceUrl: deal.link } });
        if (exists) continue;
        newProcessed++;

        // Claude: IT 핫딜 여부 판별
        let aiData: any = {};
        try {
            const message = await anthropic.messages.create({
                model: "claude-sonnet-4-6",
                max_tokens: 1000,
                system: `IT·가전·스마트홈 핫딜 전문 큐레이터. 아래 두 조건을 모두 충족해야만 등록.

[등록 가능 제품군]
- IT/전자기기: 노트북, 스마트폰, 태블릿, 모니터, 이어폰, 키보드, 마우스, SSD, 그래픽카드 등
- 가전제품: TV, 냉장고, 세탁기, 에어컨, 공기청정기, 로봇청소기, 건조기, 식기세척기 등
- 스마트홈/IoT: 스마트워치, 블루투스스피커, 스마트조명, 홈캠, 도어락 등
- 생활가전: 드라이어, 고데기, 전동칫솔, 전기면도기, 커피머신, 청소기 등

[등록 조건 - 반드시 둘 다 충족]
1. 위 제품군에 해당하는 전자/가전/스마트 기기
2. 실질적 가격 혜택: 정가 대비 할인, 기간한정 특가, 역대최저가, 쿠폰/카드 할인가 등

[제외 항목]
- 단순 제품 소개·리뷰·추천글 (할인 없음)
- 정가 그대로 판매
- 소프트웨어·게임·구독 서비스
- 식품·의류·생활용품 등 전자/가전과 무관한 제품

반드시 JSON만 반환. 조건 미충족: {"isIT":false}
조건 충족 시:
{"isIT":true,"refinedTitle":"가격 혜택 강조 제목(50자이내)","category":"Apple|삼성/LG|노트북/PC|모니터/주변기기|음향/스마트기기|생활가전 중 하나","originalPrice":정가숫자(모르면0),"salePrice":할인가숫자(모르면0),"discountInfo":"할인 핵심 한줄(예:20%할인/역대최저/오늘만특가)","aiSummary":"한줄요약(60자이내)","aiPros":"장점1, 장점2, 장점3","aiTarget":"추천대상(40자이내)","seoContent":"500자이상 상세설명"}`,
                messages: [
                    { role: "user", content: `출처:${deal.source} 제목:${deal.title}` },
                ],
            });
            const block = message.content[0];
            if (block.type !== "text") throw new Error("unexpected content type");
            const raw = block.text.trim();
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("no JSON in response");
            aiData = JSON.parse(jsonMatch[0]);
        } catch {
            continue;
        }

        if (!aiData.isIT) continue;

        const _origCheck = Number(aiData.originalPrice) || 0;
        const _saleCheck = Number(aiData.salePrice) || 0;
        const _hasDiscount = _origCheck > 0 || _saleCheck > 0 || !!aiData.discountInfo;
        if (!_hasDiscount) continue;

        const referer = `https://${new URL(deal.link).hostname}/`;
        let affiliateLink = deal.link;
        let imageUrl: string | null = deal.imageUrl || null;

        if (!isShopLink(deal.link)) {
            const shopLink = await fetchShopLink(deal.link, referer);
            affiliateLink = shopLink || deal.link;
            if (shopLink && !imageUrl) {
                imageUrl = await fetchShopImage(shopLink);
            }
        } else if (!imageUrl) {
            imageUrl = await fetchShopImage(deal.link);
        }

        affiliateLink = toCoupangAffiliateLink(affiliateLink);

        if (!imageUrl) {
            imageUrl = await fetchNaverFallbackImage(deal.title);
        }

        const originalPrice = Number(aiData.originalPrice) || 0;
        const salePrice = Number(aiData.salePrice) || 0;

        if (originalPrice > 0 && salePrice > 0 && salePrice > originalPrice) continue;
        if (salePrice > 0 && salePrice < 5000) continue;
        if (originalPrice > 0 && salePrice > 0) {
            const calcDiscount = Math.round(((originalPrice - salePrice) / originalPrice) * 100);
            if (calcDiscount > 96) continue;
        }

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
                aiSummary: aiData.discountInfo
                    ? `[${aiData.discountInfo}] ${aiData.aiSummary || ""}`.trim()
                    : aiData.aiSummary || "",
                aiPros: aiData.aiPros || "",
                aiTarget: aiData.aiTarget || "",
                seoContent: aiData.seoContent || "",
                affiliateLink,
                isActive: true,
            },
        });
        results.push(`[${deal.source}] ${newProduct.title} | https://ithotdealab.com/deal/${newProduct.id}`);
    }

    await sendTelegramAlert(results);

    const communitySources = ["클리앙", "뽐뿌", "루리웹"];
    const hasBrokenSource = communitySources.some(src => (sourceStats as any)[src] === 0);
    const totalActive = await prisma.product.count({ where: { isActive: true } });
    if (hasBrokenSource || totalActive < 5) {
        await sendTelegramMonitorAlert(sourceStats, totalActive);
    }

    console.log("Scrape done:", { expired: expired.count, added: results.length, sourceStats });
}

export async function GET(request: Request) {
    // CRON_SECRET 인증 (설정된 경우에만 검증)
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const auth = request.headers.get("authorization");
        if (auth !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
    }

    if (!process.env.ANTHROPIC_API_KEY) {
        return NextResponse.json({ error: "ANTHROPIC_API_KEY 환경변수 미설정" }, { status: 500 });
    }

    // 즉시 202 응답 후 백그라운드에서 크롤링 처리 (cron-job.org 30초 타임아웃 우회)
    waitUntil(runScrape().catch(err => console.error("Scrape Error:", err)));

    return NextResponse.json({ accepted: true, message: "수집 시작됨 (백그라운드 처리)" }, { status: 202 });
}
