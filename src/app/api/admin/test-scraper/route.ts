import { NextResponse } from "next/server";
import axios from "axios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
    const { url } = await request.json();
    const apiKey = process.env.SCRAPERAPI_KEY;

    if (!apiKey) return NextResponse.json({ error: "SCRAPERAPI_KEY 없음" }, { status: 500 });

    // url 없으면 직접 쿠팡 URL로 테스트
    const testUrl = url || "https://www.coupang.com/vp/products/8548508229?itemId=21436080703";

    try {
        // render=true 없이 기본 요청 (빠름)
        const scraperUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(testUrl)}`;
        console.log("[test-scraper] fetching:", testUrl);

        const { data: html } = await axios.get(scraperUrl, { timeout: 25000 });

        if (typeof html !== "string") {
            return NextResponse.json({ error: "HTML 응답 아님", type: typeof html, data: html });
        }

        const len = html.length;
        const isCoupang = html.includes("coupang");

        // 가격 패턴 탐색
        const patterns: Record<string, string | null> = {};
        for (const key of ["salePrice","originalPrice","basePrice","listPrice","finalPrice","discountRate","currentPrice","regularPrice","totalPrice","productPrice"]) {
            const m = html.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
            patterns[key] = m ? m[1] : null;
        }

        // 원 단위 숫자
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

        // HTML 앞 500자 텍스트
        const snippet = html.replace(/<script[\s\S]*?<\/script>/g,"").replace(/<style[\s\S]*?<\/style>/g,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").substring(0, 400);

        // HTML 중간 부분 (가격 관련 있을 법한 곳)
        const priceSection = html.substring(html.length / 3, html.length / 3 + 600)
            .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

        return NextResponse.json({ success: true, htmlLength: len, isCoupang, patterns, uniquePrices, discRates, ldJson, snippet, priceSection });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
