import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
    return new ImageResponse(
        <div
            style={{
                width: 1200,
                height: 630,
                background: "linear-gradient(135deg, #0f0f1a 0%, #1a1030 50%, #0f0f1a 100%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "sans-serif",
            }}
        >
            {/* 아이콘 */}
            <div
                style={{
                    width: 100,
                    height: 100,
                    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                    borderRadius: 24,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 60,
                    marginBottom: 32,
                }}
            >
                ⚡
            </div>

            {/* 제목 */}
            <div
                style={{
                    fontSize: 72,
                    fontWeight: 900,
                    color: "white",
                    letterSpacing: "-2px",
                }}
            >
                IT핫딜랩
            </div>

            {/* 부제 */}
            <div
                style={{
                    fontSize: 30,
                    color: "#a78bfa",
                    marginTop: 20,
                    fontWeight: 600,
                }}
            >
                매일 쏟아지는 IT/가전 핫딜, 한눈에.
            </div>

            {/* 도메인 */}
            <div
                style={{
                    fontSize: 20,
                    color: "#6b7280",
                    marginTop: 24,
                }}
            >
                ithotdealab.com
            </div>
        </div>,
        { ...size }
    );
}
