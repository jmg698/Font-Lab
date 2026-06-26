// A form screen — a third reading context. Labels, inputs, helper text, and a button all
// inherit the body face; the heading uses the display face. Fonts that feel great in prose
// can feel wrong in a tight UI, so the panel should be flippable here too (M6 multi-route).

export default function FormPage() {
  return (
    <main className="mx-auto max-w-[460px] px-6 py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">Account · form</p>
      <h1 className="font-display mt-2 text-3xl font-semibold tracking-[-0.01em]">Create your workspace</h1>
      <p className="mt-2 text-[0.95rem] leading-[1.6] text-[var(--muted)]">
        Pick a typeface that still feels right at input scale, not just in a headline.
      </p>

      <form className="mt-8 space-y-5" onSubmit={(e) => e.preventDefault()}>
        {[
          ["Full name", "Ada Lovelace", "text"],
          ["Work email", "ada@example.com", "email"],
          ["Workspace URL", "ada-co", "text"],
        ].map(([label, ph, type]) => (
          <label key={label} className="block">
            <span className="text-[0.8rem] font-medium">{label}</span>
            <input
              type={type}
              placeholder={ph}
              className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[0.95rem] outline-none"
              style={{ borderColor: "var(--rule)", background: "var(--code-bg)" }}
            />
          </label>
        ))}
        <label className="flex items-center gap-2 text-[0.85rem] text-[var(--muted)]">
          <input type="checkbox" /> Email me product updates
        </label>
        <button
          type="submit"
          className="font-display w-full rounded-lg py-2.5 text-[0.95rem] font-semibold text-white"
          style={{ background: "var(--accent)" }}
        >
          Create workspace
        </button>
        <p className="font-mono text-[11px] leading-relaxed text-[var(--muted)]">
          By continuing you agree to the <span className="text-[var(--accent)]">terms</span>.
        </p>
      </form>
    </main>
  );
}
