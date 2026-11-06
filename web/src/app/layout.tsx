import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// Fontshare faces, self-hosted (ITF Free Font License).
const clash = localFont({
  src: [
    { path: "../fonts/clash-grotesk-500.woff2", weight: "500" },
    { path: "../fonts/clash-grotesk-600.woff2", weight: "600" },
  ],
  variable: "--font-clash",
  display: "swap",
});
const zodiak = localFont({
  src: [{ path: "../fonts/zodiak-400-italic.woff2", weight: "400", style: "italic" }],
  variable: "--font-zodiak",
  display: "swap",
});
const satoshi = localFont({
  src: [
    { path: "../fonts/satoshi-400.woff2", weight: "400" },
    { path: "../fonts/satoshi-500.woff2", weight: "500" },
    { path: "../fonts/satoshi-700.woff2", weight: "700" },
  ],
  variable: "--font-satoshi",
  display: "swap",
});
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Slotwise: book care at the right minute",
  description: "The clinic timetable. See every open appointment, book one in seconds and get an instant confirmation.",
};

export const viewport: Viewport = { themeColor: "#eeebe4" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${clash.variable} ${zodiak.variable} ${satoshi.variable} ${mono.variable} antialiased`}>{children}</body>
    </html>
  );
}
