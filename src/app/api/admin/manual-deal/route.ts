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

// 상품 페이지에서 정보 추출
async function fetchProductInfo(url: string): Promise<{ title: string; imageUrl: string | null; rawPrice: string }> {
    try {
        const { data: html } = await axios.get(url, {
            headers: { ...HEADERS, Referer: "https://www.coupang.com/" },
            timeout: 10000,
            maxRedirects: 5,
        });
        const $ = cheerio.load(html);

        const title = $('meta[property="og:title"]').attr("content")
            || $("h1").first().text().trim()
            || $("title").text().trim()
            || "";

        const imageUrl = $('meta[property="og:image"]').attr("content")
            || $('meta[name="og:image"]').attr("content")
            || null;

        // 가격 추출 (다양한 셀렉터 시도)
        const rawPrice = $(".prod-price .total-price strong").text().trim()
            || $('[class*="price"]').first().text().trim()
            || $('meta[property="product:price:amount"]').attr("content")
            || "";

        return { title: title.replace(" - 쿠팡", "").trim(), imageUrl, rawPrice };
    } catch {
        return { title: "", imageUrl: null, rawPrice: "" };
    }
}

export async function POST(request: Request) {
    try {
        const { affiliateLink, category: forceCategory } = await request.json();
        if (!affiliateLink) {
            return NextResponse.json({ error: "affiliateLink 필요" }, { status: 400 });
        }

        // 파트너스 링크 적용
        const finalLink = toCoupangAffiliateLink(affiliateLink);

        // 상품 정보 추출
        const { title: pageTitle, imageUrl, rawPrice } = await fetchProductInfo(affiliateLink);

        // Claude AI 분석
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
        const message = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 1000,
            system: `IT·가전·스마트홈 핫딜 전문 큐레이터.
반드시 JSON만 반환:
{"refinedTitle":"가격 혜택 강조 제목(50자이내)","category":"골드박스|Apple|삼성/LG|노트북/PC|모니터/주변기기|음향/스마트기기|생활가전 중 하나","originalPrice":정가숫자(모르면0),"salePrice":할인가숫자(모르면0),"discountInfo":"할인 핵심 한줄(예:20%할인/역대최저/오늘만특가)","aiSummary":"한줄요약(60자이내)","aiPros":"장점1, 장점2, 장점3","aiTarget":"추천대상(40자이내)","seoContent":"500자이상 상세설명"}`,
            messages: [
                { role: "user", content: `상품 URL: ${affiliateLink}\n상품명: ${pageTitle}\n가격정보: ${rawPrice}` },
            ],
        });

        const block = message.content[0];
        if (block.type !== "text") throw new Error("AI 응답 오류");
        const jsonMatch = block.text.trim().match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("AI JSON 파싱 실패");
        const aiData = JSON.parse(jsonMatch[0]);

        const originalPrice = Number(aiData.originalPrice) || 0;
        const salePrice = Number(aiData.salePrice) || 0;
        const discountPercent = originalPrice > 0 && salePrice > 0 && originalPrice > salePrice
            ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
            : 0;

        const mallName = affiliateLink.includes("coupang.com") ? "쿠팡" : "기타";

        const product = await prisma.product.create({
            data: {
                title: aiData.refinedTitle || pageTitle || "수동 등록 상품",
                slug: generateSlug(aiData.refinedTitle || pageTitle || "product"),
                imageUrl: imageUrl || undefined,
                originalPrice,
                salePrice,
                discountPercent,
                category: forceCategory || aiData.category || "기타",
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
            message: `✅ "${product.title}" 등록 완료`,
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
