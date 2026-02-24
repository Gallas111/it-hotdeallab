import { Suspense } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CategoryFilter from "@/components/CategoryFilter";
import "./globals.css";

export const metadata = {
  title: "IT핫딜랩 - 실시간 IT/가전 핫딜 모음",
  description: "클리앙, 뽐뿌, 퀘이사존의 IT·가전 핫딜을 AI로 분석해 한곳에서 모아봅니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
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
