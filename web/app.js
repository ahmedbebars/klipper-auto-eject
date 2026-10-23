/* klipper-auto-eject web page: the app.
 *
 * Plain JavaScript, no build step and nothing loaded from the internet.
 * Everything the page shows comes from Moonraker; everything it does is a
 * G-code command (AUTO_EJECT ..., AUTO_EJECT_SET ...) or a Moonraker job
 * queue call, so it never does anything the console could not.
 *
 * This file connects to the printer, draws the menu, finds the view to show
 * and starts the page. The views and what they share are in app/.
 */

import {
  $, aeState, app, camUrl, client, DEMO, DOCS, h, icon, iso, lang, leftover, M, MACROS, num, params, phase, plan,
  prompts, setLang, STATE, store, sv, t
} from "./app/core.js";
import { viewOverview } from "./app/overview.js";
import { viewCheck, viewQueue } from "./app/files.js";
import {
  appBadge, appMode, checkPageVersion, installApp, loadPush, notifyUser, viewSetup, wakeApply
} from "./app/setup.js";
import { viewSettings } from "./app/settings.js";
import { farm, farmCamTick, farmNeeds, farmShown, loadFarm, viewFarm } from "./app/farm.js";
import { pollHardware, viewHardware } from "./app/hardware.js";
import { viewActivity, viewGuide, viewUpdates } from "./app/updates.js";
import "./app/zoom.js";

/* ========================================================== connection */

const SUBSCRIBE = ["print_stats", "toolhead", "heater_bed", "idle_timeout", "exclude_object", "webhooks",
  "virtual_sdcard", "display_status", "fan", "save_variables", STATE].concat(MACROS);

client.on("open", () => {
  app.conn = "online";
  client.call("server.connection.identify", { client_name: "klipper-auto-eject", version: "1", type: "web", url: DOCS })
    .catch(() => {});
  client.call("server.info").then((info) => {
    app.hasQueue = (info.components || []).includes("job_queue");
    app.klippy = info.klippy_state || "";
    if (app.hasQueue) loadQueue();
    app.spool = (info.components || []).includes("spoolman") ? app.spool || {} : null;
    if (app.spool) loadSpool();
    if ((info.components || []).includes("webcam")) client.call("server.webcams.list").then((r) => { app.webcams = r.webcams || []; refresh(); }).catch(() => {});
    client.call("server.config").then((r) => {
      const jq = (r.config || {}).job_queue;
      app.autoTransition = jq ? !!jq.automatic_transition : null;
      const auth = (r.config || {}).authorization;
      app.trustedClients = auth ? [].concat(auth.trusted_clients || []) : null;
      app.ntfy = M.ntfyTopic(r.config);
      app.notifier = M.notifierKind(r.config);
      app.spoolmanUrl = String(((r.config || {}).spoolman || {}).server || "");
      refresh();
    }).catch(() => {});
    loadPush();
    if (app.klippy === "ready") klippyReady();
    else refresh();
    if (app.files === null && (route() === "check" || route() === "queue")) loadFiles();
  }).catch((e) => {
    if (/unauthori/i.test(e.message)) { app.conn = "unauthorized"; refresh(); }
  });
  client.call("printer.info").then((r) => { app.host = r.hostname || ""; app.klipperVersion = r.software_version || ""; refresh(); }).catch(() => {});
  client.call("server.gcode_store", { count: 300 }).then((r) => {
    app.log = (r.gcode_store || []).map((g) => ({ time: g.time, text: g.message, type: g.type }));
    // a dialog that is open in Mainsail is open here too
    const recent = Date.now() / 1000 - 1800;
    for (const g of app.log) if (g.time > recent) prompts.feed(g.text);
    app.prompt = prompts.shown;
    renderPrompt();
    refresh("activity");
  }).catch(() => {});
  refresh();
});

client.on("close", () => { app.conn = "offline"; app.klippy = ""; app.loaded = false; refresh(); });
client.on("unauthorized", () => { app.conn = "unauthorized"; refresh(); });

function klippyReady() {
  app.klippy = "ready";
  app.loaded = false;
  client.call("printer.objects.list").then((r) => {
    const objs = r.objects || [];
    app.objects = objs;
    app.hasMacros = objs.includes("gcode_macro AUTO_EJECT");
    const want = {};
    for (const o of SUBSCRIBE) if (objs.includes(o)) want[o] = null;
    return client.call("printer.objects.subscribe", { objects: want });
  }).then((r) => {
    app.status = r.status || {};
    app.loaded = true;
    refresh();
    return client.call("printer.objects.query", { objects: { configfile: ["config"] } });
  }).then((r) => {
    app.config = ((r.status || {}).configfile || {}).config || {};
    refresh();
  }).catch((e) => { console.error(e); refresh(); });
  loadTemplate();
}

client.on("notify_klippy_ready", () => klippyReady());
client.on("notify_klippy_shutdown", () => {
  app.klippy = "shutdown";
  client.call("printer.objects.query", { objects: { webhooks: null } })
    .then((r) => { app.klippyMsg = (((r.status || {}).webhooks) || {}).state_message || ""; refresh(); }).catch(() => refresh());
});
client.on("notify_klippy_disconnected", () => { app.klippy = "disconnected"; refresh(); });

client.on("notify_status_update", (p) => {
  const diff = p[0] || {};
  for (const k of Object.keys(diff)) {
    app.status[k] = Object.assign({}, app.status[k] || {}, diff[k]);
  }
  if (diff.webhooks && diff.webhooks.state) {
    if (diff.webhooks.state === "shutdown" && app.klippy !== "shutdown") notifyUser(t("note.shutdown"), diff.webhooks.state_message || "");
    app.klippy = diff.webhooks.state;
    app.klippyMsg = diff.webhooks.state_message || "";
  }
  const ps = app.status.print_stats || {};
  if (ps.state && ps.state !== app.lastJobState) {
    if ((app.lastJobState === "printing" || app.lastJobState === "paused") && ["complete", "error", "cancelled"].includes(ps.state)) {
      notifyUser(t("note." + ps.state), [ps.filename, ps.message].filter(Boolean).join(": "));
      if (app.spool) setTimeout(loadSpool, 6000);
    }
    app.lastJobState = ps.state;
  }
  trackLanes();
  refresh();
});

client.on("notify_gcode_response", (p) => {
  const line = String(p[0] || "");
  app.log.push({ time: Date.now() / 1000, text: line, type: "response" });
  if (app.log.length > 1000) app.log.splice(0, app.log.length - 1000);
  const ev = prompts.feed(line);
  if (ev) { app.prompt = prompts.shown; renderPrompt(); }
  const note = M.noticeFor(line);
  if (note) notifyUser(t("note." + note.kind), note.text);
  refresh("activity");
});

client.on("notify_job_queue_changed", (p) => {
  const d = p[0] || {};
  if (d.updated_queue) app.queue.jobs = d.updated_queue;
  if (d.queue_state) app.queue.state = d.queue_state;
  refresh();
});

client.on("notify_active_spool_set", () => loadSpool());
client.on("notify_spoolman_status_changed", () => loadSpool());

client.on("notify_filelist_changed", () => { app.files = null; if (route() === "check" || route() === "queue") loadFiles(); });

function loadQueue() {
  return client.call("server.job_queue.status").then((r) => {
    app.queue = { jobs: r.queued_jobs || [], state: r.queue_state || "" };
    refresh();
  }).catch(() => {});
}

// Spoolman, through Moonraker: the spool on the printer and what is left on it.
function spoolman(method, path) {
  return client.call("server.spoolman.proxy", { request_method: method, path, use_v2_response: true }).then((r) => {
    if (r && r.error) throw new Error(r.error.message || "Spoolman");
    return (r || {}).response;
  });
}
function loadSpool() {
  if (!app.spool || app.conn !== "online") return Promise.resolve();
  return client.call("server.spoolman.status").then((st) => {
    const sp = app.spool;
    if (!sp) return;
    sp.connected = !!st.spoolman_connected;
    sp.id = st.spool_id === undefined ? null : st.spool_id;
    sp.pending = st.pending_reports || [];
    if (!sp.connected || sp.id === null) { sp.data = null; return; }
    return spoolman("GET", "/v1/spool/" + sp.id).then((d) => { sp.data = d || null; }, () => { sp.data = null; });
  }).catch(() => {}).then(() => refresh());
}
function loadSpools() {
  if (!app.spool || app.spool.listing) return;
  app.spool.listing = true;
  refresh();
  spoolman("GET", "/v1/spool?allow_archived=false").then((list) => { app.spool.list = Array.isArray(list) ? list : []; },
    (e) => { app.spool.list = null; toast(e.message, "bad"); }).then(() => { app.spool.listing = false; refresh(); });
}
function useSpool(id) {
  client.call("server.spoolman.post_spool_id", { spool_id: id === null ? null : Number(id) })
    .then(() => toast(t("spool.changed"), "ok")).catch((e) => toast(e.message, "bad"));
}

// The queue against the spool (M.spoolPlan), with the settings; null
// without Spoolman, without a spool chosen, or a spool without a weight.
function spoolCheck() {
  const sp = app.spool;
  if (!sp || !sp.data || typeof sp.data.remaining_weight !== "number") return null;
  const fil = sp.data.filament || {};
  const pending = (sp.pending || []).filter((r) => r.spool_id === sp.id).reduce((a, r) => a + (Number(r.filament_used) || 0), 0);
  const ps = app.status.print_stats || {};
  let now = 0;
  if (["printing", "paused"].includes(ps.state) && ps.filename) {
    const m = app.meta[ps.filename];
    if (!m) meta(ps.filename).then(() => refresh());
    now = m ? M.gramsLeft(m, ps.filament_used, (app.status.virtual_sdcard || {}).progress, fil) : null;
  }
  const jobs = app.queue.jobs.map((j) => {
    if (!app.meta[j.filename]) meta(j.filename).then(() => refresh());
    return app.meta[j.filename] ? M.fileGrams(app.meta[j.filename], fil) : null;
  });
  const set = sv(), reserve = Number(set.spool_reserve);
  const p = M.spoolPlan(sp.data.remaining_weight - (M.lengthGrams(pending, fil) || 0), now, jobs, isFinite(reserve) ? reserve : 10);
  if (p) p.action = String(set.spool_low_action || "stop").toLowerCase();
  return p;
}
// whether the plan warns about anything
function spoolTrouble(p) {
  return !!p && p.action !== "off" && (p.nowShort || p.stopAt >= 0);
}
function spoolGrams(g) { return iso(t("spool.g", { g: num(Math.max(0, g), 0) })); }

function loadFiles() {
  // a page opened on #/check draws before the connection is open: wait for it
  if (app.filesLoading || app.conn !== "online") return;
  app.filesLoading = true;
  client.call("server.files.list", { root: "gcodes" }).then((list) => {
    app.files = (list || []).filter((f) => /\.(gcode|g|gco)$/i.test(f.path)).sort((a, b) => b.modified - a.modified);
  }).catch(() => { app.files = []; }).then(() => { app.filesLoading = false; refresh(); });
}

// A long list of files draws FILE_ROWS at a time: the last row draws the next ones.
const FILE_ROWS = 300;
function fileList(ui, view, files, cls, rowFor) {
  const shown = Math.max(FILE_ROWS, ui.shown || 0);
  const rows = files.slice(0, shown).map(rowFor);
  if (files.length > shown) {
    rows.push(h("button", { type: "button", class: "btn block more-rows", onclick: () => { ui.shown = shown + FILE_ROWS; refresh(view); } },
      icon("down"), t("files.more", { n: num(Math.min(FILE_ROWS, files.length - shown), 0), all: num(files.length, 0) })));
  }
  return h("div", { class: cls }, rows);
}

const metaWait = {};
function meta(file) {
  if (app.meta[file]) return Promise.resolve(app.meta[file]);
  if (!metaWait[file]) {
    metaWait[file] = client.call("server.files.metadata", { filename: file })
      .then((m) => (app.meta[file] = m || {}), () => (app.meta[file] = {}));
  }
  return metaWait[file];
}

function loadTemplate() {
  if (app.template) return;
  fetch("../config/auto_eject_settings.cfg", { cache: "no-store" })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error("HTTP " + r.status))))
    .then((text) => { app.template = M.parseSettingsTemplate(text); })
    .catch(() => { app.template = false; })
    .then(() => refresh("settings"));
}

// Remember which push lanes the blade has run along during this eject.
function trackLanes() {
  const st = aeState();
  if (!st.busy) { app.lanesDone.clear(); app.laneActive = null; app.coolStart = null; return; }
  const bed = app.status.heater_bed;
  if (bed && app.coolStart === null) app.coolStart = bed.temperature;
  const pl = plan();
  const pos = (app.status.toolhead || {}).position;
  if (!pl || !pos) return;
  const set = sv();
  // a lane is done once the blade has been down in it and comes up again
  const low = pos[2] <= Math.max(set.push_z, 0) + 1.5;
  if (!low) {
    if (app.laneActive !== null && app.laneActive !== undefined) app.lanesDone.add(app.laneActive);
    app.laneActive = null;
    return;
  }
  const cross = pl.ai === 1 ? pos[0] : pos[1];
  pl.pushes.forEach((p, i) => { if (Math.abs(cross - p.c) < 2) app.laneActive = i; });
}

/* ================================================================ run */

function gcode(script, opts) {
  opts = opts || {};
  const p = client.gcode(script);
  if (!opts.quiet) toast(t("act.sent") + ": " + script);
  p.catch((e) => { if (e.message !== "stopped") toast(cleanError(e.message), "bad"); });
  return p;
}

function cleanError(msg) {
  return String(msg).replace(/^!!\s*/, "").replace(/^Error evaluating '[^']*':\s*/, "");
}

function confirm(title, body, okLabel, okClass, noLabel) {
  return new Promise((resolve) => {
    const close = (v) => { root.remove(); resolve(v); };
    const root = h("div", { class: "modal-back", onclick: (e) => { if (e.target === root) close(false); } },
      h("div", { class: "modal", role: "dialog", "aria-modal": "true" },
        h("header", null, h("h3", { text: title })),
        h("div", { class: "body" }, h("p", { text: body })),
        h("footer", null,
          h("button", { type: "button", class: "btn", onclick: () => close(false), text: noLabel || t("c.cancel") }),
          h("button", { type: "button", class: "btn " + (okClass || "primary"), onclick: () => close(true), text: okLabel || t("c.ok") }))));
    $("#modal-root").appendChild(root);
    root.querySelector(".btn:last-child").focus();
    root.addEventListener("keydown", (e) => { if (e.key === "Escape") close(false); });
  });
}

function toast(text, kind) {
  const el = h("div", { class: "toast" + (kind ? " " + kind : "") }, icon(kind === "bad" ? "alert" : kind === "ok" ? "ok" : "info"), h("div", { text }));
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "bad" ? 9000 : 3500);
}

/* ============================================================ prompts */

function renderPrompt() {
  const root = $("#modal-root");
  const old = root.querySelector(".modal-back.prompt");
  if (old) old.remove();
  const p = app.prompt;
  if (!p) return;
  const close = () => {
    prompts.shown = null; app.prompt = null; renderPrompt();
    gcode('RESPOND TYPE=command MSG="action:prompt_end"', { quiet: true });
  };
  const btn = (b) => h("button", {
    type: "button", class: "btn " + (b.color === "primary" ? "primary" : b.color === "error" ? "danger" : ""),
    onclick: () => gcode(b.gcode, { quiet: true }), text: b.label, dir: "auto"
  });
  const body = h("div", { class: "body" });
  for (const it of p.items) {
    if (it.type === "text") body.appendChild(h("p", { text: it.text, dir: "auto" }));
    else body.appendChild(h("div", { class: "pbtns" }, it.buttons.map(btn)));
  }
  root.appendChild(h("div", { class: "modal-back prompt" },
    h("div", { class: "modal", role: "dialog", "aria-modal": "true" },
      h("header", null, h("h3", { text: p.title, dir: "auto" }),
        h("button", { type: "button", class: "icon-btn", "aria-label": t("c.close"), onclick: close }, icon("bad"))),
      body,
      p.footer.length ? h("footer", null, p.footer.map(btn)) : null)));
}

/* ============================================================= router */

const VIEWS = [
  { id: "overview", icon: "overview", render: viewOverview },
  { id: "farm", icon: "farm", render: viewFarm },
  { id: "queue", icon: "queue", render: viewQueue },
  { id: "check", icon: "check", render: viewCheck },
  { id: "setup", icon: "setup", render: viewSetup },
  { id: "settings", icon: "settings", render: viewSettings },
  { id: "hardware", icon: "chip", render: viewHardware },
  { id: "updates", icon: "download", render: viewUpdates },
  { id: "activity", icon: "activity", render: viewActivity },
  { id: "guide", icon: "guide", render: viewGuide }
];

function route() {
  let r = location.hash.replace(/^#\/?/, "").split("/")[0];
  if (r === "motors") r = "hardware";        // its first name
  return VIEWS.some((v) => v.id === r) ? r : "overview";
}

let current = null;     // { id, sig, el, update }
let pending = false;
let pointerDown = false;
document.addEventListener("pointerdown", () => { pointerDown = true; });
document.addEventListener("pointerup", () => { pointerDown = false; setTimeout(() => refresh(), 30); });

// Views are rebuilt only when what they show changes (their signature),
// and never between a press and a release, so buttons always get clicks.
function refresh(only) {
  if (only && route() !== only) return;
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    renderChrome();
    const id = route();
    const view = VIEWS.find((v) => v.id === id);
    const sig = id + "|" + lang + "|" + view.render.sig();
    if (!current || current.id !== id || current.sig !== sig) {
      if (pointerDown && current && current.id === id) { setTimeout(() => refresh(), 120); return; }
      const box = $("#view");
      const keep = current && current.id === id ? captureInputs(box) : null;
      const scrolled = keep ? captureScroll(box) : null;
      const res = view.render();
      box.replaceChildren(res.el);
      if (keep) restoreInputs(box, keep);
      if (scrolled) restoreScroll(box, scrolled);
      current = { id, sig, update: res.update };
    }
    if (current.update) current.update();
  });
}

// keep typing and focus when a view is rebuilt
function captureInputs(box) {
  const vals = {};
  box.querySelectorAll("[data-keep]").forEach((el) => { vals[el.dataset.keep] = el.value; });
  const a = document.activeElement;
  return { vals, focus: a && a.dataset ? a.dataset.keep : null, sel: a && a.selectionStart };
}
function restoreInputs(box, keep) {
  box.querySelectorAll("[data-keep]").forEach((el) => { if (keep.vals[el.dataset.keep] !== undefined) el.value = keep.vals[el.dataset.keep]; });
  if (keep.focus) {
    const el = box.querySelector('[data-keep="' + keep.focus + '"]');
    if (el) { el.focus(); try { if (keep.sel !== null) el.setSelectionRange(keep.sel, keep.sel); } catch (e) { /* not a text box */ } }
  }
}

// A view or a dialog drawn again keeps each list where it was scrolled to:
// a list that loads its files' facts while it scrolls redraws the view.
function scrollKey(root, el) {
  const same = Array.from(root.getElementsByTagName(el.tagName)).filter((x) => x.className === el.className);
  return el.tagName + "|" + el.className + "|" + same.indexOf(el);
}
function captureScroll(root) {
  const out = [];
  for (const el of root.querySelectorAll("*")) {
    if (el.scrollTop > 0 || el.scrollLeft > 0) out.push([scrollKey(root, el), el.scrollTop, el.scrollLeft]);
  }
  if (root.scrollTop > 0) out.push(["", root.scrollTop, root.scrollLeft]);
  return { list: out, page: window.scrollY };
}
function restoreScroll(root, saved) {
  for (const [key, top, left] of saved.list) {
    let el = root;
    if (key) {
      const [tag, cls, n] = key.split("|");
      el = Array.from(root.getElementsByTagName(tag)).filter((x) => x.className === cls)[Number(n)];
    }
    if (el) { el.scrollTop = top; el.scrollLeft = left; }
  }
  if (Math.abs(window.scrollY - saved.page) > 1) window.scrollTo(0, saved.page);
}

window.addEventListener("hashchange", () => { navMore = false; refresh(); $("#main").focus({ preventScroll: true }); window.scrollTo(0, 0); });

/* ============================================================= chrome */

let chromeSig = "";
let navMore = false;          // the phone's More sheet is open
function closeMore() { if (navMore) { navMore = false; chromeSig = ""; renderChrome(); } }
document.addEventListener("click", (e) => { if (navMore && (!e.target.closest("#nav") || e.target.closest(".nav-extra a"))) closeMore(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMore(); });
function renderChrome() {
  const ph = phase();
  const id = route();
  const sig = [lang, id, navMore, appMode(), app.pageUpdate, app.conn, app.klippy, ph, app.host, app.hasQueue, app.queue.jobs.length, leftover().length, app.hasMacros,
    farmShown(), farmNeeds(), (app.objects || []).length > 0].join("|");
  if (sig === chromeSig) return;
  chromeSig = sig;
  const dir = (AE_LANGS[lang] || {}).dir || "ltr";
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;
  document.title = t("app.title") + (app.host ? " · " + app.host : "");
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
  $("#skip").onclick = () => $("#main").focus();
  $("#host").textContent = DEMO ? "demo-printer" : (app.host || location.hostname);

  const pill = $("#conn");
  let cls = "pill", text = t("conn.connecting");
  if (DEMO) { cls += " demo"; text = t("conn.demo"); }
  else if (app.conn === "online" && app.klippy === "ready") { cls += " ok"; text = t("conn.online"); }
  else if (app.conn === "online") { cls += " warn"; text = t("conn.klippy"); }
  else if (app.conn === "offline" || app.conn === "unauthorized") { cls += " bad"; text = t("conn.offline"); }
  pill.className = cls;
  pill.lastChild.textContent = text;
  pill.title = text;

  const es = $("#estop");
  es.hidden = !(ph === "working" || ph === "cooling" || ph === "printing" || ph === "paused");
  es.replaceChildren(icon("stop"), h("span", { text: t("act.estop") }));
  es.onclick = () => client.call("printer.emergency_stop").catch((e) => toast(e.message, "bad"));

  const sel = $("#lang");
  sel.replaceChildren(...Object.keys(AE_LANGS).map((c) => h("option", { value: c, selected: c === lang, text: AE_LANGS[c].name })));
  sel.onchange = () => { setLang(sel.value); chromeSig = ""; refresh(); renderPrompt(); };
  sel.setAttribute("aria-label", t("c.lang"));

  const dark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const th = $("#theme");
  th.replaceChildren(icon(dark ? "sun" : "moon"));
  th.title = t("c.theme");
  th.setAttribute("aria-label", t("c.theme"));
  th.onclick = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store("ae.theme", next);
    chromeSig = "";
    refresh();
  };
  // 3. the app can be installed: say so where it is seen
  const mode = appMode();
  const inst = $("#install");
  inst.hidden = DEMO || !(mode === "prompt" || mode === "ios");
  inst.replaceChildren(icon("install"));
  inst.title = t("remote.install");
  inst.setAttribute("aria-label", t("remote.install"));
  inst.onclick = () => mode === "prompt" ? installApp() : confirm(t("remote.install"), t("remote.install_ios"), t("c.ok"));
  // 6. the number of printers that need you, on the app's icon
  appBadge(DEMO ? 0 : farmShown() ? farmNeeds() : ph === "waiting" ? 1 : 0);
  const back = $("#back");
  back.hidden = DEMO;          // the demo has no printer dashboard to go back to
  back.replaceChildren(icon("home"));
  back.title = t("app.back");
  back.setAttribute("aria-label", t("app.back"));

  const nav = $("#nav");
  const links = VIEWS.filter((v) => (v.id !== "queue" || app.hasQueue || DEMO) && (v.id !== "farm" || farmShown() || id === "farm") &&
    (v.id !== "hardware" || (app.objects || []).length || id === "hardware")).map((v) => {
    let count = v.id === "queue" && app.queue.jobs.length ? h("span", { class: "count", text: num(app.queue.jobs.length, 0) }) : null;
    if (v.id === "farm" && farmNeeds()) count = h("span", { class: "count bad", text: num(farmNeeds(), 0) });
    return h("a", { href: "#/" + v.id, class: v.id === id ? "active" : "", "aria-current": v.id === id ? "page" : null },
      icon(v.icon), h("span", { class: "lbl", text: t("nav." + v.id) }), h("span", { class: "lbl-s", text: t("navs." + v.id) }), count);
  });
  // on a phone the bar holds the first four; More opens the rest
  const extra = links.slice(4);
  const moreHere = extra.some((a) => a.classList.contains("active"));
  nav.classList.toggle("more-open", navMore && extra.length > 0);
  nav.replaceChildren(...links.slice(0, 4),
    extra.length ? h("div", { class: "nav-extra", id: "nav-extra" }, extra) : null,
    extra.length ? h("button", { type: "button", class: "nav-more" + (moreHere ? " active" : ""), "aria-expanded": navMore ? "true" : "false",
      "aria-controls": "nav-extra", onclick: (e) => { e.stopPropagation(); navMore = !navMore; chromeSig = ""; renderChrome(); } },
      icon("dots", "dots"), h("span", { text: t("navs.more") })) : null,
    h("div", { class: "foot" }, h("a", { href: DOCS, target: "_blank", rel: "noopener", text: "klipper-auto-eject" })));

  // one banner for the most important thing
  const b = $("#banner");
  let banner = null;
  if (app.pageUpdate) banner = ["demo", "download", t("c.update_ready"),
    h("button", { type: "button", class: "btn sm primary", onclick: () => location.reload() }, icon("restart"), t("c.reload"))];
  if (app.conn === "unauthorized") banner = ["bad", "alert", t("conn.unauthorized")];
  else if (app.conn === "online" && (app.klippy === "shutdown" || app.klippy === "error")) {
    banner = ["bad", "alert", t("conn.shutdown", { msg: app.klippyMsg || app.klippy }),
      h("button", { type: "button", class: "btn sm", onclick: () => confirm(t("conn.restart"), t("conn.restart_confirm"), t("conn.restart"))
        .then((ok) => { if (ok) client.call("printer.firmware_restart").catch((e) => toast(e.message, "bad")); }) }, icon("restart"), t("conn.restart"))];
  } else if (app.conn === "online" && app.klippy === "ready" && app.hasMacros === false && id !== "farm") banner = ["bad", "alert", t("conn.missing")];   // a farm printer needs no blade
  else if (DEMO) banner = ["demo", "info", t("app.demo_note")];
  if (banner) {
    b.className = "banner " + banner[0];
    b.replaceChildren(...[icon(banner[1]), h("div", { class: "grow" }, h("div", { text: banner[2] })), banner[3]].filter(Boolean));
    b.hidden = false;
  } else b.hidden = true;
}

/* =============================================================== start */

const theme = params.get("theme") || store("ae.theme");
if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { chromeSig = ""; refresh(); });
setInterval(() => {
  // the camera snapshot, about once a second
  const img = $('[data-live="cam"]');
  const cam = app.webcams.find((w) => w.enabled !== false);
  if (img && cam && cam.snapshot_url && camUrl(cam) === camUrl({ snapshot_url: cam.snapshot_url })) {
    const u = camUrl(cam);
    img.src = u + (u.includes("?") ? "&" : "?") + "t=" + Date.now();
  }
}, 1200);
setInterval(pollHardware, 1000);
setInterval(() => {
  if (app.spool && !document.hidden && ["printing", "paused"].includes((app.status.print_stats || {}).state)) loadSpool();
}, 20000);
// the farm: often while it is shown, now and then for the menu's count
loadFarm();
setInterval(() => {
  if (document.hidden || farm.available === false) return;
  if (route() === "farm" || route() === "updates" || farm.scanOpen || ++farm.tick % 5 === 0) loadFarm();
}, 3000);
setInterval(farmCamTick, 250);
if ("launchQueue" in window) {
  window.launchQueue.setConsumer((params) => {
    try { const hash = new URL(params.targetURL).hash; if (hash && hash !== location.hash) location.hash = hash; } catch (e) { /* no address */ }
  });
}
wakeApply();
checkPageVersion();
setInterval(checkPageVersion, 5 * 60 * 1000);
if ("serviceWorker" in navigator && window.isSecureContext && !DEMO) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  // a tapped notification names the tab to show
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (!e.data || e.data.type !== "open") return;
    try { const hash = new URL(e.data.url).hash; if (hash && hash !== location.hash) location.hash = hash; } catch (err) { /* no address */ }
  });
}
refresh();
client.connect();

export {
  captureScroll, cleanError, confirm, fileList, gcode, loadFiles, loadSpools, loadTemplate, meta, refresh,
  restoreScroll, route, spoolCheck, spoolGrams, spoolTrouble, toast, useSpool
};
