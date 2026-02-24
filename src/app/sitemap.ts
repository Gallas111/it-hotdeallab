import { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const products = await prisma.product.findMany({
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
