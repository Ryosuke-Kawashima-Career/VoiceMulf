import type { Metadata, Viewport } from "next";
import { Noto_Sans, Noto_Sans_Devanagari, Noto_Sans_Tamil } from "next/font/google";
import "./globals.css";

const latin = Noto_Sans({ subsets: ["latin"], variable: "--font-latin" });
const deva = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-deva" });
const tamil = Noto_Sans_Tamil({ subsets: ["tamil"], variable: "--font-tamil" });

export const metadata: Metadata = {
  title: "Quiz Co-Driver",
  description: "Navigation and voice quizzes for drivers",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f7f9",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${latin.variable} ${deva.variable} ${tamil.variable}`}>
      <body>{children}</body>
    </html>
  );
}
