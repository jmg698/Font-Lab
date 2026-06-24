// Shared content rendered identically by `/`, `/ship`, and `/preview`.
// Identical DOM is essential: the M0 parity test pixel-diffs /ship vs /preview,
// so the ONLY thing that may differ between them is the font, never the markup.

export function Article() {
  return (
    <main className="mx-auto max-w-[680px] px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
        Field Notes · Issue 07
      </p>

      <h1 className="font-display mt-3 text-5xl font-semibold leading-[1.05] tracking-[-0.02em]">
        The moment of choice is the only part that needed you.
      </h1>

      <p className="font-display mt-5 text-xl leading-snug text-[var(--muted)]">
        AI removed the labor of implementation, but in doing so it quietly deleted the
        moment of choice — and taste only happens at the moment of choice.
      </p>

      <hr className="my-10 border-0 border-t" style={{ borderColor: "var(--rule)" }} />

      <div className="space-y-5 text-[1.0625rem] leading-[1.7]">
        <p>
          When an agent picks a typeface for you, it makes a thousand small decisions and
          shows you none of them. The result compiles, ships, and looks fine — which is
          precisely the problem. <em>Fine</em> is the texture of work that no human ever
          chose. A page set in <code className="font-mono text-[0.92em]">Inter</code> at{" "}
          <code className="font-mono text-[0.92em]">--font-sans</code> reads as competent
          and anonymous in the same breath.
        </p>
        <p>
          Good design is not the absence of slop; it is the presence of a decision. The
          difference between a default and a choice is invisible in the diff and obvious on
          the page. You can feel, instantly, whether a person with judgment stood in front
          of the thing and said: <strong>this one, not that one.</strong>
        </p>

        <blockquote
          className="font-display my-8 border-l-2 pl-5 text-2xl italic leading-snug"
          style={{ borderColor: "var(--accent)" }}
        >
          “You stayed in the loop for the only part that needed you — the taste — and the
          agent did everything else.”
        </blockquote>

        <p>
          So the tool’s job is narrow and stubborn: re-insert the choosing moment without
          re-inserting the work. Curate a handful of real directions, render them on the
          reader’s own running site, and let a human flip between them until one of them is
          obviously right. Then hand the decision back to the machine to implement.
        </p>

        <h2 className="font-display mt-10 text-2xl font-semibold tracking-[-0.01em]">
          What you see is what you ship
        </h2>
        <p>
          The promise only holds if the preview is honest. The candidate you approve has to
          be the candidate that lands in the codebase — same family, same weights, same
          metrics, down to the fallback that prevents the page from lurching as the font
          loads. Anything less and the choosing moment is a lie told in a nicer font.
        </p>

        <pre
          className="font-mono mt-4 overflow-x-auto rounded-lg p-4 text-[0.8rem] leading-relaxed"
          style={{ background: "var(--code-bg)" }}
        >
          <code>{`const display = Fraunces({ subsets: ["latin"], variable: "--font-display" });
// →  font-family: var(--font-display);  the page reflows, instantly.`}</code>
        </pre>
      </div>
    </main>
  );
}
