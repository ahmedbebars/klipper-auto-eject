/* klipper-auto-eject web page. Activity, How it works, the report for a GitHub issue, and Updates.
 */

import {
  $, aeState, app, client, DEMO, DOCS, fmtDate, h, head, icon, iso, lang, M, num, probe, settings, store, t
} from "./core.js";
import { cleanError, confirm, refresh, route, toast } from "../app.js";
import { codeCopy, copyText } from "./setup.js";
import { farm, farmCall, farmShown, loadFarm } from "./farm.js";
import { boardName, hwParts } from "./hardware.js";

/* =========================================================== activity */

const activityUi = { only: true };

function isAe(text) { return /auto[_ -]?eject|probe: at|action:prompt/i.test(text); }

function viewActivity() {
  const lines = app.log.filter((l) => !activityUi.only || isAe(l.text)).filter((l) => !/action:prompt/.test(l.text)).slice(-400).reverse();
  const toggle = h("label", { class: "switch" },
    h("input", { type: "checkbox", checked: activityUi.only, onchange: (e) => { activityUi.only = e.target.checked; refresh("activity"); } }),
    h("span", { text: t("activity.only") }));
  const el = h("div", null, head("activity.title", null, h("div", { class: "toolbar" }, toggle, reportButton())),
    h("section", { class: "card", style: { padding: 0 } },
      lines.length ? h("div", { class: "log" }, lines.map((l) => {
        const cls = l.text.startsWith("!!") ? "err" : l.text.startsWith("$") || l.type === "command" ? "cmd" : /AUTO_EJECT/.test(l.text) ? "ae" : "";
        return h("div", { class: "ln " + cls }, h("time", { text: new Date(l.time * 1000).toLocaleTimeString([], { hour12: false }) }),
          h("span", { class: "msg", text: l.text.replace(/^\/\/\s?/, "") }));
      })) : h("div", { class: "empty" }, icon("activity"), h("p", { text: t("activity.empty") }))));
  return { el };
}
viewActivity.sig = function () { return app.log.length + "|" + activityUi.only + "|" + (app.log.length ? app.log[app.log.length - 1].time : 0); };

/* ============================================================== guide */

function viewGuide() {
  const steps = [["0-welcome", "s0"], ["1-direction", "s1"], ["2a-clear-bed", "s2a"], ["2b-block", "s2b"], ["2c-result", "s2c"],
    ["3-width", "s3"], ["4-edge", "s4"], ["5-save", "s5"], ["6-first-eject", "s6"]];
  const el = h("div", null,
    head("guide.title", "guide.intro", h("a", { class: "btn", href: DOCS + "#readme", target: "_blank", rel: "noopener" }, icon("external"), t("guide.docs"))),
    h("section", { class: "card guide-hero" }, h("img", { src: "../docs/images/how-it-works.svg", alt: t("guide.title"), loading: "lazy" }),
      h("p", { class: "note", style: { marginTop: "14px" } }, icon("info"), h("span", null, t("guide.slicer"))),
      h("div", { class: "codeblock", text: "PRINT_END\nAUTO_EJECT HEIGHT=[max_layer_z] HOME=1" })),
    h("section", { class: "card" }, h("h2", null, icon("wand"), t("guide.steps")),
      h("div", { class: "steps" }, steps.map((st, i) => h("figure", null,
        h("img", { src: "../docs/images/setup/" + st[0] + ".svg", alt: t("guide." + st[1]), loading: "lazy" }),
        h("figcaption", null, h("b", { text: num(i + 1, 0) }), h("span", { text: t("guide." + st[1]) })))))));
  return { el };
}
viewGuide.sig = function () { return ""; };

/* ====================================================== support report */

// Everything a GitHub issue asks for, gathered in one go: the versions, the
// printer, the state, the settings you changed and the console. Read only,
// and without addresses (M.supportReport scrubs them).
function reportButton() {
  return h("button", { type: "button", class: "btn", onclick: openReport }, icon("file"), t("report.button"));
}

function gatherReport() {
  const call = (method, params) => client.call(method, params).catch(() => null);
  const mcus = (app.objects || []).filter((o) => o === "mcu" || o.startsWith("mcu "));
  return Promise.all([
    call("machine.update.status", { refresh: false }),
    mcus.length ? call("printer.objects.query", { objects: Object.fromEntries(mcus.map((o) => [o, ["mcu_version", "mcu_constants"]])) }) : null,
    call("machine.system_info"),
    call("printer.info"),
    app.spool ? call("server.spoolman.status") : null
  ]).then(([upd, ms, sys, info, spool]) => {
    const vi = (upd || {}).version_info || {};
    const ver = (k) => (vi[k] ? vi[k].version + (vi[k].remote_version && vi[k].remote_version !== vi[k].version ? " (latest " + vi[k].remote_version + ")" : "") : "");
    const P = hwParts();
    const boards = mcus.map((o) => {
      const x = ((ms || {}).status || {})[o] || {};
      const b = P.mcus.find((y) => y.obj === o) || { name: o, main: o === "mcu" };
      return { name: b.main ? "main" : b.name, version: x.mcu_version || "", chip: (x.mcu_constants || {}).MCU || "" };
    });
    const si = (sys || {}).system_info || {};
    const dist = (si.distribution || {}).name || "";
    const cpu = si.cpu_info || {};
    const th = app.status.toolhead || {};
    const axes = (a, b) => (Array.isArray(a) && Array.isArray(b) ? ["X", "Y", "Z"].map((n, i) => n + " " + num(a[i], 0) + "…" + num(b[i], 0)).join(", ") : "");
    const m = settings();
    const changed = m ? Object.keys(m.values).filter((k) => m.source[k] !== "default").sort().map((k) => ({ key: k, value: m.values[k], source: m.source[k] })) : [];
    const ps = app.status.print_stats || {};
    const st = aeState();
    const pb = probe();
    const web = Object.keys(vi).find((k) => vi[k].configured_type === "web");
    const set = M.macroSet(app.config);
    return M.supportReport({
      versions: { autoEject: ver("klipper-auto-eject"), klipper: (info || {}).software_version || app.klipperVersion || ver("klipper"),
        moonraker: ver("moonraker"), web: web ? web + " " + ver(web) : "" },
      boards,
      host: [dist, cpu.model || cpu.processor, cpu.total_memory ? Math.round(cpu.total_memory / 1024) + " MB" : ""].filter(Boolean).join(" · "),
      machine: { kinematics: ((app.config || {}).printer || {}).kinematics || "", travel: axes(th.axis_minimum, th.axis_maximum),
        probe: pb.section ? pb.kind + " [" + pb.section + "]" : "none",
        macroSet: set ? set.name.toUpperCase() : "", spoolman: !app.spool ? "not linked" : spool && spool.spoolman_connected ? "linked, spool " + (spool.spool_id === null ? "none" : "#" + spool.spool_id) : "linked, not connected" },
      state: { klippy: app.klippy, klippyMsg: app.klippyMsg, print: [ps.state, ps.filename].filter(Boolean).join(" · "),
        queue: app.hasQueue ? (app.queue.state || "?") + ", " + app.queue.jobs.length + " waiting" : "no [job_queue]",
        parts: String((st.objects || []).length), leftover: (st.leftover || []).join(", "), busy: !!st.busy },
      settings: changed,
      log: app.log.filter((l) => isAe(l.text) || /^!!/.test(l.text)).filter((l) => !/action:prompt/.test(l.text)).slice(-40).map((l) => l.text)
    });
  });
}

function openReport() {
  const area = h("textarea", { class: "input report-text", readonly: true, rows: 14, dir: "ltr", "aria-label": t("report.title") });
  area.value = t("report.reading");
  const close = () => root.remove();
  const save = () => {
    const a = h("a", { href: URL.createObjectURL(new Blob([area.value], { type: "text/markdown" })), download: "auto-eject-report.md" });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  const root = h("div", { class: "modal-back", onclick: (e) => { if (e.target === root) close(); } },
    h("div", { class: "modal wide", role: "dialog", "aria-modal": "true" },
      h("header", null, h("h3", { text: t("report.title") })),
      h("div", { class: "body" },
        h("p", { text: t("report.intro") }),
        area,
        h("p", { class: "note", style: { marginTop: "10px" } }, icon("info"), h("span", null, t("report.log"), " ",
          h("a", { href: client.fileUrl("/server/files/logs/klippy.log"), download: "klippy.log", text: "klippy.log" })))),
      h("footer", null,
        h("button", { type: "button", class: "btn", onclick: close, text: t("c.close") }),
        h("button", { type: "button", class: "btn", onclick: save }, icon("download"), t("report.save")),
        h("button", { type: "button", class: "btn", onclick: () => copyText(area.value) }, icon("copy"), t("slicer.copy")),
        h("a", { class: "btn primary", href: DOCS + "/issues/new?template=bug_report.yml", target: "_blank", rel: "noopener" }, icon("external"), t("report.issue")))));
  $("#modal-root").appendChild(root);
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  gatherReport().then((text) => { area.value = text; }, (e) => { area.value = t("c.error", { e: e.message }); });
}

/* ============================================================ updates */

// What changed in Klipper and the rest since this printer's versions, from
// Moonraker's update manager, and what that means here. GitHub tells which
// files an update changes: code that runs on the boards needs a reflash, and
// Klipper writes its notes on config changes in docs/Config_Changes.md.
const upd = { status: null, at: 0, loading: false, mcus: [], mcuKey: "", mcuLoading: false, res: {}, ask: {}, open: {} };

function loadUpdates(force) {
  if (app.conn !== "online") return;
  // the boards' firmware, once Klipper has listed them, and again after it restarts
  const mcus = (app.objects || []).filter((o) => o === "mcu" || o.startsWith("mcu "));
  if (mcus.length && upd.mcuKey !== mcus.join() && !upd.mcuLoading) {
    upd.mcuLoading = true;
    upd.mcuKey = mcus.join();
    client.call("printer.objects.query", { objects: Object.fromEntries(mcus.map((o) => [o, ["mcu_version"]])) })
      .then((r) => { upd.mcus = mcus.map((o) => ({ obj: o, version: ((r.status || {})[o] || {}).mcu_version || "" })); }, () => { upd.mcuKey = ""; })
      .then(() => { upd.mcuLoading = false; refresh(); });
  }
  if (upd.loading || (!force && upd.status && Date.now() - upd.at < 600000)) return;
  upd.loading = true;
  client.call("machine.update.status", { refresh: false }).then((r) => r.version_info || {}, () => ({}))
    .then((vi) => { upd.status = vi; upd.at = Date.now(); })
    .then(() => { upd.loading = false; refresh(); });
}
client.on("notify_update_refreshed", () => { if (["updates", "hardware"].includes(route())) loadUpdates(true); });
client.on("notify_klippy_ready", () => { upd.mcuKey = ""; });

// GitHub's answer to a path, or undefined while it is read and null when it
// could not be. Kept in the browser: a range of commits never changes.
function ghGet(path) {
  if (Object.prototype.hasOwnProperty.call(upd.res, path)) return upd.res[path];
  if (!upd.ask[path]) {
    upd.ask[path] = true;
    let kept = null;
    try { kept = JSON.parse(store("ae.gh." + path) || "null"); } catch (e) { kept = null; }
    if (kept) { upd.res[path] = kept; return kept; }
    const read = DEMO && client.github ? client.github(path)
      : fetch("https://api.github.com" + path, { headers: { Accept: "application/vnd.github+json" } })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("GitHub " + r.status))));
    read.then((j) => {
      upd.res[path] = ghTrim(j);
      store("ae.gh." + path, JSON.stringify(upd.res[path]));
    }, () => { upd.res[path] = null; }).then(() => refresh());
  }
  return undefined;
}
// only what the page shows: a comparison's files and notes, or a list of commits
function ghTrim(j) {
  const commit = (c) => ({ sha: String(c.sha || "").slice(0, 8), date: (c.commit || {}).author ? Date.parse(c.commit.author.date) / 1000 : 0,
    message: String((c.commit || {}).message || "") });
  if (Array.isArray(j)) return j.slice(0, 30).map(commit);
  const files = (j.files || []).map((f) => f.filename);
  const cc = (j.files || []).find((f) => f.filename === "docs/Config_Changes.md");
  return { files, notes: M.configNotes(cc && cc.patch) };
}
function klipperRepo() {
  const k = (upd.status || {}).klipper || {};
  return "/repos/" + (k.owner || "Klipper3d") + "/" + (k.repo_name || "klipper");
}

// A board's firmware against Klipper: { level, text }, or null without a version.
function firmwareNote(version) {
  if (!version) return null;
  const age = M.firmwareAge(version, app.klipperVersion);
  if (age.state === "same") return { level: "ok", text: t("upd.fw.same") };
  if (age.state === "newer") return { level: "info", text: t("upd.fw.newer") };
  if (age.state !== "older") return null;
  if (age.by === null) return { level: "warn", text: t("upd.fw.older_release") };
  const a = M.parseVersion(version).sha, b = M.parseVersion(app.klipperVersion).sha;
  const cmp = a && b ? ghGet(klipperRepo() + "/compare/" + a + "..." + b) : null;
  const n = num(age.by, 0);
  if (cmp === undefined) return { level: "info", text: t("upd.fw.older_check", { n }) };
  if (!cmp) return { level: "info", text: t("upd.fw.older_unknown", { n }) };
  const code = M.boardCode(cmp.files);
  return code.length ? { level: "warn", text: t("upd.fw.older_changed", { n, files: code.join(", ") }) }
    : { level: "ok", text: t("upd.fw.older_same", { n }) };
}
function noteLine(n, extra) {
  return n ? h("p", { class: "note " + n.level + (extra ? " " + extra : "") }, icon(n.level === "ok" ? "ok" : n.level === "warn" ? "alert" : "info"), h("span", { text: n.text })) : null;
}

function updDate(d) {
  const sec = typeof d === "number" ? d : /^\d+$/.test(String(d)) ? Number(d) : Date.parse(d) / 1000;
  return sec > 0 ? iso(fmtDate(sec)) : "";
}
// one update: its date, what it is about, its first line; the rest on a tap
function commitRow(c) {
  const msg = String(c.message || c.subject || "");
  const subject = c.subject || msg.split("\n")[0];
  const body = msg.split("\n").slice(1).join("\n").trim();
  const area = M.updateArea(subject);
  const open = !!upd.open[c.sha];
  return h("div", { class: "upd-row" },
    h("div", { class: "upd-head" },
      h("span", { class: "upd-date", text: updDate(c.date) }),
      h("span", { class: "badge upd-area " + area, text: t("upd.area." + area) }),
      h("span", { class: "upd-subject ltr", text: subject }),
      body ? h("button", { type: "button", class: "icon-btn", title: t(open ? "upd.less" : "upd.more"), "aria-label": t(open ? "upd.less" : "upd.more"),
        onclick: () => { upd.open[c.sha] = !open; refresh("updates"); } }, icon(open ? "close" : "plus")) : null),
    open && body ? h("pre", { class: "upd-body ltr", text: body }) : null);
}

function klipperUpdates(kl) {
  const behind = kl.commits_behind || [];
  const head = h("h2", null, icon("download"), "Klipper",
    h("span", { class: "right" }, h("span", { class: "badge " + (behind.length ? "warn" : "ok"),
      text: behind.length ? t("upd.n_updates", { n: num(kl.commits_behind_count || behind.length, 0) }) : t("upd.up_to_date") })));
  const versions = h("p", { class: "muted", text: t("upd.yours", { v: iso(kl.version || "?") }) + (behind.length ? " · " + t("upd.latest", { v: iso(kl.remote_version || "?") }) : "") });
  if (!behind.length) {
    const recent = kl.current_hash ? ghGet(klipperRepo() + "/commits?sha=" + kl.current_hash + "&per_page=15") : null;
    return h("section", { class: "card" }, head, versions,
      h("h3", { class: "upd-h", text: t("upd.recent") }),
      recent === undefined ? h("div", { class: "empty" }, h("span", { class: "spinner" }))
        : recent ? h("div", { class: "upd-list" }, recent.map(commitRow))
        : h("p", { class: "note" }, icon("info"), h("span", { text: t("upd.no_github") })));
  }
  const cmp = kl.current_hash && kl.remote_hash ? ghGet(klipperRepo() + "/compare/" + kl.current_hash + "..." + kl.remote_hash) : null;
  let fw;
  if (cmp === undefined) fw = { level: "info", text: t("upd.reading") };
  else if (!cmp) fw = { level: "info", text: t("upd.no_github") };
  else {
    const code = M.boardCode(cmp.files);
    fw = code.length ? { level: "warn", text: t("upd.board_changed", { files: code.join(", ") }) } : { level: "ok", text: t("upd.board_same") };
  }
  const notes = cmp && cmp.notes.length ? h("div", { class: "upd-notes" }, h("h3", { class: "upd-h", text: t("upd.notes") }),
    cmp.notes.map((x) => h("div", { class: "upd-note" }, h("b", { class: "ltr", text: x.date }), h("p", { class: "ltr", text: x.text })))) : null;
  return h("section", { class: "card" }, head, versions,
    h("div", { class: "chips" }, M.updateAreas(behind).map((a) => h("span", { class: "chip upd-area " + a.area },
      h("span", { text: t("upd.area." + a.area) }), h("b", { text: num(a.count, 0) })))),
    noteLine(fw, "upd-gap"),
    notes,
    h("h3", { class: "upd-h", text: t("upd.list") }),
    h("div", { class: "upd-list" }, behind.map(commitRow)),
    h("p", { class: "note upd-gap" }, icon("info"), h("span", { text: t("upd.how") })));
}

// The whole farm's versions, from the farm service, and updating them: one
// printer at a time, or every free one. The service updates a printer only
// while it does nothing, everything in one go and in a safe order.
const FLEET_BUSY = ["printing", "paused", "ejecting", "stopped", "offline", "off"];
const fleetPending = (p) => M.farmPending(p.updates);
function fleetCell(p, key) {
  const u = p.updates || {};
  const name = key === "web" ? Object.keys(u).find((k) => u[k].type === "web") : key;
  const c = name ? u[name] : null;
  if (!c) return h("span", { class: "muted", text: "—" });
  const isNew = fleetPending(p).includes(name);
  return h("div", { class: "fleet-v" + (isNew ? " new" : "") }, h("span", { class: "ltr", text: c.version || "?" }),
    isNew ? h("span", { class: "ltr", text: "→ " + (c.remote || "?") }) : null);
}
function fleetBoards(p) {
  const worst = M.farmFirmware(p.firmware);
  if (!worst || worst.state === "unknown") return h("span", { class: "muted", text: "—" });
  if (worst.state === "same") return h("span", { class: "fleet-ok", text: t("upd.fw_short.same") });
  if (worst.state === "newer") return h("span", { text: t("upd.fw_short.newer") });
  return h("span", { class: "fleet-new", text: worst.by === null ? t("upd.fw_short.release") : t("upd.fw_short.older", { n: num(worst.by, 0) }) });
}
function fleetUpdate(list) {
  return Promise.all(list.map((p) => farmCall("/" + p.id + "/update", { names: fleetPending(p) }).then(() => true, (e) => { toast(p.name + ": " + cleanError(e.message), "bad"); return false; })))
    .then((ok) => { const n = ok.filter(Boolean).length; if (n) toast(t("upd.farm_started", { n: num(n, 0) }), "ok"); loadFarm(); });
}
function fleetCard() {
  const list = M.farmOrder(farm.data.printers || []);
  const free = list.filter((p) => fleetPending(p).length && !FLEET_BUSY.includes(p.phase) && !(p.job && p.job.state === "running"));
  const all = () => confirm(t("upd.farm_all_title"), t("upd.farm_all_body", { n: num(free.length, 0) }), t("upd.farm_all", { n: num(free.length, 0) }))
    .then((ok) => { if (ok) fleetUpdate(free); });
  const row = (p) => {
    const pending = fleetPending(p), job = p.job || null, busy = FLEET_BUSY.includes(p.phase);
    const running = job && job.state === "running";
    const state = running ? h("span", { class: "fleet-job", title: (job.names || []).join(", ") }, h("span", { class: "spinner" }),
        t("upd.farm_running", { done: num((job.done || []).length, 0), all: num((job.names || []).length, 0) }))
      : [job && job.state === "failed" ? h("span", { class: "fleet-new", title: job.error, text: t("upd.farm_failed") }) : null,
        pending.length ? h("button", { type: "button", class: "btn sm" + (busy ? "" : " primary"), disabled: busy, title: busy ? t("farm.phase." + p.phase) : pending.join(", "),
          onclick: () => fleetUpdate([p]) }, icon("download"), t("upd.farm_one"))
        : !p.updates ? h("span", { class: "muted", text: "—" })              // never reached yet
        : h("span", { class: "fleet-ok", text: job && job.state === "done" ? t("upd.farm_done") : t("upd.up_to_date") })];
    return h("div", { class: "fleet-row", "data-state": p.phase },
      h("div", { class: "fleet-name" }, h("b", { dir: "auto", text: p.name }), h("span", { class: "muted", text: t("farm.phase." + p.phase) })),
      [["autoeject", fleetCell(p, "klipper-auto-eject")], ["klipper", fleetCell(p, "klipper")], ["moonraker", fleetCell(p, "moonraker")],
        ["web", fleetCell(p, "web")], ["boards", fleetBoards(p)]].map(([k, cell]) => h("div", { class: "fleet-c", "data-label": t("upd.col." + k) }, cell)),
      h("div", { class: "fleet-act" }, state));
  };
  return h("section", { class: "card" },
    h("h2", null, icon("farm"), t("upd.farm_title"),
      free.length ? h("span", { class: "right" }, h("button", { type: "button", class: "btn sm primary", onclick: all }, icon("download"), t("upd.farm_all", { n: num(free.length, 0) }))) : null),
    h("p", { class: "muted", text: t("upd.farm_note") }),
    h("div", { class: "fleet" }, h("div", { class: "fleet-in" },
      h("div", { class: "fleet-row fleet-head" }, ["printer", "autoeject", "klipper", "moonraker", "web", "boards", "act"].map((k) =>
        h("span", { text: k === "act" ? "" : t("upd.col." + k) }))),
      list.map(row))));
}

// The boards updated from here: tools/firmware.py, run in the background by
// the klipper-auto-eject service on this printer (push/firmware_job.py),
// which nginx serves at ../api/firmware. Without the service the card says
// what to run over SSH, as before.
const FW_API = "../api/firmware";
const FW_SSH = "~/klipper-auto-eject/install.sh --firmware";
const fwu = { data: null, available: null, at: 0, loading: false, log: false };

function fwCall(path, body) {
  if (DEMO) return client.firmware(path, body);
  const opts = body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  return fetch(FW_API + path, opts).then((r) => r.json().catch(() => ({}))
    .then((j) => (r.ok ? j : Promise.reject(new Error(j.error || "HTTP " + r.status)))));
}
function fwRunning() { return !!(fwu.data && fwu.data.job && fwu.data.job.state === "running"); }
function loadFirmware() {
  if (fwu.loading) return;
  fwu.loading = true;
  const was = fwRunning();
  fwCall("").then((d) => { fwu.data = d; fwu.available = true; }, () => { if (!fwu.data) fwu.available = false; })
    .then(() => {
      fwu.loading = false;
      fwu.at = Date.now();
      if (was && !fwRunning()) upd.mcuKey = "";          // ask the boards their new versions
      refresh();
    });
}
// while the Updates page is shown: every 2 s during an update, else once a minute
setInterval(() => {
  if (document.hidden || fwu.available === false || route() !== "updates") return;
  if (fwRunning() || Date.now() - fwu.at > 60000) loadFirmware();
}, 2000);

// a board as the page names it (Main board...), from firmware.py's name for it ("mcu")
function fwObj(name) { return name === "mcu" ? "mcu" : "mcu " + name; }
function fwLabel(name) {
  const b = hwParts().mcus.find((x) => x.obj === fwObj(name));
  return b ? boardName(b) : name;
}
function fwNames(list) { return list.map((b) => fwLabel(b.name)).join(lang === "ar" ? "، " : ", "); }

function fwStart(plan) {
  const body = t("upd.fwu.confirm_body", { names: fwNames(plan.go) }) + (plan.host ? " " + t("upd.fwu.confirm_host") : "");
  return confirm(t("upd.fwu.confirm_title"), body, t("upd.fwu.button")).then((ok) => {
    if (!ok) return null;
    return fwCall("/update", {}).then(() => { toast(t("upd.fwu.started"), "ok"); loadFirmware(); }, (e) => toast(cleanError(e.message), "bad"));
  });
}

// why a board was left out or stopped: in the page's words when it knows
// them, else in firmware.py's own (English)
function fwWhy(b, running) {
  if (b.code === "reset" && b.state === "flashing" && running) return noteLine({ level: "warn", text: t("upd.fwu.why.reset") }, "fw-why");
  const known = b.code === "setup" || b.code === "answers";
  const text = known ? t("upd.fwu.why." + b.code) : b.why;
  return text ? h("span", { class: "fw-why" + (known ? "" : " ltr"), text }) : null;
}

const FW_OK = ["written", "done"], FW_BAD = ["failed", "still", "left"];
function fwJob(job) {
  const running = job.state === "running", boards = job.boards || [];
  let top;
  if (running) top = h("p", { class: "fw-step" }, h("span", { class: "spinner" }), h("b", { text: t("upd.fwu.step." + (job.step || "checking")) }));
  else if (job.state === "done") top = noteLine({ level: "ok", text: t(!boards.length ? "upd.fwu.nothing" : job.reboot ? "upd.fwu.done_reboot" : "upd.fwu.done") });
  else {
    top = h("p", { class: "note warn" }, icon("alert"), h("span", null, h("b", { text: t("upd.fwu.failed") }),
      job.message ? h("span", { class: "fw-msg ltr", text: job.message.replace(/^Stopped: /, "") }) : null));
  }
  const rows = boards.length ? h("div", { class: "fw-rows" }, boards.map((b) => {
    const mark = running && ["building", "flashing"].includes(b.state) ? h("span", { class: "spinner" })
      : icon(FW_OK.includes(b.state) ? "ok" : FW_BAD.includes(b.state) ? "alert" : "info");
    return h("div", { class: "fw-row", "data-state": b.state }, mark, h("b", { dir: "auto", text: fwLabel(b.name) }),
      h("span", { class: "muted", text: t("upd.fwu.state." + b.state) }),
      b.state === "done" && b.now ? h("span", { class: "muted ltr", text: b.now }) : null,
      fwWhy(b, running));
  })) : null;
  const when = !running && job.at ? h("p", { class: "muted fw-when", text: t("upd.fwu.at", { t: iso(fmtDate(job.at, true)) }) }) : null;
  const log = job.log ? h("details", { class: "fw-log", open: fwu.log, ontoggle: (e) => { fwu.log = e.target.open; } },
    h("summary", { text: t("upd.fwu.log") }), h("pre", { class: "upd-body ltr", text: job.log })) : null;
  return h("div", { class: "fw-job" }, top, rows, when, log);
}

// The button, what it would write, and what it cannot: from firmware.py's
// report through the service. The last update stays shown for a day.
function fwPanel() {
  if (!fwu.available || !fwu.data) return null;
  const job = fwu.data.job, running = fwRunning(), parts = [];
  if (job && (running || Date.now() / 1000 - (job.at || 0) < 86400)) parts.push(fwJob(job));
  if (!running) {
    const plan = M.firmwarePlan(fwu.data.status);
    const busy = ["printing", "paused"].includes((app.status.print_stats || {}).state);
    const note = (key, list) => h("p", { class: "note" }, icon("info"), h("span", { text: t(key, { names: fwNames(list) }) }));
    if (plan.go.length) {
      // a plain button when GitHub says nothing in the board code changed: no need, but possible
      const needed = plan.go.some((b) => {
        const m = upd.mcus.find((x) => x.obj === fwObj(b.name));
        const n = m ? firmwareNote(m.version) : null;
        return !n || n.level !== "ok";
      });
      parts.push(h("div", { class: "fw-act" },
        h("button", { type: "button", class: "btn" + (needed ? " primary" : ""), disabled: busy, onclick: () => fwStart(plan) }, icon("download"), t("upd.fwu.button")),
        h("span", { class: "muted", text: busy ? t("upd.fwu.busy") : t(plan.host ? "upd.fwu.what_host" : "upd.fwu.what", { names: fwNames(plan.go) }) })));
    }
    if (plan.setup.length) parts.push(note("upd.fwu.setup", plan.setup));
    if (plan.answers.length) parts.push(note("upd.fwu.answers", plan.answers));
    if (plan.setup.length || plan.answers.length) parts.push(codeCopy(FW_SSH));
    if (plan.manual.length) parts.push(note("upd.fwu.manual", plan.manual));
    for (const b of plan.none) parts.push(h("p", { class: "note" }, icon("info"), h("span", null, h("b", { dir: "auto", text: fwLabel(b.name) + ": " }), h("span", { class: "ltr", text: b.why || "" }))));
  }
  return parts.length ? h("div", { class: "fw-panel" }, parts) : null;
}

function viewUpdates() {
  loadUpdates();
  if (fwu.available === null) loadFirmware();
  const vi = upd.status;
  if (!vi) return { el: h("div", null, head("upd.title", "upd.intro"), h("div", { class: "card empty" }, h("span", { class: "spinner" }))) };
  if (!Object.keys(vi).length) return { el: h("div", null, head("upd.title", "upd.intro"),
    h("div", { class: "card empty" }, icon("download"), h("p", { text: t("upd.unavailable") }))) };
  const P = hwParts();
  const boards = upd.mcus.filter((m) => m.version).map((m) => {
    const b = P.mcus.find((x) => x.obj === m.obj) || { name: m.obj.replace(/^mcu ?/, "") || "mcu", main: m.obj === "mcu" };
    return h("div", { class: "upd-board" }, h("div", { class: "upd-head" }, icon("chip"), h("b", { text: boardName(b) }),
      h("span", { class: "muted ltr", text: m.version })), noteLine(firmwareNote(m.version)));
  });
  // the update button too: also while Klipper stops at boards too old for it, and lists none
  const fwp = fwPanel();
  const newer = (c) => (c.commits_behind || []).length > 0 || !!(c.version && c.remote_version && c.version !== c.remote_version && c.remote_version !== "?");
  const others = Object.keys(vi).filter((k) => k !== "klipper" && k !== "system")
    .sort((a, b) => newer(vi[b]) - newer(vi[a]) || ((vi[b].commits_behind || []).length - (vi[a].commits_behind || []).length) || a.localeCompare(b));
  const other = (k) => {
    const c = vi[k], behind = c.commits_behind || [], isNew = newer(c);
    return h("details", { class: "upd-other" + (behind.length ? "" : " flat"), open: !!upd.open["c:" + k],
      ontoggle: (e) => { upd.open["c:" + k] = e.target.open; } },
      h("summary", null, h("b", { class: "ltr", text: k }), h("span", { class: "muted ltr", text: (c.version || "") + (isNew ? " → " + (c.remote_version || "") : "") }),
        h("span", { class: "badge " + (isNew ? "warn" : "ok"), text: isNew ? (behind.length ? t("upd.n_updates", { n: num(c.commits_behind_count || behind.length, 0) }) : t("upd.new")) : t("upd.up_to_date") })),
      behind.length ? h("div", { class: "upd-list" }, behind.map(commitRow)) : null);
  };
  return {
    el: h("div", null, head("upd.title", "upd.intro"),
      h("div", { class: "stack" },
        farmShown() && (farm.data.printers || []).length > 1 ? fleetCard() : null,
        vi.klipper ? klipperUpdates(vi.klipper) : null,
        boards.length || fwp ? h("section", { class: "card" }, h("h2", null, icon("chip"), t("upd.boards")), boards, fwp) : null,
        others.length ? h("section", { class: "card" }, h("h2", null, icon("layers"), t("upd.others")), others.map(other)) : null))
  };
}
viewUpdates.sig = function () {
  const vi = upd.status;
  // drawn again once connected, so it can ask
  return JSON.stringify([app.conn, (app.objects || []).length, !!vi, vi && Object.entries(vi).map(([k, c]) => [k, c.version, c.remote_version, (c.commits_behind || []).length]),
    app.klipperVersion, upd.mcus, Object.keys(upd.res).length, upd.open,
    farmShown() && farm.data.printers.map((p) => [p.id, p.name, p.phase, p.updates, p.firmware, p.job]),
    fwu.available, fwu.data, fwu.log, (app.status.print_stats || {}).state]);
};

export { firmwareNote, noteLine, reportButton, viewActivity, viewGuide, viewUpdates };
