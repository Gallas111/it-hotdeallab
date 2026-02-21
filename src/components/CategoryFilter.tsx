"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const CATEGORIES = ["전체", "Apple", "삼성/LG", "노트북/PC", "모니터/주변기기", "음향/스마트기기"];

export default function CategoryFilter() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const currentCategory = searchParams.get("category") || "전체";

    const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
    const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

    useEffect(() => {
        const activeTabIndex = CATEGORIES.indexOf(currentCategory);
        const activeTab = tabsRef.current[activeTabIndex];

        if (activeTab) {
            setIndicatorStyle({
                left: activeTab.offsetLeft,
                width: activeTab.offsetWidth,
            });
        }
    }, [currentCategory]);

    const handleCategoryClick = (category: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (category === "전체") {
            params.delete("category");
        } else {
            params.set("category", category);
        }
        router.push(`/?${params.toString()}`);
    };

    return (
        <div className="sticky top-[64px] z-40 bg-white/95 backdrop-blur-md dark:bg-black/95 border-b border-gray-100 dark:border-white/5">
            <div className="mx-auto max-w-2xl px-4 py-4">
                <div className="scrollbar-none relative flex gap-2 overflow-x-auto pb-1">
                    {/* Sliding Indicator */}
                    <div
                        className="tab-indicator"
                        style={{
                            transform: `translateX(${indicatorStyle.left}px)`,
                            width: `${indicatorStyle.width}px`
                        }}
                    />

                    {CATEGORIES.map((category, index) => {
                        const isActive = currentCategory === category;
                        return (
                            <button
                                key={category}
                                ref={(el) => { tabsRef.current[index] = el; }}
                                onClick={() => handleCategoryClick(category)}
                                className={`tab-pill ${isActive ? "tab-pill-active" : "tab-pill-inactive"}`}
                            >
                                {category}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
