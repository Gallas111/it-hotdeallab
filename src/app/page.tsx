import DealCard from "@/components/DealCard";
import { prisma } from "@/lib/prisma";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

// Mock data generator for initial verification
const getMockDeals = () => [
  {
    id: "1",
    title: "[쿠팡] LG전자 27인치 4K UHD 모니터 27UP850N IPS HDR400",
    slug: "lg-27inch-4k-monitor-sale",
    imageUrl: null,
    originalPrice: 620000,
    salePrice: 449000,
    discountPercent: 28,
    mallName: "쿠팡",
    category: "모니터/주변기기",
    createdAt: new Date(),
  },
  {
    id: "2",
    title: "Apple 2024 맥북 에어 13 M3 8GB 256GB 실버",
    slug: "macbook-air-m3-13-discount",
    imageUrl: null,
    originalPrice: 1590000,
    salePrice: 1390000,
    discountPercent: 12,
    mallName: "11번가",
    category: "Apple",
    createdAt: new Date(),
  },
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const resolvedParams = await searchParams;
  const deals = getMockDeals().filter(d =>
    !resolvedParams.category || d.category === resolvedParams.category
  );

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
