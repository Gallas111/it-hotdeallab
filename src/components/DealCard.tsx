import Link from "next/link";
import Image from "next/image";

interface DealCardProps {
    product: {
        id: string;
        title: string;
        slug: string;
        imageUrl?: string | null;
        originalPrice: number;
        salePrice: number;
        discountPercent: number;
        mallName: string;
        category: string;
        aiSummary: string;
        createdAt: Date;
    };
}

function timeAgo(date: Date): string {
    const diff = Date.now() - new Date(date).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "방금";
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    return `${Math.floor(h / 24)}일 전`;
}


export default function DealCard({ product }: DealCardProps) {
    const hasDiscount = product.discountPercent > 0;
    const hasPrice = product.salePrice > 0;

    return (
        <Link href={`/deal/${product.id}`} className="deal-item" style={{ textDecoration: "none" }}>
            {/* 썸네일 */}
            <div style={{
                width: 64, height: 64, flexShrink: 0,
                borderRadius: 8,
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                overflow: "hidden",
                display: "flex", alignItems: "center", justifyContent: "center",
            }}>
                {product.imageUrl ? (
                    <div style={{ position: "relative", width: "100%", height: "100%" }}>
                        <Image src={product.imageUrl} alt={product.title} fill style={{ objectFit: "cover" }} />
                    </div>
                ) : (
                    <span style={{ fontSize: 22 }}>📦</span>
                )}
            </div>

            {/* 콘텐츠 */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                {/* 상단: 뱃지 */}
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                    <span className="badge badge-red">{product.category}</span>
                    <span className="badge badge-gray">{product.mallName}</span>
                </div>

                {/* 제목 */}
                <p className="line-clamp-2" style={{
                    fontSize: 14, fontWeight: 700,
                    color: "var(--foreground)",
                    lineHeight: 1.45,
                    letterSpacing: "-0.01em",
                }}>
                    {product.title}
                </p>

                {/* 하단: 가격 + 시간 */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        {hasPrice ? (
                            <span style={{
                                fontSize: 16, fontWeight: 900,
                                color: "var(--primary)",
                                letterSpacing: "-0.03em",
                            }}>
                                {product.salePrice.toLocaleString()}원
                            </span>
                        ) : product.aiSummary ? (
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)" }}>
                                {product.aiSummary.length > 30 ? product.aiSummary.substring(0, 30) + "…" : product.aiSummary}
                            </span>
                        ) : (
                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
                                가격 확인
                            </span>
                        )}
                        {hasDiscount && (
                            <span className="badge badge-red" style={{ fontSize: 12, fontWeight: 800 }}>
                                {product.discountPercent}%↓
                            </span>
                        )}
                        {hasPrice && product.originalPrice > 0 && (
                            <span style={{ fontSize: 12, color: "var(--muted)", textDecoration: "line-through" }}>
                                {product.originalPrice.toLocaleString()}
                            </span>
                        )}
                    </div>
                    <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>
                        {timeAgo(product.createdAt)}
                    </span>
                </div>
            </div>
        </Link>
    );
}
