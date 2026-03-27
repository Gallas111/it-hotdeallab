import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    images: {
        remotePatterns: [
            { protocol: "https", hostname: "**.coupang.com" },
            { protocol: "https", hostname: "**.naver.net" },
            { protocol: "https", hostname: "**.pstatic.net" },
            { protocol: "https", hostname: "**.alicdn.com" },
            { protocol: "https", hostname: "**.11st.co.kr" },
            { protocol: "https", hostname: "**.tmon.co.kr" },
            { protocol: "https", hostname: "**.wemakeprice.com" },
            { protocol: "https", hostname: "**.gmarket.co.kr" },
            { protocol: "https", hostname: "**.auction.co.kr" },
        ],
    },
    async headers() {
        return [
            {
                source: "/(.*)",
                headers: [
                    { key: "X-Frame-Options", value: "DENY" },
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                    { key: "X-XSS-Protection", value: "1; mode=block" },
                    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
                ],
            },
        ];
    },
};

export default nextConfig;
