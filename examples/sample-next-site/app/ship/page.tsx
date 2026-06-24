// SHIP route — the real, shipped implementation: Fraunces loaded via next/font/google.
// next/font self-hosts the woff2 and generates its CLS-safe adjusted fallback. We point
// the fixture's --fl-* override at next/font's variable so the shared <Article/> renders
// in Fraunces exactly as it would after Font Lab "ships" the pick.

import type { CSSProperties } from "react";
import { Fraunces } from "next/font/google";
import { Article } from "../_components/Article";

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
});

const fontVars = {
  "--fl-sans": "var(--font-fraunces)",
  "--fl-display": "var(--font-fraunces)",
} as CSSProperties;

export default function ShipPage() {
  return (
    <div className={fraunces.variable} style={fontVars}>
      <Article />
    </div>
  );
}
