export default function Footer() {
    return (
        <footer style={{
            borderTop: "1px solid var(--border)",
            padding: "28px 0 20px",
            marginTop: 20,
        }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>

                {/* 쿠팡 파트너스 배너 */}
                <a
                    href="https://www.coupang.com/np/search?q=IT+전자기기&partnerCode=AF5418862"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        width: "100%", maxWidth: 480,
                        background: "#FEEB32",
                        borderRadius: 10,
                        padding: "12px 18px",
                        textDecoration: "none",
                        transition: "opacity 0.15s",
                    }}
                >
                    <div>
                        <p style={{ fontSize: 11, fontWeight: 800, color: "#C00020", letterSpacing: "0.05em" }}>COUPANG PARTNERS</p>
                        <p style={{ fontSize: 15, fontWeight: 900, color: "#111", letterSpacing: "-0.02em" }}>쿠팡 최저가 바로가기 →</p>
                    </div>
                    <span style={{ fontSize: 28 }}>🛒</span>
                </a>

                {/* 안내 문구 */}
                <p style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", lineHeight: 1.7 }}>
                    이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.<br />
                    게시된 가격은 실시간으로 변동될 수 있으며 구매 시점의 가격과 다를 수 있습니다.
                </p>

                <p style={{ fontSize: 11, color: "var(--muted)", opacity: 0.6 }}>
                    © 2026 IT핫딜랩
                </p>
            </div>
        </footer>
    );
}
