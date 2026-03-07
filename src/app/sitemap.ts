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

    const productUrls: MetadataRoute.Sitemap = products.map((p) => ({
        url: `https://ithotdealab.com/deal/${p.id}`,
        lastModified: p.createdAt,
        changeFrequency: "daily",
        priority: 0.8,
    }));

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
