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
        createdAt: Date;
    };
}

function timeAgo(date: Date): string {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "방금 전";
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    return `${Math.floor(hours / 24)}일 전`;
}

export default function DealCard({ product }: DealCardProps) {
    const formattedSalePrice = product.salePrice.toLocaleString();
    const formattedOriginalPrice = product.originalPrice.toLocaleString();

    return (
        <Link href={`/deal/${product.slug}`} className="deal-row group !border-none !bg-transparent !p-0">
            <div className="flex w-full gap-5 rounded-[24px] bg-white p-4 transition-all duration-300 hover:shadow-xl hover:shadow-black/5 dark:bg-[#1c1c1e] dark:hover:bg-white/5 premium-shadow">
                {/* Thumbnail */}
                <div className="image-box h-[110px] w-[110px] shrink-0 p-2 sm:h-[120px] sm:w-[120px]">
                    {product.imageUrl ? (
                        <div className="relative h-full w-full overflow-hidden rounded-xl">
                            <Image
                                src={product.imageUrl}
                                alt={product.title}
                                fill
                                className="object-contain p-1 transition-transform duration-500 group-hover:scale-110"
                            />
                        </div>
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-gray-300 uppercase">
                            NO IMAGE
                        </div>
                    )}
                </div>

                {/* Content Area */}
                <div className="flex flex-1 flex-col justify-between py-1">
                    <div>
                        <div className="mb-2 flex items-center gap-1.5">
                            <span className="category-tag !px-2 !py-0.5 !text-[10px]">{product.category}</span>
                            <span className="mall-tag !px-2 !py-0.5 !text-[10px]">{product.mallName}</span>
                        </div>
                        <h3 className="text-[17px] font-bold leading-[1.4] tracking-tight text-[var(--foreground)] line-clamp-2">
                            {product.title}
                        </h3>
                    </div>

                    <div className="flex items-end justify-between">
                        <div className="flex flex-col gap-0.5">
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-[20px] font-[900] tracking-tighter text-[var(--primary)]">
                                    {formattedSalePrice}원
                                </span>
                                <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-black text-white">
                                    {product.discountPercent}% OFF
                                </span>
                            </div>
                            <span className="text-[12px] font-medium text-gray-400 line-through opacity-60">
                                {formattedOriginalPrice}원
                            </span>
                        </div>

                        <span className="meta-info opacity-60">{timeAgo(product.createdAt)}</span>
                    </div>
                </div>
            </div>
        </Link>
    );
}
