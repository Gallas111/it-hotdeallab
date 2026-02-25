import { NextResponse } from "next/server";
import axios from "axios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
    const { url } = await request.json();
    const apiKey = process.env.SCRAPERAPI_KEY;

    if (!apiKey) return NextResponse.json({ error: "SCRAPERAPI_KEY 없음" }, { status: 500 });
    if (!url) return NextResponse.json({ error: "url 필요" }, { status: 400 });

    try {
        const scraperUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(url)}&country_code=kr&device_type=desktop&render=true`;
        console.log("[test-scraper] fetching:", url);

        const { data: html } = await axios.get(scraperUrl, { timeout: 45000 });

        if (typeof html !== "string") {
            return NextResponse.json({ error: "HTML 응답 아님", type: typeof html });
        }

        // 가격 관련 패턴 탐색
        const patterns: Record<string, string | null> = {};
        const keys = [
            "salePrice", "originalPrice", "basePrice", "listPrice",
            "finalPrice", "discountRate", "currentPrice", "regularPrice",
            "totalPrice", "productPrice",
        ];
        for (const key of keys) {
            const m = html.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
            patterns[key] = m ? m[1] : null;
        }

        // HTML에서 가격처럼 보이는 숫자 추출 (1,000 ~ 9,999,999 범위)
        const priceMatches = [...html.matchAll(/([\d,]{4,9})원/g)]
            .map(m => m[1].replace(/,/g, ""))
            .filter(p => {
                const n = parseInt(p);
                return n >= 1000 && n <= 9_999_999;
            });
        const uniquePrices = [...new Set(priceMatches)].slice(0, 20);

        // 할인율 패턴
        const discRatePatterns = [...html.matchAll(/(\d{1,2})%\s*할인/g)].map(m => m[1]).slice(0, 5);

        // JSON-LD 추출
        const ldMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
        let ldJson = null;
        if (ldMatch) {
            try { ldJson = JSON.parse(ldMatch[1]); } catch {}
        }

        // HTML 앞부분 (script 태그 제외한 텍스트) 일부
        const snippet = html
            .replace(/<script[\s\S]*?<\/script>/g, "")
            .replace(/<style[\s\S]*?<\/style>/g, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .substring(0, 500);

        return NextResponse.json({
            success: true,
            htmlLength: html.length,
            isCoupangPage: html.includes("coupang"),
            patterns,       // JS 내 가격 패턴
            pricesFound: uniquePrices,  // 원 단위 숫자들
            discountRates: discRatePatterns,
            ldJson,
            snippet,
        });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
