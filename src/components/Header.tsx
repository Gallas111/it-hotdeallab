import Link from "next/link";

export default function Header() {
    return (
        <header style={{
            position: "sticky", top: 0, zIndex: 50,
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(12px)",
            borderBottom: "1px solid var(--border)",
            width: "100%",
        }}>
            <div style={{
                maxWidth: 980, margin: "0 auto",
                padding: "0 16px",
                height: 52,
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 12,
            }}>
                {/* 로고 */}
                <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <span style={{
                        background: "var(--primary)", color: "#fff",
                        fontWeight: 900, fontSize: 13,
                        padding: "3px 7px", borderRadius: 6, letterSpacing: "-0.02em",
                    }}>IT</span>
                    <span style={{ fontWeight: 800, fontSize: 16, color: "var(--foreground)", letterSpacing: "-0.03em" }}>
                        핫딜랩
                    </span>
                </Link>

                {/* 검색 */}
                <div style={{ position: "relative", flex: 1, maxWidth: 280 }}>
                    <input
                        type="text"
                        placeholder="노트북, 모니터, 이어폰..."
                        className="search-input"
                        style={{ width: "100%" }}
                    />
                    <svg style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--muted)" }}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </div>

                {/* 우측 메뉴 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <Link href="/admin" style={{
                        fontSize: 12, fontWeight: 700,
                        color: "var(--muted)",
                        textDecoration: "none",
                        padding: "5px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        transition: "all 0.15s",
                    }}>
                        관리
                    </Link>
                </div>
            </div>
        </header>
    );
}
