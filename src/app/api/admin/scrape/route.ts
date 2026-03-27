import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return NextResponse.json({ error: "CRON_SECRET 미설정" }, { status: 500 });
    }

    // 내부적으로 cron/scrape를 호출 (CRON_SECRET 포함)
    const origin = new URL(request.url).origin;
    const res = await fetch(`${origin}/api/cron/scrape`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
}
