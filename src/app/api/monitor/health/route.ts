import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const totalDeals = await prisma.product.count({ where: { isActive: true } });
        const latest = await prisma.product.findFirst({ orderBy: { createdAt: "desc" } });

        const hoursSinceLatest = latest
            ? (Date.now() - latest.createdAt.getTime()) / (1000 * 60 * 60)
            : 999;

        // 활성 딜 5개 이상 + 최근 48시간 이내 딜 존재 → 정상
        const isHealthy = totalDeals >= 5 && hoursSinceLatest < 48;

        return NextResponse.json(
            {
                status: isHealthy ? "healthy" : "unhealthy",
                totalDeals,
                latestDealAt: latest?.createdAt ?? null,
                hoursSinceLatest: Math.round(hoursSinceLatest * 10) / 10,
                checkedAt: new Date().toISOString(),
            },
            { status: isHealthy ? 200 : 503 }
        );
    } catch (error: any) {
        console.error("[health] error:", error.message);
        return NextResponse.json(
            { status: "error", error: "서버 오류" },
            { status: 500 }
        );
    }
}
