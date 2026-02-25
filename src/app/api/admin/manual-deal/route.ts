import { NextResponse } from "next/server";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
};

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

// link.coupang.com 단축 링크 → 실제 상품 URL 추출
async function resolveShortLink(url: string): Promise<string> {
    if (!url.includes("link.coupang.com")) return url;
    try {
        // 리다이렉트를 따르지 않고 Location 헤더만 추출
        const r = await axios.get(url, {
            headers: BROWSER_HEADERS,
            maxRedirects: 0,
            timeout: 10000,
            validateStatus: (s) => s >= 200 && s < 400,
        });
        const location = r.headers["location"] as string | undefined;
        if (location) {
            return location.startsWith("http") ? location : `https://www.coupang.com${location}`;
        }
        // 리다이렉트가 없으면 HTML에서 추출 시도
        const html: string = r.data || "";
        const jsMatch = html.match(/(?:window\.location(?:\.href)?\s*=\s*|location\.replace\()["']([^"']+)/);
        if (jsMatch) return jsMatch[1];
        return url;
    } catch (e: any) {
        // 3xx 상태코드는 axios가 에러로 처리 — Location 헤더 추출
        const location = e?.response?.headers?.["location"] as string | undefined;
        if (location) {
            return location.startsWith("http") ? location : `https://www.coupang.com${location}`;
        }
        return url;
    }
}

// 쿠팡 상품 페이지에서 og:title, og:image, 가격 추출
async function fetchProductInfo(inputUrl: string): Promise<{
    title: string; imageUrl: string | null; rawPrice: string; finalUrl: string;
}> {
    // 단축링크 → 실제 URL 변환
    const productUrl = await resolveShortLink(inputUrl);
    console.log("[manual-deal] productUrl:", productUrl);

    try {
        const response = await axios.get(productUrl, {
            headers: {
                ...BROWSER_HEADERS,
                Referer: "https://www.coupang.com/",
            },
            timeout: 15000,
            maxRedirects: 5,
            responseType: "text",
        });

        const html: string = response.data;
        const finalUrl: string = (response.request as any)?.res?.responseUrl || productUrl;

        // og:title
        const titleMatch =
            html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"'<>]{2,})["']/i) ||
            html.match(/<meta[^>]+content=["']([^"'<>]{2,})["'][^>]+property=["']og:title["']/i);
        const rawTitle = titleMatch?.[1] || "";
        const title = rawTitle
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
            .replace(/\s*[:\-|]\s*쿠팡.*$/i, "").trim();

        // og:image
        const imageMatch =
            html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"'<>]+)["']/i) ||
            html.match(/<meta[^>]+content=["']([^"'<>]+)["'][^>]+property=["']og:image["']/i);
        const imageUrl = imageMatch?.[1] || null;

        // 가격: JSON-LD 우선
        let rawPrice = "";
        const ldBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
        for (const block of ldBlocks) {
            const inner = block.replace(/<\/?script[^>]*>/gi, "");
            try {
                const json = JSON.parse(inner);
                const price = json?.offers?.price || json?.offers?.[0]?.price;
                if (price) { rawPrice = String(price).replace(/,/g, ""); break; }
            } catch { /* skip */ }
        }
        // JSON-LD 없으면 패턴 탐색
        if (!rawPrice) {
            const patterns = [
                /"salePrice"\s*:\s*"?([\d,]+)"?/,
                /"finalPrice"\s*:\s*"?([\d,]+)"?/,
                /"price"\s*:\s*"?([\d,]+)"?/,
            ];
            for (const pat of patterns) {
                const m = html.match(pat);
                if (m) { rawPrice = m[1].replace(/,/g, ""); break; }
            }
        }

        console.log(`[manual-deal] title="${title}" price="${rawPrice}"`);
        return { title, imageUrl, rawPrice, finalUrl };
    } catch (e: any) {
        console.error("[manual-deal] fetchProductInfo error:", e.message);
        return { title: "", imageUrl: null, rawPrice: "", finalUrl: productUrl };
    }
}

// 네이버쇼핑으로 이미지/가격 검색 (폴백)
async function searchNaver(title: string): Promise<{ image: string | null; price: string }> {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret || !title) return { image: null, price: "" };
    try {
        const { data } = await axios.get("https://openapi.naver.com/v1/search/shop.json", {
            params: { query: title, display: 1, sort: "sim" },
            headers: { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret },
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

        // 상품 정보 추출
        const { title: pageTitle, imageUrl: pageImage, rawPrice: pagePrice, finalUrl } = await fetchProductInfo(affiliateLink);

        // 이미지/가격 없으면 네이버쇼핑 폴백
        let imageUrl = pageImage;
        let rawPrice = pagePrice;
        if ((!imageUrl || !rawPrice) && pageTitle) {
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
                error: "상품 정보를 가져오지 못했습니다. 잠시 후 다시 시도하거나 www.coupang.com/vp/... 직접 링크를 사용해보세요.",
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
        const discountPercent = originalPrice > 0 && salePrice > 0 && originalPrice > salePrice
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
