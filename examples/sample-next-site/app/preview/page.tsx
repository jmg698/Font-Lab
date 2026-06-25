// PREVIEW route — what the dev panel shows BEFORE shipping: Fraunces rendered from our
// independently precomputed @font-face (primary + capsize-derived adjusted fallback),
// pointing at the same self-hosted woff2. No next/font involved here.
//
// The M0 parity test pixel-diffs this route against /ship. If they match, "what you see
// is what you ship" is proven, not asserted.

import type { CSSProperties } from "react";
import { Article } from "../_components/Article";
import { CANDIDATE_FAMILY, candidateFontFaceCss } from "../_fontlab/generated-fonts";

const fontVars = {
  "--fl-sans": CANDIDATE_FAMILY,
  "--fl-display": CANDIDATE_FAMILY,
} as CSSProperties;

export default function PreviewPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: candidateFontFaceCss }} />
      <div style={fontVars}>
        <Article />
      </div>
    </>
  );
}
