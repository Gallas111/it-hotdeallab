import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
    const products = await prisma.product.findMany({
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            title: true,
            category: true,
            salePrice: true,
            discountPercent: true,
            mallName: true,
            affiliateLink: true,
            imageUrl: true,
            createdAt: true,
        },
    });
    return NextResponse.json(
        products.map(p => ({ ...p, createdAt: p.createdAt.toISOString() }))
    );
}

export async function DELETE(request: Request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await prisma.product.delete({ where: { id } });
    return NextResponse.json({ success: true });
}
