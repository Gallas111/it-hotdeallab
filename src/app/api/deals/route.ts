import { NextRequest, NextResponse } from "next/server";
import { queryDeals, parseSortKey } from "@/lib/deals";

export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const category = searchParams.get("category") || undefined;
    const q = searchParams.get("q") || undefined;
    const sort = parseSortKey(searchParams.get("sort") || undefined);
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10) || 0);

    const { deals, hasMore } = await queryDeals({ category, q, sort, offset });

    return NextResponse.json({
        deals: deals.map(d => ({ ...d, createdAt: d.createdAt.toISOString() })),
        hasMore,
    });
}
