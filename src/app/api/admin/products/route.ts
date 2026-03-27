import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
    const products = await prisma.product.findMany({
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
            id: true,
            title: true,
            category: true,
            salePrice: true,
            discountPercent: true,
            mallName: true,
            affiliateLink: true,
            imageUrl: true,
            viewCount: true,
            clickCount: true,
            createdAt: true,
        },
    });
    return NextResponse.json(
        products.map(p => ({ ...p, createdAt: p.createdAt.toISOString() }))
    );
}

export async function PATCH(request: Request) {
    const { id, affiliateLink, imageUrl, salePrice, originalPrice } = await request.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const data: Record<string, any> = {};
    if (affiliateLink) data.affiliateLink = affiliateLink;
    if (imageUrl) data.imageUrl = imageUrl;
    if (salePrice !== undefined) {
        const sale = Number(salePrice) || 0;
        const orig = Number(originalPrice) || 0;
        data.salePrice = sale;
        data.originalPrice = orig;
        data.discountPercent = orig > 0 && sale > 0 && orig > sale
            ? Math.round(((orig - sale) / orig) * 100)
            : 0;
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
    const updated = await prisma.product.update({ where: { id }, data });
    return NextResponse.json({ success: true, title: updated.title });
}

export async function DELETE(request: Request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await prisma.product.delete({ where: { id } });
    return NextResponse.json({ success: true });
}
