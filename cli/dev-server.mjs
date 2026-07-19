// Managed dev-server lifecycle — Font Lab starts the project's OWN dev command when a preview
// needs a running site and none is reachable.
//
// Why this lives inside the tool instead of the agent's shell: on cloud/container harnesses,
// individual shell calls run in short-lived sandboxes — a `nohup … &` from one call is reaped
// before the next, health checks 000 for two unrelated reasons, and Vite templates that pin
// `host: "::"` die with EAFNOSUPPORT on IPv4-only containers. This process (the MCP server / a
// one-shot CLI) outlives all of that: spawn the dev command ourselves with an EXPLICIT
// 127.0.0.1 bind, read the served URL off its own stdout, health-check it, hand the origin to
// the capture, and tear the whole process group down in `finally`. Zero project writes, zero
// orphans on the happy path.
//
// The command is the project's own `scripts.dev` (run through a shell with node_modules/.bin on
// PATH — exactly what `npm run dev` does, minus the package-manager arg-forwarding matrix). We
// only append host/port flags when the script is a single well-known command whose flag syntax
// we're sure of; anything exotic runs untouched and we rely on URL detection alone.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");

// The project's dev command + package manager (mirrors liveInstructions' detection — the human-
// facing string and the managed spawn must name the same thing).
export function detectDevCommand(projectDir) {
  let script = null;
  try {
    script = JSON.parse(readFileSync(path.join(projectDir, "package.json"), "utf8")).scripts?.dev ?? null;
  } catch {}
  const pm = existsSync(path.join(projectDir, "pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(path.join(projectDir, "yarn.lock"))
      ? "yarn"
      : existsSync(path.join(projectDir, "bun.lockb")) || existsSync(path.join(projectDir, "bun.lock"))
        ? "bun"
        : "npm";
  return { script, pm, devCmd: script ? (pm === "npm" ? "npm run dev" : `${pm} dev`) : null };
}

// Host/port flags for the FIRST command in the dev script, appended only when the script is one
// simple command (no `&&`/`|`/`;`) whose flag syntax is known. `next dev` takes -H/-p; the Vite
// family (vite / astro / remix vite:dev / SvelteKit's `vite dev` / TanStack's vinxi) takes
// --host/--port — and a CLI --host OVERRIDES a vite.config `server.host: "::"`, which is the
// exact template default that breaks IPv4-only containers.
export function hostArgsFor(script, framework, { host, port } = {}) {
  const s = String(script || "").trim();
  if (!s || /[&|;\n]/.test(s)) return []; // compound script — don't guess where flags would land
  const first = s.split(/\s+/)[0];
  const viteFamily = ["vite", "astro", "remix", "vinxi"].includes(first) || /\bvite\b/.test(s) || ["vite", "astro", "remix", "sveltekit", "tanstack"].includes(framework);
  if (first === "next" || (framework === "next" && !viteFamily))
    return ["-H", host, ...(port ? ["-p", String(port)] : [])];
  if (viteFamily) return ["--host", host, ...(port ? ["--port", String(port)] : [])];
  return [];
}

// First http(s) URL a dev server prints ("Local: http://127.0.0.1:8080/", "- Local: http://localhost:3000").
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[[0-9a-f:]*\])(?::\d+)?/i;

// Normalize whatever the server printed to an origin our fetches and Playwright can reach:
// loopback-bound servers often print `localhost`, which Node may resolve to ::1 first — pin it
// to 127.0.0.1, the address we forced the bind to.
export function normalizeOrigin(raw) {
  try {
    const u = new URL(raw);
    const host = /^(localhost|0\.0\.0\.0|\[::\]|\[::1\])$/i.test(u.hostname) || u.hostname === "::" ? "127.0.0.1" : u.hostname;
    return `${u.protocol}//${host}${u.port ? ":" + u.port : ""}`;
  } catch {
    return null;
  }
}

// "Is anything answering HTTP here?" — ANY response (even a 404/500 page) means a server is up;
// only a refused/timed-out connection means down. Mirrors font_lab_status's dev-server probe.
export async function probeHttp(url, { timeoutMs = 1500 } = {}) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctl.signal, redirect: "manual" });
    clearTimeout(t);
    return res.status > 0;
  } catch {
    return false;
  }
}

const DEFAULT_PORTS = { next: [3000], vite: [5173, 8080], astro: [4321], sveltekit: [5173], remix: [5173, 3000], tanstack: [3000, 5173] };

/**
 * Start the project's dev server and resolve once it answers HTTP. Returns
 * { origin, command, managed: true, stop() } — callers MUST await stop() in a finally.
 *
 * @param projectDir absolute project root
 * @param opts { framework?, host?, port?, timeoutMs?, log? }
 */
export async function startManagedServer(projectDir, { framework, host = "127.0.0.1", port, timeoutMs = 90_000, log = () => {} } = {}) {
  const dir = path.resolve(projectDir);
  const { script } = detectDevCommand(dir);
  if (!script)
    throw new Error(
      `can't start a dev server for you: ${path.join(dir, "package.json")} has no "dev" script. Start the project's server yourself (bound to 127.0.0.1, as a harness-managed background task — a plain \`&\` won't survive sandboxed shells) and pass its baseUrl.`,
    );
  const args = hostArgsFor(script, framework, { host, port });
  const command = [script, ...args].join(" ");
  const binDir = path.join(dir, "node_modules", ".bin");
  const child = spawn(command, {
    cwd: dir,
    shell: true,
    detached: process.platform !== "win32", // own process group → we can kill the whole tree
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: binDir + path.delimiter + (process.env.PATH || ""),
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      BROWSER: "none", // some dev servers try to open a browser — there is no display here
    },
  });
  log(`  dev server: starting \`${command}\` (managed — stopped after the capture)`);

  let output = "";
  let exited = null;
  const onData = (chunk) => {
    output += stripAnsi(chunk.toString());
    if (output.length > 64_000) output = output.slice(-32_000);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });

  const stop = async () => {
    if (exited) return;
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      try { child.kill("SIGTERM"); } catch {}
    }
    await new Promise((r) => setTimeout(r, 800));
    if (!exited) {
      try {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    }
  };
  // Belt-and-braces against orphans if THIS process dies mid-capture (the finally never runs).
  const reap = () => { try { if (!exited && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); } catch {} };
  process.once("exit", reap);

  // Readiness: the URL the server itself prints is the truth (auto-incremented ports included);
  // the framework's default ports are the backstop for servers that print nothing parseable.
  const candidates = new Set();
  if (port) candidates.add(`http://${host}:${port}`);
  for (const p of DEFAULT_PORTS[framework] || []) candidates.add(`http://${host}:${p}`);
  const deadline = Date.now() + timeoutMs;
  const tail = () => output.split("\n").filter(Boolean).slice(-15).join("\n");
  try {
    for (;;) {
      if (exited)
        throw new Error(
          `the dev server exited (code ${exited.code ?? "?"}${exited.signal ? `, signal ${exited.signal}` : ""}) before serving. Command: \`${command}\`. Last output:\n${tail()}\n` +
            `Common container fixes: bind 127.0.0.1 (an IPv6 \`::\` host dies with EAFNOSUPPORT on IPv4-only containers), and make sure the port isn't taken.`,
        );
      const printed = output.match(URL_RE);
      if (printed) {
        const origin = normalizeOrigin(printed[0]);
        if (origin && (await probeHttp(origin))) {
          log(`  dev server: up at ${origin}`);
          return { origin, command, managed: true, stop, pid: child.pid };
        }
      }
      for (const c of candidates) {
        if (await probeHttp(c, { timeoutMs: 700 })) {
          log(`  dev server: up at ${c}`);
          return { origin: c, command, managed: true, stop, pid: child.pid };
        }
      }
      if (Date.now() > deadline)
        throw new Error(
          `the dev server didn't answer within ${Math.round(timeoutMs / 1000)}s. Command: \`${command}\`. Last output:\n${tail()}\n` +
            `If it needs longer (a cold Next compile), retry with a bigger timeout; otherwise start it yourself as a harness-managed background task (bound to 127.0.0.1) and pass baseUrl.`,
        );
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch (e) {
    await stop(); // never leave a half-started server behind an error
    throw e;
  }
}
