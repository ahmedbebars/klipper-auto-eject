/* klipper-auto-eject web page. The Printer farm: every printer on the network, from the farm service.
 */

import {
  $, app, camUrl, client, DEMO, DOCS, duration, fmtSize, h, head, icon, lang, M, num, store, t
} from "./core.js";
import { captureScroll, cleanError, confirm, refresh, restoreScroll, toast } from "../app.js";
import { fileRow, fillFileRow, lazyRows, thumbBox } from "./files.js";
import { wake, wakeSupported, wakeToggle } from "./setup.js";
import { copySettings, editPrinter, farmQueueCard, qrDialog, queueAdd } from "./farm-tools.js";

/* =============================================================== farm */

// Every printer on the network, from the klipper-auto-eject service on
// this printer (push/farm.py), which nginx serves at ../api/.
const FARM_API = "../api/farm";
const farm = { available: null, data: null, scanOpen: false, scanWait: false, scanSig: "", pick: null, cam: {}, tick: 0 };
const FARM_ICON = { needs: "alert", stopped: "stop", paused: "pause", ejecting: "push", printing: "layers", idle: "ok", off: "power", offline: "info" };

function farmCall(path, body) {
  if (DEMO) return client.farm(path, body);
  const opts = body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  // the farm itself must answer with its printers: anything else is not the service
  return fetch(FARM_API + path, opts).then((r) => r.json().catch(() => ({}))
    .then((j) => (r.ok && (path !== "" || Array.isArray(j.printers)) ? j : Promise.reject(new Error(j.error || "HTTP " + r.status)))));
}

function loadFarm() {
  return farmCall("").then((d) => {
    farm.data = d;
    farm.available = true;
    if (farm.scanOpen) renderScan();
    refresh();
  }).catch(() => {
    if (!farm.data) { farm.available = false; refresh(); }
  });
}

function farmShown() { return !!(farm.available && farm.data); }
// the farm page's filter, search and view (cards or list; "auto": by how many)
const farmUi = { filter: "all", search: "", view: store("ae.farmView") || "auto", sel: new Set(),
  report: { period: "today", data: null, loading: false, at: 0 } };
function farmNeeds() { return farmShown() ? M.farmCounts(farm.data.printers).needs : 0; }

function farmFile(p) {
  return ["printing", "paused"].includes(p.phase) || ["done", "cancelled", "error", "parts", "leftover"].includes(p.reason) ? p.filename || "" : "";
}

function farmLine(p) {
  if (p.phase === "printing") {
    const bits = [num((p.progress || 0) * 100, 0) + " %"];
    if (p.eta !== null && p.eta !== undefined) bits.push(t("farm.left", { t: duration(p.eta) }));
    if (p.layers) bits.push(t("farm.layer", { l: num(p.layer || 0, 0), t: num(p.layers, 0) }));
    return bits.join(" · ");
  }
  if (p.phase === "needs") {
    if (p.reason === "leftover") return t("farm.why.leftover", { names: (p.leftover || []).join(lang === "ar" ? "، " : ", ") });
    if (p.reason === "parts") return t("farm.why.parts", { n: num(p.parts || 0, 0) });
    if (p.reason === "queue") return t("farm.why.queue", { n: num(p.jobs || 0, 0) });
    if (p.reason === "error") return t("farm.why.error") + (p.message ? ": " + p.message : "");
    if (p.reason === "bin") return t("farm.why.bin", { n: num(p.bin || 0, 0), cap: num(p.bin_cap || 0, 0) });
    return t("farm.why." + p.reason);
  }
  if (p.phase === "stopped") return p.message || t("farm.why.stopped");
  if (p.phase === "paused") return p.message || t("farm.why.paused");
  if (p.phase === "ejecting") return t(p.reason === "cooling" ? "farm.why.cooling" : "farm.why.ejecting");
  if (p.phase === "idle") return p.jobs ? t("farm.why.idle_jobs", { n: num(p.jobs, 0) }) : t("farm.why.idle");
  if (p.phase === "off") return t("farm.why.off");
  return t("farm.why.offline");
}

function farmAct(p, action) {
  if (action === "print") return printDialog(p);
  const go = () => farmCall("/" + p.id + "/" + action, {})
    .then(() => { toast(t("farm.sent", { name: p.name }), "ok"); setTimeout(loadFarm, 700); })
    .catch((e) => toast(cleanError(e.message), "bad"));
  if (action === "push") return confirm(t("act.push_now"), t("act.push_confirm"), t("act.push_now")).then((ok) => { if (ok) go(); });
  if (action === "clear" && p.phase === "ejecting") return confirm(t("act.bg_take"), t("act.bg_take_confirm"), t("act.bg_take")).then((ok) => { if (ok) go(); });
  if (action === "continue") return confirm(t("farm.continue"), t("farm.continue_confirm", { name: p.name }), t("farm.continue")).then((ok) => { if (ok) go(); });
  if (action === "estop") return confirm(t("act.estop"), t("farm.estop_confirm", { name: p.name }), t("act.estop"), "danger").then((ok) => { if (ok) go(); });
  if (action === "cancel") return confirm(t("farm.cancel"), t("farm.cancel_confirm", { name: p.name, file: p.filename || "" }), t("farm.cancel"), "danger", t("farm.keep_printing"))
    .then((ok) => { if (ok) go(); });
  return go();
}

function farmTodayLine(list) {
  if (!list.some((p) => p.stats)) return null;
  const d = M.farmToday(list);
  return h("span", { class: "farm-today" }, icon("activity"),
    h("span", { text: t("farm.today", { ok: num(d.ok, 0), bad: num(d.bad, 0) }) + " · " + t("farm.hours_all", { h: num(d.hours, 0) }) }));
}

function farmStatsLine(p) {
  const s = p.stats;
  if (!s || !(s.hours || s.recent)) return null;
  const bits = [t("farm.hours", { h: num(s.hours, s.hours < 10 ? 1 : 0) })];
  if (s.recent) bits.push(t("farm.success", { p: num(Math.round(100 * s.recent_ok / s.recent), 0), n: num(s.recent, 0) }));
  if (s.today_ok || s.today_bad) bits.push(t(s.today_bad ? "farm.today_short_bad" : "farm.today_short", { ok: num(s.today_ok, 0), bad: num(s.today_bad, 0) }));
  return h("div", { class: "fc-stats" }, icon("activity"), h("span", { text: bits.join(" · ") }));
}

function farmPower(p, d) {
  const action = d.status === "on" ? "off" : "on";
  const go = () => farmCall("/" + p.id + "/power", { device: d.device, action })
    .then(() => { toast(t("farm.sent", { name: p.name }), "ok"); setTimeout(loadFarm, 900); })
    .catch((e) => toast(cleanError(e.message), "bad"));
  if (action === "on") return go();
  return confirm(t("farm.turn_off", { dev: d.device }), t("farm.off_confirm", { name: p.name, dev: d.device }), t("farm.turn_off", { dev: d.device }), "danger")
    .then((ok) => { if (ok) go(); });
}

function reportSelect() {
  const now = ((farm.data || {}).settings || {}).report || "";
  const times = ["", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00"];
  if (now && !times.includes(now)) times.push(now);
  const sel = h("select", { class: "select" }, times.map((v) => h("option", { value: v, selected: v === now, text: v ? t("farm.report_at", { t: v }) : t("farm.auto_off_never") })));
  sel.addEventListener("change", () => farmCall("/settings", { report: sel.value })
    .then(() => { toast(sel.value ? t("farm.report_on", { t: sel.value }) : t("farm.report_off"), "ok"); loadFarm(); })
    .catch((e) => toast(cleanError(e.message), "bad")));
  return sel;
}

function farmCam(id) { return FARM_API + "/" + encodeURIComponent(id) + "/snapshot?t=" + Date.now(); }

// The farm's cameras: each one on the screen loads its next picture as soon
// as the last has arrived, at most one a second, so a slow link slows only
// itself and the ones scrolled away cost nothing.
const farmCamAt = {};
function farmCamTick() {
  if (document.hidden) return;
  const now = Date.now();
  document.querySelectorAll('[data-live="farmcam"]').forEach((img) => {
    const id = img.dataset.id;
    if (farmCamAt[id] === "busy" || now < (farmCamAt[id] || 0) || !onScreen(img)) return;
    farmCamAt[id] = "busy";
    // the next picture loads first, so the shown one never blinks
    const u = farmCam(id), next = new Image();
    next.onload = () => {
      document.querySelectorAll('[data-live="farmcam"]').forEach((el) => { if (el.dataset.id === id) el.src = u; });
      farm.cam[id] = u;
      farmCamAt[id] = Date.now() + 1000;
    };
    next.onerror = () => { farmCamAt[id] = Date.now() + 5000; };
    next.src = u;
  });
}
function onScreen(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
}

// One camera large and as live as the link allows: this printer's own
// stream when it has one, else pictures one after another.
function camViewer(p) {
  const own = p.local ? app.webcams.find((w) => w.enabled !== false) : null;
  const stream = own && camUrl(own) !== own.snapshot_url ? camUrl(own) : "";
  const img = h("img", { class: "cam-big", alt: p.name, src: stream || farm.cam[p.id] || farmCam(p.id) });
  let open = true, timer = null;
  const close = () => { open = false; clearTimeout(timer); img.src = ""; root.remove(); };
  const root = h("div", { class: "modal-back", onclick: (e) => { if (e.target === root) close(); } },
    h("div", { class: "modal cam-modal", role: "dialog", "aria-modal": "true", "aria-label": p.name },
      h("header", null, h("h3", { dir: "auto", text: p.name }),
        h("button", { type: "button", class: "icon-btn", title: t("c.close"), "aria-label": t("c.close"), onclick: close }, icon("close"))),
      img));
  const step = () => {
    if (!open) return;
    const t0 = Date.now(), u = farmCam(p.id), next = new Image();
    next.onload = () => {
      if (!open) return;
      img.src = u;
      farm.cam[p.id] = u;
      timer = setTimeout(step, Math.max(0, 100 - (Date.now() - t0)));
    };
    next.onerror = () => { if (open) timer = setTimeout(step, 2000); };
    next.src = u;
  };
  $("#modal-root").appendChild(root);
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  root.querySelector("button").focus();
  if (!stream) step();
}

// Another printer's picture of a file, through the farm (it reaches them all).
const farmNoPic = new Set();
function farmThumbSrc(p, file, modified, want) {
  if (DEMO) return client.thumbFor(file);
  return FARM_API + "/" + encodeURIComponent(p.id) + "/thumb?file=" + encodeURIComponent(file) + "&w=" + (want || 96) +
    (modified ? "&m=" + Math.round(modified) : "");
}
function farmThumb(p, file) {
  const key = p.id + "|" + file;
  return farmNoPic.has(key) ? thumbBox("", "sm") : thumbBox(farmThumbSrc(p, file), "sm", () => farmNoPic.add(key));
}

const FARM_ACT = { clear: ["hand", "farm.clear", "primary"], continue: ["play", "farm.continue", "primary"], estop: ["stop", "act.estop", "stop"],
  push: ["push", "act.push_now", "primary"],
  bin_empty: ["tray", "bin.empty", "primary"], print: ["file", "farm.print", "primary"], pause: ["pause", "farm.pause", ""],
  resume: ["play", "farm.resume", "primary"], cancel: ["bad", "farm.cancel", "stop"] };
// while the bed cools, "clear" stops the cooling: the parts go by hand
function farmActLabel(p, a) { return a === "clear" && p.phase === "ejecting" ? "act.bg_take" : FARM_ACT[a][1]; }

// the spool on a farm printer: its colour, its filament and the grams left
function farmSpoolChip(p, short) {
  const s = p.spool;
  if (!s || p.phase === "offline") return null;
  const low = M.farmSpoolLow(s);
  return h("span", { class: "chip" + (low ? " warn" : ""), title: s.name + (s.id ? " · #" + s.id : "") + (low ? " · " + t("farm.spool_low") : "") },
    h("i", { class: "spool-dot", style: { background: s.colour || "transparent" } }),
    short ? null : h("span", { dir: "auto", text: s.name }),
    h("b", { class: "ltr", text: s.left === null ? "?" : num(s.left, 0) + " g" }));
}

// What the farm made: today, the last 7 or 30 days, from each printer's history.
function loadFarmReport(period) {
  const r = farmUi.report;
  if (period) r.period = period;
  r.loading = true;
  refresh("farm");
  farmCall("/report?period=" + r.period).then((d) => { r.data = d; r.at = Date.now(); }, (e) => toast(cleanError(e.message), "bad"))
    .then(() => { r.loading = false; refresh("farm"); });
}
function farmReportCard() {
  const r = farmUi.report;
  if (!r.data && !r.loading) setTimeout(() => loadFarmReport(), 0);
  const d = r.data && r.data.period === r.period ? r.data : null;
  const cols = ["printer", "jobs", "ok", "stopped", "rate", "hours", "grams"];
  const kg = (g) => g >= 1000 ? num(g / 1000, 2) + " kg" : num(g, 0) + " g";
  const cells = (x) => [x.jobs, x.ok, x.stopped, x.rate === null || x.rate === undefined ? "—" : num(x.rate, 0) + " %", num(x.hours, 1) + " h", kg(x.grams || 0)];
  const csv = () => {
    const labels = [t("prod.col.printer"), t("farm.group"), t("prod.col.jobs"), t("prod.col.ok"), t("prod.col.stopped"), t("prod.col.rate"), t("prod.col.hours"), t("prod.col.grams")];
    const a = h("a", { href: URL.createObjectURL(new Blob(["\ufeff" + M.farmReportCsv(d, labels)], { type: "text/csv" })),
      download: "farm-production-" + r.period + "-" + new Date().toISOString().slice(0, 10) + ".csv" });
    document.body.appendChild(a); a.click(); a.remove();
  };
  return h("section", { class: "card", style: { marginTop: "16px" } },
    h("h2", null, icon("activity"), t("prod.title"),
      h("span", { class: "right" }, d ? h("button", { type: "button", class: "btn sm", onclick: csv }, icon("download"), t("prod.csv")) : null)),
    h("div", { class: "seg", role: "tablist" }, ["today", "7", "30"].map((k) =>
      h("button", { type: "button", role: "tab", class: "seg-btn" + (r.period === k ? " active" : ""), "aria-selected": r.period === k ? "true" : "false",
        onclick: () => loadFarmReport(k) }, t("prod.period." + k)))),
    !d ? h("div", { class: "empty" }, h("span", { class: "spinner" }))
      : h("div", { class: "fleet prod" }, h("div", { class: "fleet-in prod-in" },
        h("div", { class: "fleet-row fleet-head" }, cols.map((c) => h("span", { text: t("prod.col." + c) }))),
        d.printers.map((x) => h("div", { class: "fleet-row" },
          h("div", { class: "fleet-name" }, h("b", { dir: "auto", text: x.name }), x.group ? h("span", { class: "muted", dir: "auto", text: x.group }) : null),
          ...(x.error ? [h("span", { class: "muted prod-na", text: t("farm.phase.offline") })]
            : cells(x).map((v, i) => h("span", { class: "prod-c" + (i === 2 && x.stopped ? " fleet-new" : ""), "data-label": t("prod.col." + cols[i + 1]) },
              h("span", { class: "ltr", text: String(v) })))))),
        h("div", { class: "fleet-row prod-total" }, h("b", { text: t("prod.total") }),
          ...cells(d.total).map((v, i) => h("b", { class: "prod-c", "data-label": t("prod.col." + cols[i + 1]) }, h("span", { class: "ltr", text: String(v) })))))),
    d ? h("p", { class: "muted", style: { marginTop: "10px", fontSize: "var(--text-sm)" }, text: t("prod.note") }) : null);
}

function farmSelBox(p) {
  return h("label", { class: "fsel", title: t("farm.select", { name: p.name }) },
    h("input", { type: "checkbox", checked: farmUi.sel.has(p.id), "aria-label": t("farm.select", { name: p.name }),
      onchange: (e) => { if (e.target.checked) farmUi.sel.add(p.id); else farmUi.sel.delete(p.id); refresh("farm"); } }));
}
function farmSelAll(printers, label) {
  const all = printers.length > 0 && printers.every((p) => farmUi.sel.has(p.id));
  return h("label", { class: "fsel" + (label ? " fsel-all" : ""), title: label || t("farm.select_group") },
    h("input", { type: "checkbox", checked: all, "aria-label": label || t("farm.select_group"),
      onchange: () => { printers.forEach((p) => (all ? farmUi.sel.delete(p.id) : farmUi.sel.add(p.id))); refresh("farm"); } }),
    label ? h("span", { text: label }) : null);
}

// One command for the selected printers: only those it can be done on now.
const BULK_UI = { clear: ["hand", "farm.clear", "primary"], continue: ["play", "farm.continue", "primary"], push: ["push", "act.push_now", "primary"],
  pause: ["pause", "farm.pause", ""], resume: ["play", "farm.resume", ""], send: ["file", "farm.bulk_send", ""], queue: ["queue", "fq.title", ""],
  power_on: ["power", "farm.bulk_on", ""], power_off: ["power", "farm.bulk_off", ""], settings: ["copy", "farm.copy", ""], labels: ["qr", "farm.qr_labels", ""],
  cancel: ["bad", "farm.cancel", "stop"], estop: ["stop", "act.estop", "stop"] };
function farmBulkBar(all) {
  for (const id of Array.from(farmUi.sel)) if (!all.some((p) => p.id === id)) farmUi.sel.delete(id);
  if (!farmUi.sel.size) return null;
  const bulk = M.farmBulk(all, Array.from(farmUi.sel));
  return h("div", { class: "bulk-bar", role: "region", "aria-label": t("farm.bulk") },
    h("b", { class: "bulk-n", text: t("farm.selected", { n: num(farmUi.sel.size, 0) }) }),
    h("div", { class: "bulk-acts" }, M.FARM_BULK.filter((a) => bulk.actions[a].length).map((a) =>
      h("button", { type: "button", class: "btn sm " + BULK_UI[a][2], onclick: () => farmBulkRun(a, bulk) },
        icon(BULK_UI[a][0]), t(BULK_UI[a][1], { dev: "" }).trim() + " (" + num(bulk.actions[a].length, 0) + ")"))),
    h("button", { type: "button", class: "icon-btn", title: t("farm.bulk_none"), "aria-label": t("farm.bulk_none"),
      onclick: () => { farmUi.sel.clear(); refresh("farm"); } }, icon("close")));
}
function farmBulkOne(p, action) {
  if (action === "power_on" || action === "power_off") {
    const want = action === "power_on" ? "on" : "off";
    return (p.power || []).filter((d) => (d.status === "on") !== (want === "on"))
      .reduce((pr, d) => pr.then(() => farmCall("/" + p.id + "/power", { device: d.device, action: want })), Promise.resolve());
  }
  return farmCall("/" + p.id + "/" + action, {});
}
function farmBulkRun(action, bulk) {
  const ok = bulk.actions[action];
  const left = bulk.selected.filter((p) => !ok.includes(p));
  if (action === "send") return farmBulkSend(ok, left);
  if (action === "queue") return queueAdd(ok);
  if (action === "labels") return qrDialog(ok);
  if (action === "settings") return copySettings(ok);
  const label = t(BULK_UI[action][1], { dev: "" }).trim();
  const names = (list) => list.map((p) => p.name).join(lang === "ar" ? "، " : ", ");
  const body = t("farm.bulk_confirm", { what: label, n: num(ok.length, 0), names: names(ok) }) +
    (left.length ? " " + t("farm.bulk_left", { n: num(left.length, 0), names: names(left) }) : "");
  const danger = ["cancel", "estop", "power_off"].includes(action);
  confirm(label, body, label + " (" + num(ok.length, 0) + ")", danger ? "danger" : "primary").then((yes) => {
    if (!yes) return;
    Promise.all(ok.map((p) => farmBulkOne(p, action).then(() => null, (e) => p.name + ": " + cleanError(e.message)))).then((errs) => {
      errs = errs.filter(Boolean);
      toast(errs.length ? t("farm.bulk_partly", { n: num(ok.length - errs.length, 0), errors: errs.join("; ") }) : t("farm.bulk_done", { n: num(ok.length, 0) }), errs.length ? "bad" : "ok");
      setTimeout(loadFarm, 800);
    });
  });
}
// one file to every free printer selected, one after another, and print it if asked
function farmBulkSend(targets, left) {
  const picker = h("input", { type: "file", accept: ".gcode,.g,.gco,.bgcode", style: { display: "none" } });
  const st = {};
  const ui = { file: null, running: false, done: false };
  const close = () => { if (!ui.running) closeModal("bulksend"); };
  const run = (andPrint) => {
    ui.running = true;
    draw();
    targets.reduce((pr, p) => pr.then(() => {
      st[p.id] = 0;
      draw();
      return uploadToFarm(p, ui.file, andPrint, (v) => { st[p.id] = v; draw(); })
        .then(() => { st[p.id] = "done"; draw(); }, (e) => { st[p.id] = cleanError(e.message); draw(); });
    }), Promise.resolve()).then(() => { ui.running = false; ui.done = true; draw(); setTimeout(loadFarm, 900); });
  };
  const ask = (andPrint) => andPrint
    ? confirm(t("farm.upload_print"), t("farm.bulk_print_confirm", { file: ui.file.name, n: num(targets.length, 0) }), t("farm.upload_print")).then((y) => { if (y) run(true); })
    : run(false);
  function draw() {
    const rows = targets.map((p) => {
      const v = st[p.id];
      const state = v === undefined ? h("span", { class: "muted", text: t("farm.bulk_waiting") })
        : v === "done" ? h("span", { class: "fleet-ok", text: t("farm.bulk_sent") })
        : typeof v === "number" ? h("div", { class: "progress", style: { width: "120px" } }, h("i", { style: { width: num(v * 100, 1) + "%" } }))
        : h("span", { class: "fleet-new", title: v, text: t("upd.farm_failed") });
      return h("div", { class: "row" }, h("div", { class: "grow" }, h("div", { class: "name", dir: "auto", text: p.name })), state);
    });
    const body = h("div", null,
      h("p", { class: "muted", text: t("farm.bulk_send_intro", { n: num(targets.length, 0) }) }),
      left.length ? h("p", { class: "note" }, icon("info"), h("span", { text: t("farm.bulk_send_left", { n: num(left.length, 0) }) })) : null,
      h("div", { class: "toolbar", style: { margin: "10px 0" } },
        h("button", { type: "button", class: "btn", disabled: ui.running || ui.done, onclick: () => picker.click() }, icon("file"), t("farm.choose_file")),
        ui.file ? h("span", { class: "ltr muted", text: ui.file.name + " · " + fmtSize(ui.file.size) }) : null),
      h("div", { class: "list" }, rows),
      picker);
    modal("bulksend", t("farm.bulk_send_title"), body, [
      h("button", { type: "button", class: "btn", disabled: ui.running, onclick: close, text: t("c.close") }),
      ui.file && !ui.running && !ui.done ? h("button", { type: "button", class: "btn", onclick: () => ask(false) }, icon("download"), t("farm.upload")) : null,
      ui.file && !ui.running && !ui.done ? h("button", { type: "button", class: "btn primary", onclick: () => ask(true) }, icon("play"), t("farm.upload_print")) : null
    ], close);
  }
  picker.addEventListener("change", () => { ui.file = picker.files[0] || null; draw(); });
  draw();
}

// The list: one line for each printer, for farms too big for cards.
function farmRow(p) {
  const file = farmFile(p);
  const pct = ["printing", "paused"].includes(p.phase) ? (p.progress || 0) * 100 : null;
  const link = M.farmLink(p, location.hostname);
  const bed = typeof p.bed === "number" && p.phase !== "offline" ? num(p.bed, 0) + (p.bed_target ? " / " + num(p.bed_target, 0) : "") + " °C" : "";
  return h("div", { class: "frow" + (farmUi.sel.has(p.id) ? " picked" : ""), "data-state": p.phase },
    farmSelBox(p),
    h("span", { class: "frow-ic" }, icon(FARM_ICON[p.phase] || "info")),
    h("div", { class: "frow-name" }, h("b", { dir: "auto", text: p.name }),
      p.local ? h("span", { class: "badge accent", text: t("farm.this") }) : h("span", { class: "muted ltr", text: p.host })),
    h("div", { class: "frow-state" }, h("b", { text: t("farm.phase." + p.phase) }), h("span", { class: "muted", dir: "auto", text: farmLine(p) })),
    h("div", { class: "frow-job" }, file ? h("span", { class: "ltr", title: file, text: file }) : h("span", { class: "muted", text: "—" }),
      pct !== null ? h("div", { class: "progress" }, h("i", { style: { width: num(pct, 1) + "%" } })) : null),
    h("div", { class: "frow-facts" },
      bed ? h("span", { class: "chip" }, icon("thermo"), h("b", { class: "ltr", text: bed })) : null,
      p.jobs ? h("span", { class: "chip" }, icon("queue"), h("b", { text: num(p.jobs, 0) })) : null,
      farmSpoolChip(p, true)),
    h("div", { class: "frow-acts" },
      M.farmActions(p).slice(0, 2).map((a) => h("button", { type: "button", class: "btn sm " + FARM_ACT[a][2], onclick: () => farmAct(p, a) },
        icon(FARM_ACT[a][0]), t(farmActLabel(p, a)))),
      p.camera && p.phase !== "offline" ? h("button", { type: "button", class: "icon-btn", title: t("farm.cam_open"), "aria-label": t("farm.cam_open"),
        onclick: () => camViewer(p) }, icon("camera")) : null,
      p.local ? h("a", { class: "icon-btn", href: "#/overview", title: t("farm.open"), "aria-label": t("farm.open") }, icon("home"))
        : link ? h("a", { class: "icon-btn", href: link, target: "_blank", rel: "noopener", title: t("farm.open"), "aria-label": t("farm.open") }, icon("external")) : null,
      h("button", { type: "button", class: "icon-btn", title: t("farm.edit"), "aria-label": t("farm.edit"), onclick: () => editPrinter(p) }, icon("edit"))));
}

function farmCard(p) {
  const ACT = FARM_ACT;
  const file = farmFile(p);
  const bed = typeof p.bed === "number" ? num(p.bed, 0) + (p.bed_target ? " / " + num(p.bed_target, 0) : "") + " °C" : "";
  const link = M.farmLink(p, location.hostname);
  const prog = ["printing", "paused"].includes(p.phase) ? h("div", { class: "progress" }, h("i", { style: { width: num((p.progress || 0) * 100, 1) + "%" } })) : null;
  const open = p.local ? h("a", { class: "btn sm", href: "#/overview" }, icon("home"), t("farm.open"))
    : link ? h("a", { class: "btn sm", href: link, target: "_blank", rel: "noopener" }, icon("external"), t("farm.open"))
    : p.page ? h("span", { class: "btn sm disabled", title: t("farm.open_local"), "aria-disabled": "true" }, icon("external"), t("farm.open_local_short")) : null;
  return h("section", { class: "card fcard" + (farmUi.sel.has(p.id) ? " picked" : ""), "data-state": p.phase },
    h("div", { class: "fc-top" },
      farmSelBox(p),
      h("div", { class: "fc-ic" }, icon(FARM_ICON[p.phase] || "info")),
      h("div", { class: "grow", style: { minWidth: 0 } },
        h("div", { class: "fc-name", dir: "auto", text: p.name }),
        h("div", { class: "fc-host" }, p.local ? h("span", { class: "badge accent", text: t("farm.this") }) : h("span", { class: "ltr", text: p.host }),
          p.auto_eject ? h("span", { class: "badge", text: t("farm.auto_eject") }) : null)),
      h("button", { type: "button", class: "icon-btn", title: t("farm.edit"), "aria-label": t("farm.edit"), onclick: () => editPrinter(p) }, icon("edit"))),
    h("div", { class: "fc-state" }, h("b", { text: t("farm.phase." + p.phase) }), h("span", { dir: "auto", text: farmLine(p) })),
    file ? h("div", { class: "fc-job" }, farmThumb(p, file),
      h("div", { class: "grow" }, h("div", { class: "fc-file ltr", title: file, text: file }), prog)) : prog,
    p.camera && p.phase !== "offline" ? h("img", { class: "fc-cam", alt: t("remote.camera"), title: t("farm.cam_open"), "data-live": "farmcam", "data-id": p.id,
      src: farm.cam[p.id] || farmCam(p.id), onclick: () => camViewer(p) }) : null,
    p.phase !== "offline" ? h("div", { class: "chips" },
      bed ? h("span", { class: "chip" }, icon("thermo"), h("span", { text: t("c.bed") }), h("b", { class: "ltr", text: bed })) : null,
      p.jobs ? h("span", { class: "chip" }, icon("queue"), h("span", { text: t("facts.queue") + ":" }), h("b", { text: num(p.jobs, 0) })) : null,
      farmSpoolChip(p),
      M.farmService(p) ? h("span", { class: "chip" + (M.farmService(p).due ? " bad" : M.farmService(p).near ? " warn" : ""),
        title: t(M.farmService(p).due ? "farm.service_due" : "farm.service_chip_title") }, icon("wand"),
        h("span", { text: t("farm.service_chip") + ":" }), h("b", { class: "ltr", text: num(p.service_since, 0) + " / " + num(p.service_every, 0) + " h" })) : null,
      p.bin_cap ? h("span", { class: "chip" + (p.bin >= p.bin_cap ? " bad" : p.bin >= Math.ceil(p.bin_cap * 0.8) ? " warn" : "") }, icon("tray"),
        h("span", { text: t("bin.chip") + ":" }), h("b", { text: num(p.bin || 0, 0) + " / " + num(p.bin_cap, 0) })) : null) : null,
    p.phase !== "offline" ? farmStatsLine(p) : null,
    h("div", { class: "fc-acts" }, M.farmActions(p).map((a) => h("button", { type: "button", class: "btn sm " + ACT[a][2], onclick: () => farmAct(p, a) }, icon(ACT[a][0]), t(farmActLabel(p, a)))),
      // never offered while it prints: the farm would refuse it anyway
      (["printing", "paused", "ejecting"].includes(p.phase) ? [] : p.power || []).map((d) => h("button", { type: "button", class: "btn sm" + (d.status === "on" ? " power-on" : p.phase === "off" ? " primary" : ""),
        title: d.device, onclick: () => farmPower(p, d) }, icon("power"), t(d.status === "on" ? "farm.turn_off" : "farm.turn_on", { dev: d.device }))),
      open));
}

function farmSetupCard() {
  return h("section", { class: "card" },
    h("h2", null, icon("farm"), t("farm.setup_title")),
    h("p", { text: t("farm.setup") }),
    h("div", { class: "codeblock", text: "~/klipper-auto-eject/install.sh --farm" }),
    h("p", { class: "note", style: { marginTop: "12px" } }, icon("info"), h("span", { text: t("farm.setup_note") })),
    h("div", { class: "toolbar", style: { marginTop: "14px" } },
      h("a", { class: "btn", href: DOCS + "/blob/main/docs/farm.md", target: "_blank", rel: "noopener" }, icon("external"), t("farm.docs"))));
}

function viewFarm() {
  if (!farmShown()) {
    if (farm.available === null) return { el: h("div", null, head("farm.title"), h("div", { class: "card empty" }, h("span", { class: "spinner" }))) };
    return { el: h("div", null, head("farm.title", "farm.intro"), farmSetupCard()) };
  }
  const all = M.farmOrder(farm.data.printers || []);
  const c = M.farmCounts(all);
  if (farmUi.filter !== "all" && !c[farmUi.filter]) farmUi.filter = "all";      // nothing left under it
  const list = M.farmFilter(all, farmUi.filter, farmUi.search);
  // many printers: a line each; a few: cards
  const asList = farmUi.view === "list" || (farmUi.view !== "cards" && all.length > 12);
  const items = (printers) => asList ? h("div", { class: "frows" }, h("div", { class: "frows-in" }, printers.map(farmRow))) : h("div", { class: "farm-grid" }, printers.map(farmCard));
  const groups = M.farmGroups(list);
  const body = !list.length ? h("div", { class: "card empty" }, icon("search"), h("p", { text: t("farm.none_match") }))
    : groups.length > 1 || groups[0].group ? h("div", { class: "stack" }, groups.map((g) => h("section", { class: "farm-group" },
      h("h2", { class: "farm-group-h" }, farmSelAll(g.printers), icon("layers"), h("span", { dir: "auto", text: g.group || t("farm.no_group") }),
        h("span", { class: "muted", text: num(g.printers.length, 0) })), items(g.printers))))
    : items(list);
  const tools = all.length > 1 ? h("div", { class: "farm-tools" },
    h("div", { class: "seg farm-filter", role: "tablist" }, ["all", "needs", "printing", "idle", "off", "offline"].filter((k) => k === "all" || c[k]).map((k) =>
      h("button", { type: "button", role: "tab", class: "seg-btn" + (farmUi.filter === k ? " active" : "") + (k === "needs" ? " needs" : ""),
        "aria-selected": farmUi.filter === k ? "true" : "false", onclick: () => { farmUi.filter = k; refresh("farm"); } },
        h("span", { text: t("farm.filter." + k) }), h("b", { text: num(k === "all" ? all.length : c[k], 0) })))),
    list.length ? farmSelAll(list, t("farm.select_all")) : null,
    h("div", { class: "search farm-search" }, icon("search"),
      h("input", { class: "input", type: "search", placeholder: t("farm.search_ph"), "aria-label": t("farm.search_ph"), value: farmUi.search, "data-keep": "f-search",
        oninput: (e) => { farmUi.search = e.target.value; refresh("farm"); } })),
    wakeSupported() ? h("button", { type: "button", class: "icon-btn wake-btn" + (wake.on ? " on" : ""), "aria-pressed": wake.on ? "true" : "false",
      title: t("c.wake"), "aria-label": t("c.wake"), onclick: wakeToggle }, icon("sun")) : null,
    h("div", { class: "seg", role: "group", "aria-label": t("farm.view.title") }, [["cards", "overview"], ["list", "queue"]].map(([v, ic]) =>
      h("button", { type: "button", class: "seg-btn" + (asList === (v === "list") ? " active" : ""), title: t("farm.view." + v), "aria-label": t("farm.view." + v),
        onclick: () => { farmUi.view = v; store("ae.farmView", v); refresh("farm"); } }, icon(ic))))) : null;
  const el = h("div", null,
    head("farm.title", "farm.intro", h("button", { type: "button", class: "btn primary", onclick: openScan }, icon("search"), t("farm.search"))),
    tools,
    h("div", { class: "farm-sum" }, farmTodayLine(all)),
    body,
    farmBulkBar(all),
    farmQueueCard(all),
    all.length > 1 ? farmReportCard() : null,
    all.length < 2 ? h("section", { class: "card", style: { marginTop: "16px" } },
      h("p", { class: "note" }, icon("search"), h("span", { text: t("farm.first") })),
      h("div", { class: "toolbar", style: { marginTop: "12px" } }, h("button", { type: "button", class: "btn primary", onclick: openScan }, icon("search"), t("farm.search")))) : null,
    h("div", { class: "farm-foot" },
      h("p", { class: "note" }, icon("info"), h("span", { text: t("farm.notify_note") })),
      h("label", { class: "field farm-report" }, h("span", { text: t("farm.report") }), reportSelect())));
  return { el };
}
viewFarm.sig = function () {
  if (!farmShown()) return String(farm.available);
  const report = ((farm.data.settings || {}).report || "") + "|" + farmUi.filter + "|" + farmUi.search + "|" + farmUi.view + "|" + wake.on + "|" +
    Array.from(farmUi.sel).join(",") + "|" + farmUi.report.period + farmUi.report.loading + farmUi.report.at + "|";
  return report + JSON.stringify(farm.data.printers.map((p) => [p.id, p.name, p.group, p.phase, p.reason, p.filename, Math.round((p.progress || 0) * 100),
    p.eta === null || p.eta === undefined ? null : Math.round(p.eta / 60), p.layer, Math.round(p.bed || 0), p.bed_target, p.jobs, p.queue,
    p.parts, p.leftover, p.camera, p.message, p.page, p.page_remote, p.auto_eject, p.service_every, p.service_since, p.stats, p.bin, p.bin_cap, p.power, p.auto_off, p.auto_off_device,
    p.spool]) + JSON.stringify(farm.data.queue || null));
};

function closeModal(cls) {
  const old = $("#modal-root").querySelector(".modal-back." + cls);
  if (old) old.remove();
}

// A dialog; drawn again in place (no new fade-in) when it is already open.
function modal(cls, title, body, footer, onClose) {
  const box = h("div", { class: "modal", role: "dialog", "aria-modal": "true" },
    h("header", null, h("h3", { text: title }),
      h("button", { type: "button", class: "icon-btn", "aria-label": t("c.close"), onclick: onClose }, icon("bad"))),
    h("div", { class: "body" }, body),
    footer ? h("footer", null, footer) : null);
  const old = $("#modal-root").querySelector(".modal-back." + cls);
  if (old) {
    const scrolled = captureScroll(old.firstChild);
    old.firstChild.replaceChildren(...Array.from(box.childNodes));
    restoreScroll(old.firstChild, scrolled);
    old.onClose = onClose;
    return old;
  }
  const root = h("div", { class: "modal-back " + cls, onclick: (e) => { if (e.target === root) root.onClose(); } }, box);
  root.onClose = onClose;
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") root.onClose(); });
  $("#modal-root").appendChild(root);
  return root;
}

// ----- search the network, add what it finds
function openScan() {
  farm.scanOpen = true;
  farm.scanWait = true;
  farm.pick = null;
  farm.scanSig = "";
  renderScan();
  farmCall("/scan", {}).then(() => loadFarm()).catch((e) => toast(cleanError(e.message), "bad"))
    .then(() => { farm.scanWait = false; renderScan(); });
}

function addPrinters(entries, done, skip) {
  return farmCall("/printers", skip && skip.length ? { add: entries, skip } : { add: entries }).then((r) => {
    toast(t("farm.added", { n: num((r.added || []).length, 0) }), "ok");
    if (done) done();
    loadFarm();
  }).catch((e) => toast(cleanError(e.message), "bad"));
}

function renderScan() {
  if (!farm.scanOpen) return closeModal("scan");
  const sc = (farm.data && farm.data.scan) || { running: true, found: [] };
  const running = farm.scanWait || sc.running;
  const sig = JSON.stringify([running, sc.found, lang]);
  if (sig === farm.scanSig) return;
  farm.scanSig = sig;
  const close = () => { farm.scanOpen = false; closeModal("scan"); };
  // the ones left out last time come last, unticked
  const found = running ? [] : (sc.found || []).slice().sort((a, b) => (a.skipped ? 1 : 0) - (b.skipped ? 1 : 0));
  if (!running && farm.pick === null) farm.pick = new Set(found.filter((f) => !f.skipped).map((f) => f.host + ":" + f.port));
  const pick = farm.pick || new Set();
  const addr = h("input", { class: "input ltr", type: "text", placeholder: "192.168.1.50", autocomplete: "off", spellcheck: "false", style: { flex: "1 1 160px", minWidth: 0 } });
  const addOne = () => { const v = addr.value.trim(); if (v) addPrinters([{ host: v }], close); };
  addr.addEventListener("keydown", (e) => { if (e.key === "Enter") addOne(); });
  const body = h("div", null,
    running ? h("div", { class: "scan-wait" }, h("span", { class: "spinner" }), h("div", null, h("b", { text: t("farm.searching") }), h("p", { class: "muted", text: t("farm.search_note") })))
      : found.length ? h("div", null, h("p", { text: t("farm.found", { n: num(found.length, 0) }) }),
        h("div", { class: "list scan-list" }, found.map((f) => {
          const key = f.host + ":" + f.port;
          return h("label", { class: "row switch-row" },
            h("input", { type: "checkbox", checked: pick.has(key), onchange: (e) => { if (e.target.checked) pick.add(key); else pick.delete(key); farm.scanSig = ""; renderScan(); } }),
            h("div", { class: "grow" }, h("div", { class: "name", dir: "auto", text: f.name }),
              h("div", { class: "sub" }, h("span", { class: "ltr", text: f.host + (f.port !== 7125 ? ":" + f.port : "") }),
                f.skipped ? h("span", { text: " · " + t("farm.skipped") }) : null)),
            f.klippy && f.klippy !== "ready" ? h("span", { class: "badge warn", text: f.klippy }) : null);
        })))
      : h("p", { class: "note" }, icon("info"), h("span", { text: t("farm.found_none") })),
    h("h3", { class: "sub-head", text: t("farm.add_by_address") }),
    h("div", { class: "form-row", style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, addr,
      h("button", { type: "button", class: "btn", onclick: addOne }, icon("plus"), t("farm.add"))),
    h("p", { class: "muted", style: { fontSize: "12.5px", marginTop: "6px" }, text: t("farm.address_note") }));
  const chosen = found.filter((f) => pick.has(f.host + ":" + f.port));
  const left = found.filter((f) => !pick.has(f.host + ":" + f.port));
  modal("scan", t("farm.search"), body, [
    h("button", { type: "button", class: "btn", onclick: close, text: t("c.close") }),
    running ? null : h("button", { type: "button", class: "btn", onclick: openScan }, icon("restart"), t("farm.again")),
    chosen.length ? h("button", { type: "button", class: "btn primary", onclick: () => addPrinters(chosen, close, left) }, icon("plus"), t("farm.add_n", { n: num(chosen.length, 0) })) : null
  ], close);
}

// ----- print one of a printer's files, or send it one from this device
function printDialog(p) {
  const ui = { files: null, error: "", filter: "", busy: false, progress: null, meta: {} };
  const close = () => closeModal("printd");
  // each file's facts and whether it has a picture, once its row is seen
  const metaKey = (path) => { const f = (ui.files || []).find((x) => x.path === path) || {}; return path + "|" + f.modified; };
  const loadMeta = (path) => {
    const k = metaKey(path);
    if (ui.meta[k]) return Promise.resolve(ui.meta[k]);
    return farmCall("/" + p.id + "/meta?file=" + encodeURIComponent(path)).then((r) => (ui.meta[k] = r.meta || {}), () => (ui.meta[k] = {}));
  };
  const picOf = (f, m) => (m.thumbs ? farmThumbSrc(p, f.path, f.modified) : "");
  const start = (file) => confirm(t("farm.print"), t("farm.print_confirm", { name: p.name, file }), t("farm.print")).then((ok) => {
    if (!ok) return;
    farmCall("/" + p.id + "/print", { filename: file })
      .then(() => { toast(t("farm.print_started", { name: p.name }), "ok"); close(); setTimeout(loadFarm, 900); })
      .catch((e) => toast(cleanError(e.message), "bad"));
  });
  const picker = h("input", { type: "file", accept: ".gcode,.g,.gco,.bgcode", style: { display: "none" } });
  const send = (andPrint) => {
    const f = picker.files && picker.files[0];
    if (!f) return;
    const go = () => {
      ui.busy = true;
      ui.progress = 0;
      draw();
      uploadToFarm(p, f, andPrint, (v) => { ui.progress = v; draw(); }).then(() => {
        toast(t(andPrint ? "farm.print_started" : "farm.uploaded", { name: p.name, file: f.name }), "ok");
        if (andPrint) { close(); setTimeout(loadFarm, 900); return; }
        ui.busy = false; ui.progress = null; ui.files = null; picker.value = ""; load();
      }).catch((e) => { ui.busy = false; ui.progress = null; draw(); toast(cleanError(e.message), "bad"); });
    };
    if (andPrint) confirm(t("farm.print"), t("farm.print_confirm", { name: p.name, file: f.name }), t("farm.print")).then((ok) => { if (ok) go(); });
    else go();
  };
  picker.addEventListener("change", draw);
  function load() {
    farmCall("/" + p.id + "/files").then((r) => { ui.files = r.files || []; draw(); })
      .catch((e) => { ui.error = cleanError(e.message); draw(); });
  }
  function draw() {
    const q = ui.filter.toLowerCase();
    const files = (ui.files || []).filter((f) => !q || f.path.toLowerCase().includes(q)).slice(0, 60);
    const watch = lazyRows(loadMeta, (el, m) => fillFileRow(el, m, picOf((ui.files || []).find((x) => x.path === el.dataset.file) || { path: el.dataset.file }, m)));
    const search = h("input", { class: "input", type: "search", placeholder: t("check.search"), "aria-label": t("check.search"), value: ui.filter, "data-keep": "pd-search" });
    search.addEventListener("input", () => { ui.filter = search.value; draw(); const s = $(".modal-back.printd input[type=search]"); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } });
    const chosen = picker.files && picker.files[0];
    const body = h("div", null,
      h("p", { class: "muted", text: t("farm.print_intro", { name: p.name }) }),
      search,
      ui.error ? h("p", { class: "note", style: { marginTop: "10px" } }, icon("alert"), h("span", { text: ui.error }))
        : ui.files === null ? h("div", { class: "empty" }, h("span", { class: "spinner" }))
        : files.length ? h("div", { class: "list scan-list" }, files.map((f) => {
            const m = ui.meta[metaKey(f.path)];
            const row = fileRow(f, m, m ? picOf(f, m) : null, () => start(f.path));
            row.appendChild(icon("play"));
            if (!m) watch(row);
            return row;
          }))
        : h("p", { class: "note", style: { marginTop: "10px" } }, icon("info"), h("span", { text: t("farm.no_files") })),
      h("h3", { class: "sub-head", text: t("farm.upload_title") }),
      h("div", { class: "toolbar" },
        h("button", { type: "button", class: "btn", disabled: ui.busy, onclick: () => picker.click() }, icon("file"), t("farm.choose_file")),
        chosen ? h("span", { class: "ltr muted", text: chosen.name + " · " + fmtSize(chosen.size) }) : null),
      ui.progress !== null ? h("div", { class: "progress", style: { marginTop: "10px" } }, h("i", { style: { width: num(ui.progress * 100, 1) + "%" } })) : null,
      chosen && !ui.busy ? h("div", { class: "toolbar", style: { marginTop: "10px" } },
        h("button", { type: "button", class: "btn", onclick: () => send(false) }, icon("download"), t("farm.upload")),
        h("button", { type: "button", class: "btn primary", onclick: () => send(true) }, icon("play"), t("farm.upload_print"))) : null,
      picker);
    modal("printd", t("farm.print_on", { name: p.name }), body, [h("button", { type: "button", class: "btn", onclick: close, text: t("c.close") })], close);
  }
  draw();
  load();
}

// The file goes through the farm printer (it reaches the others), with progress.
function uploadToFarm(p, file, andPrint, onProgress) {
  if (DEMO) return client.farm("/" + p.id + "/upload", { name: file.name, print: andPrint, size: file.size }).then((r) => { onProgress(1); return r; });
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", FARM_API + "/" + encodeURIComponent(p.id) + "/upload?name=" + encodeURIComponent(file.name) + "&print=" + (andPrint ? 1 : 0));
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      let j = {};
      try { j = JSON.parse(x.responseText || "{}"); } catch (e) { /* not JSON */ }
      if (x.status >= 200 && x.status < 300) resolve(j); else reject(new Error(j.error || "HTTP " + x.status));
    };
    x.onerror = () => reject(new Error(t("farm.upload_failed")));
    x.send(file);
  });
}

export { closeModal, farm, FARM_API, farmCall, farmCamTick, farmNeeds, farmShown, loadFarm, modal, viewFarm };
