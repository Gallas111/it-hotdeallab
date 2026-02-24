"use client";

import { useState } from "react";

export default function AdminLogin() {
    const [password, setPassword] = useState("");
    const [error, setError] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(false);

        const res = await fetch("/api/admin/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
        });

        if (res.ok) {
            window.location.href = "/admin";
        } else {
            setError(true);
            setPassword("");
            setLoading(false);
        }
    };

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
                {/* 아이콘 */}
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
                    <h1 style={{
                        fontSize: 20, fontWeight: 900,
                        color: "var(--foreground)",
                        marginBottom: 6,
                    }}>
                        관리자 로그인
                    </h1>
                    <p style={{ fontSize: 13, color: "var(--muted)" }}>
                        IT핫딜랩 어드민 페이지
                    </p>
                </div>

                <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="비밀번호 입력"
                        autoFocus
                        style={{
                            width: "100%",
                            padding: "12px 16px",
                            borderRadius: 10,
                            border: `1.5px solid ${error ? "#ef4444" : "var(--border)"}`,
                            background: "var(--surface2)",
                            fontSize: 16,
                            color: "var(--foreground)",
                            outline: "none",
                            boxSizing: "border-box",
                            letterSpacing: "0.2em",
                        }}
                    />
                    {error && (
                        <p style={{ fontSize: 13, color: "#ef4444", fontWeight: 600, margin: 0 }}>
                            비밀번호가 올바르지 않습니다.
                        </p>
                    )}
                    <button
                        type="submit"
                        disabled={loading || !password}
                        style={{
                            width: "100%",
                            padding: "12px",
                            borderRadius: 10,
                            background: "var(--primary)",
                            color: "white",
                            fontSize: 15,
                            fontWeight: 800,
                            border: "none",
                            cursor: loading || !password ? "not-allowed" : "pointer",
                            opacity: loading || !password ? 0.6 : 1,
                            transition: "opacity 0.15s",
                        }}
                    >
                        {loading ? "확인 중..." : "로그인"}
                    </button>
                </form>
            </div>
        </div>
    );
}
