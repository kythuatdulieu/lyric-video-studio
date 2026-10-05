import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lydra — Lyric Video Studio",
  description: "Căn lời bài hát theo audio và dựng bản xem trước lyric video.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
