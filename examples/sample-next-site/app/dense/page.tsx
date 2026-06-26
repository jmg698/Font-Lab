// A dense, information-rich screen — the opposite reading context from the hero. Fonts read
// very differently here (tight leading, small sizes, lots of mono), which is the whole point
// of M6 multi-route flipping: "your real site" is more than one screen.

export default function DensePage() {
  const rows = [
    ["GET", "/api/fonts", "200", "list catalog families"],
    ["POST", "/select", "200", "write selection.json"],
    ["GET", "/selection", "200", "read current pick"],
    ["POST", "/apply", "200", "ship next/font + tailwind"],
    ["POST", "/undo", "200", "restore from backup"],
  ];
  return (
    <main className="mx-auto max-w-[860px] px-6 py-12">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">Reference · dense</p>
      <h1 className="font-display mt-2 text-3xl font-semibold tracking-[-0.01em]">API & changelog</h1>
      <p className="mt-3 text-[0.95rem] leading-[1.6] text-[var(--muted)]">
        A deliberately busy page: small body copy, tight tables, and a lot of monospace. Flip a
        direction in the panel and watch how a face that sang in the hero behaves under density.
      </p>

      <h2 className="font-display mt-8 text-xl font-semibold">Endpoints</h2>
      <table className="mt-3 w-full text-left text-[0.85rem]">
        <thead className="text-[var(--muted)]">
          <tr className="border-b" style={{ borderColor: "var(--rule)" }}>
            <th className="py-1.5 font-mono font-normal">method</th>
            <th className="py-1.5 font-mono font-normal">path</th>
            <th className="py-1.5 font-mono font-normal">code</th>
            <th className="py-1.5 font-normal">note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[1]} className="border-b" style={{ borderColor: "var(--rule)" }}>
              <td className="py-1.5 font-mono">{r[0]}</td>
              <td className="py-1.5 font-mono">{r[1]}</td>
              <td className="py-1.5 font-mono">{r[2]}</td>
              <td className="py-1.5">{r[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="font-display mt-8 text-xl font-semibold">Changelog</h2>
      <div className="mt-3 space-y-3 text-[0.9rem] leading-[1.6]">
        {[
          ["v0.5", "MCP server + skill — an agent drives the loop end to end."],
          ["v0.4", "Parity catalog (41 fonts) + deterministic curator."],
          ["v0.3", "Real analyzer: framework, router, Tailwind, current fonts, wiring."],
        ].map(([v, note]) => (
          <p key={v}>
            <code className="font-mono text-[0.82em] text-[var(--accent)]">{v}</code> &nbsp;{note}
          </p>
        ))}
      </div>
    </main>
  );
}
