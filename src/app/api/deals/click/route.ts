import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
    try {
        const { id } = await request.json();
        if (!id || typeof id !== "string") {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }

        await prisma.product.update({
            where: { id },
            data: { clickCount: { increment: 1 } },
        });

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
