import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9",
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

// 상품 페이지에서 정보 추출 (리다이렉트 추적 포함)
async function fetchProductInfo(url: string): Promise<{
    title: string; imageUrl: string | null; rawPrice: string; finalUrl: string;
}> {
    try {
        const response = await axios.get(url, {
            headers: { ...HEADERS, Referer: "https://www.coupang.com/" },
            timeout: 12000,
            maxRedirects: 10,
        });

        // 리다이렉트 후 최종 URL 추적
        const finalUrl: string = (response.request as any)?.res?.responseUrl
            || (response.request as any)?.responseURL
            || url;

        const html = response.data as string;
        const $ = cheerio.load(html);

        // 제목 추출 (og:title이 가장 신뢰성 높음)
        let title = $('meta[property="og:title"]').attr("content")
            || $('meta[name="og:title"]').attr("content")
            || $("h1").first().text().trim()
            || $("title").text().trim()
            || "";
        title = title.replace(/ [-|] 쿠팡.*/, "").replace(/쿠팡$/, "").trim();

        // 이미지 추출
        const imageUrl = $('meta[property="og:image"]').attr("content")
            || $('meta[name="og:image"]').attr("content")
            || null;

        // 가격 추출 - JSON-LD 우선
        let rawPrice = "";
        $('script[type="application/ld+json"]').each((_, el) => {
            if (rawPrice) return;
            try {
                const data = JSON.parse($(el).html() || "");
                const price = data?.offers?.price || data?.offers?.[0]?.price;
                if (price) rawPrice = `${price}원`;
            } catch { /* ignore */ }
        });

        // CSS 셀렉터로 가격 추출
        if (!rawPrice) {
            rawPrice = $(".total-price strong").text().trim()
                || $('[class*="total-price"]').text().trim()
                || $('meta[property="product:price:amount"]').attr("content") || "";
        }

        return { title, imageUrl, rawPrice, finalUrl };
    } catch {
        return { title: "", imageUrl: null, rawPrice: "", finalUrl: url };
    }
}

export async function POST(request: Request) {
    try {
        const { affiliateLink, category: forceCategory, title: manualTitle } = await request.json();
        if (!affiliateLink) {
            return NextResponse.json({ error: "affiliateLink 필요" }, { status: 400 });
        }

        // 상품 정보 추출
        const { title: pageTitle, imageUrl, rawPrice, finalUrl } = await fetchProductInfo(affiliateLink);

        // 최종 파트너스 링크 결정 (단축링크 유지 또는 직접 URL에 partnerCode 추가)
        const finalLink = affiliateLink.includes("link.coupang.com")
            ? affiliateLink  // 단축링크는 그대로 (이미 파트너스 추적 포함)
            : toCoupangAffiliateLink(affiliateLink);

        const titleForAI = manualTitle || pageTitle || "쿠팡 상품";

        // Claude AI 분석 - 정보가 없어도 URL만으로 최대한 생성
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
        const message = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 1200,
            system: `IT·가전·스마트홈 핫딜 전문 큐레이터.
상품명과 URL 기반으로 핫딜 정보를 생성하라.
가격 정보가 없어도 상품명만으로 최대한 정보를 생성하라.
반드시 JSON만 반환 (다른 텍스트 절대 금지):
{"refinedTitle":"제목(50자이내)","category":"골드박스|Apple|삼성/LG|노트북/PC|모니터/주변기기|음향/스마트기기|생활가전 중 하나","originalPrice":정가숫자(모르면0),"salePrice":할인가숫자(모르면0),"discountInfo":"할인 핵심 한줄","aiSummary":"한줄요약(60자이내)","aiPros":"장점1, 장점2, 장점3","aiTarget":"추천대상(40자이내)","seoContent":"300자이상 상세설명"}`,
            messages: [{
                role: "user",
                content: `상품명: ${titleForAI}\n가격: ${rawPrice || "정보 없음"}\n링크: ${finalUrl}`,
            }],
        });

        const block = message.content[0];
        if (block.type !== "text") throw new Error("AI 응답 오류");

        // JSON 파싱 (마크다운 코드블록 포함 대응)
        const raw = block.text.trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error("Claude raw response:", raw);
            throw new Error(`AI 응답 파싱 실패: ${raw.substring(0, 100)}`);
        }
        const aiData = JSON.parse(jsonMatch[0]);

        const originalPrice = Number(aiData.originalPrice) || 0;
        const salePrice = Number(aiData.salePrice) || 0;
        const discountPercent = originalPrice > 0 && salePrice > 0 && originalPrice > salePrice
            ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
            : 0;

        const mallName = affiliateLink.includes("coupang.com") ? "쿠팡" : "기타";

        const product = await prisma.product.create({
            data: {
                title: aiData.refinedTitle || titleForAI,
                slug: generateSlug(aiData.refinedTitle || titleForAI),
                imageUrl: imageUrl || undefined,
                originalPrice,
                salePrice,
                discountPercent,
                category: forceCategory || aiData.category || "골드박스",
                mallName,
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
