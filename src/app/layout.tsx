import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "HyperTools - 跨交易所资金费率监控与组合分析",
    template: "%s | HyperTools",
  },
  description:
    "聚合 Hyperliquid、Gate.io、Binance、OKX、Lighter、Bitget、Bybit 七家交易所，提供资金费率监控与现货 / 永续组合分析。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
