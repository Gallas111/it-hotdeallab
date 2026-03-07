import { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    // 최근 90일 이내 딜만 sitemap에 포함
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const products = await prisma.product.findMany({
        where: { createdAt: { gte: cutoff } },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "desc" },
    });

    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    const productUrls: MetadataRoute.Sitemap = products.map((p) => {
        const age = now - new Date(p.createdAt).getTime();
        const priority = age < sevenDays ? 0.9 : age < thirtyDays ? 0.7 : 0.5;
        const changeFrequency = age < sevenDays ? "daily" : "weekly";
        return {
            url: `https://ithotdealab.com/deal/${p.id}`,
            lastModified: p.createdAt,
            changeFrequency,
            priority,
        };
    });

    return [
        {
            url: "https://ithotdealab.com",
            lastModified: new Date(),
            changeFrequency: "hourly",
            priority: 1,
        },
        ...productUrls,
    ];
}
