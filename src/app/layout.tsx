import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import "katex/dist/katex.min.css";
import "./globals.css";
import AdminAuthNavButton from "@/components/AdminAuthNavButton";
import HomeTitleLink from "@/components/HomeTitleLink";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "honki12345 블로그",
    template: "%s | honki12345 블로그",
  },
  description: "AI 수집 글과 직접 작성 글을 함께 발행하는 개인 블로그",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-slate-50 text-slate-900 antialiased`}
      >
        <div className="flex min-h-screen flex-col">
          <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
              <HomeTitleLink className="min-w-0 text-lg font-semibold tracking-tight">
                honki12345 블로그
              </HomeTitleLink>
              <nav
                aria-label="주요 메뉴"
                className="flex w-full min-w-0 flex-wrap items-center gap-1 text-sm font-medium sm:w-auto sm:justify-end sm:gap-2"
              >
                <Link href="/posts" className="header-nav-item">
                  글 목록
                </Link>
                <Link href="/tags" className="header-nav-item">
                  태그
                </Link>
                <Suspense
                  fallback={
                    <Link href="/admin/login" className="header-nav-item">
                      로그인
                    </Link>
                  }
                >
                  <AdminAuthNavButton />
                </Suspense>
              </nav>
            </div>
          </header>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
