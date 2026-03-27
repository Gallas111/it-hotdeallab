import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSimilarDeals } from "@/lib/deals";
import ShareButtons from "@/components/ShareButtons";
import ViewTracker from "@/components/ViewTracker";
import ClickTracker from "@/components/ClickTracker";
import DealImage from "@/components/DealImage";

export const revalidate = 1800; // 30분마다 ISR 재생성

export async function generateStaticParams() {
    try {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const products = await prisma.product.findMany({
            where: { createdAt: { gte: cutoff } },
            select: { id: true },
            orderBy: { createdAt: "desc" },
        });
        return products.map((p) => ({ slug: p.id }));
    } catch {
        return [];
    }
}

async function getProductById(id: string) {
    return prisma.product.findUnique({ where: { id } });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug: id } = await params;
    const p = await getProductById(id);
    if (!p) return { title: "핫딜을 찾을 수 없습니다" };

    const title = `${p.title} - ${p.discountPercent > 0 ? `${p.discountPercent}% 할인` : "핫딜"}`;
    const description = p.discountPercent > 0
        ? `${p.discountPercent}% 할인 ${p.salePrice.toLocaleString()}원! ${p.aiSummary}`
        : p.aiSummary;
    const url = `https://ithotdealab.com/deal/${p.id}`;

    return {
        title,
        description,
        openGraph: {
            type: "article",
            url,
            title,
            description,
            images: p.imageUrl ? [{ url: p.imageUrl, width: 800, height: 600, alt: p.title }] : [],
            siteName: "IT핫딜랩",
            locale: "ko_KR",
        },
        twitter: {
            card: p.imageUrl ? "summary_large_image" : "summary",
            title,
            description,
            images: p.imageUrl ? [p.imageUrl] : [],
        },
    };
}

function getCtaLabel(affiliateLink: string, mallName: string): string {
    const communityMap: Record<string, string> = {
        "ppomppu.co.kr": "뽐뿌",
        "clien.net": "클리앙",
        "ruliweb.com": "루리웹",
        "quasarzone.com": "퀘이사존",
    };
    for (const [domain, name] of Object.entries(communityMap)) {
        if (affiliateLink.includes(domain)) {
            return `${name}에서 확인하기`;
        }
    }
    return `${mallName}에서 구매하기`;
}

export default async function DealDetail({ params }: { params: Promise<{ slug: string }> }) {
    const { slug: id } = await params;
    const p = await getProductById(id).catch(() => null);
    if (!p) notFound();

    const similarDeals = await getSimilarDeals(p.id, p.category, 4).catch(() => []);
    const pros = (p.aiPros || "").split(",").map((s: string) => s.trim()).filter(Boolean);

    const timeAgo = (() => {
        const diff = Date.now() - new Date(p.createdAt).getTime();
        const m = Math.floor(diff / 60000);
        if (m < 1) return "방금 전";
        if (m < 60) return `${m}분 전`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}시간 전`;
        return `${Math.floor(h / 24)}일 전`;
    })();

    const timeRemaining = (() => {
        const expiresAt = new Date(p.createdAt).getTime() + 3 * 24 * 60 * 60 * 1000;
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) return null;
        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);
        if (h < 6) return { text: `⏰ ${h}시간 ${m}분 후 딜 종료`, color: "#ef4444" };
        if (h < 24) return { text: `⏰ ${h}시간 후 딜 종료`, color: "#f97316" };
        const d = Math.floor(h / 24);
        return { text: `${d}일 후 종료`, color: "var(--muted)" };
    })();

    const pageUrl = `https://ithotdealab.com/deal/${p.id}`;

    const priceValidUntil = new Date(new Date(p.createdAt).getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const productJsonLd: Record<string, unknown> = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": p.title,
        "description": p.aiSummary,
        ...(p.imageUrl ? { "image": p.imageUrl } : {}),
        "brand": { "@type": "Brand", "name": p.mallName },
        "offers": p.salePrice > 0 ? {
            "@type": "Offer",
            "price": p.salePrice,
            "priceCurrency": "KRW",
            "availability": "https://schema.org/InStock",
            "itemCondition": "https://schema.org/NewCondition",
            "url": p.affiliateLink,
            "seller": { "@type": "Organization", "name": p.mallName },
            "priceValidUntil": priceValidUntil,
        } : undefined,
    };
    if (!productJsonLd.offers) delete productJsonLd.offers;

    const breadcrumbJsonLd = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "홈", "item": "https://ithotdealab.com" },
            { "@type": "ListItem", "position": 2, "name": p.category, "item": `https://ithotdealab.com/?category=${encodeURIComponent(p.category)}` },
            { "@type": "ListItem", "position": 3, "name": p.title },
        ],
    };

    return (
        <div className="detail-wrap">
            <ViewTracker id={p.id} />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
            />
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
                <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="badge badge-red">{p.category}</span>
                    <span className="badge badge-gray">{p.mallName}</span>
                    {p.viewCount > 0 && (
                        <span className="badge badge-gray">👁 {p.viewCount}회</span>
                    )}
                    <span className="badge badge-gray" style={{ marginLeft: "auto" }}>{timeAgo} 등록</span>
                    {timeRemaining && (
                        <span style={{
                            fontSize: 12, fontWeight: 700,
                            color: timeRemaining.color,
                            background: timeRemaining.color === "#ef4444" ? "#fef2f2" : timeRemaining.color === "#f97316" ? "#fff7ed" : "var(--surface2)",
                            padding: "2px 8px", borderRadius: 6,
                        }}>
                            {timeRemaining.text}
                        </span>
                    )}
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
                    {p.salePrice > 0 ? (
                        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                            <span style={{ fontSize: 32, fontWeight: 900, color: "var(--primary)", letterSpacing: "-0.04em" }}>
                                {p.salePrice.toLocaleString()}
                            </span>
                            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>원</span>
                        </div>
                    ) : p.aiSummary && (
                        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--primary)", lineHeight: 1.5 }}>
                            {p.aiSummary}
                        </div>
                    )}
                </div>

                {/* 이미지 */}
                {p.imageUrl && (
                    <div style={{
                        position: "relative", width: "100%", aspectRatio: "1/1",
                        borderRadius: 8, overflow: "hidden",
                        background: "var(--surface2)", marginBottom: 20,
                        border: "1px solid var(--border)",
                    }}>
                        <DealImage
                            productId={p.id}
                            imageUrl={p.imageUrl}
                            alt={p.title}
                            fill
                            style={{ objectFit: "cover" }}
                        />
                    </div>
                )}

                {/* CTA 버튼 */}
                <ClickTracker id={p.id} href={p.affiliateLink} target="_blank" rel="noopener noreferrer" className="btn-primary">
                    {getCtaLabel(p.affiliateLink, p.mallName)}
                </ClickTracker>

                {/* 쿠팡 파트너스 공지 문구 (쿠팡 딜만 표시) */}
                {p.affiliateLink.includes("coupang.com") && (
                    <div style={{
                        marginTop: 12,
                        padding: "10px 14px",
                        background: "#fffbeb",
                        border: "1px solid #fde68a",
                        borderRadius: 8,
                        display: "flex", alignItems: "flex-start", gap: 8,
                    }}>
                        <span style={{ fontSize: 14, flexShrink: 0 }}>📢</span>
                        <p style={{ fontSize: 11, color: "#92400e", lineHeight: 1.7, fontWeight: 600 }}>
                            이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.
                        </p>
                    </div>
                )}

                {/* 공유 버튼 */}
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 10 }}>이 딜 공유하기</p>
                    <ShareButtons
                        title={p.salePrice > 0 ? `[IT핫딜] ${p.title} - ${p.salePrice.toLocaleString()}원` : `[IT핫딜] ${p.title}`}
                        url={pageUrl}
                    />
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

            {/* 비슷한 상품 추천 */}
            {similarDeals.length > 0 && (
                <div className="detail-card">
                    <h2 style={{
                        fontSize: 13, fontWeight: 800, color: "var(--primary)",
                        letterSpacing: "0.05em", textTransform: "uppercase",
                        marginBottom: 16, display: "flex", alignItems: "center", gap: 8,
                    }}>
                        <span style={{ width: 3, height: 16, background: "var(--primary)", borderRadius: 2, display: "inline-block" }} />
                        비슷한 핫딜
                    </h2>
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, 1fr)",
                        gap: 12,
                    }}>
                        {similarDeals.map(deal => (
                            <Link key={deal.id} href={`/deal/${deal.id}`} style={{
                                display: "flex", gap: 10, alignItems: "center",
                                padding: 10, borderRadius: 10,
                                background: "var(--surface2)",
                                border: "1px solid var(--border)",
                                textDecoration: "none",
                                transition: "border-color 0.15s",
                            }}>
                                {deal.imageUrl ? (
                                    <div style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}>
                                        <DealImage
                                            productId={deal.id}
                                            imageUrl={deal.imageUrl}
                                            alt={deal.title}
                                            fill
                                            style={{ borderRadius: 8, objectFit: "cover" }}
                                        />
                                    </div>
                                ) : (
                                    <div style={{
                                        width: 48, height: 48, borderRadius: 8,
                                        background: "var(--border)",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        fontSize: 18, flexShrink: 0,
                                    }}>🛒</div>
                                )}
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <p style={{
                                        fontSize: 12, fontWeight: 700,
                                        color: "var(--foreground)",
                                        lineHeight: 1.3,
                                        display: "-webkit-box",
                                        WebkitLineClamp: 1,
                                        WebkitBoxOrient: "vertical",
                                        overflow: "hidden",
                                    }}>{deal.title}</p>
                                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                                        {deal.salePrice > 0 && (
                                            <span style={{ fontSize: 12, fontWeight: 900, color: "var(--primary)" }}>
                                                {deal.salePrice.toLocaleString()}원
                                            </span>
                                        )}
                                        {deal.discountPercent > 0 && (
                                            <span style={{
                                                fontSize: 10, fontWeight: 800,
                                                color: "#ef4444",
                                                background: "#fef2f2",
                                                padding: "1px 5px",
                                                borderRadius: 4,
                                            }}>-{deal.discountPercent}%</span>
                                        )}
                                    </div>
                                </div>
                            </Link>
                        ))}
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
                <ClickTracker id={p.id} href={p.affiliateLink} target="_blank" rel="noopener noreferrer"
                    className="btn-primary" style={{ flex: 1, fontSize: 14, padding: "12px" }}>
                    구매하러 가기
                </ClickTracker>
            </div>
        </div>
    );
}
