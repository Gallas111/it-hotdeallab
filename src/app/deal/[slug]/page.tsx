import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getProductById(id: string) {
    return prisma.product.findUnique({ where: { id } });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug: id } = await params;
    const p = await getProductById(id);
    if (!p) return { title: "핫딜을 찾을 수 없습니다 - IT핫딜랩" };
    return {
        title: `${p.title} - IT핫딜랩`,
        description: `${p.discountPercent}% 할인! ${p.aiSummary}`,
    };
}

export default async function DealDetail({ params }: { params: Promise<{ slug: string }> }) {
    const { slug: id } = await params;
    const p = await getProductById(id);
    if (!p) notFound();

    const pros = p.aiPros.split(",").map(s => s.trim()).filter(Boolean);
    const isClienLink = p.affiliateLink.includes("clien.net");

    const timeAgo = (() => {
        const diff = Date.now() - new Date(p.createdAt).getTime();
        const m = Math.floor(diff / 60000);
        if (m < 1) return "방금 전";
        if (m < 60) return `${m}분 전`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}시간 전`;
        return `${Math.floor(h / 24)}일 전`;
    })();

    return (
        <div className="detail-wrap">
            {/* 뒤로 가기 */}
            <Link href="/" style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 13, fontWeight: 600, color: "var(--muted)",
                textDecoration: "none", transition: "color 0.15s",
            }}>
                ← 목록으로
            </Link>

            {/* 메인 카드 */}
            <div className="detail-card">
                {/* 뱃지 */}
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                    <span className="badge badge-red">{p.category}</span>
                    <span className="badge badge-gray">{p.mallName}</span>
                    <span className="badge badge-gray" style={{ marginLeft: "auto" }}>{timeAgo} 등록</span>
                </div>

                {/* 제목 */}
                <h1 style={{
                    fontSize: 20, fontWeight: 900, lineHeight: 1.4,
                    letterSpacing: "-0.03em", color: "var(--foreground)",
                    marginBottom: 16,
                }}>
                    {p.title}
                </h1>

                {/* 가격 */}
                <div style={{
                    padding: "16px 0",
                    borderTop: "1px solid var(--border)",
                    borderBottom: "1px solid var(--border)",
                    marginBottom: 20,
                }}>
                    {p.discountPercent > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                            <span className="badge badge-red" style={{ fontSize: 14, fontWeight: 900, padding: "4px 10px" }}>
                                {p.discountPercent}% 할인
                            </span>
                            {p.originalPrice > 0 && (
                                <span style={{ fontSize: 14, color: "var(--muted)", textDecoration: "line-through" }}>
                                    {p.originalPrice.toLocaleString()}원
                                </span>
                            )}
                        </div>
                    )}
                    {p.salePrice > 0 && (
                        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                            <span style={{ fontSize: 32, fontWeight: 900, color: "var(--primary)", letterSpacing: "-0.04em" }}>
                                {p.salePrice.toLocaleString()}
                            </span>
                            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>원</span>
                        </div>
                    )}
                </div>

                {/* 이미지 */}
                {p.imageUrl && (
                    <div style={{
                        position: "relative", width: "100%", aspectRatio: "16/9",
                        borderRadius: 8, overflow: "hidden",
                        background: "var(--surface2)", marginBottom: 20,
                        border: "1px solid var(--border)",
                    }}>
                        <Image src={p.imageUrl} alt={p.title} fill style={{ objectFit: "cover" }} />
                    </div>
                )}

                {/* 클리앙 링크 안내 */}
                {isClienLink && (
                    <div style={{
                        background: "var(--surface2)", border: "1px solid var(--border)",
                        borderRadius: 8, padding: "10px 14px",
                        marginBottom: 14,
                        fontSize: 13, color: "var(--muted)", lineHeight: 1.6,
                    }}>
                        ⚠️ 아래 버튼을 누르면 원본 게시글로 이동합니다. 게시글 내 링크를 클릭해 구매하세요.
                    </div>
                )}

                {/* CTA 버튼 */}
                <a href={p.affiliateLink} target="_blank" rel="noopener noreferrer" className="btn-primary">
                    {isClienLink ? "원본 게시글에서 구매링크 확인" : `${p.mallName}에서 구매하기`}
                </a>

                {/* 원본 링크 */}
                <div style={{ marginTop: 12, textAlign: "center" }}>
                    <Link href={p.sourceUrl} target="_blank" rel="noopener noreferrer" style={{
                        fontSize: 12, color: "var(--muted)", textDecoration: "none",
                    }}>
                        📝 원본 게시글 보기
                    </Link>
                </div>
            </div>

            {/* AI 분석 카드 */}
            <div className="detail-card">
                <h2 style={{
                    fontSize: 13, fontWeight: 800, color: "var(--primary)",
                    letterSpacing: "0.05em", textTransform: "uppercase",
                    marginBottom: 16, display: "flex", alignItems: "center", gap: 8,
                }}>
                    <span style={{ width: 3, height: 16, background: "var(--primary)", borderRadius: 2, display: "inline-block" }} />
                    AI 스마트 분석
                </h2>

                {/* 한줄 요약 */}
                <div style={{
                    background: "var(--surface2)", borderRadius: 8,
                    padding: "14px 16px", marginBottom: 20,
                    fontSize: 15, fontWeight: 700, lineHeight: 1.6,
                    color: "var(--foreground)", borderLeft: "3px solid var(--primary)",
                }}>
                    &ldquo;{p.aiSummary}&rdquo;
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    {/* 핵심 포인트 */}
                    <div>
                        <p style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 10 }}>핵심 포인트</p>
                        <ul style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {pros.map((pro, i) => (
                                <li key={i} style={{
                                    display: "flex", gap: 8, alignItems: "flex-start",
                                    fontSize: 13, fontWeight: 600, color: "var(--foreground)", lineHeight: 1.5,
                                }}>
                                    <span style={{
                                        width: 18, height: 18, borderRadius: "50%",
                                        background: "var(--primary-soft)", color: "var(--primary)",
                                        fontSize: 10, fontWeight: 900,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        flexShrink: 0, marginTop: 1,
                                    }}>✓</span>
                                    {pro}
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* 추천 대상 */}
                    <div>
                        <p style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 10 }}>이런 분께 추천</p>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", lineHeight: 1.7 }}>
                            {p.aiTarget}
                        </p>
                    </div>
                </div>
            </div>

            {/* 상세 가이드 카드 */}
            {p.seoContent && (
                <div className="detail-card">
                    <h2 style={{
                        fontSize: 13, fontWeight: 800, color: "var(--muted)",
                        letterSpacing: "0.04em", marginBottom: 16,
                        display: "flex", alignItems: "center", gap: 8,
                    }}>
                        <span style={{ width: 3, height: 16, background: "var(--muted)", borderRadius: 2, display: "inline-block" }} />
                        심층 분석 가이드
                    </h2>
                    <div style={{
                        fontSize: 14, lineHeight: 1.9, color: "var(--muted)",
                        fontWeight: 500, whiteSpace: "pre-line",
                    }}>
                        {p.seoContent}
                    </div>
                </div>
            )}

            {/* 모바일 고정 하단 CTA */}
            <div style={{
                position: "fixed", bottom: 0, left: 0, right: 0,
                background: "rgba(255,255,255,0.96)",
                backdropFilter: "blur(12px)",
                borderTop: "1px solid var(--border)",
                padding: "12px 16px",
                display: "flex", gap: 12, alignItems: "center",
                zIndex: 50,
            }} className="sm-hidden">
                {p.salePrice > 0 && (
                    <div style={{ flexShrink: 0 }}>
                        <p style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>혜택가</p>
                        <p style={{ fontSize: 18, fontWeight: 900, color: "var(--primary)", letterSpacing: "-0.03em" }}>
                            {p.salePrice.toLocaleString()}원
                        </p>
                    </div>
                )}
                <a href={p.affiliateLink} target="_blank" rel="noopener noreferrer"
                    className="btn-primary" style={{ flex: 1, fontSize: 14, padding: "12px" }}>
                    {isClienLink ? "원본 게시글 보기" : "최저가 구매하기"}
                </a>
            </div>
        </div>
    );
}
