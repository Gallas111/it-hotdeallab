import Link from "next/link";
import { Suspense } from "react";
import SearchForm from "./SearchForm";

export default function Header() {
    return (
        <header style={{
            position: "sticky", top: 0, zIndex: 50,
            background: "var(--header-bg)",
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

                {/* 검색 - useSearchParams 때문에 Suspense 필요 */}
                <Suspense fallback={
                    <div style={{ position: "relative", flex: 1, maxWidth: 280 }}>
                        <input type="text" placeholder="노트북, 모니터, 이어폰..." className="search-input" style={{ width: "100%" }} disabled />
                    </div>
                }>
                    <SearchForm />
                </Suspense>
            </div>
        </header>
    );
}
