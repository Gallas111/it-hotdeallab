import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";

// Mock data fetcher
const getProductBySlug = (slug: string) => {
    return {
        title: "LG전자 27인치 4K UHD 모니터 27UP850N IPS HDR400",
        slug: slug,
        imageUrl: null,
        originalPrice: 620000,
        salePrice: 449000,
        discountPercent: 28,
        mallName: "쿠팡",
        category: "모니터/주변기기",
        aiSummary: "현재 주요 오픈마켓 중 최저가이며, 이전 역대급 할인가에 근접한 가격입니다. 사무용 및 영상 편집용 4K 모니터를 찾으신다면 최고의 선택입니다.",
        aiPros: "4K 고해상도 IPS 패널, USB-C PD 90W 지원, 정확한 색표현력",
        aiTarget: "가성비 4K 모니터가 필요한 재택근무자, 맥북 사용자",
        seoContent: "LG 전자 27UP850N 모니터는 27인치 화면 크기에 4K UHD 해상도를 지원하는 고성능 모니터입니다. IPS 패널을 탑재하여 상하좌우 178도의 넓은 시야각을 자랑하며, HDR400 인증을 통해 더욱 선명하고 생동감 넘치는 화면을 제공합니다. 특히 USB-C 단자를 통해 모니터 연결과 동시에 노트북 충전(최대 90W)이 가능하여 맥북이나 최신 노트북 사용자에게 매우 편리합니다.",
        affiliateLink: "https://link.coupang.com/a/example",
        sourceUrl: "https://www.coupang.com/vp/products/...",
        createdAt: new Date(),
    };
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const resolvedParams = await params;
    const product = getProductBySlug(resolvedParams.slug);
    return {
        title: `${product.title} - IT핫딜랩`,
        description: `${product.discountPercent}% 할인! ${product.aiSummary}`,
    };
}

export default async function DealDetail({ params }: { params: Promise<{ slug: string }> }) {
    const resolvedParams = await params;
    const product = getProductBySlug(resolvedParams.slug);
    if (!product) notFound();

    const pros = product.aiPros.split(",").map(p => p.trim());

    return (
        <div className="detail-layout pb-32">
            {/* Header / Navigation */}
            <div className="flex items-center justify-between">
                <Link href="/" className="meta-link font-bold group">
                    <span className="text-xl transition-transform group-hover:-translate-x-1">←</span>
                    <span className="ml-1">핫딜 목록</span>
                </Link>
                <div className="flex gap-4">
                    <button className="meta-link hover:text-[var(--primary)] text-sm">북마크</button>
                    <button className="meta-link hover:text-[var(--primary)] text-sm">공유</button>
                </div>
            </div>

            {/* Main Content Card */}
            <article className="card-section premium-shadow">
                {/* Product Info Header */}
                <div className="mb-8 flex items-center gap-2">
                    <span className="category-tag">{product.category}</span>
                    <span className="mall-tag">{product.mallName}</span>
                </div>

                <h1 className="mb-6 text-3xl font-extrabold leading-[1.3] tracking-tighter text-[var(--foreground)] sm:text-4xl">
                    {product.title}
                </h1>

                <div className="flex items-center justify-between border-b border-[var(--border)] pb-8">
                    <div className="flex items-center gap-3 text-[13px] text-gray-400 font-medium">
                        <span>온라인 최저가</span>
                        <span className="h-1 w-1 rounded-full bg-gray-300"></span>
                        <span>12분 전 등록</span>
                    </div>
                    <div className="flex gap-4">
                        <Link href={product.sourceUrl} target="_blank" className="meta-link text-[var(--primary)] font-bold text-sm">📝 원본글</Link>
                        <button className="meta-link opacity-60 text-sm">🚨 신고</button>
                    </div>
                </div>

                {/* Price Section */}
                <div className="py-12 sm:py-16 text-center sm:text-left">
                    <div className="mb-4 flex items-center justify-center sm:justify-start gap-2">
                        <span className="rounded-md bg-red-50 px-2 py-1 text-lg font-black text-[var(--primary)] uppercase">{product.discountPercent}% OFF</span>
                        <span className="text-base font-medium text-gray-400 line-through">{product.originalPrice.toLocaleString()}원</span>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-center sm:justify-start gap-1">
                        <span className="text-6xl font-black tracking-tighter text-[var(--foreground)]">
                            {product.salePrice.toLocaleString()}
                        </span>
                        <span className="text-3xl font-bold text-[var(--foreground)]">원</span>
                    </div>
                </div>

                {/* Thumbnail Area */}
                <div className="mb-12">
                    <div className="group relative aspect-video w-full overflow-hidden rounded-3xl bg-gray-50 border border-[var(--border)] dark:bg-gray-900">
                        {product.imageUrl ? (
                            <Image src={product.imageUrl} alt={product.title} fill className="object-cover transition-transform duration-700 group-hover:scale-105" />
                        ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-gray-300">
                                <span className="text-5xl">📦</span>
                                <span className="text-sm font-bold opacity-60">상품 이미지를 준비 중입니다</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Main CTA */}
                <div className="mb-2">
                    <a href={product.affiliateLink} target="_blank" rel="noopener noreferrer" className="btn-cta bg-gradient-to-r from-[var(--primary)] to-[#ff5e57] shadow-xl shadow-red-500/10">
                        {product.mallName}에서 즉시 구매하기
                    </a>
                    <p className="mt-8 text-center text-[12px] leading-relaxed text-gray-400 px-6">
                        * 해당 링크를 통해 구매 시 소정의 수수료를 제공받아 서비스 운영에 사용됩니다.<br />
                        쿠팡 파트너스 활동의 일환으로 최저가는 실시간으로 변동될 수 있습니다.
                    </p>
                </div>
            </article>

            {/* AI Review Card */}
            <section className="card-section">
                <div className="mb-10 flex items-center gap-3">
                    <div className="h-6 w-1 rounded-full bg-[var(--primary)]"></div>
                    <h3 className="text-[16px] font-black uppercase tracking-widest text-[var(--primary)]">
                        IT핫딜랩 스마트 분석
                    </h3>
                </div>

                <div className="space-y-12">
                    {/* Summary */}
                    <div className="rounded-2xl bg-gray-50 p-8 dark:bg-white/5">
                        <p className="text-xl font-bold leading-[1.8] text-gray-800 dark:text-gray-200">
                            "{product.aiSummary}"
                        </p>
                    </div>

                    {/* Features Detail */}
                    <div className="grid gap-12 sm:grid-cols-2">
                        <div>
                            <h4 className="mb-6 text-[14px] font-bold text-gray-400 tracking-tight flex items-center gap-2">
                                <span className="h-1.5 w-1.5 rounded-full bg-gray-300"></span>
                                핵심 포인트
                            </h4>
                            <ul className="space-y-4">
                                {pros.map((pro, i) => (
                                    <li key={i} className="flex items-start gap-3 text-[16px] font-bold text-gray-700 dark:text-gray-300">
                                        <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-50 text-[10px] text-[var(--primary)]">✓</div>
                                        {pro}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <h4 className="mb-6 text-[14px] font-bold text-gray-400 tracking-tight flex items-center gap-2">
                                <span className="h-1.5 w-1.5 rounded-full bg-gray-300"></span>
                                이런 분께 추천해요
                            </h4>
                            <p className="text-[16px] font-bold leading-[1.8] text-gray-700 dark:text-gray-300">
                                {product.aiTarget}
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Detailed SEO Content Card */}
            <section className="card-section">
                <h3 className="mb-8 text-[14px] font-bold text-gray-400 tracking-tight flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-300"></span>
                    심층 분석 가이드
                </h3>
                <div className="prose prose-sm max-w-none px-2 text-[17px] leading-[1.95] text-gray-600 dark:text-gray-400 font-medium">
                    {product.seoContent}
                </div>
            </section>

            {/* Fixed Bottom CTA for Mobile */}
            <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--border)] bg-white/95 p-5 pb-safe backdrop-blur-md dark:bg-black/95 sm:hidden">
                <div className="mx-auto flex max-w-2xl items-center justify-between gap-6">
                    <div className="flex flex-col">
                        <span className="text-[11px] font-bold text-gray-400">혜택가</span>
                        <span className="text-xl font-black text-[var(--primary)]">{product.salePrice.toLocaleString()}원</span>
                    </div>
                    <a href={product.affiliateLink} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-2xl bg-[var(--primary)] py-4 text-center text-sm font-bold text-white shadow-xl shadow-red-500/20 active:scale-95 transition-transform">
                        최저가 구매하기
                    </a>
                </div>
            </div>
        </div>
    );
}
