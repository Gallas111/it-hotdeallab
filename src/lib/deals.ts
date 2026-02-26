import { prisma } from "./prisma";

export const PAGE_SIZE = 20;

export type SortKey = "newest" | "discount" | "price_asc" | "price_desc" | "popular";

export function parseSortKey(raw?: string): SortKey {
    const valid: SortKey[] = ["newest", "discount", "price_asc", "price_desc", "popular"];
    return valid.includes(raw as SortKey) ? (raw as SortKey) : "newest";
}

function buildOrderBy(sort: SortKey) {
    switch (sort) {
        case "discount": return { discountPercent: "desc" as const };
        case "price_asc": return { salePrice: "asc" as const };
        case "price_desc": return { salePrice: "desc" as const };
        case "popular": return { viewCount: "desc" as const };
        default: return { createdAt: "desc" as const };
    }
}

const DEAL_SELECT = {
    id: true,
    title: true,
    slug: true,
    imageUrl: true,
    originalPrice: true,
    salePrice: true,
    discountPercent: true,
    category: true,
    mallName: true,
    aiSummary: true,
    viewCount: true,
    createdAt: true,
} as const;

export async function queryDeals(params: {
    category?: string;
    q?: string;
    sort: SortKey;
    offset?: number;
}) {
    const { category, q, sort, offset = 0 } = params;

    const items = await prisma.product.findMany({
        where: {
            isActive: true,
            ...(category && category !== "전체" ? { category } : {}),
            ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
        },
        orderBy: buildOrderBy(sort),
        skip: offset,
        take: PAGE_SIZE + 1,
        select: DEAL_SELECT,
    });

    const hasMore = items.length > PAGE_SIZE;
    const deals = hasMore ? items.slice(0, PAGE_SIZE) : items;

    return { deals, hasMore };
}
