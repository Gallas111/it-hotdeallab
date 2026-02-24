import { prisma } from "@/lib/prisma";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
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
            createdAt: true,
        },
    });

    // Date를 string으로 직렬화
    const serialized = products.map(p => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
    }));

    return <AdminClient initialProducts={serialized} />;
}
