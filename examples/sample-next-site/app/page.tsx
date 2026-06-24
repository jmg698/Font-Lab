"use client";

// Home route = the "current" state (Inter), with the dev panel available to flip fonts.
// This is a client component so editing it triggers classic Fast Refresh (re-render, no
// full reload) — which is exactly the condition the M0 HMR test exercises: the :root
// font override set by the panel must survive a Fast Refresh.
//
// The #hmr-marker span is how the HMR test confirms a Fast Refresh actually happened
// (it rewrites the marker text and waits for it to appear) before asserting the swap held.

import { Article } from "./_components/Article";

export default function Home() {
  return (
    <>
      <span id="hmr-marker" hidden>
        hmr-v0
      </span>
      <Article />
    </>
  );
}
