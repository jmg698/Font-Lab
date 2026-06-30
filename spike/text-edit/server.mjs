// Localhost write-back endpoint for the text-edit spike — the sibling of cli/font-lab.mjs's
// /select. The browser panel POSTs the clicked node's bundled call-site frame + the new words;
// the server resolves the frame to original source via the dev source map and applies the edit
// with the reversible write-back engine. Resolution lives here (Node) so the panel stays tiny
// and ships no source-map machinery.
//
//   POST /edit   { frame:{url,line,column}, newText, oldText? }  -> { ok, file, line, before, after }
//   POST /undo   {}                                              -> { ok, restored }
//   GET  /health
//
// Usage: node server.mjs --project <dir> [--port 7788]

import http from "node:http";
import path from "node:path";
import { SourceMapConsumer } from "source-map";
import { applyEdit, undoEdit } from "./edit-codegen.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = Number(arg("--port", "7788"));
const PROJECT = path.resolve(arg("--project", process.cwd()));

const mapCache = new Map();
async function resolveFrame({ url, line, column }) {
  if (!mapCache.has(url)) {
    const res = await fetch(url + ".map");
    mapCache.set(url, res.ok ? await new SourceMapConsumer(await res.json()) : null);
  }
  const consumer = mapCache.get(url);
  if (!consumer) throw new Error(`no source map for ${url}`);
  const orig = consumer.originalPositionFor({ line, column });
  if (!orig.source) throw new Error(`could not resolve ${url}:${line}:${column}`);
  return { file: orig.source.replace(/^file:\/\//, ""), line: orig.line, col: orig.column };
}

const send = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" });
  res.end(JSON.stringify(obj));
};
const body = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, project: PROJECT });

  if (req.method === "POST" && req.url === "/edit") {
    try {
      const { frame, newText, oldText } = JSON.parse(await body(req));
      const loc = await resolveFrame(frame);
      const r = applyEdit(PROJECT, { ...loc, oldText, newText, runIdSeed: "panel" });
      console.log(r.ok ? `  ✎ ${r.file}:${r.line}  "${r.before}" → "${r.after}"` : `  ⚠ refused: ${r.error}`);
      return send(res, r.ok ? 200 : 409, r);
    } catch (e) { return send(res, 400, { ok: false, error: String(e.message || e) }); }
  }

  if (req.method === "POST" && req.url === "/undo") {
    try { const u = undoEdit(PROJECT); console.log(`  ↩ undo ${u.runId}`); return send(res, 200, { ok: true, ...u }); }
    catch (e) { return send(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  send(res, 404, { ok: false });
}).listen(PORT, () => {
  console.log(`text-edit endpoint  http://localhost:${PORT}  (POST /edit, /undo)`);
  console.log(`  project   ${PROJECT}`);
});
