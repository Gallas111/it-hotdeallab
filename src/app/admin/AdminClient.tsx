"use client";

import { useState } from "react";

type Product = {
    id: string;
    title: string;
    category: string;
    salePrice: number;
    discountPercent: number;
    mallName: string;
    affiliateLink: string;
    imageUrl: string | null;
    createdAt: string;
};

export default function AdminClient({ initialProducts }: { initialProducts: Product[] }) {
    const [products, setProducts] = useState(initialProducts);
    const [scrapeStatus, setScrapeStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
    const [scrapeResult, setScrapeResult] = useState<string>("");
    const [linkUpdateStatus, setLinkUpdateStatus] = useState<"idle" | "loading" | "done">("idle");
    const [imageUpdateStatus, setImageUpdateStatus] = useState<"idle" | "loading" | "done">("idle");
    const [imageUpdateResult, setImageUpdateResult] = useState<string>("");

    // 크롤링 수동 실행
    const handleScrape = async () => {
        setScrapeStatus("loading");
        setScrapeResult("");
        try {
            const res = await fetch("/api/cron/scrape");
            const data = await res.json();
            if (data.success) {
                const added = data.added as string[];
                setScrapeResult(added.length > 0 ? `✅ ${added.length}개 추가됨: ${added.join(", ")}` : "✅ 새로운 IT 핫딜 없음 (이미 등록됨)");
                setScrapeStatus("done");
                // 목록 새로고침
                const r2 = await fetch("/api/admin/products");
                const newList = await r2.json();
                setProducts(newList);
            } else {
                setScrapeResult(`❌ 오류: ${data.error}`);
                setScrapeStatus("error");
            }
        } catch (e: any) {
            setScrapeResult(`❌ 요청 실패: ${e.message}`);
            setScrapeStatus("error");
        }
    };

    // 기존 클리앙 링크를 실제 쇼핑몰 링크로 업데이트
    const handleUpdateLinks = async () => {
        setLinkUpdateStatus("loading");
        try {
            await fetch("/api/admin/update-links", { method: "POST" });
            setLinkUpdateStatus("done");
            const r = await fetch("/api/admin/products");
            const newList = await r.json();
            setProducts(newList);
        } catch {
            setLinkUpdateStatus("idle");
        }
    };

    // 이미지 없는 상품에 이미지 채우기
    const handleUpdateImages = async () => {
        setImageUpdateStatus("loading");
        setImageUpdateResult("");
        try {
            const res = await fetch("/api/admin/update-images", { method: "POST" });
            const data = await res.json();
            if (data.success) {
                setImageUpdateResult(`✅ ${data.total}개 중 ${data.updated}개 이미지 업데이트 완료`);
                setImageUpdateStatus("done");
                const r = await fetch("/api/admin/products");
                const newList = await r.json();
                setProducts(newList);
            } else {
                setImageUpdateResult(`❌ 오류: ${data.error}`);
                setImageUpdateStatus("idle");
            }
        } catch (e: any) {
            setImageUpdateResult(`❌ 요청 실패: ${e.message}`);
            setImageUpdateStatus("idle");
        }
    };

    // 상품 삭제
    const handleDelete = async (id: string) => {
        if (!confirm("이 핫딜을 삭제하시겠습니까?")) return;
        await fetch(`/api/admin/products?id=${id}`, { method: "DELETE" });
        setProducts(prev => prev.filter(p => p.id !== id));
    };

    const clienCount = products.filter(p => p.affiliateLink.includes("clien.net")).length;
    const noImageCount = products.filter(p => !p.imageUrl).length;

    return (
        <div className="mx-auto max-w-5xl px-4 py-12 space-y-10">
            <div>
                <h1 className="text-3xl font-black text-[var(--foreground)] tracking-tight">상품 관리 대시보드</h1>
                <p className="mt-2 text-[15px] font-medium text-gray-400">핫딜 수집·관리·등록을 모두 이곳에서 처리합니다.</p>
            </div>

            {/* 통계 */}
            <div className="grid grid-cols-4 gap-4">
                <div className="card-section text-center">
                    <p className="text-3xl font-black text-[var(--primary)]">{products.length}</p>
                    <p className="text-[12px] font-bold text-gray-400 mt-1">전체 핫딜</p>
                </div>
                <div className="card-section text-center">
                    <p className="text-3xl font-black text-green-500">{products.length - clienCount}</p>
                    <p className="text-[12px] font-bold text-gray-400 mt-1">쇼핑몰 링크</p>
                </div>
                <div className="card-section text-center">
                    <p className="text-3xl font-black text-yellow-500">{clienCount}</p>
                    <p className="text-[12px] font-bold text-gray-400 mt-1">클리앙 링크</p>
                </div>
                <div className="card-section text-center">
                    <p className="text-3xl font-black text-purple-500">{noImageCount}</p>
                    <p className="text-[12px] font-bold text-gray-400 mt-1">이미지 없음</p>
                </div>
            </div>

            {/* 크롤링 실행 */}
            <section className="card-section space-y-4">
                <div className="flex items-center gap-3 border-b border-gray-50 pb-4 dark:border-white/5">
                    <span className="h-5 w-1 rounded-full bg-[var(--primary)]"></span>
                    <h3 className="text-[17px] font-extrabold text-[var(--foreground)]">핫딜 자동 수집</h3>
                </div>
                <p className="text-[13px] text-gray-400">클리앙 알뜰구매에서 IT 핫딜을 가져와 AI로 분류 후 DB에 저장합니다. (매일 오전 9시 자동 실행)</p>
                <div className="flex gap-3 flex-wrap">
                    <button
                        onClick={handleScrape}
                        disabled={scrapeStatus === "loading"}
                        className="rounded-xl bg-[var(--primary)] px-6 py-3 text-[14px] font-black text-white transition-all hover:opacity-80 disabled:opacity-50"
                    >
                        {scrapeStatus === "loading" ? "⏳ 수집 중 (약 30~60초)..." : "🔄 지금 크롤링 실행"}
                    </button>
                    {clienCount > 0 && (
                        <button
                            onClick={handleUpdateLinks}
                            disabled={linkUpdateStatus === "loading"}
                            className="rounded-xl bg-blue-500 px-6 py-3 text-[14px] font-black text-white transition-all hover:opacity-80 disabled:opacity-50"
                        >
                            {linkUpdateStatus === "loading" ? "⏳ 업데이트 중..." : linkUpdateStatus === "done" ? "✅ 완료" : `🔗 클리앙 링크 ${clienCount}개 업데이트`}
                        </button>
                    )}
                    {noImageCount > 0 && (
                        <button
                            onClick={handleUpdateImages}
                            disabled={imageUpdateStatus === "loading"}
                            className="rounded-xl bg-purple-500 px-6 py-3 text-[14px] font-black text-white transition-all hover:opacity-80 disabled:opacity-50"
                        >
                            {imageUpdateStatus === "loading" ? "⏳ 이미지 수집 중..." : imageUpdateStatus === "done" ? "✅ 완료" : `🖼 이미지 없는 ${noImageCount}개 업데이트`}
                        </button>
                    )}
                </div>
                {scrapeResult && (
                    <div className={`rounded-xl p-4 text-[13px] font-bold ${scrapeStatus === "error" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>
                        {scrapeResult}
                    </div>
                )}
                {imageUpdateResult && (
                    <div className={`rounded-xl p-4 text-[13px] font-bold ${imageUpdateResult.startsWith("❌") ? "bg-red-50 text-red-600" : "bg-purple-50 text-purple-700"}`}>
                        {imageUpdateResult}
                    </div>
                )}
            </section>

            {/* 등록된 핫딜 목록 */}
            <section className="card-section space-y-4">
                <div className="flex items-center gap-3 border-b border-gray-50 pb-4 dark:border-white/5">
                    <span className="h-5 w-1 rounded-full bg-blue-500"></span>
                    <h3 className="text-[17px] font-extrabold text-[var(--foreground)]">등록된 핫딜 ({products.length})</h3>
                </div>
                <div className="space-y-2">
                    {products.length === 0 && (
                        <p className="text-center text-gray-400 py-8 text-[14px]">등록된 핫딜이 없습니다. 크롤링을 실행해보세요.</p>
                    )}
                    {products.map(p => (
                        <div key={p.id} className="flex items-center gap-3 rounded-xl border border-gray-100 p-3 dark:border-white/5">
                            {/* 이미지 썸네일 */}
                            <div style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "var(--surface2)", border: "1px solid var(--border)" }}>
                                {p.imageUrl
                                    ? <img src={p.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🖼</div>
                                }
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[14px] font-bold text-[var(--foreground)] truncate">{p.title}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[11px] font-bold text-[var(--primary)]">{p.salePrice.toLocaleString()}원 ({p.discountPercent}% OFF)</span>
                                    <span className="text-[11px] text-gray-400">{p.category}</span>
                                    {p.affiliateLink.includes("clien.net") ? (
                                        <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-bold">클리앙링크</span>
                                    ) : (
                                        <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">쇼핑몰링크</span>
                                    )}
                                </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                <a href={`/deal/${p.id}`} target="_blank" className="text-[12px] font-bold text-blue-500 hover:underline">보기</a>
                                <button onClick={() => handleDelete(p.id)} className="text-[12px] font-bold text-red-400 hover:text-red-600">삭제</button>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
