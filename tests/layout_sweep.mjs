// Layout sweep: every view of the web page, in the demo, at phone, tablet and
// desktop widths, in English and in Arabic (right to left). It reports what a
// person would notice: the page scrolling sideways, content wider than its
// card, controls on top of each other, errors in the browser's console and
// page files that do not load. Exits with 1 when it finds anything, so CI
// fails.
//
// Nothing to install: Node 22 or newer, and Chrome, Chromium or Edge, driven
// through the DevTools protocol.
//   node tests/layout_sweep.mjs
//   VIEWS=farm,settings WIDTHS=390 LANGS=ar node tests/layout_sweep.mjs
//   CHROME=/path/to/chrome SHOTS=sweep-shots node tests/layout_sweep.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const list = (name, all) => (process.env[name] ? process.env[name].split(",") : all);
// the views the page has, as app.js lists them
const ALL_VIEWS = [...fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8").matchAll(/\{ id: "(\w+)", icon: "/g)].map((m) => m[1]);
const VIEWS = list("VIEWS", ALL_VIEWS);
const WIDTHS = list("WIDTHS", ["390", "768", "1280"]).map(Number);
const LANGS = list("LANGS", ["en", "ar"]);
const SHOTS = process.env.SHOTS || "";

// ------------------------------------------------------------ the page files
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".cfg": "text/plain", ".md": "text/plain", ".gcode": "text/plain", ".stl": "application/octet-stream" };

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// --------------------------------------------------------------- the browser
function findBrowser() {
  if (process.env.CHROME) return process.env.CHROME;
  const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const n of names) if (fs.existsSync(path.join(dir, n))) return path.join(dir, n);
  }
  const known = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return known.find((p) => fs.existsSync(p)) || null;
}

// A busy CI machine sometimes starts the browser slowly, or not at all the
// first time: wait a minute, and try once more.
async function launch(exe, tries = 2) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ae-sweep-"));
  const proc = spawn(exe, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let said = "";
  proc.stderr.on("data", (d) => { said = (said + d).slice(-2000); });
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 600 && !fs.existsSync(portFile) && proc.exitCode === null; i++) await sleep(100);
  if (!fs.existsSync(portFile)) {
    proc.kill();
    if (tries > 1) return launch(exe, tries - 1);
    throw new Error("the browser did not start: " + exe + "\n" + said);
  }
  const [port, wsPath] = fs.readFileSync(portFile, "utf8").split("\n");
  const ws = new WebSocket("ws://127.0.0.1:" + port + wsPath);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  return { proc, profile, cdp: new Cdp(ws) };
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.n = 0;
    this.waiting = new Map();
    this.listeners = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.waiting.has(m.id)) {
        const [resolve, reject] = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      } else for (const fn of this.listeners) fn(m);
    };
  }
  send(method, params = {}, sessionId = undefined) {
    const id = ++this.n;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.waiting.set(id, [resolve, reject]));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------- what is checked, in the page
// Runs inside the page (sent as its source), so it uses only what a page has.
function inspect() {
  const out = [];
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const label = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    const text = (el.getAttribute("aria-label") || el.textContent || el.value || "").replace(/\s+/g, " ").trim().slice(0, 30);
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (cls.length ? "." + cls.join(".") : "") + (text ? ' "' + text + '"' : "");
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && Number(cs.opacity) > 0;
  };
  const clips = (el) => getComputedStyle(el).overflowX !== "visible";

  // 1. the page scrolls sideways
  if (doc.scrollWidth > vw + 1) {
    let worst = null;
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (shown(el) && (r.right > vw + 1 || r.left < -1) && (!worst || r.width < worst.r.width)) worst = { el, r };
    }
    out.push("page scrolls sideways (" + doc.scrollWidth + " > " + vw + ")" + (worst ? ": " + label(worst.el) : ""));
  }

  // 2. content wider than its card, outside anything that scrolls or clips on purpose
  for (const card of document.querySelectorAll("#view .card")) {
    if (!shown(card)) continue;
    const c = card.getBoundingClientRect();
    let worst = null;
    const walk = (el) => {
      for (const child of el.children) {
        if (!shown(child)) continue;
        const r = child.getBoundingClientRect();
        const past = Math.max(r.right - c.right, c.left - r.left);
        if (past > 1 && (!worst || past > worst.past)) worst = { el: child, past };
        if (!clips(child)) walk(child);
      }
    };
    walk(card);
    if (worst) {
      const title = (card.querySelector("h2") || {}).textContent || "";
      out.push("content wider than its card" + (title ? ' "' + title.trim().slice(0, 30) + '"' : "") + ": " + label(worst.el) +
        " (" + Math.round(worst.past) + " px out)");
    }
  }

  // 3. controls on top of each other, in the same layer (a fixed bar over the
  //    page is fine), where one really covers the other
  const layer = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      if (p === "fixed" || p === "sticky") return e;
    }
    return null;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      if (clips(e) || getComputedStyle(e).overflowY !== "visible") {
        const b = e.getBoundingClientRect();
        x0 = Math.max(x0, b.left); y0 = Math.max(y0, b.top); x1 = Math.min(x1, b.right); y1 = Math.min(y1, b.bottom);
      }
    }
    return x1 - x0 > 2 && y1 - y0 > 2 ? { x0, y0, x1, y1 } : null;
  };
  const sel = "button, a[href], input, select, textarea, [role=button]";
  const controls = [...document.querySelectorAll(sel)].filter((el) => shown(el) && !el.querySelector(sel))
    .map((el) => ({ el, layer: layer(el) }));
  const seen = new Set();
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i], b = controls[j];
      if (a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      let ra = visible(a.el), rb = visible(b.el);
      if (!ra || !rb) continue;
      const w = Math.min(ra.x1, rb.x1) - Math.max(ra.x0, rb.x0), h = Math.min(ra.y1, rb.y1) - Math.max(ra.y0, rb.y0);
      if (w <= 4 || h <= 4) continue;
      // bring the overlap into view, then ask what is drawn there
      a.el.scrollIntoView({ block: "center", inline: "nearest" });
      ra = visible(a.el); rb = visible(b.el);
      if (!ra || !rb) continue;
      const hit = document.elementFromPoint((Math.max(ra.x0, rb.x0) + Math.min(ra.x1, rb.x1)) / 2, (Math.max(ra.y0, rb.y0) + Math.min(ra.y1, rb.y1)) / 2);
      if (hit && (a.el.contains(hit) || b.el.contains(hit))) {
        const key = label(a.el) + " <> " + label(b.el);
        if (!seen.has(key)) { seen.add(key); out.push("controls on top of each other: " + key); }
      }
    }
  }
  window.scrollTo(0, 0);
  return out;
}

// --------------------------------------------------------------------- run
async function main() {
  const exe = findBrowser();
  if (!exe) {
    console.error("layout sweep: no Chrome, Chromium or Edge found (set CHROME=...)");
    process.exit(2);
  }
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port;
  const { proc, profile, cdp } = await launch(exe);
  const problems = [];
  let views = 0;
  try {
    for (const lang of LANGS) {
      // a tab of its own for each language: the page reads it from its storage at start
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      const send = (method, params) => cdp.send(method, params, sessionId);
      let errors = [];
      let loaded = false;
      cdp.listeners = [(m) => {
        if (m.sessionId !== sessionId) return;
        const p = m.params || {};
        if (m.method === "Page.loadEventFired") loaded = true;
        if (m.method === "Runtime.exceptionThrown") errors.push("page error: " + ((p.exceptionDetails.exception || {}).description || p.exceptionDetails.text));
        if (m.method === "Runtime.consoleAPICalled" && p.type === "error") errors.push("console: " + p.args.map((a) => a.value || a.description || "").join(" "));
        if (m.method === "Log.entryAdded" && p.entry.level === "error") errors.push("console: " + p.entry.text + (p.entry.url ? " " + p.entry.url : ""));
        if (m.method === "Network.responseReceived" && p.response.status >= 400 && p.response.url.startsWith(base)) {
          errors.push(p.response.status + " " + p.response.url.slice(base.length));
        }
      }];
      for (const domain of ["Page", "Runtime", "Log", "Network"]) await send(domain + ".enable");
      await send("Page.addScriptToEvaluateOnNewDocument", { source: "try { localStorage.setItem('ae.lang', '" + lang + "'); } catch (e) {}" });
      for (const width of WIDTHS) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
        for (const view of VIEWS) {
          views++;
          errors = [];
          loaded = false;
          await send("Page.navigate", { url: base + "/web/index.html?demo&v=" + views + "#/" + view });
          for (let i = 0; i < 100 && !loaded; i++) await sleep(50);
          // the view is drawn, then the demo's answers arrive (files, the farm...)
          for (let i = 0; i < 60; i++) {
            const r = await send("Runtime.evaluate", { expression: "!!(document.querySelector('#view h1') || document.querySelector('#view .card'))", returnByValue: true });
            if (r.result.value) break;
            await sleep(100);
          }
          await sleep(1500);
          const r = await send("Runtime.evaluate", { expression: "(" + inspect.toString() + ")()", returnByValue: true });
          if (r.exceptionDetails) errors.push("the check itself failed: " + r.exceptionDetails.text);
          const found = [...(r.result.value || []), ...errors];
          if (found.length) {
            const where = lang + " " + width + "px #/" + view;
            problems.push([where, found]);
            if (SHOTS) {
              fs.mkdirSync(SHOTS, { recursive: true });
              const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
              fs.writeFileSync(path.join(SHOTS, where.replace(/[^\w-]+/g, "_") + ".png"), Buffer.from(shot.data, "base64"));
            }
          }
        }
      }
      await cdp.send("Target.closeTarget", { targetId });
    }
  } finally {
    proc.kill();
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* the browser may still hold it */ }
  }
  for (const [where, found] of problems) {
    console.log(where);
    for (const f of found) console.log("  " + f);
  }
  console.log("layout sweep: %d views (%d widths, %d languages), %d with problems", views, WIDTHS.length, LANGS.length, problems.length);
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => {
  console.error("layout sweep:", e);
  process.exit(2);
});
