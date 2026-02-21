import DealCard from "@/components/DealCard";
import { prisma } from "@/lib/prisma";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const resolvedParams = await searchParams;
  const category = resolvedParams.category;

  // 실제 DB에서 데이터 가져오기 (최신순 20개)
  const deals = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(category && category !== "전체" ? { category } : {}),
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 20,
  });

  return (
    <div className="flex flex-col gap-10">
      <div className="flex items-center justify-between border-b border-gray-100 pb-6 dark:border-white/5">
        <h2 className="text-xl font-black text-[var(--foreground)] tracking-tight flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--primary)]"></span>
          실시간 인기 핫딜
        </h2>
        <div className="flex gap-2">
          <button className="text-[12px] font-bold text-gray-400 hover:text-[var(--primary)] transition-colors">최신순</button>
          <span className="text-[12px] text-gray-200">|</span>
          <button className="text-[12px] font-bold text-gray-400 hover:text-[var(--primary)] transition-colors">인기순</button>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2">
        {deals.length > 0 ? (
          deals.map((deal) => (
            <DealCard key={deal.id} product={deal} />
          ))
        ) : (
          <div className="flex h-64 flex-col items-center justify-center text-gray-400 col-span-full">
            <span className="text-4xl mb-4">🔍</span>
            <p className="text-sm font-bold">현재 등록된 핫딜이 없습니다.</p>
          </div>
        )}
      </div>

      {/* Footer Meta */}
      <div className="py-20 text-center">
        <div className="inline-flex flex-col items-center gap-4">
          <div className="h-[1px] w-12 bg-gray-100 dark:bg-white/5"></div>
          <p className="text-[10px] font-black text-gray-300 uppercase tracking-[0.3em]">
            IT HOTDEAL LAB CURATION
          </p>
          <div className="h-[1px] w-12 bg-gray-100 dark:bg-white/5"></div>
        </div>
      </div>
    </div>
  );
}
