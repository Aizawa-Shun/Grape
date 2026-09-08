import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Grape",
  description: "作ったサービスが使われない理由を調べて、次にやることを一つ出す道具。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/*
        No <main> here: the landmark belongs inside each layout, because the
        app shell renders a <nav> alongside its content and /login has neither.
      */}
      <body className="min-h-full">{children}</body>
    </html>
  );
}
