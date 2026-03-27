"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
    return (
        <html lang="ko">
            <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
                <div style={{
                    padding: "80px 20px",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 16,
                }}>
                    <span style={{ fontSize: 48 }}>⚠️</span>
                    <h2 style={{ fontSize: 18, fontWeight: 800 }}>
                        문제가 발생했습니다
                    </h2>
                    <p style={{ fontSize: 14, color: "#888" }}>
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
                            background: "#2563eb",
                            border: "none",
                            borderRadius: 8,
                            cursor: "pointer",
                        }}
                    >
                        다시 시도
                    </button>
                </div>
            </body>
        </html>
    );
}
