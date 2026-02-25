"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";

export default function Header() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [query, setQuery] = useState(searchParams.get("q") || "");

    useEffect(() => {
        setQuery(searchParams.get("q") || "");
    }, [searchParams]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const params = new URLSearchParams(searchParams.toString());
        if (query.trim()) {
            params.set("q", query.trim());
            params.delete("category");
        } else {
            params.delete("q");
        }
        router.push(`/?${params.toString()}`);
    };

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

                {/* 검색 */}
                <form onSubmit={handleSearch} style={{ position: "relative", flex: 1, maxWidth: 280 }}>
                    <input
                        type="text"
                        placeholder="노트북, 모니터, 이어폰..."
                        className="search-input"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        style={{ width: "100%" }}
                    />
                    <button type="submit" style={{
                        position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex",
                    }}>
                        <svg style={{ width: 14, height: 14, color: "var(--muted)" }}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </button>
                </form>
            </div>
        </header>
    );
}
