import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "IT핫딜랩 - 실시간 IT/가전 핫딜 모음",
        short_name: "IT핫딜랩",
        description: "매일 쏟아지는 IT/가전 핫딜, 한눈에.",
        start_url: "/",
        display: "standalone",
        background_color: "#0f0a1a",
        theme_color: "#6366f1",
        icons: [
            {
                src: "/icon",
                sizes: "48x48",
                type: "image/png",
            },
            {
                src: "/apple-icon",
                sizes: "180x180",
                type: "image/png",
            },
        ],
    };
}
