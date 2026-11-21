import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Safe Bike Seoul",
  description: "서울에서 시작하는 안전한 자전거 라이딩",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
