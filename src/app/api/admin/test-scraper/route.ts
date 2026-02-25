import { NextResponse } from "next/server";
import axios from "axios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
    const apiKey = process.env.SCRAPERAPI_KEY;
    if (!apiKey) return NextResponse.json({ error: "SCRAPERAPI_KEY 없음" }, { status: 500 });

    const testUrl = "https://www.coupang.com/vp/products/8548508229?itemId=21436080703";

    // premium=true: 프리미엄 주거용 IP 사용 (10크레딧/요청)
    const scraperUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(testUrl)}&premium=true&country_code=kr`;

    try {
        console.log("[test-scraper] premium 요청 시작:", testUrl);
        const { data: html } = await axios.get(scraperUrl, { timeout: 55000 });

        if (typeof html !== "string") {
            return NextResponse.json({ error: "HTML 아님", type: typeof html });
        }

        const isCoupang = html.includes("coupang");
        const isBlocked = html.includes("captcha") || html.includes("403") || html.length < 5000;

        // 가격 패턴 탐색
        const patterns: Record<string, string | null> = {};
        for (const key of ["salePrice", "originalPrice", "basePrice", "listPrice",
            "finalPrice", "discountRate", "currentPrice", "regularPrice", "normalPrice"]) {
            const m = html.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
            patterns[key] = m ? m[1] : null;
        }

        // 원 단위 숫자 추출
        const priceMatches = [...html.matchAll(/([\d,]{4,9})원/g)]
            .map(m => m[1].replace(/,/g, ""))
            .filter(p => { const n = parseInt(p); return n >= 1000 && n <= 9_999_999; });
        const uniquePrices = [...new Set(priceMatches)].slice(0, 15);

        // 할인율
        const discRates = [...html.matchAll(/(\d{1,2})%\s*할인/g)].map(m => m[1]).slice(0, 5);

        // JSON-LD
        const ldMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
        let ldJson = null;
        if (ldMatch) { try { ldJson = JSON.parse(ldMatch[1]); } catch {} }

        return NextResponse.json({
            success: true,
            htmlLength: html.length,
            isCoupang,
            isBlocked,
            patterns,
            uniquePrices,
            discRates,
            ldJson,
        });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
