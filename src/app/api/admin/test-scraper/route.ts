import { NextResponse } from "next/server";
import axios from "axios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
    const apiKey = process.env.SCRAPERAPI_KEY;
    if (!apiKey) return NextResponse.json({ error: "SCRAPERAPI_KEY 없음" }, { status: 500 });

    const results: Record<string, any> = { apiKey: apiKey.substring(0, 8) + "..." };

    // 1단계: ScraperAPI 자체 연결 테스트 (간단한 URL)
    try {
        const simpleUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=https%3A%2F%2Fhttpbin.org%2Fip`;
        const r = await axios.get(simpleUrl, { timeout: 15000 });
        results.step1_simple = { ok: true, status: r.status, data: r.data };
    } catch (e: any) {
        results.step1_simple = { ok: false, error: e.message };
    }

    // 2단계: ScraperAPI account 정보 확인
    try {
        const accountUrl = `https://api.scraperapi.com/account?api_key=${apiKey}`;
        const r = await axios.get(accountUrl, { timeout: 10000 });
        results.step2_account = { ok: true, data: r.data };
    } catch (e: any) {
        results.step2_account = { ok: false, error: e.message };
    }

    return NextResponse.json(results);
}
