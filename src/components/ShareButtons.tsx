"use client";

import { useState, useEffect } from "react";

interface ShareButtonsProps {
    title: string;
    url: string;
}

export default function ShareButtons({ title, url }: ShareButtonsProps) {
    const [copied, setCopied] = useState(false);
    const [hasShare, setHasShare] = useState(false);

    useEffect(() => {
        setHasShare(typeof navigator !== "undefined" && "share" in navigator);
    }, []);

    const handleShare = async () => {
        try {
            await navigator.share({ title, url });
        } catch {}
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {}
    };

    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;

    const btn: React.CSSProperties = {
        padding: "9px 16px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        border: "none",
        color: "white",
        transition: "opacity 0.15s",
        lineHeight: 1,
    };

    return (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            {hasShare && (
                <button onClick={handleShare} style={{ ...btn, background: "#3b82f6" }}>
                    📤 공유하기
                </button>
            )}
            <a
                href={twitterUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...btn, background: "#1d9bf0", textDecoration: "none", display: "inline-flex", alignItems: "center" }}
            >
                𝕏 트위터 공유
            </a>
            <button
                onClick={handleCopy}
                style={{ ...btn, background: copied ? "#22c55e" : "#6b7280" }}
            >
                {copied ? "✅ 복사됨" : "🔗 링크 복사"}
            </button>
        </div>
    );
}
