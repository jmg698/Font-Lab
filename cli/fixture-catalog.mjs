// Read the fixture's GENERATED catalog (app/_fontlab/catalog.generated.ts) back into data so
// the browser gates (loop-test, m6-test) drive whatever the current curator actually produced,
// instead of hardcoding direction ids/families — hardcoded expectations rot silently as the
// curator evolves, which is exactly how the m1/m6 gates broke while nobody was looking.
// The generated module prints its exports with JSON.stringify, so the arrays/objects parse
// straight back out of the source text (top-level closers sit at column 0).

import path from "node:path";
import { readFileSync, existsSync } from "node:fs";

export function readFixtureCatalog(appDir) {
  const file = ["app", "src/app"]
    .map((d) => path.join(appDir, d, "_fontlab", "catalog.generated.ts"))
    .find((p) => existsSync(p));
  if (!file) throw new Error(`no catalog.generated.ts under ${appDir} — run gen-catalog.mjs first`);
  const src = readFileSync(file, "utf8");
  const json = (marker, closer) => {
    const at = src.indexOf(marker);
    if (at === -1) throw new Error(`catalog parse: "${marker}" not found in ${file}`);
    const start = at + marker.length;
    const stop = src.indexOf(closer, start);
    if (stop === -1) throw new Error(`catalog parse: closer for "${marker}" not found`);
    return JSON.parse(src.slice(start, stop + closer.length));
  };
  return {
    file,
    directions: json("export const directions: Direction[] = ", "\n]"),
    replaces: json("export const replaces = ", "\n}"),
  };
}
