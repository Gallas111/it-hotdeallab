import { Suspense } from "react";
import DealListClient from "@/components/DealListClient";
import SortSelect from "@/components/SortSelect";
import { queryDeals, parseSortKey, PAGE_SIZE } from "@/lib/deals";

export const dynamic = "force-dynamic";

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "IT핫딜랩",
  "url": "https://ithotdealab.com",
  "description": "매일 쏟아지는 IT/가전 핫딜, 한눈에.",
  "potentialAction": {
    "@type": "SearchAction",
    "target": "https://ithotdealab.com/?q={search_term_string}",
    "query-input": "required name=search_term_string",
  },
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string; sort?: string }>;
}) {
  const { category, q, sort } = await searchParams;
  const sortKey = parseSortKey(sort);

  const { deals, hasMore } = await queryDeals({ category, q, sort: sortKey }).catch(() => ({ deals: [], hasMore: false }));

  const sectionTitle = q
    ? `"${q}" 검색 결과`
    : category && category !== "전체"
    ? `${category} 핫딜`
    : "실시간 IT 핫딜";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />

      {/* 섹션 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "var(--primary)",
            display: "inline-block",
            boxShadow: "0 0 0 3px rgba(255,59,48,0.2)",
          }} />
          <h2 style={{ fontSize: 15, fontWeight: 800, color: "var(--foreground)", letterSpacing: "-0.02em" }}>
            {sectionTitle}
          </h2>
        </div>
        <Suspense fallback={<span style={{ fontSize: 12, color: "var(--muted)" }}>최신순</span>}>
          <SortSelect />
        </Suspense>
      </div>

      {/* 딜 리스트 (무한스크롤) */}
      <DealListClient
        initialDeals={JSON.parse(JSON.stringify(deals))}
        hasMore={hasMore}
        category={category}
        q={q}
        sort={sortKey}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
