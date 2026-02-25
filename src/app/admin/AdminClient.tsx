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
    const [manualTitle, setManualTitle] = useState("");
    const [manualPrice, setManualPrice] = useState("");
    const [manualCategory, setManualCategory] = useState("골드박스");
    const [manualStatus, setManualStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
    const [manualResult, setManualResult] = useState("");
    const [linkUpdateStatus, setLinkUpdateStatus] = useState<"idle" | "loading" | "done">("idle");
    const [imageUpdateStatus, setImageUpdateStatus] = useState<"idle" | "loading" | "done">("idle");
    const [imageUpdateResult, setImageUpdateResult] = useState<string>("");

    // 탭별 sessionStorage로 인증 상태 확인 (탭/창 닫으면 초기화)
    useEffect(() => {
        setAuthed(sessionStorage.getItem("admin-auth") === "1");
    }, []);

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
            setAuthed(true);
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
            const res = await fetch("/api/cron/scrape");
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
                    title: manualTitle.trim() || undefined,
                    price: manualPrice.trim() || undefined,
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

            {/* 수동 딜 등록 */}
            <section className="card-section space-y-4">
                <div className="flex items-center gap-3 border-b border-gray-50 pb-4 dark:border-white/5">
                    <span className="h-5 w-1 rounded-full bg-yellow-500"></span>
                    <h3 className="text-[17px] font-extrabold text-[var(--foreground)]">쿠팡 딜 수동 등록</h3>
                </div>
                <p className="text-[13px] text-gray-400">쿠팡 파트너스에서 생성한 상품 링크를 붙여넣으면 AI가 자동으로 정보를 추출해 등록합니다.</p>
                <div className="rounded-xl bg-yellow-50 border border-yellow-200 p-3">
                    <p className="text-[12px] font-bold text-yellow-700">
                        📢 이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.
                    </p>
                </div>
                <form onSubmit={handleManualRegister} className="space-y-3">
                    <div className="flex gap-3 flex-wrap">
                        <select
                            value={manualCategory}
                            onChange={e => setManualCategory(e.target.value)}
                            className="rounded-xl border border-gray-200 px-4 py-3 text-[13px] font-bold text-[var(--foreground)] bg-[var(--surface2)] outline-none focus:border-yellow-400 dark:border-white/10 shrink-0"
                        >
                            <option value="골드박스">🥇 골드박스</option>
                            <option value="Apple">🍎 Apple</option>
                            <option value="삼성/LG">📺 삼성/LG</option>
                            <option value="노트북/PC">💻 노트북/PC</option>
                            <option value="모니터/주변기기">🖥 모니터/주변기기</option>
                            <option value="음향/스마트기기">🎧 음향/스마트기기</option>
                            <option value="생활가전">🏠 생활가전</option>
                        </select>
                        <input
                            type="text"
                            value={manualTitle}
                            onChange={e => setManualTitle(e.target.value)}
                            placeholder="상품명 입력 (필수) — 예: 삼성 갤럭시버즈3 프로"
                            className="flex-1 min-w-0 rounded-xl border border-gray-200 px-4 py-3 text-[13px] font-medium text-[var(--foreground)] bg-[var(--surface2)] outline-none focus:border-yellow-400 dark:border-white/10"
                        />
                        <input
                            type="text"
                            value={manualPrice}
                            onChange={e => setManualPrice(e.target.value)}
                            placeholder="할인가 (선택) — 예: 89000"
                            className="w-36 rounded-xl border border-gray-200 px-4 py-3 text-[13px] font-medium text-[var(--foreground)] bg-[var(--surface2)] outline-none focus:border-yellow-400 dark:border-white/10 shrink-0"
                        />
                    </div>
                    <div className="flex gap-3">
                        <input
                            type="url"
                            value={manualLink}
                            onChange={e => { setManualLink(e.target.value); setManualStatus("idle"); setManualResult(""); }}
                            placeholder="쿠팡 파트너스 링크 — https://link.coupang.com/a/..."
                            className="flex-1 min-w-0 rounded-xl border border-gray-200 px-4 py-3 text-[13px] font-medium text-[var(--foreground)] bg-[var(--surface2)] outline-none focus:border-yellow-400 dark:border-white/10"
                        />
                        <button
                            type="submit"
                            disabled={manualStatus === "loading" || !manualLink.trim() || !manualTitle.trim()}
                            className="rounded-xl bg-yellow-500 px-6 py-3 text-[14px] font-black text-white transition-all hover:opacity-80 disabled:opacity-50 shrink-0"
                        >
                            {manualStatus === "loading" ? "⏳ 등록 중..." : "➕ 등록"}
                        </button>
                    </div>
                </form>
                {manualResult && (
                    <div className={`rounded-xl p-4 text-[13px] font-bold ${manualStatus === "error" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>
                        {manualResult}
                        {manualStatus === "done" && (
                            <a href={`/deal/${products[0]?.id}`} target="_blank" className="ml-3 underline text-green-800">페이지 확인 →</a>
                        )}
                    </div>
                )}
            </section>

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
                            {(() => {
                                const isBroken = p.imageUrl && BROKEN_IMG_DOMAINS.some(d => p.imageUrl!.includes(d));
                                return (
                                    <div style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "var(--surface2)", border: `1px solid ${isBroken ? "#f87171" : "var(--border)"}` }}>
                                        {p.imageUrl && !isBroken
                                            ? <img src={p.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{isBroken ? "🚫" : "🖼"}</div>
                                        }
                                    </div>
                                );
                            })()}
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
