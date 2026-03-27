"use client";

import { useState, useEffect } from "react";

type Product = {
    id: string;
    title: string;
    category: string;
    salePrice: number;
    discountPercent: number;
    mallName: string;
    affiliateLink: string;
    imageUrl: string | null;
    viewCount: number;
    clickCount: number;
    createdAt: string;
};

export default function AdminClient({ initialProducts }: { initialProducts: Product[] }) {
    const [authed, setAuthed] = useState<boolean | null>(null);
    const [pw, setPw] = useState("");
    const [pwError, setPwError] = useState(false);
    const [pwLoading, setPwLoading] = useState(false);

    const [products, setProducts] = useState(initialProducts);
    const [scrapeStatus, setScrapeStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
    const [scrapeResult, setScrapeResult] = useState<string>("");

    // 수동 등록
    const [manualLink, setManualLink] = useState("");
    const [manualCategory, setManualCategory] = useState("골드박스");
    const [manualStatus, setManualStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
    const [manualResult, setManualResult] = useState("");
    const [filterCategory, setFilterCategory] = useState("전체");
    const [syncStatus, setSyncStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
    const [syncResult, setSyncResult] = useState("");
    const [testStatus, setTestStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
    const [testResult, setTestResult] = useState("");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editSale, setEditSale] = useState("");
    const [editOrig, setEditOrig] = useState("");
    const [editSaving, setEditSaving] = useState(false);
    const [linkUpdateStatus, setLinkUpdateStatus] = useState<"idle" | "loading" | "done">("idle");
    const [imageUpdateStatus, setImageUpdateStatus] = useState<"idle" | "loading" | "done">("idle");
    const [imageUpdateResult, setImageUpdateResult] = useState<string>("");

    // 서버에서 initialProducts가 있으면 인증된 상태
    useEffect(() => {
        setAuthed(initialProducts.length > 0 || sessionStorage.getItem("admin-auth") === "1");
    }, [initialProducts]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setPwLoading(true);
        setPwError(false);
        const res = await fetch("/api/admin/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pw }),
        });
        if (res.ok) {
            sessionStorage.setItem("admin-auth", "1");
            // 쿠키 설정 후 페이지 새로고침 (서버에서 데이터 가져오기)
            window.location.reload();
            return;
        } else {
            setPwError(true);
            setPw("");
        }
        setPwLoading(false);
    };

    // 크롤링 수동 실행
    const handleScrape = async () => {
        setScrapeStatus("loading");
        setScrapeResult("");
        try {
            const res = await fetch("/api/admin/scrape", { method: "POST" });
            const data = await res.json();
            if (data.success) {
                const added = data.added as string[];
                const expiredMsg = data.expired > 0 ? ` / 만료 ${data.expired}개 삭제` : "";
                setScrapeResult(added.length > 0 ? `✅ ${added.length}개 추가됨: ${added.join(", ")}${expiredMsg}` : `✅ 새로운 IT 핫딜 없음${expiredMsg}`);
                setScrapeStatus("done");
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

    const handleUpdateImages = async () => {
        setImageUpdateStatus("loading");
        setImageUpdateResult("");
        try {
            const res = await fetch("/api/admin/update-images", { method: "POST" });
            const data = await res.json();
            if (data.success) {
                setImageUpdateResult(`✅ ${data.message || `${data.total}개 중 ${data.updated}개 업데이트 완료`}`);
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

    const handleManualRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!manualLink.trim()) return;
        setManualStatus("loading");
        setManualResult("");
        try {
            const res = await fetch("/api/admin/manual-deal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    affiliateLink: manualLink.trim(),
                    category: manualCategory,
                }),
            });
            const data = await res.json();
            if (data.success) {
                setManualResult(`✅ ${data.message}`);
                setManualStatus("done");
                setManualLink("");
                const r = await fetch("/api/admin/products");
                setProducts(await r.json());
            } else {
                setManualResult(`❌ 오류: ${data.error}`);
                setManualStatus("error");
            }
        } catch (e: any) {
            setManualResult(`❌ 요청 실패: ${e.message}`);
            setManualStatus("error");
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("이 핫딜을 삭제하시겠습니까?")) return;
        await fetch(`/api/admin/products?id=${id}`, { method: "DELETE" });
        setProducts(prev => prev.filter(p => p.id !== id));
    };

    const handleSyncPrices = async () => {
        setSyncStatus("loading");
        setSyncResult("");
        try {
            const res = await fetch("/api/admin/sync-prices", { method: "POST" });
            const data = await res.json();
            if (data.success) {
                setSyncStatus("done");
                setSyncResult(`✅ ${data.total}개 중 ${data.updated}개 가격 업데이트${data.changes?.length > 0 ? "\n" + data.changes.join("\n") : ""}`);
                const r = await fetch("/api/admin/products");
                setProducts(await r.json());
            } else {
                setSyncStatus("error");
                setSyncResult(`❌ ${data.error}`);
            }
        } catch (e: any) {
            setSyncStatus("error");
            setSyncResult(`❌ 요청 실패: ${e.message}`);
        }
    };

    const handleTestScraper = async () => {
        const coupangProduct = products.find(p => p.affiliateLink?.includes("coupang.com"));
        if (!coupangProduct) { setTestResult("❌ 쿠팡 상품 없음"); return; }
        setTestStatus("loading");
        setTestResult(`테스트 중: ${coupangProduct.title.substring(0, 30)}...`);
        try {
            const res = await fetch("/api/admin/test-scraper", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: coupangProduct.affiliateLink }),
            });
            const data = await res.json();
            setTestStatus(data.success ? "done" : "error");
            setTestResult(JSON.stringify(data, null, 2));
        } catch (e: any) {
            setTestStatus("error");
            setTestResult(`❌ 요청 실패: ${e.message}`);
        }
    };

    const startEdit = (p: Product) => {
        setEditingId(p.id);
        setEditSale(p.salePrice > 0 ? String(p.salePrice) : "");
        setEditOrig(String((p as any).originalPrice ?? 0));
    };

    const handleSavePrice = async (id: string) => {
        setEditSaving(true);
        const res = await fetch("/api/admin/products", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, salePrice: Number(editSale), originalPrice: Number(editOrig) }),
        });
        if (res.ok) {
            const sale = Number(editSale) || 0;
            const orig = Number(editOrig) || 0;
            const discount = orig > 0 && sale > 0 && orig > sale ? Math.round(((orig - sale) / orig) * 100) : 0;
            setProducts(prev => prev.map(p => p.id === id ? { ...p, salePrice: sale, discountPercent: discount } : p));
            setEditingId(null);
        }
        setEditSaving(false);
    };

    // SSR 직후 깜빡임 방지
    if (authed === null) return null;

    // 비밀번호 입력창
    if (!authed) {
        return (
            <div style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--background)",
            }}>
                <div style={{
                    width: "100%",
                    maxWidth: 360,
                    padding: "40px 32px",
                    background: "var(--surface)",
                    borderRadius: 16,
                    border: "1px solid var(--border)",
                    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
                }}>
                    <div style={{ textAlign: "center", marginBottom: 24 }}>
                        <div style={{
                            width: 56, height: 56,
                            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                            borderRadius: 14,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 28,
                            marginBottom: 16,
                        }}>
                            ⚡
                        </div>
                        <h1 style={{ fontSize: 20, fontWeight: 900, color: "var(--foreground)", marginBottom: 6 }}>
                            관리자 로그인
                        </h1>
                        <p style={{ fontSize: 13, color: "var(--muted)" }}>IT핫딜랩 어드민 페이지</p>
                    </div>
                    <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <input
                            type="password"
                            value={pw}
                            onChange={e => setPw(e.target.value)}
                            placeholder="비밀번호 입력"
                            autoFocus
                            style={{
                                width: "100%",
                                padding: "12px 16px",
                                borderRadius: 10,
                                border: `1.5px solid ${pwError ? "#ef4444" : "var(--border)"}`,
                                background: "var(--surface2)",
                                fontSize: 16,
                                color: "var(--foreground)",
                                outline: "none",
                                boxSizing: "border-box",
                                letterSpacing: "0.2em",
                            }}
                        />
                        {pwError && (
                            <p style={{ fontSize: 13, color: "#ef4444", fontWeight: 600, margin: 0 }}>
                                비밀번호가 올바르지 않습니다.
                            </p>
                        )}
                        <button
                            type="submit"
                            disabled={pwLoading || !pw}
                            style={{
                                width: "100%",
                                padding: "12px",
                                borderRadius: 10,
                                background: "var(--primary)",
                                color: "white",
                                fontSize: 15,
                                fontWeight: 800,
                                border: "none",
                                cursor: pwLoading || !pw ? "not-allowed" : "pointer",
                                opacity: pwLoading || !pw ? 0.6 : 1,
                                transition: "opacity 0.15s",
                            }}
                        >
                            {pwLoading ? "확인 중..." : "로그인"}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    const BROKEN_IMG_DOMAINS = ["clien.net", "ppomppu.co.kr"];
    const clienCount = products.filter(p => p.affiliateLink.includes("clien.net")).length;
    const noImageCount = products.filter(p =>
        !p.imageUrl || BROKEN_IMG_DOMAINS.some(d => p.imageUrl!.includes(d))
    ).length;

    const filteredProducts = products.filter(p => filterCategory === "전체" || p.category === filterCategory);

    const CATS = ["전체", "골드박스", "Apple", "삼성/LG", "노트북/PC", "모니터/주변기기", "음향/스마트기기", "생활가전", "해외직구"];

    return (
        <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">

            {/* 헤더 */}
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-black text-[var(--foreground)] tracking-tight">상품 관리 대시보드</h1>
                    <p className="mt-1 text-[13px] text-gray-400">핫딜 수집·관리·등록</p>
                </div>
                <span className="text-[12px] font-bold text-gray-400">IT핫딜랩 어드민</span>
            </div>

            {/* 통계 카드 */}
            <div className="grid grid-cols-5 gap-3">
                {[
                    { label: "전체 핫딜", value: products.length, color: "var(--primary)", bg: "rgba(99,102,241,0.07)" },
                    { label: "CTA 클릭", value: products.reduce((sum, p) => sum + (p.clickCount || 0), 0), color: "#ec4899", bg: "rgba(236,72,153,0.07)" },
                    { label: "쇼핑몰 링크", value: products.length - clienCount, color: "#22c55e", bg: "rgba(34,197,94,0.07)" },
                    { label: "클리앙 링크", value: clienCount, color: "#f59e0b", bg: "rgba(245,158,11,0.07)" },
                    { label: "이미지 없음", value: noImageCount, color: "#a855f7", bg: "rgba(168,85,247,0.07)" },
                ].map(s => (
                    <div key={s.label} className="rounded-2xl border border-gray-100 dark:border-white/5 p-4" style={{ background: s.bg }}>
                        <p className="text-[28px] font-black leading-none" style={{ color: s.color }}>{s.value}</p>
                        <p className="text-[11px] font-bold text-gray-400 mt-2">{s.label}</p>
                    </div>
                ))}
            </div>

            {/* 수동 딜 등록 */}
            <section className="card-section space-y-4">
                <div className="flex items-center gap-3">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-yellow-100 text-yellow-600 text-[14px] font-black shrink-0">+</span>
                    <h3 className="text-[16px] font-extrabold text-[var(--foreground)]">쿠팡 딜 수동 등록</h3>
                </div>
                <form onSubmit={handleManualRegister} className="flex gap-2 flex-wrap">
                    <select
                        value={manualCategory}
                        onChange={e => setManualCategory(e.target.value)}
                        className="rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-bold text-[var(--foreground)] bg-[var(--surface2)] outline-none focus:border-yellow-400 dark:border-white/10 shrink-0"
                    >
                        <option value="골드박스">🥇 골드박스</option>
                        <option value="Apple">🍎 Apple</option>
                        <option value="삼성/LG">📺 삼성/LG</option>
                        <option value="노트북/PC">💻 노트북/PC</option>
                        <option value="모니터/주변기기">🖥 모니터/주변기기</option>
                        <option value="음향/스마트기기">🎧 음향/스마트기기</option>
                        <option value="생활가전">🏠 생활가전</option>
                        <option value="해외직구">🌍 해외직구</option>
                    </select>
                    <input
                        type="url"
                        value={manualLink}
                        onChange={e => { setManualLink(e.target.value); setManualStatus("idle"); setManualResult(""); }}
                        placeholder="https://link.coupang.com/a/..."
                        className="flex-1 min-w-0 rounded-xl border border-gray-200 px-4 py-2.5 text-[13px] font-medium text-[var(--foreground)] bg-[var(--surface2)] outline-none focus:border-yellow-400 dark:border-white/10"
                    />
                    <button
                        type="submit"
                        disabled={manualStatus === "loading" || !manualLink.trim()}
                        className="rounded-xl bg-yellow-500 px-5 py-2.5 text-[13px] font-black text-white transition-all hover:opacity-80 disabled:opacity-50 shrink-0"
                    >
                        {manualStatus === "loading" ? "⏳ 분석 중..." : "➕ 등록"}
                    </button>
                </form>
                {manualResult && (
                    <div className={`rounded-xl px-4 py-3 text-[13px] font-bold ${manualStatus === "error" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>
                        {manualResult}
                        {manualStatus === "done" && (
                            <a href={`/deal/${products[0]?.id}`} target="_blank" className="ml-3 underline text-green-800">페이지 확인 →</a>
                        )}
                    </div>
                )}
            </section>

            {/* 크롤링 */}
            <section className="card-section space-y-4">
                <div className="flex items-center gap-3">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-100 text-indigo-600 text-[14px] shrink-0">🔄</span>
                    <h3 className="text-[16px] font-extrabold text-[var(--foreground)]">핫딜 자동 수집</h3>
                    <span className="text-[11px] text-gray-400 font-medium">매일 자동 실행</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                    <button
                        onClick={handleScrape}
                        disabled={scrapeStatus === "loading"}
                        className="rounded-xl bg-[var(--primary)] px-5 py-2.5 text-[13px] font-black text-white transition-all hover:opacity-80 disabled:opacity-50"
                    >
                        {scrapeStatus === "loading" ? "⏳ 수집 중..." : "🔄 지금 실행"}
                    </button>
                    {clienCount > 0 && (
                        <button
                            onClick={handleUpdateLinks}
                            disabled={linkUpdateStatus === "loading"}
                            className="rounded-xl bg-blue-500 px-5 py-2.5 text-[13px] font-black text-white transition-all hover:opacity-80 disabled:opacity-50"
                        >
                            {linkUpdateStatus === "loading" ? "⏳..." : linkUpdateStatus === "done" ? "✅ 완료" : `🔗 클리앙 링크 ${clienCount}개`}
                        </button>
                    )}
                    {noImageCount > 0 && (
                        <button
                            onClick={handleUpdateImages}
                            disabled={imageUpdateStatus === "loading"}
                            className="rounded-xl bg-purple-500 px-5 py-2.5 text-[13px] font-black text-white transition-all hover:opacity-80 disabled:opacity-50"
                        >
                            {imageUpdateStatus === "loading" ? "⏳..." : imageUpdateStatus === "done" ? "✅ 완료" : `🖼 이미지 ${noImageCount}개`}
                        </button>
                    )}
                    <button
                        onClick={handleSyncPrices}
                        disabled={syncStatus === "loading"}
                        className="rounded-xl bg-orange-500 px-5 py-2.5 text-[13px] font-black text-white transition-all hover:opacity-80 disabled:opacity-50"
                    >
                        {syncStatus === "loading" ? "⏳ 가격 동기화 중..." : syncStatus === "done" ? "✅ 완료" : "💰 쿠팡 가격 동기화"}
                    </button>
                </div>
                {syncResult && (
                    <div className={`rounded-xl px-4 py-3 text-[12px] font-bold whitespace-pre-line ${syncStatus === "error" ? "bg-red-50 text-red-600" : "bg-orange-50 text-orange-700"}`}>
                        {syncResult}
                    </div>
                )}
                <button
                    onClick={handleTestScraper}
                    disabled={testStatus === "loading"}
                    className="rounded-xl bg-slate-500 px-4 py-2 text-[12px] font-bold text-white transition-all hover:opacity-80 disabled:opacity-50"
                >
                    {testStatus === "loading" ? "⏳ 테스트 중..." : "🔍 스크래퍼 테스트"}
                </button>
                {testResult && (
                    <div className={`rounded-xl px-4 py-3 text-[11px] font-mono whitespace-pre-wrap break-all ${testStatus === "error" ? "bg-red-50 text-red-600" : "bg-slate-50 text-slate-700"}`}
                        style={{ maxHeight: 300, overflowY: "auto" }}>
                        {testResult}
                    </div>
                )}
                {scrapeResult && (
                    <div className={`rounded-xl px-4 py-3 text-[13px] font-bold ${scrapeStatus === "error" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>
                        {scrapeResult}
                    </div>
                )}
                {imageUpdateResult && (
                    <div className={`rounded-xl px-4 py-3 text-[13px] font-bold ${imageUpdateResult.startsWith("❌") ? "bg-red-50 text-red-600" : "bg-purple-50 text-purple-700"}`}>
                        {imageUpdateResult}
                    </div>
                )}
            </section>

            {/* 핫딜 목록 */}
            <section className="card-section space-y-4">
                {/* 헤더 */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-blue-100 text-blue-600 text-[14px] shrink-0">📋</span>
                        <h3 className="text-[16px] font-extrabold text-[var(--foreground)]">등록된 핫딜</h3>
                    </div>
                    <span className="text-[13px] font-bold text-gray-400">
                        <span className="text-[var(--primary)]">{filteredProducts.length}</span>
                        <span className="text-gray-300 mx-1">/</span>
                        {products.length}개
                    </span>
                </div>

                {/* 카테고리 필터 */}
                <div className="flex flex-wrap gap-1.5">
                    {CATS.map(cat => {
                        const cnt = cat === "전체" ? products.length : products.filter(p => p.category === cat).length;
                        const active = filterCategory === cat;
                        return (
                            <button
                                key={cat}
                                onClick={() => setFilterCategory(cat)}
                                className={`rounded-xl px-4 py-2 text-[13px] font-bold transition-all border ${
                                    active
                                        ? "bg-[var(--primary)] text-white border-transparent"
                                        : "bg-transparent text-gray-500 border-gray-200 hover:border-gray-400 dark:border-white/10 dark:text-gray-400"
                                }`}
                            >
                                {cat} <span className={active ? "opacity-80" : "opacity-60"}>({cnt})</span>
                            </button>
                        );
                    })}
                </div>

                {/* 목록 */}
                <div className="divide-y divide-gray-50 dark:divide-white/5">
                    {filteredProducts.length === 0 ? (
                        <p className="text-center text-gray-400 py-10 text-[14px]">해당 카테고리에 핫딜이 없습니다.</p>
                    ) : filteredProducts.map((p, idx) => {
                        const isBroken = p.imageUrl && BROKEN_IMG_DOMAINS.some(d => p.imageUrl!.includes(d));
                        const timeAgo = (() => {
                            const diff = Date.now() - new Date(p.createdAt).getTime();
                            const m = Math.floor(diff / 60000);
                            if (m < 60) return `${m}분 전`;
                            const h = Math.floor(m / 60);
                            if (h < 24) return `${h}시간 전`;
                            return `${Math.floor(h / 24)}일 전`;
                        })();
                        return (
                            <div key={p.id} className={`flex items-center gap-3 py-3 ${idx === 0 ? "" : ""}`}>
                                {/* 썸네일 */}
                                <div style={{
                                    width: 52, height: 52, borderRadius: 10, overflow: "hidden", flexShrink: 0,
                                    background: "var(--surface2)",
                                    border: `1.5px solid ${isBroken ? "#f87171" : "var(--border)"}`,
                                }}>
                                    {p.imageUrl && !isBroken
                                        ? <img src={p.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                                            {isBroken ? "🚫" : "🖼"}
                                        </div>
                                    }
                                </div>

                                {/* 정보 */}
                                <div className="flex-1 min-w-0 space-y-1">
                                    <p className="text-[14px] font-bold text-[var(--foreground)] leading-snug" style={{
                                        display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden",
                                    }}>{p.title}</p>

                                    {/* 가격 인라인 수정 */}
                                    {editingId === p.id ? (
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <input
                                                type="number"
                                                value={editOrig}
                                                onChange={e => setEditOrig(e.target.value)}
                                                placeholder="정가"
                                                className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-[12px] font-bold text-[var(--foreground)] bg-[var(--surface2)] outline-none focus:border-[var(--primary)]"
                                            />
                                            <span className="text-gray-400 text-[12px]">→</span>
                                            <input
                                                type="number"
                                                value={editSale}
                                                onChange={e => setEditSale(e.target.value)}
                                                placeholder="할인가"
                                                className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-[12px] font-bold text-[var(--primary)] bg-[var(--surface2)] outline-none focus:border-[var(--primary)]"
                                            />
                                            {editOrig && editSale && Number(editOrig) > Number(editSale) && (
                                                <span className="text-[11px] font-black text-red-500">
                                                    {Math.round(((Number(editOrig) - Number(editSale)) / Number(editOrig)) * 100)}% 할인
                                                </span>
                                            )}
                                            <button
                                                onClick={() => handleSavePrice(p.id)}
                                                disabled={editSaving}
                                                className="rounded-lg bg-[var(--primary)] px-3 py-1 text-[12px] font-bold text-white hover:opacity-80 disabled:opacity-50"
                                            >
                                                {editSaving ? "저장 중..." : "저장"}
                                            </button>
                                            <button
                                                onClick={() => setEditingId(null)}
                                                className="rounded-lg border border-gray-200 px-3 py-1 text-[12px] font-bold text-gray-500 hover:bg-gray-50"
                                            >
                                                취소
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {p.salePrice > 0 && (
                                                <span className="text-[13px] font-black text-[var(--primary)]">
                                                    {p.salePrice.toLocaleString()}원
                                                </span>
                                            )}
                                            {p.discountPercent > 0 && (
                                                <span className="text-[11px] font-bold bg-red-50 text-red-500 px-1.5 py-0.5 rounded">
                                                    -{p.discountPercent}%
                                                </span>
                                            )}
                                            <span className="text-[11px] font-bold text-gray-400 border border-gray-200 dark:border-white/10 px-1.5 py-0.5 rounded">
                                                {p.category}
                                            </span>
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                                p.affiliateLink.includes("clien.net")
                                                    ? "bg-yellow-50 text-yellow-600"
                                                    : "bg-green-50 text-green-600"
                                            }`}>
                                                {p.affiliateLink.includes("clien.net") ? "클리앙" : "쇼핑몰"}
                                            </span>
                                            <span className="text-[11px] text-gray-300">{timeAgo}</span>
                                            {(p.viewCount > 0 || p.clickCount > 0) && (
                                                <span className="text-[10px] font-bold text-gray-400">
                                                    👁{p.viewCount || 0} 🖱{p.clickCount || 0}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* 액션 */}
                                <div className="flex gap-1.5 shrink-0">
                                    {editingId !== p.id && (
                                        <button
                                            onClick={() => startEdit(p)}
                                            className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-[12px] font-bold text-orange-500 hover:bg-orange-100 transition-colors"
                                        >
                                            수정
                                        </button>
                                    )}
                                    <a
                                        href={`/deal/${p.id}`}
                                        target="_blank"
                                        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[12px] font-bold text-blue-600 hover:bg-blue-100 transition-colors"
                                    >
                                        보기
                                    </a>
                                    <button
                                        onClick={() => handleDelete(p.id)}
                                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-bold text-red-500 hover:bg-red-100 transition-colors"
                                    >
                                        삭제
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}
