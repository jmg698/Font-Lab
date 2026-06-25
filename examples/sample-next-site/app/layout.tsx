import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import dynamic from "next/dynamic";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const jbMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-jbmono" });

// Dev-only panel. The IMPORT itself is gated, not just the render: a static import plus an
// inline `process.env.NODE_ENV` render guard tree-shakes the call but STILL ships the
// component's code chunk to production (verified in M0). A dev-only dynamic import in the
// dead prod branch is never emitted, so the panel truly never ships.
const FontLabDevPanel =
  process.env.NODE_ENV === "development"
    ? dynamic(() => import("./_fontlab/FontLabDevPanel").then((m) => m.FontLabDevPanel))
    : () => null;

export const metadata: Metadata = {
  title: "Sample Site — Font Lab fixture",
  description: "Deterministic Next.js + Tailwind v4 fixture for the Font Lab M0 spike.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${jbMono.variable}`}>
      <body>
        {children}
        {process.env.NODE_ENV === "development" && <FontLabDevPanel />}
      </body>
    </html>
  );
}
