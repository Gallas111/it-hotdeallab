import { NextResponse } from "next/server";
import * as https from "node:https";
import * as http from "node:http";
import * as zlib from "node:zlib";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { getCoupangProductInfo } from "@/lib/coupang-scraper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

function generateSlug(title: string): string {
    const ascii = title.replace(/\[.*?\]/g, "").trim();
    return `${ascii.substring(0, 20).replace(/[^a-zA-Z0-9가-힣]/g, "-")}-${Date.now()}`;
}

function toCoupangAffiliateLink(url: string): string {
    const partnersId = process.env.COUPANG_PARTNERS_ID || "";
    if (!partnersId) return url;
    if (!url.includes("coupang.com")) return url;
    if (url.includes("link.coupang.com")) return url;
    try {
        const u = new URL(url);
        u.searchParams.set("partnerCode", partnersId);
        return u.toString();
    } catch {
        return url;
    }
}

// 단일 HTTP 요청 (리다이렉트 따라가지 않음)
function rawGet(url: string, extraHeaders: Record<string, string> = {}): Promise<{
    status: number;
    headers: Record<string, string | string[]>;
    body: string;
}> {
    return new Promise((resolve, reject) => {
        let parsed: URL;
        try { parsed = new URL(url); } catch (e) { reject(e); return; }

        const mod = parsed.protocol === "https:" ? https : http;
        const req = mod.request({
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: "GET",
            headers: {
                "User-Agent": BROWSER_UA,
                "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
                "Accept-Language": "ko-KR,ko;q=0.9",
                "Accept-Encoding": "gzip, deflate",
                ...extraHeaders,
            },
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => {
                const buf = Buffer.concat(chunks);
                const enc = ((res.headers["content-encoding"] as string) || "").toLowerCase();
                const decode = (): Promise<string> =>
                    new Promise((r, j) => {
                        if (enc === "gzip") zlib.gunzip(buf, (e, d) => e ? j(e) : r(d.toString("utf-8")));
                        else if (enc === "deflate") zlib.inflate(buf, (e, d) => e ? j(e) : r(d.toString("utf-8")));
                        else r(buf.toString("utf-8"));
                    });
                decode().then(body =>
                    resolve({ status: res.statusCode ?? 200, headers: res.headers as any, body })
                ).catch(reject);
            });
        });
        req.on("error", reject);
        req.setTimeout(12000, () => { req.destroy(); reject(new Error("Timeout")); });
        req.end();
    });
}

// link.coupang.com → 실제 상품 URL 추출 (리다이렉트만 추적, HTML 미수신)
async function resolveToProductUrl(startUrl: string): Promise<string> {
    if (!startUrl.includes("link.coupang.com")) return startUrl;

    let url = startUrl;
    const cookies: string[] = [];

    for (let hop = 0; hop < 10; hop++) {
        const extra: Record<string, string> = {};
        if (cookies.length) extra["Cookie"] = cookies.join("; ");

        try {
            const res = await rawGet(url, extra);

            // 쿠키 수집
            const sc = res.headers["set-cookie"];
            if (sc) {
                (Array.isArray(sc) ? sc : [sc as string])
                    .forEach(c => cookies.push(c.split(";")[0].trim()));
            }

            console.log(`[resolve hop${hop}] status=${res.status} url=${url.substring(0, 80)}`);

            if (res.status >= 300 && res.status < 400) {
                const loc = res.headers["location"] as string | undefined;
                if (loc) {
                    const next = loc.startsWith("http") ? loc : new URL(loc, url).href;
                    // 상품 페이지 도달 시 반환
                    if (next.includes("coupang.com/vp/products") || next.includes("coupang.com/np/")) {
                        console.log(`[resolve] 상품 URL 확보: ${next.substring(0, 80)}`);
                        return next;
                    }
                    url = next;
                    continue;
                }
            }
        } catch (e: any) {
            console.error(`[resolve hop${hop}] error: ${e.message}`);
        }
        break;
    }

    return url;
}

// 텍스트에서 할인율/정가 추출
function parsePriceHints(text: string, salePrice: number): {
    originalPrice: number;
    discountPercent: number;
} {
    const pctMatch = text.match(/(\d+)%/g) || [];
    const discountPercent = pctMatch
        .map(s => parseInt(s))
        .filter(n => n >= 5 && n <= 90)[0] || 0;

    const priceMatches = text.match(/[\d,]+원/g) || [];
    const prices = priceMatches
        .map(s => parseInt(s.replace(/[,원]/g, "")))
        .filter(n => n > 1000 && n < 10_000_000);

    const higherPrices = prices.filter(p => p > salePrice * 1.05);
    let originalPrice = higherPrices.length > 0 ? Math.min(...higherPrices) : 0;

    if (originalPrice === 0 && discountPercent > 0 && salePrice > 0) {
        const calc = Math.round(salePrice / (1 - discountPercent / 100) / 100) * 100;
        if (calc > salePrice && calc < salePrice * 10) originalPrice = calc;
    }

    const computedDiscount = originalPrice > 0 && salePrice > 0
        ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
        : discountPercent;

    return { originalPrice, discountPercent: computedDiscount };
}

// Naver 웹검색으로 Coupang 상품명 + 가격 힌트 조회 (상품 ID 기반)
async function searchNaverWeb(productId: string): Promise<{
    title: string;
    originalPrice: number;
    discountPercent: number;
}> {
    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;
    if (!id || !secret || !productId) return { title: "", originalPrice: 0, discountPercent: 0 };
    try {
        const { data } = await axios.get("https://openapi.naver.com/v1/search/webkr.json", {
            params: { query: `coupang.com/vp/products/${productId}`, display: 5 },
            headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
            timeout: 6000,
        });
        let bestTitle = "";
        let bestHints = { originalPrice: 0, discountPercent: 0 };

        for (const item of (data.items || [])) {
            const isProductPage = (item.link || "").includes(`/products/${productId}`);
            const cleanTitle = item.title
                .replace(/<[^>]+>/g, "")
                .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
                .replace(/\s*[:\-|]\s*쿠팡\s*$/i, "").trim();

            if (isProductPage && !bestTitle && cleanTitle) bestTitle = cleanTitle;

            // 스니펫에서 가격 힌트 추출 (salePrice 모르므로 0으로 전달, 나중에 정제)
            const text = [item.title, item.description].join(" ")
                .replace(/<[^>]+>/g, "")
                .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
            const hints = parsePriceHints(text, 0);
            if ((hints.originalPrice > 0 || hints.discountPercent > 0) && bestHints.originalPrice === 0 && bestHints.discountPercent === 0) {
                bestHints = hints;
            }
        }

        if (!bestTitle && data.items?.[0]) {
            bestTitle = data.items[0].title
                .replace(/<[^>]+>/g, "")
                .replace(/&amp;/g, "&").replace(/\s*[:\-|]\s*쿠팡\s*$/i, "").trim();
        }

        return { title: bestTitle, ...bestHints };
    } catch (e: any) {
        console.error("Naver webkr error:", e.message);
    }
    return { title: "", originalPrice: 0, discountPercent: 0 };
}

// Naver Shopping에서 쿠팡 전용 리스팅 우선 조회
async function searchNaverShopping(query: string): Promise<{
    image: string | null; price: string; originalPrice: string; title: string;
}> {
    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;
    if (!id || !secret || !query) return { image: null, price: "", originalPrice: "", title: "" };
    try {
        const { data } = await axios.get("https://openapi.naver.com/v1/search/shop.json", {
            params: { query, display: 10, sort: "sim" },
            headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
            timeout: 5000,
        });
        const items: any[] = data.items || [];
        // 쿠팡 리스팅 우선, 없으면 첫 번째
        const item = items.find(i =>
            i.mallName?.includes("쿠팡") || (i.link || "").includes("coupang.com")
        ) ?? items[0];
        if (!item) return { image: null, price: "", originalPrice: "", title: "" };
        const img = item.image;
        const lprice = item.lprice || "";
        const hprice = Number(item.hprice) > Number(item.lprice) ? item.hprice : "";
        return {
            image: img ? (img.startsWith("//") ? "https:" + img : img) : null,
            price: lprice,
            originalPrice: hprice,
            title: item.title?.replace(/<[^>]+>/g, "").trim() || "",
        };
    } catch {
        return { image: null, price: "", originalPrice: "", title: "" };
    }
}

export async function POST(request: Request) {
    try {
        const { affiliateLink, category: forceCategory } = await request.json();
        if (!affiliateLink) {
            return NextResponse.json({ error: "affiliateLink 필요" }, { status: 400 });
        }

        // 1. 실제 상품 URL 확보
        const productUrl = await resolveToProductUrl(affiliateLink);
        console.log(`[manual-deal] productUrl=${productUrl.substring(0, 100)}`);

        // 2. 상품 ID 추출
        const productIdMatch = productUrl.match(/\/(?:vp|np)\/products\/(\d+)/);
        const productId = productIdMatch?.[1] || "";
        console.log(`[manual-deal] productId=${productId}`);

        // 3. 스크래핑 (Scrape.do → ScraperAPI 순) + Naver 병렬 (fallback)
        const scraperTarget = productUrl.includes("coupang.com") ? productUrl : affiliateLink;
        const [scraperResult, webResult] = await Promise.all([
            getCoupangProductInfo(scraperTarget),
            productId ? searchNaverWeb(productId) : Promise.resolve({ title: "", originalPrice: 0, discountPercent: 0 }),
        ]);

        console.log(`[manual-deal] scraper title="${scraperResult?.title?.substring(0, 30)}" sale=${scraperResult?.salePrice} orig=${scraperResult?.originalPrice}`);
        console.log(`[manual-deal] webkr title="${webResult.title}" orig=${webResult.originalPrice} disc=${webResult.discountPercent}%`);

        // 제목: ScraperAPI 우선, 없으면 Naver webkr
        let pageTitle = scraperResult?.title || webResult.title || "";

        // 이미지/가격: ScraperAPI 우선
        let imageUrl: string | null = scraperResult?.image || null;
        let rawPrice = scraperResult?.salePrice ? String(scraperResult.salePrice) : "";
        let rawOriginalPrice = scraperResult?.originalPrice ? String(scraperResult.originalPrice) : "";

        // 4. ScraperAPI로 부족한 정보만 Naver Shopping으로 보완
        if (!imageUrl || !rawPrice || !pageTitle) {
            const shopQuery = pageTitle || (productId ? `쿠팡 ${productId}` : "");
            if (shopQuery) {
                const shop = await searchNaverShopping(shopQuery);
                if (!imageUrl && shop.image) imageUrl = shop.image;
                if (!rawPrice && shop.price) rawPrice = shop.price;
                if (!rawOriginalPrice && shop.originalPrice) rawOriginalPrice = shop.originalPrice;
                if (!pageTitle && shop.title) pageTitle = shop.title;
            }
        }

        // 정가: ScraperAPI → Naver Shopping → Naver webkr 순
        if (!rawOriginalPrice && webResult.originalPrice > 0) {
            rawOriginalPrice = String(webResult.originalPrice);
        }

        console.log(`[manual-deal] final title="${pageTitle}" price="${rawPrice}" orig="${rawOriginalPrice}" img=${!!imageUrl}`);

        // 파트너스 링크 결정
        const finalLink = affiliateLink.includes("link.coupang.com")
            ? affiliateLink
            : toCoupangAffiliateLink(affiliateLink);

        if (!pageTitle) {
            return NextResponse.json({
                success: false,
                error: `상품 정보 조회 실패 (productId: ${productId || "미확인"}). 쿠팡 직접 URL(www.coupang.com/vp/...)로 다시 시도해보세요.`,
            }, { status: 400 });
        }

        // 5. Gemini AI 분석
        const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
        const response = await genai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            config: {
                systemInstruction: `핫딜 큐레이터. 상품명과 가격으로 핫딜 정보 생성.
반드시 JSON만 반환:
{"refinedTitle":"제목(50자이내)","category":"골드박스|Apple|삼성/LG|노트북/PC|모니터/주변기기|음향/스마트기기|생활가전 중 하나","originalPrice":정가숫자(모르면0),"salePrice":할인가숫자(모르면0),"discountInfo":"할인 핵심 한줄","aiSummary":"한줄요약(60자이내)","aiPros":"장점1, 장점2, 장점3","aiTarget":"추천대상(40자이내)","seoContent":"300자이상 상세설명"}`,
            },
            contents: `상품명: ${pageTitle}\n현재가: ${rawPrice ? rawPrice + "원" : "정보 없음"}\n정가: ${rawOriginalPrice ? rawOriginalPrice + "원" : "정보 없음"}${webResult.discountPercent > 0 && !rawOriginalPrice ? `\n할인율 힌트: ${webResult.discountPercent}%` : ""}\n링크: ${productUrl}`,
        });

        const raw = (response.text ?? "").trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error(`AI 응답 파싱 실패: ${raw.substring(0, 100)}`);
        const aiData = JSON.parse(jsonMatch[0]);

        // 가격: ScraperAPI 값 우선 (더 정확), 없으면 AI 분석값
        const finalSalePrice = scraperResult?.salePrice || Number(aiData.salePrice) || 0;
        const finalOriginalPrice = scraperResult?.originalPrice || Number(aiData.originalPrice) || 0;
        const discountPercent =
            finalOriginalPrice > 0 && finalSalePrice > 0 && finalOriginalPrice > finalSalePrice
                ? Math.round(((finalOriginalPrice - finalSalePrice) / finalOriginalPrice) * 100)
                : 0;

        const product = await prisma.product.create({
            data: {
                title: aiData.refinedTitle || pageTitle,
                slug: generateSlug(aiData.refinedTitle || pageTitle),
                imageUrl: imageUrl || undefined,
                originalPrice: finalOriginalPrice,
                salePrice: finalSalePrice,
                discountPercent,
                category: forceCategory || aiData.category || "골드박스",
                mallName: "쿠팡",
                sourceUrl: affiliateLink,
                aiSummary: aiData.discountInfo
                    ? `[${aiData.discountInfo}] ${aiData.aiSummary || ""}`.trim()
                    : aiData.aiSummary || "",
                aiPros: aiData.aiPros || "",
                aiTarget: aiData.aiTarget || "",
                seoContent: aiData.seoContent || "",
                affiliateLink: finalLink,
                isActive: true,
            },
        });

        return NextResponse.json({
            success: true,
            id: product.id,
            title: product.title,
            message: `"${product.title}" 등록 완료`,
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
