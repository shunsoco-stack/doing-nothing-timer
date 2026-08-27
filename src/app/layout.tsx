import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { PwaRegister } from "@/components/pwa-register";
import { PrivacyAnalytics } from "@/components/privacy-analytics";
import "./globals.css";

const title = "何もしない記録 — 何もしない時間を、ちゃんと記録する。";
const description =
  "生産性を、少しだけお休み。何もしない時間を計測して、今日の記録・週間記録・実績に。厳格モードとゆるモードで、自分のペースの余白をつくる無料アプリ。";

export const metadata: Metadata = {
  metadataBase: new URL("https://doing-nothing-timer.vercel.app"),
  title,
  description,
  applicationName: "何もしない記録",
  alternates: { canonical: "/" },
  keywords: ["何もしない", "タイマー", "休憩", "デジタルデトックス", "余白"],
  openGraph: {
    title,
    description,
    url: "/",
    siteName: "何もしない記録",
    locale: "ja_JP",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "何もしない記録。何もしない時間を、ちゃんと記録する。",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "何もしない記録",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f5" },
    { media: "(prefers-color-scheme: dark)", color: "#151a17" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
        >{`try{var t=localStorage.getItem('doing-nothing:theme:v1');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch(e){}`}</Script>
        {children}
        <PwaRegister />
        <PrivacyAnalytics />
      </body>
    </html>
  );
}
