import { NextResponse } from "next/server";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

// Playwright로 실제 브라우저에서 상품 정보 추출
async function fetchWithBrowser(url: string): Promise<{
    title: string; imageUrl: string | null; rawPrice: string; finalUrl: string;
}> {
    let browser: any = null;
    try {
        const { chromium } = await import("playwright-core");

        // Vercel 프로덕션: sparticuz chromium, 로컬: 시스템 chromium
        if (process.env.VERCEL) {
            const chromiumBin = await import("@sparticuz/chromium");
            browser = await chromium.launch({
                args: chromiumBin.default.args,
                executablePath: await chromiumBin.default.executablePath(),
                headless: true,
            });
        } else {
            browser = await chromium.launch({ headless: true });
        }

        const page = await browser.newPage();
        await page.setExtraHTTPHeaders({
            "Accept-Language": "ko-KR,ko;q=0.9",
        });

        // 페이지 로드 (리다이렉트 자동 추적)
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        const finalUrl = page.url();

        // og:title / og:image 추출
        const title = await page.$eval(
            'meta[property="og:title"]',
            (el: any) => el.getAttribute("content") || ""
        ).catch(() => "");

        const imageUrl = await page.$eval(
            'meta[property="og:image"]',
            (el: any) => el.getAttribute("content") || ""
        ).catch(() => null);

        // 가격 추출 (쿠팡 전용 셀렉터)
        const rawPrice = await page.$eval(
            ".total-price strong",
            (el: any) => el.textContent?.trim() || ""
        ).catch(async () => {
            return await page.$eval(
                '[class*="price"] strong',
                (el: any) => el.textContent?.trim() || ""
            ).catch(() => "");
        });

        return {
            title: title.replace(/ [-|] 쿠팡.*/, "").trim(),
            imageUrl: imageUrl || null,
            rawPrice,
            finalUrl,
        };
    } catch (e) {
        console.error("Browser fetch error:", e);
        return { title: "", imageUrl: null, rawPrice: "", finalUrl: url };
    } finally {
        if (browser) await browser.close();
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

        // Playwright로 실제 브라우저에서 정보 추출
        const { title: pageTitle, imageUrl: pageImage, rawPrice, finalUrl } = await fetchWithBrowser(affiliateLink);

        // 이미지 없으면 네이버쇼핑으로 폴백
        let imageUrl = pageImage;
        if (!imageUrl && pageTitle) {
            imageUrl = await searchNaverImage(pageTitle);
        }

        // 파트너스 링크 결정
        const finalLink = affiliateLink.includes("link.coupang.com")
            ? affiliateLink
            : toCoupangAffiliateLink(affiliateLink);

        const titleForAI = pageTitle || "쿠팡 상품";

        // Claude AI 분석
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
        const message = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 1200,
            system: `IT·가전·스마트홈 핫딜 전문 큐레이터.
상품명과 가격 기반으로 핫딜 정보를 생성하라.
반드시 JSON만 반환 (다른 텍스트 절대 금지):
{"refinedTitle":"제목(50자이내)","category":"골드박스|Apple|삼성/LG|노트북/PC|모니터/주변기기|음향/스마트기기|생활가전 중 하나","originalPrice":정가숫자(모르면0),"salePrice":할인가숫자(모르면0),"discountInfo":"할인 핵심 한줄","aiSummary":"한줄요약(60자이내)","aiPros":"장점1, 장점2, 장점3","aiTarget":"추천대상(40자이내)","seoContent":"300자이상 상세설명"}`,
            messages: [{
                role: "user",
                content: `상품명: ${titleForAI}\n가격: ${rawPrice || "정보 없음"}\n링크: ${finalUrl}`,
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
