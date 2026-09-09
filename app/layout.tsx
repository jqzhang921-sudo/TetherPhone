import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TetherPhone",
  description: "一部住着 AI 的小手机",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // 手机上加到主屏幕后，状态栏区域交给页面自己画
  viewportFit: "cover",
  themeColor: "#111318",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        {/* 分片字体的 @font-face 表。生成物，不进构建管线——
            换字体重跑 tools/slice-font.py 就行。 */}
        <link rel="stylesheet" href="/fonts/zhimangxing/ZhiMangXing.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
