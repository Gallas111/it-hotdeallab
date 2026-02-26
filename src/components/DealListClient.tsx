"use client";

import { useRef, useCallback, useEffect, useState } from "react";
import DealCard from "./DealCard";

interface Deal {
    id: string;
    title: string;
    slug: string;
    imageUrl?: string | null;
    originalPrice: number;
    salePrice: number;
    discountPercent: number;
    category: string;
    mallName: string;
    aiSummary: string;
    viewCount: number;
    createdAt: string;
}

interface Props {
    initialDeals: Deal[];
    hasMore: boolean;
    category?: string;
    q?: string;
    sort: string;
    pageSize: number;
}

export default function DealListClient({ initialDeals, hasMore: initialHasMore, category, q, sort, pageSize }: Props) {
    const [deals, setDeals] = useState<Deal[]>(initialDeals);
    const [hasMore, setHasMore] = useState(initialHasMore);
    const [loading, setLoading] = useState(false);
    const sentinelRef = useRef<HTMLDivElement>(null);

    // SSR props 변경 시 리스트 리셋 (카테고리/검색/정렬 변경)
    useEffect(() => {
        setDeals(initialDeals);
        setHasMore(initialHasMore);
    }, [initialDeals, initialHasMore]);

    const loadMore = useCallback(async () => {
        if (loading || !hasMore) return;
        setLoading(true);

        const params = new URLSearchParams();
        if (category && category !== "전체") params.set("category", category);
        if (q) params.set("q", q);
        params.set("sort", sort);
        params.set("offset", String(deals.length));

        try {
            const res = await fetch(`/api/deals?${params.toString()}`);
            const data = await res.json();
            setDeals(prev => [...prev, ...data.deals]);
            setHasMore(data.hasMore);
        } catch (err) {
            console.error("Failed to load more deals:", err);
        } finally {
            setLoading(false);
        }
    }, [loading, hasMore, deals.length, category, q, sort]);

    // IntersectionObserver로 무한스크롤
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMore();
                }
            },
            { rootMargin: "200px" }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [loadMore]);

    if (deals.length === 0) {
        return (
            <div className="card" style={{
                padding: "60px 20px", textAlign: "center",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
            }}>
                <span style={{ fontSize: 40 }}>🔍</span>
                <p style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)" }}>
                    등록된 핫딜이 없습니다
                </p>
                <p style={{ fontSize: 13, color: "var(--muted)" }}>
                    {q ? "다른 검색어를 시도해보세요" : (
                        <a href="/admin" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
                            관리 페이지
                        </a>
                    )}
                </p>
            </div>
        );
    }

    return (
        <>
            <div className="card" style={{ overflow: "hidden" }}>
                {deals.map(deal => (
                    <DealCard key={deal.id} product={deal} />
                ))}
            </div>

            {/* IntersectionObserver 감지 요소 */}
            <div ref={sentinelRef} />

            {/* 로딩 스피너 */}
            {loading && <div className="loading-spinner" />}

            {/* 목록 끝 */}
            {!hasMore && deals.length > 0 && (
                <div className="end-of-list">
                    모든 핫딜을 확인했습니다
                </div>
            )}
        </>
    );
}
