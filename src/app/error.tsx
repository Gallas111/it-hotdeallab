"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
    return (
        <div style={{
            padding: "80px 20px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
        }}>
            <span style={{ fontSize: 48 }}>⚠️</span>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--foreground)" }}>
                문제가 발생했습니다
            </h2>
            <p style={{ fontSize: 14, color: "var(--muted)" }}>
                잠시 후 다시 시도해주세요
            </p>
            <button
                onClick={reset}
                style={{
                    marginTop: 8,
                    padding: "10px 24px",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#fff",
                    background: "var(--primary)",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                }}
            >
                다시 시도
            </button>
        </div>
    );
}
