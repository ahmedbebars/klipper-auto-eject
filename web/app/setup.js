/* klipper-auto-eject web page. Blade and setup: the guided setup, notifications on the phone, the app
 * itself (installing it, its updates, keeping the screen on), remote access
 * and the slicer card.
 */

import {
  app, blocked, client, DEMO, DOCS, h, head, icon, lang, M, num, parts, probe, s, store, sv, t
} from "./core.js";
import { gcode, loadFiles, meta, refresh, toast } from "../app.js";
import { actRow, doDry } from "./overview.js";

/* ============================================================== setup */

function viewSetup() {
  const set = sv();
  const pb = probe();
  const lift = set.blade_lift;
  const measured = typeof lift === "number";
  const why = blocked();
  const el = h("div", null, head("setup.title"),
    h("div", { class: "cols" },
      h("div", { class: "stack" },
        h("section", { class: "card" },
          h("h2", null, icon("ruler"), t("setup.blade"),
            h("span", { class: "right" }, h("span", { class: "badge " + (measured ? "ok" : ""), text: measured ? t("setup.measured") : t("setup.not_measured") }))),
          bladeFigure(set),
          h("dl", { class: "kv" },
            h("dt", { text: t("setup.edge") }), h("dd", { text: t("edge." + (set.direction || "front")) }),
            h("dt", { text: t("setup.width") }), h("dd", { text: set.blade_width !== undefined ? t("c.mm", { v: num(set.blade_width) }) : "—" }),
            h("dt", { text: t("setup.offset") }), h("dd", { text: set.blade_offset !== undefined ? t("c.mm", { v: num(set.blade_offset) }) : "—" }),
            h("dt", { text: t("setup.lift") }), h("dd", { text: measured ? t("c.mm", { v: num(lift, 2) }) : t("facts.unknown") }),
            h("dt", { text: t("setup.push_z") }), h("dd", { text: set.push_z !== undefined ? t("c.mm", { v: num(set.push_z, 2) }) : "—" }),
            h("dt", { text: t("setup.probe") }), h("dd", { text: t(pb.label) }))),
        slicerCard()),
      h("div", { class: "stack" },
        h("section", { class: "card" },
          h("h2", null, icon("wand"), t("setup.calibration")),
          h("div", { class: "act-list", style: { marginTop: 0 } },
            actRow("wand", t("setup.run"), t("setup.run_desc"), why, () => { gcode("AUTO_EJECT_SETUP", { quiet: true }); toast(t("setup.started")); }),
            actRow("ruler", t("setup.measure"), pb.nozzle ? t("setup.measure_desc") : t("setup.measure_no"), why || (pb.nozzle ? "" : "setup.measure_no"),
              () => { gcode("AUTO_EJECT_CALIBRATE", { quiet: true }); toast(t("setup.started")); }),
            actRow("eye", t("act.dry"), t("setup.dry_desc"), why || (parts().length ? "" : "act.why_empty"), doDry))),
        h("section", { class: "card" },
          h("h2", null, icon("box"), t("setup.parts_title")),
          h("div", { class: "dl-list" },
            stlRow("setup.block", "setup.block_desc", "calibration_block.stl"),
            stlRow("setup.gauge", "setup.gauge_desc", "blade_gauge.stl"),
            stlRow("setup.cube", "setup.cube_desc", "test_hollow_cube.stl"))),
        remoteCard())));
  return { el, update: () => {
    if (!slicerUi.scroll) return;
    slicerUi.scroll = false;
    // at once: a smooth scroll stops when the view is drawn again
    const card = document.getElementById("slicer");
    if (card) card.scrollIntoView({ block: "start" });
  } };
}
viewSetup.sig = function () {
  const f = slicerUi.found || {};
  return JSON.stringify([sv(), blocked(), Object.keys(app.config).length, parts().length, remoteInfo(), slicerUi.kind,
    f.file, f.kind, (f.tail || "").length, app.files === null ? -1 : app.files.length]);
};

// Notifications. With the printer's notification service (install.sh
// --push) this device subscribes with its browser's push service and gets
// them even while the app is closed. Without it the page shows them itself
// while it is open or in the background.
const PUSH = "auto_eject_push";
function pushReady() {
  return !!(app.push.key && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window);
}
function notifyState() {
  if (!("Notification" in window) || !window.isSecureContext) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (app.push.id) return "push";
  return Notification.permission === "granted" && store("ae.notify") === "1" ? "on" : "off";
}
function b64ToBytes(text) {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function bytesToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function subId(endpoint) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(hash).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}
// Is the service installed, and is this device subscribed to it?
async function loadPush() {
  if (DEMO || !window.isSecureContext || !("serviceWorker" in navigator)) return;
  try {
    app.push.key = (await client.call("server.database.get_item", { namespace: PUSH, key: "vapid" })).value;
  } catch (e) { app.push.key = null; refresh(); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = reg.pushManager && await reg.pushManager.getSubscription();
    app.push.id = null;
    if (sub) {
      const id = await subId(sub.endpoint);
      const mine = await client.call("server.database.get_item", { namespace: PUSH, key: "subs." + id }).catch(() => null);
      const sameKey = sub.options && sub.options.applicationServerKey && bytesToB64(sub.options.applicationServerKey) === app.push.key;
      if (mine && sameKey) { app.push.id = id; app.push.jobs = mine.value.jobs !== false; app.push.hardware = mine.value.hardware !== false; }
    }
    // turned on before the service was installed: move on to push, the
    // permission is there already
    if (!app.push.id && store("ae.notify") === "1" && Notification.permission === "granted" && pushReady()) {
      await pushOn();
      store("ae.notify", "0");
    }
  } catch (e) { /* no push in this browser */ }
  refresh();
}
async function pushOn() {
  const reg = await navigator.serviceWorker.ready;
  const old = await reg.pushManager.getSubscription();
  if (old) await old.unsubscribe();        // made for another key: start again
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(app.push.key) });
  const json = sub.toJSON();
  const id = await subId(json.endpoint);
  await client.call("server.database.post_item", { namespace: PUSH, key: "subs." + id, value: {
    endpoint: json.endpoint, keys: json.keys, lang, jobs: app.push.jobs, hardware: app.push.hardware,
    url: location.origin + location.pathname, name: deviceName(), time: Math.round(Date.now() / 1000) } });
  app.push.id = id;
}
async function pushOff() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  if (app.push.id) await client.call("server.database.delete_item", { namespace: PUSH, key: "subs." + app.push.id }).catch(() => {});
  app.push.id = null;
}
function pushJobs(on) { pushOption("jobs", on); }
function pushOption(key, on) {
  app.push[key] = on;
  if (app.push.id) client.call("server.database.post_item", { namespace: PUSH, key: "subs." + app.push.id + "." + key, value: on }).catch((e) => toast(e.message, "bad"));
  refresh();
}
function deviceName() {
  const ua = navigator.userAgent;
  const m = /Android [\d.]+; ([^;)]+)/.exec(ua) || /(iPhone|iPad|Macintosh|Windows|Linux)/.exec(ua);
  return (m ? m[1] : "Device").trim().slice(0, 40);
}
function showNote(title, body) {
  const opts = { body: String(body || ""), icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    tag: "auto-eject", renotify: true, data: { url: location.href } };
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, opts)).catch(() => {});
  } else {
    try { new Notification(title, opts); } catch (e) { /* phones need the service worker */ }
  }
}
function notifyUser(title, body) {
  // in front of the user the page itself shows it; with push the service sends it
  if (DEMO || notifyState() !== "on" || (document.visibilityState === "visible" && document.hasFocus())) return;
  showNote(title, body);
}
async function notifyToggle() {
  try {
    const state = notifyState();
    if (state === "push") await pushOff();
    else if (state === "on") store("ae.notify", "0");
    else if ((await Notification.requestPermission()) === "granted") {
      if (pushReady()) { await pushOn(); gcode("AUTO_EJECT_NOTIFY_TEST", { quiet: true }); }
      else { store("ae.notify", "1"); showNote(t("note.test"), t("note.test_body")); }
    }
  } catch (e) { toast(t("c.error", { e: e.message }), "bad"); }
  refresh();
}

// 6. The app's icon shows how many printers need you (installed apps,
// where the system has such badges).
let badgeShown = -1;
function appBadge(n) {
  if (n === badgeShown || !("setAppBadge" in navigator)) return;
  badgeShown = n;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

// 7. A page left open (a tablet by the farm) learns that the printer got a
// new version of it: the files' tags change when the files do.
const PAGE_FILES = ["index.html", "app.js", "model.js", "qr.js", "style.css", "lang/en.js", "lang/ar.js",
  "app/core.js", "app/overview.js", "app/files.js", "app/setup.js", "app/settings.js",
  "app/farm.js", "app/farm-tools.js", "app/hardware.js", "app/updates.js", "app/zoom.js"];
let pageTags = null;
function pageVersion() {
  return Promise.all(PAGE_FILES.map((f) => fetch(f, { method: "HEAD", cache: "no-store" })
    .then((r) => r.ok ? (r.headers.get("etag") || r.headers.get("last-modified") || "") : "")))
    .then((tags) => tags.join("|"));
}
function checkPageVersion() {
  if (DEMO || document.hidden || app.pageUpdate) return;
  pageVersion().then((tag) => {
    if (!tag.replace(/\|/g, "")) return;                 // the server gives no tags
    if (pageTags === null) pageTags = tag;
    else if (tag !== pageTags) { app.pageUpdate = true; refresh(); }
  }).catch(() => {});
}

// 8. Keep the screen on while this page is open, on this device: a tablet
// on the wall by the printers. Browsers allow it over HTTPS.
const wake = { on: store("ae.wake") === "1", lock: null };
function wakeSupported() { return "wakeLock" in navigator && window.isSecureContext; }
function wakeApply() {
  if (!wakeSupported()) return;
  if (wake.on && !wake.lock && !document.hidden) {
    navigator.wakeLock.request("screen").then((l) => {
      wake.lock = l;
      l.addEventListener("release", () => { wake.lock = null; });
    }).catch(() => {});
  } else if (!wake.on && wake.lock) {
    wake.lock.release().catch(() => {});
    wake.lock = null;
  }
}
function wakeToggle() {
  wake.on = !wake.on;
  store("ae.wake", wake.on ? "1" : "0");
  wakeApply();
  toast(t(wake.on ? "c.wake_on" : "c.wake_off"), "ok");
  refresh();
}
// the lock is let go whenever the page is hidden: take it again
document.addEventListener("visibilitychange", () => { wakeApply(); if (!document.hidden) checkPageVersion(); });

// Installing the page as an app. Chrome and Edge offer a prompt the page
// can open; Safari on iPhone and iPad has Add to Home Screen in its share
// menu. Browsers allow it only over HTTPS.
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; refresh(); });
window.addEventListener("appinstalled", () => { installPrompt = null; refresh(); });
function appMode() {
  if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone) return "installed";
  if (!window.isSecureContext) return "insecure";
  if (installPrompt) return "prompt";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "menu";
}
function installApp() {
  if (!installPrompt) return;
  installPrompt.prompt();
  installPrompt.userChoice.finally(() => { installPrompt = null; refresh(); });
}

// How this page was opened, for the remote access card.
function remoteInfo() {
  const host = location.hostname;
  const ts = /\.ts\.net$/i.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
  const tc = app.trustedClients;
  const trusts = tc === null ? true : tc === undefined ? null : tc.some((c) => /^100\./.test(String(c).trim()));
  return { ts, https: location.protocol === "https:", trusts, cams: app.webcams.length, app: appMode(), notify: notifyState(),
    ntfy: app.ntfy, notifier: app.notifier, push: !!app.push.key, jobs: app.push.jobs, hardware: app.push.hardware };
}

function remoteCard() {
  const r = remoteInfo();
  const yes = (v) => (v === null ? "—" : t(v ? "remote.yes" : "remote.no"));
  const next = r.trusts === false ? "remote.next_trust" : !r.ts ? "remote.next_setup" : !r.https ? "remote.next_https" : "remote.next_done";
  const docs = (file, label) => h("a", { class: "btn", href: DOCS + "/blob/main/docs/" + file, target: "_blank", rel: "noopener" }, icon("external"), t(label));
  return h("section", { class: "card" },
    h("h2", null, icon("phone"), t("remote.title")),
    h("p", { class: "muted", text: t("remote.intro") }),
    // how this page is reached, and what to do next
    h("dl", { class: "kv" },
      h("dt", { text: t("remote.from") }), h("dd", { text: t(r.ts ? (r.https ? "remote.from_https" : "remote.from_ts") : "remote.from_lan") }),
      h("dt", { text: t("remote.trust") }), h("dd", { text: yes(r.trusts) }),
      h("dt", { text: t("remote.https") }), h("dd", { text: yes(r.https) }),
      h("dt", { text: t("remote.camera") }), h("dd", { text: r.cams ? t("remote.cams", { n: num(r.cams, 0) }) : t("remote.none") })),
    h("p", { class: "note", style: { marginTop: "12px" } }, icon(next === "remote.next_done" ? "ok" : "info"), h("span", { text: t(next) })),
    next === "remote.next_done" ? null : h("div", { class: "codeblock", style: { marginTop: "10px" }, text: "~/klipper-auto-eject/install.sh --remote" }),
    // the app on this device
    h("h3", { class: "sub-head", text: t("remote.app") }),
    h("dl", { class: "kv" }, h("dt", { text: t("remote.app_state") }), h("dd", { text: t("remote.app_" + r.app) })),
    r.app === "prompt" ? h("div", { class: "toolbar", style: { marginTop: "10px" } },
      h("button", { type: "button", class: "btn primary", onclick: installApp }, icon("download"), t("remote.install"))) : null,
    r.app === "ios" || r.app === "menu" ? h("p", { class: "note", style: { marginTop: "10px" } }, icon("phone"), h("span", { text: t("remote.install_" + r.app) })) : null,
    wakeSupported() ? h("label", { class: "switch-row", style: { marginTop: "10px" } },
      h("input", { type: "checkbox", checked: wake.on, onchange: wakeToggle }), h("span", { text: t("c.wake_desc") })) : null,
    // notifications
    h("h3", { class: "sub-head", text: t("remote.notify_title") }),
    h("dl", { class: "kv" },
      h("dt", { text: t("remote.notify_here") }), h("dd", { text: t("remote.notify_" + r.notify) }),
      r.notifier ? h("dt", { text: t("remote.ntfy", { s: t("remote.via." + r.notifier) }) }) : null, r.notifier ? h("dd", { text: t("remote.ntfy_on") }) : null),
    r.notify === "push" ? h("label", { class: "switch-row", style: { marginTop: "10px" } },
      h("input", { type: "checkbox", checked: r.jobs, onchange: (e) => pushJobs(e.target.checked) }), h("span", { text: t("remote.push_jobs") })) : null,
    r.notify === "push" ? h("label", { class: "switch-row", style: { marginTop: "6px" } },
      h("input", { type: "checkbox", checked: r.hardware, onchange: (e) => pushOption("hardware", e.target.checked) }), h("span", { text: t("remote.push_hardware") })) : null,
    h("div", { class: "toolbar", style: { marginTop: "10px" } },
      r.notify === "push" || r.notify === "on" || r.notify === "off" ? h("button", { type: "button", class: "btn" + (r.notify === "off" ? " primary" : ""), onclick: notifyToggle },
        icon(r.notify === "off" ? "ok" : "bad"), t(r.notify === "off" ? "remote.notify_start" : "remote.notify_stop")) : null,
      r.notify === "push" || r.notifier ? h("button", { type: "button", class: "btn", onclick: () => gcode("AUTO_EJECT_NOTIFY_TEST") }, icon("play"), t("remote.ntfy_test")) : null,
      r.ntfy ? h("a", { class: "btn", href: "https://ntfy.sh/" + encodeURIComponent(r.ntfy), target: "_blank", rel: "noopener" }, icon("external"), t("remote.ntfy_open")) : null),
    r.push || r.notify === "unsupported" ? null : h("p", { class: "note", style: { marginTop: "10px" } }, icon("info"), h("span", { text: t("remote.push_setup") })),
    r.push || r.notify === "unsupported" ? null : h("div", { class: "codeblock", style: { marginTop: "8px" }, text: "~/klipper-auto-eject/install.sh --push" }),
    h("div", { class: "toolbar", style: { marginTop: "14px" } }, docs("remote-access.md", "remote.docs"), docs("notifications.md", "remote.notify_docs"),
      docs("farm.md", "farm.docs")));
}

// ---------------------------------------------------- the slicer card
// What to paste into the slicer, with the end macro this printer uses:
// the one the newest file runs, or the one in its config.
const slicerUi = { kind: null, found: null, asked: false, scroll: false };
// where each setting is: the slicers' own menu names, the same in every language
const SLICER_PATHS = {
  orca: { labels: "Process → Others → G-code output", end: "Printer settings → Machine G-code → Machine end G-code",
          start: "Printer settings → Machine G-code → Machine start G-code" },
  prusa: { labels: "Print Settings → Output options → Label objects", end: "Printer Settings → Custom G-code → End G-code",
           start: "Printer Settings → Custom G-code → Start G-code" },
  cura: { labels: null, end: "Preferences → Printers → Machine Settings → End G-code",
          start: "Preferences → Printers → Machine Settings → Start G-code" }
};
function menuPath(path) { return path ? h("p", null, h("span", { class: "menu-path", dir: "ltr", text: path })) : null; }

function findSlicer() {
  if (slicerUi.asked) return;
  if (app.files === null) { loadFiles(); return; }      // drawn again once the files are in
  const newest = app.files[0];
  slicerUi.asked = true;
  if (!newest) return;
  const path = "/server/files/gcodes/" + newest.path.split("/").map(encodeURIComponent).join("/");
  // the macro is looked up when drawn: the printer's config may come later
  Promise.all([meta(newest.path), client.fetchText(path, "-262144")]).then(([m, tail]) => {
    slicerUi.found = { file: newest.path, kind: M.slicerKind((m || {}).slicer), tail: String(tail).slice(-262144) };
  }).catch(() => {}).then(() => refresh("setup"));
}

function copyText(text) {
  const done = () => toast(t("slicer.copied"), "ok");
  const fallback = () => {
    const ta = h("textarea", { style: { position: "fixed", top: "0", opacity: "0" } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { if (!document.execCommand("copy")) throw new Error("copy"); done(); } catch (e) { toast(t("slicer.copy_failed"), "bad"); }
    ta.remove();
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
}

function codeCopy(text) {
  // a long command wraps indented, so it still reads as one line
  return h("div", { class: "codecopy" }, h("div", { class: "codeblock code-lines" }, text.split("\n").map((l) => h("div", { class: "cl", text: l }))),
    h("button", { type: "button", class: "btn sm", onclick: () => copyText(text) }, icon("copy"), t("slicer.copy")));
}

function slicerCard() {
  findSlicer();
  const found = slicerUi.found || {};
  const kind = slicerUi.kind || found.kind || "orca";
  const macros = M.endMacros(app.config);
  if (found.tail !== undefined) found.macro = M.endMacroInFile(found.tail, macros);
  const macro = found.macro || macros[0] || null;
  const source = found.macro ? t("slicer.macro_file", { macro: found.macro, file: found.file })
    : macro ? t("slicer.macro_config", { macro }) : t("slicer.macro_none");
  // DEMON Klipper Essentials: its start lines stay as they are, and its end macro turns the motors off
  const demon = (M.macroSet(app.config) || {}).name === "demon";
  const set = sv();
  const tabs = h("div", { class: "seg", role: "tablist" }, ["orca", "prusa", "cura"].map((k) =>
    h("button", { type: "button", role: "tab", class: "seg-btn" + (k === kind ? " active" : ""), "aria-selected": k === kind ? "true" : "false",
      onclick: () => { slicerUi.kind = k; refresh("setup"); } }, t("slicer.name_" + k), found.kind === k ? h("span", { class: "dot", title: t("slicer.found") }) : null)));
  return h("section", { class: "card", id: "slicer" },
    h("h2", null, icon("file"), t("slicer.title")),
    h("p", { class: "muted", text: t("slicer.intro") }),
    tabs,
    found.kind === kind ? h("p", { class: "note", style: { marginTop: "8px" } }, icon("ok"), h("span", { text: t("slicer.found_file", { file: found.file }) })) : null,
    demon ? h("p", { class: "note", style: { marginTop: "8px" } }, icon("info"), h("span", null, t("slicer.demon"), " ",
      h("a", { href: DOCS + "/blob/main/docs/integration.md#demon-klipper-essentials", target: "_blank", rel: "noopener", text: t("slicer.demon_link") }))) : null,
    h("ol", { class: "slicer-steps" },
      h("li", null, h("b", { text: t("slicer.labels") }), menuPath(SLICER_PATHS[kind].labels), h("p", { text: t("slicer.labels_" + kind) })),
      h("li", null, h("b", { text: t("slicer.end") }), menuPath(SLICER_PATHS[kind].end),
        h("p", { text: macro ? t("slicer.end_how", { macro }) : t("slicer.end_how_none") }),
        codeCopy(M.slicerEndGcode(kind, macro)),
        h("p", { class: "muted small", text: source }),
        demon ? h("p", { class: "muted small", text: t("slicer.demon_end") }) : null,
        demon && String(set.home_method || "").toLowerCase() === "g28" ? h("p", { class: "note warn" }, icon("alert"), h("span", { text: t("slicer.demon_g28") })) : null,
        demon && (M.macroSet(app.config) || {}).autoOff ? h("p", { class: "note" }, icon("power"), h("span", { text: t("slicer.demon_off") })) : null),
      // with DEMON, in its first hook: DEMON stops the printer when anything long runs before DEMON_START
      demon ? h("li", null, h("b", { text: t("slicer.start_demon") }), menuPath("demon_custom_expansion → _CUSTOM_PRE_START"),
        (M.macroSet(app.config) || {}).guardHook ? h("p", { class: "note ok" }, icon("ok"), h("span", { text: t("slicer.start_demon_done") }))
          : [h("p", { text: t("slicer.start_how_demon") }), codeCopy("~/klipper-auto-eject/install.sh --demon"),
            h("p", { class: "muted small", text: t("slicer.start_demon_hand") })])
        : h("li", null, h("b", { text: t("slicer.start") }), menuPath(SLICER_PATHS[kind].start),
          h("p", { text: t("slicer.start_how") }), codeCopy("AUTO_EJECT_GUARD"))),
    h("div", { class: "toolbar", style: { marginTop: "12px" } },
      h("a", { class: "btn primary", href: "#/check" }, icon("check"), t("slicer.check")),
      h("a", { class: "btn", href: DOCS + "/blob/main/docs/slicer-setup.md", target: "_blank", rel: "noopener" }, icon("external"), t("slicer.docs"))));
}

function stlRow(title, desc, file) {
  return h("div", { class: "act-row" }, icon("box", "lead"),
    h("div", { class: "txt" }, h("b", { text: t(title) }), h("span", { text: t(desc) })),
    h("a", { class: "btn sm", href: "../hardware/test/" + file, download: file }, icon("download"), t("setup.download")));
}

// Side view: the nozzle, the blade ahead of it and how far it sits above
// the nozzle tip.
function bladeFigure(set) {
  const lift = typeof set.blade_lift === "number" ? set.blade_lift : null;
  const off = Number(set.blade_offset) || 0;
  const scale = Math.min(3.2, 300 / Math.max(40, off + 30));
  const nx = 380, bedY = 150, tipY = bedY - 10;
  const bx = nx - off * scale;
  const liftPx = lift !== null ? Math.max(6, lift * scale * 3) : 18;
  // drawings keep left-to-right text anchors in every language
  const svg = s("svg", { viewBox: "0 0 460 190", role: "img", "aria-label": t("setup.blade"), direction: "ltr" },
    s("rect", { class: "bf-bed", x: 10, y: bedY, width: 440, height: 14, rx: 3 }),
    s("rect", { class: "bf-head", x: nx - 26, y: 22, width: 56, height: tipY - 34, rx: 8 }),
    s("polygon", { class: "bf-nozzle", points: (nx - 7) + "," + (tipY - 12) + " " + (nx + 7) + "," + (tipY - 12) + " " + (nx + 1.5) + "," + tipY + " " + (nx - 1.5) + "," + tipY }),
    s("rect", { class: "bf-head", x: Math.min(bx, nx - 26), y: 34, width: Math.max(10, nx - 26 - bx + 4), height: 10, rx: 3 }),
    s("rect", { class: "bf-blade", x: bx - 5, y: 30, width: 7, height: tipY - liftPx - 30, rx: 2 }),
    // offset dimension
    s("path", { class: "bf-dim", d: "M" + (bx - 1.5) + " 16 V 24 M" + nx + " 16 V 24 M" + (bx - 1.5) + " 20 H " + nx }),
    s("text", { class: "bf-text", x: (bx + nx) / 2, y: 13, "text-anchor": "middle" }, t("c.mm", { v: num(off) })),
    // lift dimension
    s("path", { class: "bf-dim", d: "M" + (bx - 16) + " " + (tipY - liftPx) + " H " + (bx + 4) + " M" + (bx - 16) + " " + tipY + " H " + (nx + 30) + " M" + (bx - 11) + " " + (tipY - liftPx) + " V " + tipY }),
    s("text", { class: "bf-text", x: bx - 18, y: tipY - liftPx / 2 + 4, "text-anchor": "end" }, lift !== null ? t("c.mm", { v: num(lift, 2) }) : "?"),
    s("text", { class: "bf-sub", x: 452, y: tipY - 5, "text-anchor": "end" }, t("setup.tip")),
    s("text", { class: "bf-sub", x: 14, y: bedY + 30 }, "←"),
    s("text", { class: "bf-sub", x: 30, y: bedY + 30 }, t("bed.drop")));
  return h("div", { class: "blade-fig" }, svg);
}

export {
  appBadge, appMode, checkPageVersion, codeCopy, copyText, installApp, loadPush, notifyUser, slicerUi, viewSetup, wake,
  wakeApply, wakeSupported, wakeToggle
};
