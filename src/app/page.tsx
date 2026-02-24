import DealCard from "@/components/DealCard";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;

  const deals = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(category && category !== "전체" ? { category } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

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
            {category && category !== "전체" ? `${category} 핫딜` : "실시간 IT 핫딜"}
          </h2>
          {deals.length > 0 && (
            <span className="badge badge-gray">{deals.length}개</span>
          )}
        </div>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>최신순</span>
      </div>

      {/* 딜 리스트 */}
      {deals.length > 0 ? (
        <div className="card" style={{ overflow: "hidden" }}>
          {deals.map(deal => (
            <DealCard key={deal.id} product={deal} />
          ))}
        </div>
      ) : (
        <div className="card" style={{
          padding: "60px 20px", textAlign: "center",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontSize: 40 }}>🔍</span>
          <p style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)" }}>
            등록된 핫딜이 없습니다
          </p>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            <a href="/admin" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
              관리 페이지
            </a>
            에서 크롤링을 실행해보세요
          </p>
        </div>
      )}
    </div>
  );
}
