import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "페이지를 찾을 수 없습니다",
    robots: { index: false, follow: false },
};

export default function NotFound() {
    return (
        <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", minHeight: "50vh", gap: 16, textAlign: "center",
        }}>
            <h1 style={{ fontSize: 48, fontWeight: 900, color: "var(--primary)" }}>404</h1>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--foreground)" }}>
                요청하신 페이지를 찾을 수 없습니다
            </p>
            <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>
                이미 종료된 딜이거나, 잘못된 주소일 수 있습니다.
            </p>
            <Link href="/" style={{
                marginTop: 8, padding: "10px 24px", borderRadius: 8,
                background: "var(--primary)", color: "#fff",
                fontSize: 14, fontWeight: 700, textDecoration: "none",
            }}>
                핫딜 목록으로 돌아가기
            </Link>
        </div>
    );
}
