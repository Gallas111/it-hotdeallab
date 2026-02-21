"use client";

import { useState, useEffect, Suspense } from "react";

export const dynamic = "force-dynamic";

export default function AdminPage() {
    const [title, setTitle] = useState("");
    const [originalPrice, setOriginalPrice] = useState(0);
    const [salePrice, setSalePrice] = useState(0);
    const [discountPercent, setDiscountPercent] = useState(0);

    // 할인율 자동 계산 로직
    useEffect(() => {
        if (originalPrice > 0 && salePrice > 0) {
            const discount = Math.round(((originalPrice - salePrice) / originalPrice) * 100);
            setDiscountPercent(discount);
        } else {
            setDiscountPercent(0);
        }
    }, [originalPrice, salePrice]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        alert("현재 로컬 환경이며, DB 마이그레이션 완료 후 실제 저장이 가능합니다.");
        console.log({ title, originalPrice, salePrice, discountPercent });
    };

    return (
        <div className="mx-auto max-w-4xl px-4 py-12">
            <div className="mb-12">
                <h1 className="text-3xl font-black text-[var(--foreground)] tracking-tight">상품 관리 대시보드</h1>
                <p className="mt-2 text-[15px] font-medium text-gray-400">새로운 핫딜을 등록하거나 기존 상품을 프리미엄 규격으로 관리합니다.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-10">
                <section className="card-section premium-shadow space-y-8">
                    <div className="flex items-center gap-3 border-b border-gray-50 pb-5 dark:border-white/5">
                        <span className="h-5 w-1 rounded-full bg-[var(--primary)]"></span>
                        <h3 className="text-[17px] font-extrabold text-[var(--foreground)]">기본 정보 설정</h3>
                    </div>

                    <div className="grid gap-x-8 gap-y-7 sm:grid-cols-1 md:grid-cols-[160px_1fr]">
                        <label className="pt-2 text-[14px] font-bold text-gray-500">카테고리 분류</label>
                        <select
                            className="h-12 rounded-xl border border-gray-200 bg-gray-50 px-4 text-[14px] font-bold outline-none focus:border-[var(--primary)] focus:bg-white transition-all dark:bg-white/5 dark:border-white/10"
                            onChange={(e) => console.log(e.target.value)}
                        >
                            <option value="Apple 핫딜">Apple 핫딜</option>
                            <option value="삼성/LG 가전">삼성/LG 가전</option>
                            <option value="노트북/PC">노트북/PC</option>
                            <option value="모니터/주변기기">모니터/주변기기</option>
                            <option value="음향/스마트기기">음향/스마트기기</option>
                        </select>

                        <div className="md:col-start-2">
                            <div className="flex flex-col gap-2 p-4 bg-orange-50/50 dark:bg-orange-900/10 rounded-2xl border border-orange-100/50 dark:border-orange-900/20">
                                <h4 className="text-[11px] font-black text-orange-600 dark:text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <span className="h-1.5 w-1.5 rounded-full bg-orange-500"></span>
                                    전환 최적화 팁
                                </h4>
                                <p className="text-[12px] leading-relaxed text-orange-800/80 dark:text-orange-300/80 font-medium">
                                    제목에 <span className="font-bold text-orange-600 underline decoration-orange-300 dark:text-orange-400">역대급, 신학기, 최저가</span> 등을 포함하면 클릭률이 개선됩니다.
                                </p>
                            </div>
                        </div>

                        <label className="pt-3 text-[14px] font-bold text-gray-500">상품명 (SEO)</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="h-12 rounded-xl border border-gray-200 bg-gray-50 px-4 text-[14px] font-bold outline-none focus:border-[var(--primary)] focus:bg-white transition-all dark:bg-white/5 dark:border-white/10"
                            placeholder="예: [역대급할인] LG 노트북 그램 16인치 2024년형 쿠팡특가"
                            required
                        />

                        <label className="pt-3 text-[14px] font-bold text-gray-500">가격 정보</label>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[12px] font-bold text-gray-400">원가</span>
                                <input
                                    type="number"
                                    value={originalPrice}
                                    onChange={(e) => setOriginalPrice(Number(e.target.value))}
                                    className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 pl-14 pr-4 text-[14px] font-black text-gray-400 line-through outline-none focus:border-[var(--primary)] focus:bg-white transition-all dark:bg-white/5 dark:border-white/10"
                                    required
                                />
                            </div>
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[12px] font-bold text-[var(--primary)]">할인</span>
                                <input
                                    type="number"
                                    value={salePrice}
                                    onChange={(e) => setSalePrice(Number(e.target.value))}
                                    className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 pl-14 pr-4 text-[14px] font-black text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:bg-white transition-all dark:bg-white/5 dark:border-white/10 shadow-sm"
                                    required
                                />
                            </div>
                        </div>

                        <div className="md:col-start-2 px-4 py-3 bg-gray-50 rounded-xl dark:bg-white/5">
                            <p className="text-[13px] font-bold text-gray-400">
                                예상 할인율: <span className="ml-1 text-[15px] font-black text-[var(--primary)] tracking-tight">{discountPercent}% OFF</span>
                            </p>
                        </div>
                    </div>
                </section>

                <section className="card-section premium-shadow space-y-8">
                    <div className="flex items-center gap-3 border-b border-gray-50 pb-5 dark:border-white/5">
                        <span className="h-5 w-1 rounded-full bg-blue-500"></span>
                        <h3 className="text-[17px] font-extrabold text-[var(--foreground)]">AI & SEO 최적화</h3>
                    </div>

                    <div className="grid gap-x-8 gap-y-7 sm:grid-cols-1 md:grid-cols-[160px_1fr]">
                        <label className="pt-2 text-[14px] font-bold text-gray-500">AI 한 줄 요약</label>
                        <textarea
                            className="min-h-[100px] rounded-xl border border-gray-200 bg-gray-50 p-4 text-[14px] font-medium leading-relaxed outline-none focus:border-[var(--primary)] focus:bg-white transition-all dark:bg-white/5 dark:border-white/10"
                            placeholder="수익 전환을 유도하는 매력적인 한 줄 문장을 작성하세요."
                        ></textarea>

                        <label className="pt-3 text-[14px] font-bold text-gray-500">핵심 특징 (쉼표)</label>
                        <input
                            type="text"
                            className="h-12 rounded-xl border border-gray-200 bg-gray-50 px-4 text-[14px] font-medium outline-none focus:border-[var(--primary)] focus:bg-white transition-all dark:bg-white/5 dark:border-white/10"
                            placeholder="배터리 성능, 가벼운 무게, HDR 지원"
                        />

                        <label className="pt-3 text-[14px] font-bold text-gray-500">SEO 상세 본문</label>
                        <textarea
                            className="min-h-[240px] rounded-xl border border-gray-200 bg-gray-50 p-4 text-[14px] font-medium leading-relaxed outline-none focus:border-[var(--primary)] focus:bg-white transition-all dark:bg-white/5 dark:border-white/10"
                            placeholder="검색 노출을 강화할 수 있는 상세한 제품 설명을 입력하세요 (1000자 이상 권장)."
                        ></textarea>

                        <label className="pt-3 text-[14px] font-bold text-gray-500">파트너스 링크</label>
                        <input
                            type="url"
                            className="h-12 rounded-xl border border-gray-200 bg-gray-50 px-4 text-[14px] font-bold text-blue-600 outline-none focus:border-[var(--primary)] focus:bg-white transition-all dark:bg-white/5 dark:border-white/10"
                            placeholder="https://link.coupang.com/..."
                            required
                        />
                    </div>
                </section>

                <div className="flex flex-col gap-4 pt-4">
                    <button type="submit" className="btn-cta h-16 w-full rounded-2xl">
                        프리미엄 핫딜 등록하기
                    </button>
                    <p className="text-center text-[12px] font-medium text-gray-400">
                        등록 시 즉시 메인 페이지와 검색 엔진에 최적화된 형태로 노출됩니다.
                    </p>
                </div>
            </form>
        </div>
    );
}
