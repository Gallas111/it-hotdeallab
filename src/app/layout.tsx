import { Suspense } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CategoryFilter from "@/components/CategoryFilter";
import "./globals.css";

export const metadata = {
  title: "IT핫딜랩 - 실시간 IT/가전 핫딜 모음",
  description: "실시간으로 분석하고 검증하는 IT, 노트북, 모니터 최저가 핫딜 플랫폼. IT핫딜랩.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          as="style"
          crossOrigin=""
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body className="flex min-h-screen justify-center bg-[var(--background)]">
        <div className="main-layout premium-shadow">
          <Header />
          <Suspense fallback={null}>
            <CategoryFilter />
          </Suspense>
          <main className="flex-1 py-8">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
