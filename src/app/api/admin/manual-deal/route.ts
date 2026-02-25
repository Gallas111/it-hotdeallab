import { NextResponse } from "next/server";
import * as https from "node:https";
import * as http from "node:http";
import * as zlib from "node:zlib";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

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

// Naver 웹검색으로 Coupang 상품명 조회 (상품 ID 기반)
async function searchNaverWeb(productId: string): Promise<string> {
    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;
    if (!id || !secret || !productId) return "";
    try {
        const { data } = await axios.get("https://openapi.naver.com/v1/search/webkr.json", {
            params: { query: `coupang.com/vp/products/${productId}`, display: 5 },
            headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
            timeout: 6000,
        });
        for (const item of (data.items || [])) {
            if ((item.link || "").includes(`/products/${productId}`)) {
                const title = item.title
                    .replace(/<[^>]+>/g, "")
                    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
                    .replace(/\s*[:\-|]\s*쿠팡\s*$/i, "").trim();
                if (title) return title;
            }
        }
        // productId가 포함된 첫 결과라도 사용
        const first = data.items?.[0];
        if (first) {
            return first.title
                .replace(/<[^>]+>/g, "")
                .replace(/&amp;/g, "&").replace(/\s*[:\-|]\s*쿠팡\s*$/i, "").trim();
        }
    } catch (e: any) {
        console.error("Naver webkr error:", e.message);
    }
    return "";
}

// Naver Shopping으로 이미지+가격 조회
async function searchNaverShopping(query: string): Promise<{ image: string | null; price: string; title: string }> {
    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;
    if (!id || !secret || !query) return { image: null, price: "", title: "" };
    try {
        const { data } = await axios.get("https://openapi.naver.com/v1/search/shop.json", {
            params: { query, display: 1, sort: "sim" },
            headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
            timeout: 5000,
        });
        const item = data.items?.[0];
        if (!item) return { image: null, price: "", title: "" };
        const img = item.image;
        const shoppingTitle = item.title?.replace(/<[^>]+>/g, "").trim() || "";
        return {
            image: img ? (img.startsWith("//") ? "https:" + img : img) : null,
            price: item.lprice || "",
            title: shoppingTitle,
        };
    } catch {
        return { image: null, price: "", title: "" };
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

        // 3. Naver 웹검색으로 상품명 조회
        let pageTitle = "";
        if (productId) {
            pageTitle = await searchNaverWeb(productId);
        }
        console.log(`[manual-deal] title from naver web: "${pageTitle}"`);

        // 4. Naver Shopping으로 이미지+가격 (상품명으로 검색)
        let imageUrl: string | null = null;
        let rawPrice = "";
        if (pageTitle) {
            const shop = await searchNaverShopping(pageTitle);
            imageUrl = shop.image;
            rawPrice = shop.price;
            // 웹검색 결과가 없었으면 쇼핑 결과 제목 사용
            if (!pageTitle && shop.title) pageTitle = shop.title;
        }

        console.log(`[manual-deal] image="${imageUrl?.substring(0, 60)}" price="${rawPrice}"`);

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

        // 5. Claude AI 분석
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
        const message = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 1200,
            system: `핫딜 큐레이터. 상품명과 가격으로 핫딜 정보 생성.
반드시 JSON만 반환:
{"refinedTitle":"제목(50자이내)","category":"골드박스|Apple|삼성/LG|노트북/PC|모니터/주변기기|음향/스마트기기|생활가전 중 하나","originalPrice":정가숫자(모르면0),"salePrice":할인가숫자(모르면0),"discountInfo":"할인 핵심 한줄","aiSummary":"한줄요약(60자이내)","aiPros":"장점1, 장점2, 장점3","aiTarget":"추천대상(40자이내)","seoContent":"300자이상 상세설명"}`,
            messages: [{
                role: "user",
                content: `상품명: ${pageTitle}\n가격: ${rawPrice ? rawPrice + "원" : "정보 없음"}\n링크: ${productUrl}`,
            }],
        });

        const block = message.content[0];
        if (block.type !== "text") throw new Error("AI 응답 오류");
        const raw = block.text.trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error(`AI 응답 파싱 실패: ${raw.substring(0, 100)}`);
        const aiData = JSON.parse(jsonMatch[0]);

        const originalPrice = Number(aiData.originalPrice) || 0;
        const salePrice = Number(aiData.salePrice) || 0;
        const discountPercent =
            originalPrice > 0 && salePrice > 0 && originalPrice > salePrice
                ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
                : 0;

        const product = await prisma.product.create({
            data: {
                title: aiData.refinedTitle || pageTitle,
                slug: generateSlug(aiData.refinedTitle || pageTitle),
                imageUrl: imageUrl || undefined,
                originalPrice,
                salePrice,
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
