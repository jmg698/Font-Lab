// A perfectly generic content page — headings use `font-display`, body `font-sans`,
// code `font-mono`. Before Font Lab there is no display font (the utility is unset, so
// headings inherit the body font); after `font-lab apply` they render the picked face.

export default function Home() {
  return (
    <main className="mx-auto max-w-[680px] px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
        Acme · Changelog
      </p>

      <h1 className="font-display mt-3 text-5xl font-semibold leading-[1.05] tracking-[-0.02em]">
        Ship typography you actually chose.
      </h1>

      <p className="mt-5 text-xl leading-snug text-[var(--muted)]">
        This starter ships the same fonts as everyone else. Run Font Lab, pick a direction
        on this very page, and the agent writes the real next/font + Tailwind code.
      </p>

      <hr className="my-10 border-0 border-t" style={{ borderColor: "var(--rule)" }} />

      <div className="space-y-5 text-[1.0625rem] leading-[1.7]">
        <p>
          The body you are reading is the default sans. The headline above wants a display
          face with personality; the snippet below is set in a monospace. Each is a
          separate role, wired through a CSS variable, so a single edit reflows the page.
        </p>

        <h2 className="font-display mt-10 text-2xl font-semibold tracking-[-0.01em]">
          One pick, three roles
        </h2>
        <p>
          Display, body, and mono move together when you choose a direction — and what you
          approved in preview is exactly what lands here, down to the metric-matched
          fallback that keeps the page from shifting as the font loads.
        </p>

        <pre
          className="font-mono mt-4 overflow-x-auto rounded-lg p-4 text-[0.8rem] leading-relaxed"
          style={{ background: "var(--code-bg)" }}
        >
          <code>{`const display = Fraunces({ subsets: ["latin"], variable: "--font-display" });
// font-lab apply  →  layout.tsx + globals.css, reversibly.`}</code>
        </pre>
      </div>
    </main>
  );
}
