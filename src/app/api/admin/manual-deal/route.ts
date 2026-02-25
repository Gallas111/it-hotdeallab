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

// Node.js 내장 https 모듈로 단일 요청 (리다이렉트 안 따라감)
function rawGet(url: string, extraHeaders: Record<string, string> = {}): Promise<{
    status: number;
    headers: Record<string, string | string[]>;
    body: string;
}> {
    return new Promise((resolve, reject) => {
        let parsed: URL;
        try { parsed = new URL(url); } catch (e) { reject(e); return; }

        const mod = parsed.protocol === "https:" ? https : http;
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: "GET",
            headers: {
                "User-Agent": BROWSER_UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "ko-KR,ko;q=0.9",
                "Accept-Encoding": "gzip, deflate",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Upgrade-Insecure-Requests": "1",
                ...extraHeaders,
            },
        };

        const req = mod.request(options, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => {
                const buf = Buffer.concat(chunks);
                const enc = ((res.headers["content-encoding"] as string) || "").toLowerCase();
                const decode = (): Promise<string> =>
                    new Promise((r, j) => {
                        if (enc === "gzip") zlib.gunzip(buf, (e, d) => (e ? j(e) : r(d.toString("utf-8"))));
                        else if (enc === "deflate") zlib.inflate(buf, (e, d) => (e ? j(e) : r(d.toString("utf-8"))));
                        else r(buf.toString("utf-8"));
                    });
                decode()
                    .then((body) =>
                        resolve({ status: res.statusCode ?? 200, headers: res.headers as any, body })
                    )
                    .catch(reject);
            });
        });

        req.on("error", reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
        req.end();
    });
}

// 리다이렉트 체인을 직접 추적 (쿠키 수집 포함)
async function fetchFollowingRedirects(startUrl: string): Promise<{
    body: string; finalUrl: string;
}> {
    let url = startUrl;
    const cookies: string[] = [];

    for (let hop = 0; hop < 12; hop++) {
        const extra: Record<string, string> = {};
        if (cookies.length) extra["Cookie"] = cookies.join("; ");
        if (url.includes("coupang.com") && !url.includes("link.coupang.com")) {
            extra["Referer"] = "https://link.coupang.com/";
        }

        let res: Awaited<ReturnType<typeof rawGet>>;
        try {
            res = await rawGet(url, extra);
        } catch (e: any) {
            console.error(`[hop ${hop}] rawGet error: ${e.message}`);
            break;
        }

        // 쿠키 수집
        const sc = res.headers["set-cookie"];
        if (sc) {
            const list = Array.isArray(sc) ? sc : [sc as string];
            list.forEach((c: string) => {
                const kv = c.split(";")[0].trim();
                if (kv) cookies.push(kv);
            });
        }

        console.log(`[hop ${hop}] status=${res.status} url=${url.substring(0, 80)}`);

        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers["location"] as string | undefined;
            if (loc) {
                url = loc.startsWith("http") ? loc : new URL(loc, url).href;
                continue;
            }
        }

        // 200이거나 더 이상 리다이렉트 없음
        console.log(`[hop ${hop}] body_len=${res.body.length} snippet="${res.body.substring(0, 120).replace(/\n/g, " ")}"`);
        return { body: res.body, finalUrl: url };
    }

    return { body: "", finalUrl: url };
}

// HTML에서 og:title, og:image, 가격 파싱
function parseProductHtml(html: string): {
    title: string; imageUrl: string | null; rawPrice: string;
} {
    const unescape = (s: string) =>
        s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    const titleMatch =
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"'<>]{2,})["']/i) ||
        html.match(/<meta[^>]+content=["']([^"'<>]{2,})["'][^>]+property=["']og:title["']/i);
    const rawTitle = titleMatch?.[1] ? unescape(titleMatch[1]) : "";
    const title = rawTitle.replace(/\s*[:\-|]\s*쿠팡.*$/i, "").trim();

    const imageMatch =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"'<>]+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"'<>]+)["'][^>]+property=["']og:image["']/i);
    const imageUrl = imageMatch?.[1] || null;

    // 가격: JSON-LD 우선
    let rawPrice = "";
    for (const block of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
            const json = JSON.parse(block[1]);
            const price = json?.offers?.price ?? json?.offers?.[0]?.price;
            if (price) { rawPrice = String(price).replace(/,/g, ""); break; }
        } catch { /* skip */ }
    }
    if (!rawPrice) {
        for (const pat of [/"salePrice":\s*"?([\d]+)"?/, /"finalPrice":\s*"?([\d]+)"?/, /"price":\s*"?([\d]+)"?/]) {
            const m = html.match(pat);
            if (m) { rawPrice = m[1]; break; }
        }
    }

    return { title, imageUrl, rawPrice };
}

// 네이버쇼핑으로 이미지/가격 보완
async function searchNaver(title: string): Promise<{ image: string | null; price: string }> {
    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;
    if (!id || !secret || !title) return { image: null, price: "" };
    try {
        const { data } = await axios.get("https://openapi.naver.com/v1/search/shop.json", {
            params: { query: title, display: 1, sort: "sim" },
            headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
            timeout: 5000,
        });
        const item = data.items?.[0];
        if (!item) return { image: null, price: "" };
        const img = item.image;
        return {
            image: img ? (img.startsWith("//") ? "https:" + img : img) : null,
            price: item.lprice || "",
        };
    } catch {
        return { image: null, price: "" };
    }
}

export async function POST(request: Request) {
    try {
        const { affiliateLink, category: forceCategory } = await request.json();
        if (!affiliateLink) {
            return NextResponse.json({ error: "affiliateLink 필요" }, { status: 400 });
        }

        // 리다이렉트 체인 추적 후 HTML 수신
        const { body: html, finalUrl } = await fetchFollowingRedirects(affiliateLink);
        const { title: pageTitle, imageUrl: pageImage, rawPrice: pagePrice } = parseProductHtml(html);

        console.log(`[manual-deal] title="${pageTitle}" price="${pagePrice}" image="${pageImage?.substring(0, 60)}"`);

        // 이미지/가격 부족하면 네이버쇼핑 보완
        let imageUrl = pageImage;
        let rawPrice = pagePrice;
        if (pageTitle && (!imageUrl || !rawPrice)) {
            const naver = await searchNaver(pageTitle);
            if (!imageUrl) imageUrl = naver.image;
            if (!rawPrice) rawPrice = naver.price;
        }

        // 파트너스 링크 결정
        const finalLink = affiliateLink.includes("link.coupang.com")
            ? affiliateLink
            : toCoupangAffiliateLink(affiliateLink);

        if (!pageTitle) {
            return NextResponse.json({
                success: false,
                error: "상품 정보를 가져오지 못했습니다. www.coupang.com/vp/... 직접 링크를 사용해보세요.",
            }, { status: 400 });
        }

        // Claude AI 분석
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
        const message = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 1200,
            system: `핫딜 큐레이터. 상품명과 가격으로 핫딜 정보 생성.
반드시 JSON만 반환:
{"refinedTitle":"제목(50자이내)","category":"골드박스|Apple|삼성/LG|노트북/PC|모니터/주변기기|음향/스마트기기|생활가전 중 하나","originalPrice":정가숫자(모르면0),"salePrice":할인가숫자(모르면0),"discountInfo":"할인 핵심 한줄","aiSummary":"한줄요약(60자이내)","aiPros":"장점1, 장점2, 장점3","aiTarget":"추천대상(40자이내)","seoContent":"300자이상 상세설명"}`,
            messages: [{
                role: "user",
                content: `상품명: ${pageTitle}\n가격: ${rawPrice ? rawPrice + "원" : "정보 없음"}\n링크: ${finalUrl}`,
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
