import { Suspense } from "react";
import { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CategoryFilter from "@/components/CategoryFilter";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ithotdealab.com"),
  title: {
    default: "IT핫딜랩 - 실시간 IT/가전 핫딜 모음",
    template: "%s | IT핫딜랩",
  },
  description: "매일 쏟아지는 IT/가전 핫딜, 한눈에. 최신 IT 기기·가전제품 최저가 할인 정보를 실시간으로 확인하세요.",
  keywords: ["IT핫딜", "가전제품 할인", "핫딜", "핫딜모음", "IT할인", "전자기기 핫딜", "최저가", "쿠팡핫딜", "다나와핫딜", "노트북 할인", "스마트폰 할인"],
  authors: [{ name: "IT핫딜랩", url: "https://ithotdealab.com" }],
  creator: "IT핫딜랩",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "https://ithotdealab.com",
    siteName: "IT핫딜랩",
    title: "IT핫딜랩 - 실시간 IT/가전 핫딜 모음",
    description: "매일 쏟아지는 IT/가전 핫딜, 한눈에.",
  },
  twitter: {
    card: "summary_large_image",
    title: "IT핫딜랩 - 실시간 IT/가전 핫딜 모음",
    description: "매일 쏟아지는 IT/가전 핫딜, 한눈에.",
  },
  verification: {
    google: "BPEPStceyj8JVwc0yyAvoJa2im--ULbmuajiSz7CYSo",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
        {/* Google Analytics */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-PYFWDRRCSJ" />
        <script dangerouslySetInnerHTML={{ __html: `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-PYFWDRRCSJ');
        `}} />
      </head>
      <body className="site-wrap">
        <Header />
        <Suspense fallback={null}>
          <CategoryFilter />
        </Suspense>
        <div className="site-body">
          <main style={{ flex: 1, paddingTop: 20, paddingBottom: 40 }}>
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
