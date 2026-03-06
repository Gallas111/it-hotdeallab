"use client";

import { useState, useRef } from "react";

interface DealImageProps {
    productId: string;
    imageUrl: string;
    alt: string;
    fill?: boolean;
    style?: React.CSSProperties;
}

export default function DealImage({ productId, imageUrl, alt, fill, style }: DealImageProps) {
    const [imgSrc, setImgSrc] = useState(imageUrl);
    const [showFallback, setShowFallback] = useState(false);
    const retrying = useRef(false);

    const handleImgError = async () => {
        if (retrying.current) {
            setShowFallback(true);
            return;
        }
        retrying.current = true;
        try {
            const res = await fetch(`/api/deals/refresh-image?id=${productId}`);
            const data = await res.json();
            if (data.imageUrl) {
                setImgSrc(data.imageUrl);
            } else {
                setShowFallback(true);
            }
        } catch {
            setShowFallback(true);
        }
    };

    if (showFallback) {
        return (
            <div style={{
                width: "100%", height: "100%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 48,
            }}>
                📦
            </div>
        );
    }

    const imgStyle: React.CSSProperties = fill
        ? { position: "absolute", width: "100%", height: "100%", inset: 0, ...style }
        : { ...style };

    return (
        <img
            src={imgSrc}
            alt={alt}
            style={imgStyle}
            onError={handleImgError}
            loading="lazy"
        />
    );
}
