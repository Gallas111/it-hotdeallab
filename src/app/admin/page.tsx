import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAdminToken, COOKIE_NAME } from "@/lib/admin-auth";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    const isAuthed = token ? verifyAdminToken(token) : false;

    if (!isAuthed) {
        return <AdminClient initialProducts={[]} />;
    }

    let serialized: Array<{
        id: string;
        title: string;
        category: string;
        salePrice: number;
        discountPercent: number;
        mallName: string;
        affiliateLink: string;
        imageUrl: string | null;
        viewCount: number;
        clickCount: number;
        createdAt: string;
    }> = [];

    try {
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
                viewCount: true,
                clickCount: true,
                createdAt: true,
            },
        });

        serialized = products.map(p => ({
            ...p,
            createdAt: p.createdAt.toISOString(),
        }));
    } catch {
        // DB 연결 실패 시 빈 배열
    }

    return <AdminClient initialProducts={serialized} />;
}
