import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenAI } from "@google/genai";
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
    // 국내 대형
    "coupang.com", "link.coupang.com", "11st.co.kr",
    "gmarket.co.kr", "auction.co.kr", "interpark.com",
    "ssg.com", "lotteon.com", "danawa.com",
    "tmon.co.kr", "smartstore.naver.com", "brand.naver.com",
    "shopping.naver.com", "search.shopping.naver.com",
    "shoppinglive.naver.com", "naver.me",
    // 국내 전문몰
    "cjonstyle.com", "compuzone.co.kr", "ohou.se",
    "lottehimall.com", "himart.co.kr", "earphoneshop.co.kr",
    "baemin.com", "baemin.go.link", "wemakeprice.com", "kurly.com",
    "apple.com", "samsung.com", "lg.co.kr",
    // 해외직구
    "amazon.com", "amazon.co.jp", "amazon.co.uk", "amazon.de",
    "aliexpress.com", "aliexpress.kr",
    "ebay.com", "ebay.co.kr", "newegg.com", "bhphotovideo.com",
    "iherb.com", "rakuten.co.jp",
    "woot.com", "costco.com", "asus.com",
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

// affiliateLink 기반으로 실제 쇼핑몰 이름 결정
function getMallNameFromLink(link: string, fallback: string): string {
    if (link.includes("coupang.com")) return "쿠팡";
    if (link.includes("smartstore.naver.com")) return "네이버스마트스토어";
    if (link.includes("brand.naver.com")) return "네이버브랜드스토어";
    if (link.includes("shopping.naver.com") || link.includes("naver.me")) return "네이버쇼핑";
    if (link.includes("11st.co.kr")) return "11번가";
    if (link.includes("gmarket.co.kr")) return "G마켓";
    if (link.includes("auction.co.kr")) return "옥션";
    if (link.includes("ssg.com")) return "SSG";
    if (link.includes("lotteon.com")) return "롯데온";
    if (link.includes("danawa.com")) return "다나와";
    if (link.includes("interpark.com")) return "인터파크";
    if (link.includes("aliexpress.com")) return "알리익스프레스";
    if (link.includes("amazon.com")) return "아마존";
    if (link.includes("ebay.com")) return "eBay";
    if (link.includes("apple.com")) return "Apple";
    if (link.includes("samsung.com")) return "삼성";
    if (link.includes("lg.co.kr")) return "LG";
    if (link.includes("himart.co.kr")) return "하이마트";
    if (link.includes("compuzone.co.kr")) return "컴퓨존";
    return fallback;
}

// 알리익스프레스 URL을 포털스 제휴 링크로 변환
function toAliexpressAffiliateLink(url: string): string {
    const trackingId = process.env.ALIEXPRESS_TRACKING_ID || "";
    if (!trackingId) return url;
    if (!url.includes("aliexpress.com")) return url;
    try {
        const u = new URL(url);
        u.searchParams.set("aff_platform", "portals-tool");
        u.searchParams.set("sk", trackingId);
        return u.toString();
    } catch {
        return url;
    }
}

// URL 정규화 (//, /, http 모두 처리)
function normalizeImgUrl(url: string | undefined, baseUrl: string): string | null {
    if (!url) return null;
    const u = url.trim();
    // data: URI, blob: URI, placeholder 제외
    if (u.startsWith("data:") || u.startsWith("blob:") || u === "" || u === "#") return null;
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
        // http→https 변환 (뽐뿌 등 JS 리다이렉트 방지)
        const fetchUrl = postUrl.replace(/^http:\/\/(www\.)?ppomppu\.co\.kr/, "https://www.ppomppu.co.kr");
        const { data: html } = await axios.get(fetchUrl, {
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

        // 2. 뽐뿌 base64 인코딩 링크 해독 (raw HTML에서 target= 파라미터 직접 추출)
        if (!found && postUrl.includes("ppomppu")) {
            const rawHtml = typeof html === "string" ? html : "";
            const b64Matches = rawHtml.match(/[?&]target=([A-Za-z0-9+/=]{20,})/g) || [];
            for (const raw of b64Matches) {
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

// 커뮤니티 CDN 이미지 차단 (핫링크 차단 + 제품 이미지 아님)
const BLOCKED_IMG_DOMAINS = ["ppomppu.co.kr", "clien.net", "ruliweb.com", "quasarzone.com"];
function isCommunityImage(url: string): boolean {
    return BLOCKED_IMG_DOMAINS.some(d => url.includes(d));
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
            if (img && img.startsWith("http") && !isCommunityImage(img)) return img;
        }

        // 2. product 메타 이미지
        const productMeta = $('meta[property="product:image"]').attr("content");
        const productNorm = normalizeImgUrl(productMeta, shopUrl);
        if (productNorm && !isCommunityImage(productNorm)) return productNorm;

        // 3. og:image (마지막 폴백 - 기획전/배너 이미지 가능성 있음)
        const ogRaw = $('meta[property="og:image"]').attr("content")
            || $('meta[name="og:image"]').attr("content");
        const ogNorm = normalizeImgUrl(ogRaw, shopUrl);
        return ogNorm && !isCommunityImage(ogNorm) ? ogNorm : null;

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

// ─── 네이버 이미지 폴백 (쇼핑 → 이미지 검색 2단계) ─────────
function extractImageKeyword(title: string): string {
    return title
        .replace(/\[.*?\]/g, "")
        .replace(/[0-9,]+원/g, "")
        .replace(/\$[\d,.]+/g, "")
        .replace(/¥[\d,.]+/g, "")
        .replace(/만원대?/g, "")
        .replace(/역대[가최]*/g, "")
        .replace(/최저가|특가|할인|초특가|오픈박스|리퍼|정품|새제품|미개봉|무료배송|득템|기회/g, "")
        .replace(/[^\w\s가-힣a-zA-Z0-9.-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 50);
}

// 제품명 핵심 키워드 추출 (유사도 비교용)
function extractCoreTokens(text: string): string[] {
    const clean = text.replace(/<[^>]+>/g, "").replace(/\[.*?\]/g, "")
        .replace(/[0-9,]+원/g, "").replace(/\$[\d,.]+/g, "")
        .replace(/특가|할인|초특가|무료배송|최저가/g, "")
        .toLowerCase().trim();
    return clean.split(/[\s/,]+/).filter(t => t.length >= 2);
}

// 두 제품명의 핵심 키워드 겹침 비율 계산
function titleSimilarity(titleA: string, titleB: string): number {
    const tokensA = extractCoreTokens(titleA);
    const tokensB = extractCoreTokens(titleB);
    if (tokensA.length === 0) return 0;
    const matched = tokensA.filter(t => tokensB.some(b => b.includes(t) || t.includes(b)));
    return matched.length / tokensA.length;
}

async function fetchNaverFallbackImage(title: string): Promise<string | null> {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    const keyword = extractImageKeyword(title);
    if (keyword.length < 2) return null;

    const naverHeaders = {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
    };

    // 1차: 네이버 쇼핑 검색 (CDN 이미지, 핫링크 없음)
    try {
        const { data } = await axios.get("https://openapi.naver.com/v1/search/shop.json", {
            params: { query: keyword, display: 5 },
            headers: naverHeaders,
            timeout: 5000,
        });
        // 제품명 유사도가 가장 높은 결과의 이미지 사용
        let bestImg: string | null = null;
        let bestScore = 0;
        for (const item of data.items || []) {
            const score = titleSimilarity(title, item.title);
            if (score > bestScore && item.image) {
                bestScore = score;
                bestImg = item.image;
            }
        }
        if (bestScore >= 0.3 && bestImg) {
            const url = normalizeImgUrl(bestImg, "https://shopping.naver.com");
            if (url) return url;
        }
        console.log(`[Image] 네이버쇼핑 유사도 부족 (best=${bestScore.toFixed(2)}): "${keyword}"`);
    } catch { /* 다음 단계로 */ }

    // 2차: 네이버 이미지 검색 (쇼핑에 없는 제품도 커버)
    try {
        const { data } = await axios.get("https://openapi.naver.com/v1/search/image", {
            params: { query: keyword + " 제품", display: 5, sort: "sim" },
            headers: naverHeaders,
            timeout: 5000,
        });
        for (const item of data.items || []) {
            // thumbnail: 실제 이미지 URL, link: 이미지가 있는 페이지 URL
            const url = normalizeImgUrl(item.thumbnail || item.link, "https://search.naver.com");
            if (url && !url.includes("blog") && !url.includes("cafe")) return url;
        }
    } catch { /* 무시 */ }

    return null;
}

// ─── 이미지 URL 유효성 검증 ──────────────────────────────────
async function validateImageUrl(url: string | null): Promise<boolean> {
    if (!url) return false;
    if (isCommunityImage(url)) return false;
    try {
        // 1차: HEAD 요청 (빠름)
        const res = await axios.head(url, {
            timeout: 5000,
            headers: { "User-Agent": HEADERS["User-Agent"] },
            maxRedirects: 3,
        });
        const contentType = res.headers["content-type"] || "";
        if (res.status === 200 && contentType.startsWith("image/")) return true;
        // content-type 없으면 URL 확장자로 판단
        if (res.status === 200 && !contentType) {
            return /\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i.test(url);
        }
    } catch {
        // HEAD 차단 서버 → GET으로 재시도 (첫 1바이트만)
        try {
            const res = await axios.get(url, {
                timeout: 5000,
                headers: { "User-Agent": HEADERS["User-Agent"], Range: "bytes=0-0" },
                maxRedirects: 3,
                responseType: "arraybuffer",
            });
            const contentType = res.headers["content-type"] || "";
            if (contentType.startsWith("image/")) return true;
            if (!contentType) return /\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i.test(url);
            return false;
        } catch {
            return false;
        }
    }
    return false;
}

// ─── 이미지 없는 기존 제품 자동 복구 ────────────────────────
async function repairMissingImages() {
    const products = await prisma.product.findMany({
        where: {
            isActive: true,
            OR: [
                { imageUrl: null },
                { imageUrl: "" },
            ],
        },
        select: { id: true, title: true, imageUrl: true, affiliateLink: true },
        orderBy: { createdAt: "desc" },
        take: 5, // 매 실행마다 최대 5개씩 복구 (API 호출 절약)
    });

    if (products.length === 0) return;
    console.log(`[Image Repair] ${products.length}개 제품 이미지 복구 시도`);

    let repaired = 0;
    for (const p of products) {
        let newImageUrl: string | null = null;

        // 1차: affiliateLink(쇼핑몰 페이지)에서 og:image 추출
        if (p.affiliateLink) {
            newImageUrl = await fetchShopImage(p.affiliateLink);
            if (newImageUrl && !(await validateImageUrl(newImageUrl))) newImageUrl = null;
        }

        // 2차: 네이버 쇼핑 폴백
        if (!newImageUrl) {
            newImageUrl = await fetchNaverFallbackImage(p.title);
            if (newImageUrl && !(await validateImageUrl(newImageUrl))) {
                newImageUrl = null;
            }
        }

        if (newImageUrl) {
            await prisma.product.update({
                where: { id: p.id },
                data: { imageUrl: newImageUrl },
            });
            repaired++;
            console.log(`[Image Repair] ✓ ${p.title}`);
        }
    }

    if (repaired > 0) {
        console.log(`[Image Repair] ${repaired}/${products.length}개 복구 완료`);
    }
}

// ─── 커뮤니티 링크 자동 교체 ─────────────────────────────────
const COMMUNITY_LINK_DOMAINS = ["clien.net", "ppomppu.co.kr", "ruliweb.com", "quasarzone.com"];
const isCommunityLink = (url: string) => COMMUNITY_LINK_DOMAINS.some(d => url.includes(d));

async function repairCommunityLinks() {
    const products = await prisma.product.findMany({
        where: {
            isActive: true,
            OR: COMMUNITY_LINK_DOMAINS.map(d => ({ affiliateLink: { contains: d } })),
        },
        select: { id: true, title: true, affiliateLink: true, sourceUrl: true, mallName: true },
        orderBy: { createdAt: "desc" },
        take: 5, // 매 실행마다 최대 5개씩 처리
    });

    if (products.length === 0) return;
    console.log(`[Link Repair] ${products.length}개 커뮤니티 링크 교체 시도`);

    let repaired = 0;
    for (const p of products) {
        const postUrl = p.affiliateLink || p.sourceUrl;
        let referer: string;
        try {
            referer = `https://${new URL(postUrl).hostname}/`;
        } catch {
            console.error(`[Link Repair] URL 파싱 실패: ${postUrl}`);
            continue;
        }
        const shopLink = await fetchShopLink(postUrl, referer);

        if (shopLink) {
            const finalLink = toAliexpressAffiliateLink(toCoupangAffiliateLink(shopLink));
            await prisma.product.update({
                where: { id: p.id },
                data: {
                    affiliateLink: finalLink,
                    mallName: getMallNameFromLink(finalLink, p.mallName || "쇼핑몰"),
                },
            });
            repaired++;
            console.log(`[Link Repair] ✓ ${p.title}`);
        } else {
            // 쇼핑몰 링크를 찾지 못하면 비활성화 (더 이상 표시 안 함)
            await prisma.product.update({
                where: { id: p.id },
                data: { isActive: false },
            });
            console.log(`[Link Repair] 삭제 (링크 없음): ${p.title}`);
        }
    }

    if (repaired > 0) {
        console.log(`[Link Repair] ${repaired}/${products.length}개 교체 완료`);
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

// ─── 사이트 상태 자동 점검 + 자동 수정 (크롤링마다 실행) ─────
async function runSiteHealthCheck() {
    const issues: string[] = [];
    const fixes: string[] = [];
    const SITE = "https://ithotdealab.com";

    // 1. 메인 페이지 접속 확인
    try {
        const res = await axios.get(SITE, { timeout: 10000, maxRedirects: 5 });
        if (res.status === 500 || res.status === 502 || res.status === 503) {
            // 서버 에러 → 코드 문제일 수 있으므로 자동 수정 시도
            const codeFixResult = await autoFixCodeIssue({
                type: "component-error",
                description: `메인 페이지 HTTP ${res.status} 서버 에러`,
                errorLog: typeof res.data === "string" ? res.data.slice(0, 2000) : undefined,
            });
            if (codeFixResult) fixes.push(codeFixResult);
            else issues.push(`메인 페이지 HTTP ${res.status}`);
        } else if (res.status !== 200) {
            issues.push(`메인 페이지 HTTP ${res.status}`);
        }
    } catch (e: any) {
        issues.push(`메인 페이지 접속 실패: ${e.message}`);
    }

    // 2. 이미지 HTTP 상태 점검 + 자동 교체 (최근 20개 샘플링)
    const sampleProducts = await prisma.product.findMany({
        where: { isActive: true, imageUrl: { not: null } },
        select: { id: true, title: true, imageUrl: true, affiliateLink: true },
        orderBy: { createdAt: "desc" },
        take: 20,
    });

    let imgFixed = 0;
    let img402 = 0;
    const brokenImageProducts: typeof sampleProducts = [];

    for (const p of sampleProducts) {
        if (!p.imageUrl) continue;
        try {
            const res = await axios.head(p.imageUrl, {
                timeout: 5000,
                headers: { "User-Agent": HEADERS["User-Agent"] },
                maxRedirects: 3,
                validateStatus: () => true,
            });
            if (res.status === 402) img402++;
            if (res.status >= 400) brokenImageProducts.push(p);
        } catch {
            brokenImageProducts.push(p);
        }
    }

    if (img402 > 0) {
        // 402 = Vercel 이미지 최적화 한도 초과 → 코드에서 next/image 사용 여부 확인 후 자동 수정
        const codeFixResult = await autoFixCodeIssue({
            type: "image-402",
            description: `Vercel 이미지 최적화 402 에러 ${img402}건 - next/image → img 태그 교체 필요`,
        });
        if (codeFixResult) fixes.push(codeFixResult);
        else unfixable.push(`이미지 402 에러 ${img402}건 - 자동 수정 시도했으나 실패`);
    }

    // 깨진 이미지 자동 교체: 쇼핑몰 og:image → 네이버 폴백
    for (const p of brokenImageProducts) {
        let newUrl: string | null = null;

        // 1차: 쇼핑몰 페이지에서 og:image 재추출
        if (p.affiliateLink) {
            newUrl = await fetchShopImage(p.affiliateLink);
            if (newUrl && newUrl === p.imageUrl) newUrl = null; // 같은 URL이면 스킵
            if (newUrl && !(await validateImageUrl(newUrl))) newUrl = null;
        }

        // 2차: 네이버 쇼핑 이미지 검색 폴백
        if (!newUrl) {
            newUrl = await fetchNaverFallbackImage(p.title);
            if (newUrl && !(await validateImageUrl(newUrl))) newUrl = null;
        }

        if (newUrl) {
            await prisma.product.update({ where: { id: p.id }, data: { imageUrl: newUrl } });
            imgFixed++;
            console.log(`[Auto Fix] 이미지 교체: ${p.title}`);
        } else {
            // 이미지를 null로 설정해서 프론트에서 폴백 아이콘 표시
            await prisma.product.update({ where: { id: p.id }, data: { imageUrl: null } });
            console.log(`[Auto Fix] 이미지 제거(폴백표시): ${p.title}`);
        }
    }
    if (brokenImageProducts.length > 0) {
        fixes.push(`깨진 이미지 ${brokenImageProducts.length}건 발견 → ${imgFixed}건 새 이미지로 교체, ${brokenImageProducts.length - imgFixed}건 폴백 처리`);
    }

    // 3. 헬스체크 API 확인
    try {
        const res = await axios.get(`${SITE}/api/monitor/health`, { timeout: 10000 });
        if (res.data?.status !== "healthy") {
            issues.push(`헬스체크 비정상: 딜 ${res.data?.totalDeals}개, 최신 ${res.data?.hoursSinceLatest}시간 전`);
        }
    } catch (e: any) {
        issues.push(`헬스체크 API 실패: ${e.message}`);
    }

    // 4. DB 상태 체크
    const totalActive = await prisma.product.count({ where: { isActive: true } });
    if (totalActive < 5) issues.push(`활성 딜 ${totalActive}개 (5개 미만 - 크롤링 소스 확인 필요)`);

    const noImageCount = await prisma.product.count({
        where: { isActive: true, OR: [{ imageUrl: null }, { imageUrl: "" }] },
    });
    if (noImageCount > totalActive * 0.3) {
        issues.push(`이미지 없는 딜 ${noImageCount}/${totalActive}개 (30% 초과)`);
    }

    // 5. 커뮤니티 링크 자동 교체 (잔존분 추가 처리)
    const communityProducts = await prisma.product.findMany({
        where: {
            isActive: true,
            OR: [
                { affiliateLink: { contains: "clien.net" } },
                { affiliateLink: { contains: "ppomppu.co.kr" } },
                { affiliateLink: { contains: "ruliweb.com" } },
                { affiliateLink: { contains: "quasarzone.com" } },
                { affiliateLink: { contains: "arca.live" } },
            ],
        },
        select: { id: true, title: true, affiliateLink: true, sourceUrl: true, mallName: true },
        take: 10,
    });

    if (communityProducts.length > 0) {
        let linkFixed = 0;
        let linkRemoved = 0;
        for (const p of communityProducts) {
            const postUrl = p.affiliateLink || p.sourceUrl;
            let referer: string;
            try { referer = `https://${new URL(postUrl).hostname}/`; } catch { continue; }

            const shopLink = await fetchShopLink(postUrl, referer);
            if (shopLink) {
                const finalLink = toAliexpressAffiliateLink(toCoupangAffiliateLink(shopLink));
                await prisma.product.update({
                    where: { id: p.id },
                    data: { affiliateLink: finalLink, mallName: getMallNameFromLink(finalLink, p.mallName || "쇼핑몰") },
                });
                linkFixed++;
            } else {
                await prisma.product.update({ where: { id: p.id }, data: { isActive: false } });
                linkRemoved++;
            }
        }
        fixes.push(`커뮤니티 링크 ${communityProducts.length}건 → ${linkFixed}건 쇼핑몰로 교체, ${linkRemoved}건 비활성화`);
    }

    // 6. 가격 이상 자동 수정 (할인가 > 정가 등)
    const priceAnomalies = await prisma.product.findMany({
        where: {
            isActive: true,
            originalPrice: { gt: 0 },
            salePrice: { gt: 0 },
        },
        select: { id: true, title: true, originalPrice: true, salePrice: true, discountPercent: true },
    });
    let priceFixed = 0;
    for (const p of priceAnomalies) {
        if (p.salePrice > p.originalPrice) {
            // 할인가가 정가보다 높으면 스왑
            await prisma.product.update({
                where: { id: p.id },
                data: {
                    originalPrice: p.salePrice,
                    salePrice: p.originalPrice,
                    discountPercent: Math.round(((p.salePrice - p.originalPrice) / p.salePrice) * 100),
                },
            });
            priceFixed++;
            console.log(`[Auto Fix] 가격 스왑: ${p.title} (${p.salePrice}→정가, ${p.originalPrice}→할인가)`);
        } else if (p.discountPercent === 0 && p.originalPrice > p.salePrice) {
            // 할인율 미계산된 경우 자동 계산
            const disc = Math.round(((p.originalPrice - p.salePrice) / p.originalPrice) * 100);
            await prisma.product.update({ where: { id: p.id }, data: { discountPercent: disc } });
            priceFixed++;
        }
    }
    if (priceFixed > 0) fixes.push(`가격 이상 ${priceFixed}건 자동 수정`);

    // 결과 정리 및 알림
    if (fixes.length > 0 || issues.length > 0) {
        console.log(`[Health Check] 수정: ${fixes.length}건, 미해결: ${issues.length}건`);
        await sendTelegramHealthAlert(fixes, issues);
    } else {
        console.log("[Health Check] 사이트 정상");
    }
}

// ─── 코드 레벨 자동 수정 (GitHub 커밋 → Vercel 배포) ────────
const REPO = "Gallas111/it-hotdeallab";

interface CodeIssue {
    type: "image-402" | "build-error" | "component-error" | "api-error";
    description: string;
    errorLog?: string;
}

// 문제 유형별 수정 대상 파일 & 프롬프트 매핑
const CODE_FIX_RULES: Record<string, { files: string[]; prompt: string }> = {
    "image-402": {
        files: ["src/components/DealImage.tsx", "src/app/deal/[slug]/page.tsx"],
        prompt: `Vercel Hobby 플랜의 이미지 최적화 월간 한도(1,000건)가 초과되어 모든 이미지에서 402 Payment Required 에러가 발생하고 있습니다.

수정 방법:
- next/image의 <Image> 컴포넌트를 일반 <img> 태그로 교체
- import Image from "next/image" 제거
- fill 속성 대신 CSS로 동일한 레이아웃 구현 (position:absolute, width:100%, height:100%, object-fit:cover)
- loading="lazy" 추가로 성능 유지
- 기존 onError, fallback 등 에러 핸들링 로직은 반드시 유지`,
    },
    "component-error": {
        files: ["src/components/DealImage.tsx", "src/components/DealCard.tsx", "src/components/ShareButtons.tsx"],
        prompt: `프론트엔드 컴포넌트에서 런타임 에러가 발생하고 있습니다. 에러 로그를 분석하여 수정하세요.
- 타입 에러, null 참조, undefined 접근 등을 방어적으로 수정
- 기존 기능은 모두 유지`,
    },
    "api-error": {
        files: ["src/app/api/cron/scrape/route.ts"],
        prompt: `API 라우트에서 에러가 발생하고 있습니다. 에러 로그를 분석하여 수정하세요.
- import 경로, 타입 에러, 런타임 에러 등을 수정
- 기존 로직 유지, 최소한의 변경만`,
    },
};

async function autoFixCodeIssue(issue: CodeIssue): Promise<string | null> {
    const githubToken = process.env.GITHUB_TOKEN;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!githubToken || !geminiKey) {
        console.log("[Code Fix] GITHUB_TOKEN 또는 GEMINI_API_KEY 미설정");
        return null;
    }

    const rule = CODE_FIX_RULES[issue.type];
    if (!rule) return null;

    try {
        // 최근 30분 내 자동수정 커밋이 있으면 스킵 (무한루프 방지)
        const commitsRes = await fetch(
            `https://api.github.com/repos/${REPO}/commits?per_page=3`,
            { headers: { Authorization: `token ${githubToken}`, Accept: "application/vnd.github.v3+json" } }
        );
        const commits = await commitsRes.json();
        if (Array.isArray(commits)) {
            const recentAutoFix = commits.find((c: any) =>
                c.commit?.message?.includes("[자동수정]") &&
                (Date.now() - new Date(c.commit.committer.date).getTime()) < 30 * 60 * 1000
            );
            if (recentAutoFix) {
                console.log("[Code Fix] 최근 30분 내 자동수정 이력 있음, 스킵");
                return null;
            }
        }

        // 대상 파일들의 현재 코드 가져오기
        const fileContents: { path: string; content: string; sha: string }[] = [];
        for (const filePath of rule.files) {
            try {
                const res = await fetch(
                    `https://api.github.com/repos/${REPO}/contents/${filePath}`,
                    { headers: { Authorization: `token ${githubToken}`, Accept: "application/vnd.github.v3+json" } }
                );
                if (!res.ok) continue;
                const data = await res.json();
                fileContents.push({
                    path: filePath,
                    content: Buffer.from(data.content, "base64").toString("utf-8"),
                    sha: data.sha,
                });
            } catch { continue; }
        }

        if (fileContents.length === 0) return null;

        // Gemini에게 수정 요청
        const genai = new GoogleGenAI({ apiKey: geminiKey });
        const filesContext = fileContents.map(f =>
            `=== ${f.path} ===\n\`\`\`typescript\n${f.content}\n\`\`\``
        ).join("\n\n");

        const response = await genai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: `당신은 Next.js/TypeScript 전문 개발자입니다. 프로덕션 사이트에서 다음 문제가 발생했습니다:

문제: ${issue.description}
${issue.errorLog ? `에러 로그: ${issue.errorLog}` : ""}

${rule.prompt}

현재 파일들:
${filesContext}

반드시 아래 JSON 형식으로만 응답하세요 (설명 없이):
[{"path": "파일경로", "content": "수정된 전체 파일 내용"}, ...]

수정이 필요 없는 파일은 배열에 포함하지 마세요.
수정할 내용이 없으면 빈 배열 []을 반환하세요.`,
        });

        const raw = (response.text ?? "").trim();
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            console.log("[Code Fix] Gemini 응답에서 JSON 파싱 실패");
            return null;
        }

        const fileFixes: { path: string; content: string }[] = JSON.parse(jsonMatch[0]);
        if (fileFixes.length === 0) {
            console.log("[Code Fix] 수정할 내용 없음");
            return null;
        }

        // 각 파일별로 GitHub에 커밋
        const fixedFiles: string[] = [];
        for (const fix of fileFixes) {
            const original = fileContents.find(f => f.path === fix.path);
            if (!original) continue;
            if (original.content.trim() === fix.content.trim()) continue; // 변경 없음

            const commitRes = await fetch(
                `https://api.github.com/repos/${REPO}/contents/${fix.path}`,
                {
                    method: "PUT",
                    headers: {
                        Authorization: `token ${githubToken}`,
                        Accept: "application/vnd.github.v3+json",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        message: `[자동수정] ${issue.type}: ${issue.description.slice(0, 50)}`,
                        content: Buffer.from(fix.content).toString("base64"),
                        sha: original.sha,
                    }),
                }
            );

            if (commitRes.ok) {
                fixedFiles.push(fix.path);
                console.log(`[Code Fix] ${fix.path} 커밋 성공`);
            } else {
                console.log(`[Code Fix] ${fix.path} 커밋 실패:`, await commitRes.text());
            }
        }

        if (fixedFiles.length > 0) {
            return `코드 자동 수정: ${fixedFiles.join(", ")} (${issue.description.slice(0, 40)}) → 배포 중`;
        }
        return null;

    } catch (e: any) {
        console.error("[Code Fix] 에러:", e.message);
        return null;
    }
}

async function sendTelegramHealthAlert(fixes: string[], issues: string[]) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const lines: string[] = [];

    if (fixes.length > 0) {
        lines.push(`🔧 자동 수정 완료:`);
        fixes.forEach(f => lines.push(`  ✅ ${f}`));
    }
    if (issues.length > 0) {
        if (fixes.length > 0) lines.push(``);
        lines.push(`⚠️ 수동 확인 필요:`);
        issues.forEach(i => lines.push(`  🔴 ${i}`));
    }

    const text = [
        `🩺 IT핫딜랩 사이트 점검 리포트`,
        ``,
        ...lines,
        ``,
        `🔗 https://ithotdealab.com`,
    ].join("\n");

    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text,
        });
    } catch { /* 무시 */ }
}

// ─── 카테고리 후처리 보정 (AI 오분류 방지) ──────────────────
// \b는 한글에서 작동하지 않으므로 사용하지 않음
const BRAND_CATEGORY_RULES: { pattern: RegExp; category: string }[] = [
    // 삼성/LG 제품 (Apple보다 먼저 체크 - 갤럭시가 Apple로 오분류되는 것 방지)
    { pattern: /(삼성|samsung|갤럭시|galaxy|갤S|갤[A-Z]?\d|비스포크|bespoke|에어드레서|갤탭|갤럭시\s?탭|갤럭시\s?버즈|갤럭시\s?워치|갤럭시\s?북|갤럭시\s?링)/i, category: "삼성/LG" },
    { pattern: /(LG전자|LG\s?gram|LG그램|스탠바이미|올레드|트롬|오브제|시그니처|퓨리케어|코드제로|디오스)/i, category: "삼성/LG" },
    // Apple 제품
    { pattern: /(apple|아이폰|iphone|맥북|macbook|아이패드|ipad|에어팟|airpods?|애플워치|apple\s?watch|imac|mac\s?mini|mac\s?studio|mac\s?pro|homepod|apple\s?tv)/i, category: "Apple" },
];

function correctCategory(title: string, aiCategory: string): string {
    const combined = title.toLowerCase();
    for (const rule of BRAND_CATEGORY_RULES) {
        if (rule.pattern.test(combined)) {
            if (aiCategory !== rule.category) {
                console.log(`[Category Fix] "${title}" : ${aiCategory} → ${rule.category}`);
            }
            return rule.category;
        }
    }
    return aiCategory;
}

// ─── 쇼핑몰 페이지 제목 추출 + 딜 제목 일치 검증 ─────────
function extractKeywords(text: string): string[] {
    return text
        .replace(/\[.*?\]/g, "")
        .replace(/[0-9,]+원/g, "")
        .replace(/\$[\d,.]+/g, "")
        .replace(/만원대?|역대|최저가?|특가|할인|초특가|오픈박스|리퍼|정품|새제품|미개봉|사전예약|예약판매|KB페이|카드|혜택|더블스토리지/gi, "")
        .replace(/[^\w가-힣a-zA-Z]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter(w => w.length >= 2);
}

async function verifyShopLinkMatch(shopUrl: string, dealTitle: string): Promise<{ match: boolean; shopTitle: string | null }> {
    try {
        const { data: html } = await axios.get(shopUrl, {
            headers: { ...HEADERS, Referer: shopUrl },
            timeout: 8000,
            maxRedirects: 5,
        });
        const $ = cheerio.load(html);

        // 쇼핑몰 페이지에서 상품명 추출 (우선순위)
        const shopTitle =
            $('meta[property="og:title"]').attr("content")?.trim() ||
            $("h1.prod-buy__title").text().trim() ||          // 쿠팡
            $("h1#productName").text().trim() ||               // 11번가
            $("h2.itemtit").text().trim() ||                   // G마켓
            $("h1.product-name").text().trim() ||              // 공통
            $("title").text().trim() ||
            null;

        if (!shopTitle) return { match: true, shopTitle: null }; // 제목 추출 실패 → 통과

        const dealKeywords = extractKeywords(dealTitle);
        const shopKeywords = extractKeywords(shopTitle);

        if (dealKeywords.length === 0 || shopKeywords.length === 0) return { match: true, shopTitle };

        // 핵심 키워드 매칭: 딜 제목의 핵심 단어가 쇼핑몰 제목에 1개 이상 포함되면 OK
        const matchCount = dealKeywords.filter(kw =>
            shopKeywords.some(sk => sk.includes(kw) || kw.includes(sk))
        ).length;

        // 매칭률이 30% 이상이거나 2개 이상 매칭되면 OK
        const matchRatio = matchCount / dealKeywords.length;
        const isMatch = matchCount >= 2 || matchRatio >= 0.3;

        if (!isMatch) {
            console.log(`[Link Mismatch] 딜: "${dealTitle}" ↔ 쇼핑몰: "${shopTitle}" (매칭: ${matchCount}/${dealKeywords.length})`);
        }

        return { match: isMatch, shopTitle };
    } catch {
        return { match: true, shopTitle: null }; // 요청 실패 → 통과 (관대하게)
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
// 소스 3: 뽐뿌 해외뽐뿌 (RSS 피드 - 해외직구 전용)
// ═══════════════════════════════════════════════════════════
async function scrapePpomppuOversea(): Promise<RawDeal[]> {
    try {
        const { data: xml } = await axios.get(
            "https://www.ppomppu.co.kr/rss.php?id=ppomppu4",
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
            deals.push({ title, link, mallName: mallMatch?.[1] || "해외직구", source: "해외뽐뿌" });
        });

        return deals;
    } catch {
        return [];
    }
}

// ═══════════════════════════════════════════════════════════
// 소스 4: 퀘이사존 핫딜
// ═══════════════════════════════════════════════════════════
async function scrapeQuasarzone(): Promise<RawDeal[]> {
    try {
        const { data: html } = await axios.get(
            "https://quasarzone.com/bbs/qb_saleinfo",
            { headers: { ...HEADERS, Referer: "https://quasarzone.com/" }, timeout: 10000 }
        );
        const $ = cheerio.load(html);
        const deals: RawDeal[] = [];
        const seen = new Set<string>();

        $("a.subject-link").each((_, el) => {
            if (deals.length >= 15) return;
            const href = $(el).attr("href") || "";
            if (!href.includes("/views/")) return;
            const title = $(el).find(".ellipsis-with-reply-cnt").text().replace(/\s+/g, " ").trim();
            if (!title || title.length < 5) return;
            const link = href.startsWith("http") ? href : "https://quasarzone.com" + href;
            if (seen.has(link)) return;
            seen.add(link);

            // 종료된 딜 스킵
            const row = $(el).closest("tr, li, div.market-info-list-cont");
            if (row.find(".label").text().includes("종료")) return;

            const category = row.find("span.category").text().trim();
            const mallName = row.find("span.brand").text().trim() || "퀘이사존";
            deals.push({ title: `[${category || mallName}] ${title}`, link, mallName, source: "퀘이사존" });
        });

        return deals;
    } catch {
        return [];
    }
}

// ═══════════════════════════════════════════════════════════
// 소스 5: 아카라이브 핫딜 채널
// ═══════════════════════════════════════════════════════════
async function scrapeArcaLive(): Promise<RawDeal[]> {
    try {
        const { data: html } = await axios.get(
            "https://arca.live/b/hotdeal",
            {
                headers: {
                    ...HEADERS,
                    Referer: "https://arca.live/",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
                timeout: 10000,
            }
        );
        const $ = cheerio.load(html);
        const deals: RawDeal[] = [];
        const seen = new Set<string>();

        $(".vrow").each((_, el) => {
            if (deals.length >= 15) return;
            // 공지·광고 스킵
            if ($(el).hasClass("notice") || $(el).hasClass("head")) return;

            const titleEl = $(el).find(".title a, .col-title a").first();
            const href = titleEl.attr("href") || "";
            if (!href || !href.includes("/b/hotdeal/")) return;

            const title = titleEl.text().replace(/\s+/g, " ").trim();
            if (!title || title.length < 5) return;

            const link = href.startsWith("http") ? href : "https://arca.live" + href.split("?")[0];
            if (seen.has(link)) return;
            seen.add(link);

            const badge = $(el).find(".badge").first().text().trim();
            const mallName = badge || "아카라이브";
            deals.push({ title: badge ? `[${badge}] ${title}` : title, link, mallName, source: "아카라이브" });
        });

        return deals;
    } catch {
        return [];
    }
}

// ═══════════════════════════════════════════════════════════
// 소스 6: 네이버 쇼핑 API (병렬 처리)
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
// 딜 유효성 검사 (품절/404 여부 확인)
// ═══════════════════════════════════════════════════════════
async function isDealExpired(affiliateLink: string): Promise<boolean> {
    // 쇼핑몰 링크가 아닌 경우(= 링크 추출 실패한 불완전한 딜) → 삭제
    if (!isShopLink(affiliateLink)) return true;
    try {
        const { data: html, status } = await axios.get(affiliateLink, {
            headers: HEADERS,
            timeout: 4000,
            maxRedirects: 3,
            validateStatus: (s) => s < 500,
        });
        if (status === 404) return true;
        const SOLD_OUT = [
            "품절", "일시품절", "판매종료", "판매완료", "구매불가",
            "soldout", "sold out", "out of stock",
            "상품이 존재하지 않", "삭제된 상품", "존재하지 않는 상품",
        ];
        const lower = (html as string).toLowerCase();
        return SOLD_OUT.some(kw => lower.includes(kw.toLowerCase()));
    } catch {
        // 타임아웃·봇 차단 등 → 판단 불가, 보존
        return false;
    }
}

// ═══════════════════════════════════════════════════════════
// 메인 핸들러
// ═══════════════════════════════════════════════════════════
async function runScrape() {
    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    // ── 1. 만료 딜 처리 ──────────────────────────────────────
    // 7일 이상 → 무조건 삭제
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const hardExpired = await prisma.product.deleteMany({
        where: { createdAt: { lt: sevenDaysAgo } },
    });

    // 전체 딜 품절/404 체크 (오래된 순으로 10개씩 순환)
    // → 신규 딜 포함 모든 딜이 매 실행마다 점진적으로 체크됨
    const candidates = await prisma.product.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, affiliateLink: true },
        take: 10,
    });
    let softDeleted = 0;
    for (let i = 0; i < candidates.length; i += 5) {
        const batch = candidates.slice(i, i + 5);
        const checks = await Promise.allSettled(batch.map(p => isDealExpired(p.affiliateLink)));
        const toDelete = batch
            .filter((_, j) => checks[j].status === "fulfilled" && (checks[j] as PromiseFulfilledResult<boolean>).value)
            .map(p => p.id);
        if (toDelete.length > 0) {
            await prisma.product.deleteMany({ where: { id: { in: toDelete } } });
            softDeleted += toDelete.length;
        }
    }
    const expired = { count: hardExpired.count + softDeleted };

    // Promise.allSettled: 소스 하나가 죽어도 나머지는 정상 수집
    const [clienResult, ppomppuResult, ppomppuOverseaResult, quasarzoneResult, arcaResult, naverResult] = await Promise.allSettled([
        scrapeClien(),
        scrapePpomppu(),
        scrapePpomppuOversea(),
        scrapeQuasarzone(),
        scrapeArcaLive(),
        scrapeNaverShopping(),
    ]);
    const clienDeals = clienResult.status === "fulfilled" ? clienResult.value : (console.error("[Scrape] 클리앙 실패:", (clienResult as PromiseRejectedResult).reason), []);
    const ppomppuDeals = ppomppuResult.status === "fulfilled" ? ppomppuResult.value : (console.error("[Scrape] 뽐뿌 실패:", (ppomppuResult as PromiseRejectedResult).reason), []);
    const ppomppuOverseaDeals = ppomppuOverseaResult.status === "fulfilled" ? ppomppuOverseaResult.value : (console.error("[Scrape] 해외뽐뿌 실패:", (ppomppuOverseaResult as PromiseRejectedResult).reason), []);
    const quasarzoneDeals = quasarzoneResult.status === "fulfilled" ? quasarzoneResult.value : (console.error("[Scrape] 퀘이사존 실패:", (quasarzoneResult as PromiseRejectedResult).reason), []);
    const arcaDeals = arcaResult.status === "fulfilled" ? arcaResult.value : (console.error("[Scrape] 아카라이브 실패:", (arcaResult as PromiseRejectedResult).reason), []);
    const naverDeals = naverResult.status === "fulfilled" ? naverResult.value : (console.error("[Scrape] 네이버쇼핑 실패:", (naverResult as PromiseRejectedResult).reason), []);

    const allDeals = interleaveDeals(clienDeals, ppomppuDeals, ppomppuOverseaDeals, quasarzoneDeals, arcaDeals, naverDeals);
    const sourceStats = {
        클리앙: clienDeals.length,
        뽐뿌: ppomppuDeals.length,
        해외뽐뿌: ppomppuOverseaDeals.length,
        퀘이사존: quasarzoneDeals.length,
        아카라이브: arcaDeals.length,
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
            const response = await genai.models.generateContent({
                model: "gemini-2.5-flash-lite",
                config: {
                    systemInstruction: `IT·가전·스마트홈 핫딜 전문 큐레이터. 아래 두 조건을 모두 충족해야만 등록.

[등록 가능 제품군]
- IT/전자기기: 노트북, 스마트폰, 태블릿, 모니터, 이어폰, 키보드, 마우스, SSD, 그래픽카드 등
- 가전제품: TV, 냉장고, 세탁기, 에어컨, 공기청정기, 로봇청소기, 건조기, 식기세척기 등
- 스마트홈/IoT: 스마트워치, 블루투스스피커, 스마트조명, 홈캠, 도어락 등
- 생활가전: 드라이어, 고데기, 전동칫솔, 전기면도기, 커피머신, 청소기 등

[카테고리 분류 규칙 - 반드시 준수]
★ 브랜드/제품명으로 카테고리를 정확히 분류할 것:
- "Apple" 카테고리: Apple, 아이폰, iPhone, 맥북, MacBook, 아이패드, iPad, 에어팟, AirPods, 애플워치, Apple Watch, iMac, Mac Mini, Mac Studio, Mac Pro, HomePod, Apple TV 제품만 해당
- "삼성/LG" 카테고리: 삼성, Samsung, 갤럭시, Galaxy, 비스포크, BESPOKE, 에어드레서, LG, 그램, gram, 스탠바이미, 올레드, OLED(LG), 트롬, 오브제, 시그니처, 퓨리케어, 코드제로, 디오스 등
- "노트북/PC" 카테고리: 레노버, ASUS, MSI, HP, 델, Acer, 한성, 기가바이트, 데스크톱, 조립PC 등 (삼성 갤럭시북/LG그램은 "삼성/LG"로)
- "모니터/주변기기" 카테고리: 모니터, 키보드, 마우스, 웹캠, SSD, HDD, RAM, 그래픽카드, USB허브, 도킹스테이션 등
- "음향/스마트기기" 카테고리: 무선이어폰, 헤드폰, 블루투스스피커, 스마트워치(삼성/애플 제외), 스마트밴드, VR 등
- "생활가전" 카테고리: 드라이어, 고데기, 전동칫솔, 전기면도기, 커피머신, 안마기, 제습기 등
- "해외직구" 카테고리: 해외뽐뿌 출처 또는 Amazon/AliExpress/eBay 등 해외몰 상품
- "골드박스" 카테고리: 쿠팡 골드박스/타임딜 명시된 경우만

★ 주의: 갤럭시 S/Z/A/탭/버즈/워치/북은 반드시 "삼성/LG"이다. 절대 "Apple"로 분류하지 마라.

[등록 조건 - 반드시 둘 다 충족]
1. 위 제품군에 해당하는 전자/가전/스마트 기기
2. 실질적 가격 혜택: 정가 대비 할인, 기간한정 특가, 역대최저가, 쿠폰/카드 할인가 등

[제외 항목]
- 단순 제품 소개·리뷰·추천글 (할인 없음)
- 정가 그대로 판매
- 소프트웨어·게임·구독 서비스
- 식품·의류·생활용품 등 전자/가전과 무관한 제품

[해외직구 참고]
- 출처가 해외뽐뿌/퀘이사존이면서 Amazon/AliExpress/eBay/Newegg/Costco 등 해외 쇼핑몰 상품이면 category를 "해외직구"로 분류
- 외화 가격은 반드시 원화(KRW)로 환산하여 숫자로 반환 (환율: $1≈1,450원, ¥100≈950원, €1≈1,550원)
- 예: $18.9 → salePrice:27405, $899.99 → salePrice:1304985
- 제목에 가격 힌트가 있으면 반드시 추출 (예: "1.5만원대" → salePrice:15000)

반드시 JSON만 반환. 조건 미충족: {"isIT":false}
조건 충족 시:
{"isIT":true,"refinedTitle":"가격 혜택 강조 제목(50자이내)","category":"골드박스|Apple|삼성/LG|노트북/PC|모니터/주변기기|음향/스마트기기|생활가전|해외직구 중 하나","originalPrice":정가숫자(모르면0),"salePrice":할인가숫자(모르면0),"discountInfo":"할인 핵심 한줄(예:20%할인/역대최저/오늘만특가)","aiSummary":"한줄요약(60자이내)","aiPros":"장점1, 장점2, 장점3","aiTarget":"추천대상(40자이내)","seoContent":"500자이상 상세설명"}`,
                },
                contents: `출처:${deal.source} 제목:${deal.title}`,
            });
            const raw = (response.text ?? "").trim();
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("no JSON in response");
            aiData = JSON.parse(jsonMatch[0]);
        } catch {
            continue;
        }

        if (!aiData.isIT) continue;

        // ── 카테고리 후처리 보정 (AI 오분류 방지) ──
        if (aiData.category) {
            aiData.category = correctCategory(
                `${deal.title} ${aiData.refinedTitle || ""}`,
                aiData.category
            );
        }

        const _origCheck = Number(aiData.originalPrice) || 0;
        const _saleCheck = Number(aiData.salePrice) || 0;
        const _hasDiscount = _origCheck > 0 || _saleCheck > 0 || !!aiData.discountInfo;
        if (!_hasDiscount) continue;

        const referer = `https://${new URL(deal.link).hostname}/`;
        let affiliateLink = deal.link;
        let imageUrl: string | null = deal.imageUrl || null;
        // 커뮤니티 CDN 이미지 즉시 제거 (핫링크 차단 + 제품 이미지 아님)
        if (imageUrl && isCommunityImage(imageUrl)) imageUrl = null;

        if (!isShopLink(deal.link)) {
            const shopLink = await fetchShopLink(deal.link, referer);
            if (!shopLink) {
                console.log(`[Skip] 쇼핑몰 링크 추출 실패, 저장 안함: "${deal.title}"`);
                continue;
            }
            affiliateLink = shopLink;
            if (!imageUrl) {
                imageUrl = await fetchShopImage(shopLink);
            }
        } else if (!imageUrl) {
            imageUrl = await fetchShopImage(deal.link);
        }

        affiliateLink = toCoupangAffiliateLink(affiliateLink);
        affiliateLink = toAliexpressAffiliateLink(affiliateLink);

        // ── 링크-제목 일치 검증 (다른 상품 링크 방지) ──
        if (isShopLink(affiliateLink)) {
            const titleToCheck = aiData.refinedTitle || deal.title;
            const { match } = await verifyShopLinkMatch(affiliateLink, titleToCheck);
            if (!match) {
                console.log(`[Skip] 링크 불일치로 스킵: "${titleToCheck}" → ${affiliateLink}`);
                continue;
            }
        }

        // 이미지 유효성 검증 (깨진 URL 방지)
        if (imageUrl && !(await validateImageUrl(imageUrl))) {
            console.log(`[Image] 깨진 이미지 감지, 네이버 폴백 시도: ${imageUrl}`);
            imageUrl = null;
        }

        if (!imageUrl) {
            // AI가 정제한 제목으로 먼저 시도, 실패하면 원본 제목으로 재시도
            imageUrl = await fetchNaverFallbackImage(aiData.refinedTitle || deal.title);
            if (!imageUrl && aiData.refinedTitle) {
                imageUrl = await fetchNaverFallbackImage(deal.title);
            }
            // 폴백 이미지도 검증
            if (imageUrl && !(await validateImageUrl(imageUrl))) {
                imageUrl = null;
            }
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
                mallName: getMallNameFromLink(affiliateLink, deal.mallName),
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

    const communitySources = ["클리앙", "뽐뿌", "해외뽐뿌"];
    const hasBrokenSource = communitySources.some(src => (sourceStats as any)[src] === 0);
    const totalActive = await prisma.product.count({ where: { isActive: true } });
    if (hasBrokenSource || totalActive < 5) {
        await sendTelegramMonitorAlert(sourceStats, totalActive);
    }

    // 이미지 없는 기존 제품 자동 복구 (매 실행마다)
    await repairMissingImages().catch(err => console.error("[Image Repair] Error:", err));

    // 커뮤니티 링크 → 쇼핑몰 링크 자동 교체 (매 실행마다)
    await repairCommunityLinks().catch(err => console.error("[Link Repair] Error:", err));

    // 사이트 상태 점검 (매 실행마다)
    await runSiteHealthCheck().catch(err => console.error("[Health Check] Error:", err));

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

    if (!process.env.GEMINI_API_KEY) {
        return NextResponse.json({ error: "GEMINI_API_KEY 환경변수 미설정" }, { status: 500 });
    }

    // 즉시 202 응답 후 백그라운드에서 크롤링 처리 (cron-job.org 30초 타임아웃 우회)
    waitUntil(runScrape().catch(err => console.error("Scrape Error:", err)));

    return NextResponse.json({ accepted: true, message: "수집 시작됨 (백그라운드 처리)" }, { status: 202 });
}
