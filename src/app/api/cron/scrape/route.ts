import { NextResponse } from "next/server";
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

        // 2. 리다이렉트 패턴
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

// ─── 쇼핑몰 상품 페이지 og:image 추출 ────────────────────────
// 쿠팡/11번가/지마켓 등 CDN 이미지 → 핫링크 없음, 실제 상품 사진
async function fetchShopImage(shopUrl: string): Promise<string | null> {
    try {
        const { data: html } = await axios.get(shopUrl, {
            headers: { ...HEADERS, Referer: shopUrl },
            timeout: 10000,
            maxRedirects: 5,
        });
        const $ = cheerio.load(html);

        // og:image 우선
        const ogRaw = $('meta[property="og:image"]').attr("content")
            || $('meta[name="og:image"]').attr("content");
        const ogImg = normalizeImgUrl(ogRaw, shopUrl);
        if (ogImg) return ogImg;

        // product 이미지 메타
        const productImg = $('meta[property="product:image"]').attr("content");
        const productNorm = normalizeImgUrl(productImg, shopUrl);
        if (productNorm) return productNorm;

        return null;
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
// 소스 2: 루리웹 핫딜 (RSS 피드 사용 - 봇 차단 우회)
// ═══════════════════════════════════════════════════════════
async function scrapeRuliweb(): Promise<RawDeal[]> {
    try {
        const { data: xml } = await axios.get(
            "https://bbs.ruliweb.com/market/board/1020.rss",
            { headers: { ...HEADERS, Referer: "https://bbs.ruliweb.com/" }, timeout: 10000 }
        );
        const $ = cheerio.load(xml, { xmlMode: true });
        const deals: RawDeal[] = [];

        $("item").each((i, el) => {
            if (i >= 15) return;
            const title = $(el).find("title").text().trim();
            if (!title || title.length < 5) return;
            let link = $(el).find("link").text().trim();
            if (!link) link = $(el).find("guid").text().trim();
            // RSS URL에 .rss가 섞인 경우 정리
            link = link.replace("/board/1020.rss/", "/board/1020/");
            if (!link || !link.startsWith("http")) return;
            const mallMatch = title.match(/\[([^\]]+)\]/);
            deals.push({ title, link, mallName: mallMatch?.[1] || "루리웹", source: "루리웹" });
        });

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
                // 네이버 쇼핑 API 이미지는 CDN URL → 핫링크 없음
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
    if (!process.env.ANTHROPIC_API_KEY) {
        return NextResponse.json({ error: "ANTHROPIC_API_KEY 환경변수 미설정" }, { status: 500 });
    }
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    try {
        // ── 1. 만료 딜 자동 삭제 (3일 이상 된 핫딜) ─────────────
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        const expired = await prisma.product.deleteMany({
            where: { createdAt: { lt: threeDaysAgo } },
        });

        const [clienDeals, ruliwebDeals, naverDeals] = await Promise.all([
            scrapeClien(),
            scrapeRuliweb(),
            scrapeNaverShopping(),
        ]);

        const allDeals = [...clienDeals, ...ruliwebDeals, ...naverDeals];
        const sourceStats = {
            클리앙: clienDeals.length,
            루리웹: ruliwebDeals.length,
            네이버쇼핑: naverDeals.length,
        };

        if (allDeals.length === 0) {
            return NextResponse.json({ success: true, added: [], sourceStats, message: "수집된 게시글 없음" });
        }

        const results: string[] = [];
        let dedupCount = 0;
        let gptFilterCount = 0;
        let gptErrorCount = 0;
        let discountFilterCount = 0;
        let lastError = "";
        const MAX_NEW_PER_RUN = 6; // 타임아웃 방지: 신규 아이템 최대 6개씩 처리
        let newProcessed = 0;

        for (const deal of allDeals) {
            if (newProcessed >= MAX_NEW_PER_RUN) break;
            const exists = await prisma.product.findFirst({ where: { sourceUrl: deal.link } });
            if (exists) { dedupCount++; continue; }
            newProcessed++;

            // Claude: IT 핫딜 여부 판별
            let aiData: any = {};
            try {
                const message = await anthropic.messages.create({
                    model: "claude-3-5-haiku-20241022",
                    max_tokens: 1000,
                    system: `IT/가전 핫딜 전문 큐레이터. 아래 두 조건을 모두 충족해야만 등록.

[등록 조건 - 반드시 둘 다 충족]
1. IT/전자기기/가전 제품 (노트북, 스마트폰, 모니터, 이어폰, 키보드 등 하드웨어)
2. 실질적 가격 혜택 존재: 정가 대비 할인, 기간한정 특가, 역대최저가, 쿠폰/카드 할인가 등

[제외 항목 - 하나라도 해당하면 false]
- 단순 제품 소개·리뷰·추천글 (할인 없음)
- 정가 그대로 판매
- 소프트웨어·게임·구독 서비스 (하드웨어만 허용)
- 중고/리퍼라도 특별 할인이 없으면 제외

반드시 JSON만 반환. 조건 미충족: {"isIT":false}
조건 충족 시:
{"isIT":true,"refinedTitle":"가격 혜택 강조 제목(50자이내)","category":"Apple|삼성/LG|노트북/PC|모니터/주변기기|음향/스마트기기 중 하나","originalPrice":정가숫자(모르면0),"salePrice":할인가숫자(모르면0),"discountInfo":"할인 핵심 한줄(예:20%할인/역대최저/오늘만특가)","aiSummary":"한줄요약(60자이내)","aiPros":"장점1, 장점2, 장점3","aiTarget":"추천대상(40자이내)","seoContent":"500자이상 상세설명"}`,
                    messages: [
                        { role: "user", content: `출처:${deal.source} 제목:${deal.title}` },
                    ],
                });
                const block = message.content[0];
                if (block.type !== "text") throw new Error("unexpected content type");
                // Claude가 JSON 외 텍스트를 포함할 수 있으므로 JSON 부분만 추출
                const raw = block.text.trim();
                const jsonMatch = raw.match(/\{[\s\S]*\}/);
                if (!jsonMatch) throw new Error("no JSON in response");
                aiData = JSON.parse(jsonMatch[0]);
            } catch (e: any) {
                gptErrorCount++;
                lastError = e?.message || String(e);
                continue;
            }

            if (!aiData.isIT) { gptFilterCount++; continue; }

            // ── 할인 정보 검증 ────────────────────────────────────
            // 가격 정보도 없고 할인 설명도 없으면 정가 판매 → 제외
            const _origCheck = Number(aiData.originalPrice) || 0;
            const _saleCheck = Number(aiData.salePrice) || 0;
            const _hasDiscount = _origCheck > 0 || _saleCheck > 0 || !!aiData.discountInfo;
            if (!_hasDiscount) { discountFilterCount++; continue; }

            // ── 이미지 + 쇼핑몰 링크 처리 ────────────────────────
            const referer = `https://${new URL(deal.link).hostname}/`;
            let affiliateLink = deal.link;
            // 네이버쇼핑 API 이미지는 CDN → 바로 사용
            let imageUrl: string | null = deal.imageUrl || null;

            if (!isShopLink(deal.link)) {
                // 커뮤니티 포스트 → 쇼핑몰 링크 추출
                const shopLink = await fetchShopLink(deal.link, referer);
                affiliateLink = shopLink || deal.link;

                // 쇼핑몰 링크가 있으면 해당 상품 페이지에서 이미지 추출
                // 커뮤니티 사이트 이미지는 핫링크 차단 → 사용 안 함
                if (shopLink && !imageUrl) {
                    imageUrl = await fetchShopImage(shopLink);
                }
            } else if (!imageUrl) {
                // 이미 쇼핑몰 링크인 경우 상품 페이지 이미지
                imageUrl = await fetchShopImage(deal.link);
            }

            affiliateLink = toCoupangAffiliateLink(affiliateLink);

            const originalPrice = Number(aiData.originalPrice) || 0;
            const salePrice = Number(aiData.salePrice) || 0;

            // ── 2. 가격 이상 감지 ─────────────────────────────────
            // 할인가 > 정가: AI가 원가/할인가를 반대로 파악한 경우
            if (originalPrice > 0 && salePrice > 0 && salePrice > originalPrice) continue;
            // 비정상적으로 낮은 가격: 1원·100원 등 오류값 (IT 제품은 최소 5,000원 이상)
            if (salePrice > 0 && salePrice < 5000) continue;
            // 비현실적 할인율: 97% 이상이면 가격 파싱 오류로 간주
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

        // 새 딜이 있으면 텔레그램 알림 전송
        await sendTelegramAlert(results);

        // ── 모니터링: 커뮤니티 소스 0개 또는 활성 딜 부족 감지 ──
        const communitySources = ["클리앙", "루리웹"];
        const hasBrokenSource = communitySources.some(src => (sourceStats as any)[src] === 0);
        const totalActive = await prisma.product.count({ where: { isActive: true } });
        if (hasBrokenSource || totalActive < 5) {
            await sendTelegramMonitorAlert(sourceStats, totalActive);
        }

        return NextResponse.json({
            success: true,
            added: results,
            sourceStats,
            expired: expired.count,
            totalActive,
            debug: { dedupCount, gptErrorCount, gptFilterCount, discountFilterCount, lastError },
        });
    } catch (error: any) {
        console.error("Scrape Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
