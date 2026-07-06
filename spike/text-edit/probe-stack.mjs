// Follow-up probe: React 19 replaced `_debugSource` with a captured stack. Inspect
// `_debugStack` / `_debugTask` to see whether the original source location is recoverable
// at runtime (this is what React DevTools parses for "open in editor").
import { chromium } from "playwright";
const BASE = process.argv[2] || "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector("h1");

const dump = await page.evaluate(() => {
  const el = document.querySelector("h1");
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  const fiber = el[key];
  const owner = fiber._debugOwner;
  const grab = (f) => {
    if (!f) return null;
    const o = {};
    if (f._debugStack) o.debugStack = (f._debugStack.stack || String(f._debugStack)).split("\n").slice(0, 12);
    if (f._debugTask) {
      o.debugTaskKeys = Object.keys(f._debugTask);
      try { o.debugTaskName = f._debugTask.name || (f._debugTask.run && "has run()"); } catch {}
      // _debugTask often wraps a stack too
      for (const k of Object.keys(f._debugTask)) {
        const v = f._debugTask[k];
        if (v && typeof v === "object" && v.stack) o["debugTask." + k + ".stack"] = String(v.stack).split("\n").slice(0, 12);
      }
    }
    return o;
  };
  return {
    fiberType: typeof fiber.type === "string" ? fiber.type : (fiber.type && fiber.type.name) || String(fiber.type),
    onHostFiber: grab(fiber),
    ownerType: owner ? (typeof owner.type === "string" ? owner.type : (owner.type && owner.type.name) || String(owner.type)) : null,
    onOwnerFiber: grab(owner),
  };
});

console.log(JSON.stringify(dump, null, 2));
await browser.close();
