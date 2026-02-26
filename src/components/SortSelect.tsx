"use client";

import { useRouter, useSearchParams } from "next/navigation";

const SORT_OPTIONS = [
    { label: "최신순", value: "newest" },
    { label: "할인율순", value: "discount" },
    { label: "저가순", value: "price_asc" },
    { label: "고가순", value: "price_desc" },
];

export default function SortSelect() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const current = searchParams.get("sort") || "newest";

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const params = new URLSearchParams(searchParams.toString());
        if (e.target.value === "newest") {
            params.delete("sort");
        } else {
            params.set("sort", e.target.value);
        }
        router.push(`/?${params.toString()}`);
    };

    return (
        <select className="sort-select" value={current} onChange={handleChange}>
            {SORT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
        </select>
    );
}
