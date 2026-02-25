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
    "Cache-Control": "no-cache",
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

// axios로 쿠팡 상품 정보 추출 (og 태그 + JSON-LD)
async function fetchProductInfo(url: string): Promise<{
    title: string; imageUrl: string | null; rawPrice: string; finalUrl: string;
}> {
    try {
        const response = await axios.get(url, {
            headers: BROWSER_HEADERS,
            timeout: 15000,
            maxRedirects: 10,
            responseType: "text",
        });

        const html: string = response.data;
        const finalUrl: string = response.request?.res?.responseUrl || url;

        // og:title 추출
        const titleMatch =
            html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
        const rawTitle = titleMatch?.[1] || "";
        const title = rawTitle.replace(/\s*[:\-|]\s*쿠팡.*$/i, "").trim();

        // og:image 추출
        const imageMatch =
            html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        const imageUrl = imageMatch?.[1] || null;

        // 가격 추출: JSON-LD 우선
        let rawPrice = "";
        const ldMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
        if (ldMatch) {
            for (const block of ldMatch) {
                const inner = block.replace(/<\/?script[^>]*>/gi, "");
                try {
                    const json = JSON.parse(inner);
                    const price = json?.offers?.price || json?.offers?.[0]?.price;
                    if (price) { rawPrice = String(price); break; }
                } catch { /* skip */ }
            }
        }

        // JSON-LD 없으면 페이지 내 패턴 검색
        if (!rawPrice) {
            const pricePatterns = [
                /"salePrice"\s*:\s*"?([\d,]+)"?/,
                /"finalPrice"\s*:\s*"?([\d,]+)"?/,
                /"price"\s*:\s*"?([\d,]+)"?/,
                /class="[^"]*total-price[^"]*"[^>]*>[^<]*<strong[^>]*>([\d,]+)/,
            ];
            for (const pat of pricePatterns) {
                const m = html.match(pat);
                if (m) { rawPrice = m[1].replace(/,/g, ""); break; }
            }
        }

        console.log(`[manual-deal] title="${title}" price="${rawPrice}" finalUrl="${finalUrl}"`);
        return { title, imageUrl, rawPrice, finalUrl };
    } catch (e: any) {
        console.error("fetchProductInfo error:", e.message);
        return { title: "", imageUrl: null, rawPrice: "", finalUrl: url };
    }
}

// 네이버쇼핑으로 이미지 검색 (폴백)
async function searchNaverImage(title: string): Promise<string | null> {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret || !title) return null;
    try {
        const { data } = await axios.get("https://openapi.naver.com/v1/search/shop.json", {
            params: { query: title, display: 1, sort: "sim" },
            headers: { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret },
            timeout: 5000,
        });
        const img = data.items?.[0]?.image;
        return img ? (img.startsWith("//") ? "https:" + img : img) : null;
    } catch {
        return null;
    }
}

export async function POST(request: Request) {
    try {
        const { affiliateLink, category: forceCategory } = await request.json();
        if (!affiliateLink) {
            return NextResponse.json({ error: "affiliateLink 필요" }, { status: 400 });
        }

        // 상품 정보 추출
        const { title: pageTitle, imageUrl: pageImage, rawPrice, finalUrl } = await fetchProductInfo(affiliateLink);

        // 이미지 없으면 네이버쇼핑으로 폴백
        let imageUrl = pageImage;
        if (!imageUrl && pageTitle) {
            imageUrl = await searchNaverImage(pageTitle);
        }

        // 파트너스 링크 결정
        const finalLink = affiliateLink.includes("link.coupang.com")
            ? affiliateLink
            : toCoupangAffiliateLink(affiliateLink);

        const titleForAI = pageTitle || "";
        if (!titleForAI) {
            return NextResponse.json({ success: false, error: "상품 정보를 가져오지 못했습니다. 쿠팡 직접 링크(www.coupang.com/vp/...)를 사용해보세요." }, { status: 400 });
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
                content: `상품명: ${titleForAI}\n가격: ${rawPrice ? rawPrice + "원" : "정보 없음"}\n링크: ${finalUrl}`,
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
                title: aiData.refinedTitle || titleForAI,
                slug: generateSlug(aiData.refinedTitle || titleForAI),
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
