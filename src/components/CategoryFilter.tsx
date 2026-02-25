"use client";

import { useRouter, useSearchParams } from "next/navigation";

const CATEGORIES = [
    { label: "전체", value: "전체" },
    { label: "🍎 Apple", value: "Apple" },
    { label: "📺 삼성/LG", value: "삼성/LG" },
    { label: "💻 노트북/PC", value: "노트북/PC" },
    { label: "🖥 모니터/주변기기", value: "모니터/주변기기" },
    { label: "🎧 음향/스마트기기", value: "음향/스마트기기" },
    { label: "🏠 생활가전", value: "생활가전" },
];

export default function CategoryFilter() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const current = searchParams.get("category") || "전체";

    const handleClick = (value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value === "전체") params.delete("category");
        else params.set("category", value);
        router.push(`/?${params.toString()}`);
    };

    return (
        <div style={{
            position: "sticky", top: 52, zIndex: 40,
            background: "var(--filter-bg)",
            backdropFilter: "blur(10px)",
            borderBottom: "1px solid var(--border)",
            width: "100%",
        }}>
            <div style={{ maxWidth: 980, margin: "0 auto", padding: "8px 16px" }}>
                <div className="tab-bar-wrap">
                    <div className="tab-bar">
                        {CATEGORIES.map(cat => (
                            <button
                                key={cat.value}
                                onClick={() => handleClick(cat.value)}
                                className={`tab-btn${current === cat.value ? " active" : ""}`}
                            >
                                {cat.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
