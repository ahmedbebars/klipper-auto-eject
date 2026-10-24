/* klipper-auto-eject web page. What every part of the page uses: small helpers, the languages, the
 * state read from the printer and what is worked out from it.
 */

const M = window.AEModel;
const Q = window.AEQr;
const params = new URLSearchParams(location.search);
const DEMO = params.has("demo");
const STATE = "gcode_macro _AUTO_EJECT_STATE";
const MACROS = ["_AUTO_EJECT_DEFAULTS", "_AUTO_EJECT_SETTINGS", "_AUTO_EJECT_OVERRIDES"].map((m) => "gcode_macro " + m);
const DOCS = "https://github.com/ahmedbebars/klipper-auto-eject";

/* ============================================================ helpers */

const $ = (sel, el) => (el || document).querySelector(sel);

function h(tag, attrs) {
  const el = document.createElement(tag);
  if (attrs) setAttrs(el, attrs);
  for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
  return el;
}
function s(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) setAttrs(el, attrs);
  for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
  return el;
}
function setAttrs(el, attrs) {
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.setAttribute("class", v);
    else if (k === "text") el.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "disabled" || k === "selected" || k === "hidden") el[k] = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
}
function add(el, kid) {
  if (kid === null || kid === undefined || kid === false) return;
  if (Array.isArray(kid)) { kid.forEach((k) => add(el, k)); return; }
  el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
}

// Line icons, 24 x 24.
const ICONS = {
  overview: "M3 3h8v8H3z M13 3h8v5h-8z M13 10h8v11h-8z M3 13h8v8H3z",
  queue: "M9 6h12 M9 12h12 M9 18h12 M4 6h.01 M4 12h.01 M4 18h.01",
  check: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6 M9 15l2 2 4-4",
  setup: "M3 17L17 3l4 4L7 21H3z M7.5 12.5l2 2 M10.5 9.5l2 2 M13.5 6.5l2 2",
  settings: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  guide: "M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2z M22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z",
  home: "M3 11l9-8 9 8 M5 9.5V21h5v-6h4v6h5V9.5",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  sun: "M12 4V2 M12 22v-2 M4.9 4.9L3.5 3.5 M20.5 20.5l-1.4-1.4 M4 12H2 M22 12h-2 M4.9 19.1l-1.4 1.4 M20.5 3.5l-1.4 1.4 M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
  stop: "M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z M9 9l6 6 M15 9l-6 6",
  push: "M3 12h13 M11 6l6 6-6 6 M21 4v16",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  hand: "M18 11V6a2 2 0 0 0-4 0v5 M14 10V4a2 2 0 0 0-4 0v6 M10 10.5V6a2 2 0 0 0-4 0v8 M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.3 16.8a2 2 0 0 1 2.8-2.8L8 16",
  play: "M6 4l14 8-14 8z",
  pause: "M6 4h4v16H6z M14 4h4v16h-4z",
  alert: "M12 3l10 18H2z M12 10v4 M12 17h.01",
  ok: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M8 12l3 3 5-6",
  bad: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M15 9l-6 6 M9 9l6 6",
  info: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M12 16v-4 M12 8h.01",
  thermo: "M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z",
  layers: "M12 2l10 5-10 5L2 7z M2 17l10 5 10-5 M2 12l10 5 10-5",
  ruler: "M21.3 8.7L8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z M7.5 10.5l2 2 M10.5 7.5l2 2 M13.5 4.5l2 2 M4.5 13.5l2 2",
  plus: "M12 5v14 M5 12h14",
  trash: "M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-5-5",
  file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6",
  camera: "M3 7h4l2-3h6l2 3h4v13H3z M12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  phone: "M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z M11 18h2",
  download: "M12 3v12 M7 10l5 5 5-5 M4 21h16",
  external: "M14 3h7v7 M10 14L21 3 M21 14v7H3V3h7",
  reset: "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5",
  restart: "M21 12a9 9 0 1 1-3-6.7L21 8 M21 3v5h-5",
  wand: "M15 4V2 M15 16v-2 M8 9h2 M20 9h2 M17.8 11.8L19 13 M17.8 6.2L19 5 M12.2 6.2L11 5 M12.2 11.8L3 21",
  box: "M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8",
  dots: "M5 12h.01 M12 12h.01 M19 12h.01",
  install: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M12 6v8 M9 11l3 3 3-3 M11 18h2",
  farm: "M2 4h9v16H2z M13 4h9v16h-9z M2 9h9 M13 9h9 M5 9v3h3V9 M16 9v3h3V9",
  edit: "M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4",
  copy: "M9 9h11v11H9z M5 15H4V4h11v1",
  tray: "M3 13h5l1 3h6l1-3h5 M5 5h14l2 8v6H3v-6z",
  power: "M12 3v8 M6.3 6.3a8 8 0 1 0 11.4 0",
  clock: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M12 7v5l3 2",
  spool: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  height: "M12 3v18 M8 7l4-4 4 4 M8 17l4 4 4-4",
  motor: "M4 7h11v10H4z M15 10h3v4h-3 M18 12h3 M7 7V4 M12 7V4 M7 20v-3 M12 20v-3",
  chip: "M7 7h10v10H7z M10 10h4v4h-4z M9 3v4 M15 3v4 M9 17v4 M15 17v4 M3 9h4 M3 15h4 M17 9h4 M17 15h4",
  fan: "M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M12 10.5C11 6 12 3 15 3s3 4-1.5 7.5 M13.5 12c4.5-1 7.5 0 7.5 3s-4 3-7.5-1.5 M12 13.5c1 4.5 0 7.5-3 7.5s-3-4 1.5-7.5 M10.5 12C6 13 3 12 3 9s4-3 7.5 1.5",
  server: "M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01",
  close: "M6 6l12 12 M18 6L6 18",
  up: "M12 19V5 M5 12l7-7 7 7",
  down: "M12 5v14 M19 12l-7 7-7-7",
  minus: "M5 12h14",
  qr: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M6 6h1v1H6z M17 6h1v1h-1z M6 17h1v1H6z M14 14h3v3h-3z M18 18h3v3h-3z M21 14v1 M14 21h1"
};
function icon(name, cls) {
  return s("svg", { class: "ic" + (cls ? " " + cls : ""), viewBox: "0 0 24 24", "aria-hidden": "true" }, s("path", { d: ICONS[name] || "" }));
}

/* ======================================================== translation */

let lang = pickLang();
function setLang(code) { lang = code; store("ae.lang", code); }
function pickLang() {
  const asked = params.get("lang");
  if (asked && AE_TEXT[asked]) return asked;
  const saved = store("ae.lang");
  if (saved && AE_TEXT[saved]) return saved;
  const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
  return AE_TEXT[nav] ? nav : "en";
}
function t(key, vars) {
  let text = (AE_TEXT[lang] && AE_TEXT[lang][key]) || AE_TEXT.en[key];
  if (text === undefined) return key;
  if (vars) text = text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return text;
}
function has(key) { return !!((AE_TEXT[lang] && AE_TEXT[lang][key]) || AE_TEXT.en[key]); }
function num(v, digits) {
  if (typeof v !== "number" || !isFinite(v)) return String(v);
  return v.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: digits === undefined ? 1 : digits, minimumFractionDigits: 0 });
}
function duration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const hrs = Math.floor(sec / 3600), min = Math.floor((sec % 3600) / 60);
  const ar = lang === "ar";
  if (hrs) return ar ? hrs + " س " + min + " د" : hrs + " h " + min + " min";
  if (min) return ar ? min + " دقيقة" : min + " min";
  return ar ? sec + " ث" : sec + " s";
}

function fmtSize(b) {
  if (!b) return "";
  if (b > 1048576) return num(b / 1048576) + " MB";
  return num(b / 1024, 0) + " KB";
}
// a number or date kept in one piece inside right-to-left text
function iso(text) { return "\u2068" + text + "\u2069"; }
function fmtClock(sec) {
  return new Date(sec * 1000).toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
function fmtDate(sec, withTime) {
  const d = new Date(sec * 1000), loc = lang === "ar" ? "ar-EG-u-nu-latn" : undefined;
  return withTime ? d.toLocaleString(loc) : d.toLocaleDateString(loc);
}

function head(titleKey, introKey, extra) {
  return h("div", { class: "view-head" }, h("div", null, h("h1", { text: t(titleKey) }), introKey ? h("p", { text: t(introKey) }) : null), extra || null);
}

function camUrl(cam) {
  // an MJPEG stream plays in an <img>; anything else shows snapshots
  const u = /mjpeg/.test(cam.service || "") || !cam.snapshot_url ? cam.stream_url || "" : cam.snapshot_url;
  if (/^https?:/.test(u) || u.startsWith("/")) return u;
  return "/" + u.replace(/^\.?\//, "");
}

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch (e) { return null; }
  return null;
}

/* ============================================================== state */

const app = {
  conn: "connecting",          // connecting | online | offline
  klippy: "",                  // ready | startup | shutdown | error | disconnected
  klippyMsg: "",
  loaded: false,               // the first printer status has arrived
  status: {},
  config: {},                  // configfile.config section names -> options
  hasMacros: null,
  hasQueue: false,
  autoTransition: null,
  queue: { jobs: [], state: "" },
  spool: null,                 // with Moonraker's [spoolman]: { connected, id, pending, data, list }
  spoolmanUrl: "",             // [spoolman] server, for a link to Spoolman's own page
  files: null,
  meta: {},
  webcams: [],
  trustedClients: undefined,   // Moonraker's trusted_clients, null without [authorization]
  ntfy: "",                    // the ntfy topic of [notifier auto_eject], if any
  notifier: "",                // where [notifier auto_eject] sends: ntfy, telegram, discord, other
  push: { key: null, id: null, jobs: true, hardware: true },   // the printer's notification service and this device
  log: [],
  template: null,              // parsed auto_eject_settings.cfg, or false
  prompt: null,
  host: "",
  lanesDone: new Set(),
  coolStart: null
};

const client = DEMO ? new window.AEDemo() : new window.Moonraker(params.get("printer") || "");
const prompts = new M.PromptParser();

/* ======================================================= derived data */

function settings() {
  const st = app.status;
  if (!st[MACROS[0]]) return null;
  return M.mergeSettings(st[MACROS[0]], st[MACROS[1]], (st[MACROS[2]] || {}).data);
}
function sv() { const m = settings(); return m ? m.values : {}; }

function aeState() { return app.status[STATE] || { objects: [], leftover: [], height: 0, busy: false }; }

// The parts the page shows: stored ones, or the live labelled objects of
// a print that has just finished.
function parts() {
  const st = aeState();
  if (st.objects && st.objects.length) return st.objects;
  const ps = app.status.print_stats || {};
  if (["printing", "paused"].includes(ps.state)) {
    const live = (app.status.exclude_object || {}).objects || [];
    return M.recordsFromExcludeObjects(live);
  }
  return [];
}

function polygons() {
  const out = {};
  for (const o of ((app.status.exclude_object || {}).objects || [])) if (o.polygon && o.polygon.length) out[String(o.name).replace(/['"]/g, "")] = o.polygon;
  return out;
}

function leftover() {
  const st = aeState();
  const names = new Set((st.objects || []).map((r) => r[0]));
  return (st.leftover || []).filter((n) => names.has(n));
}

function axes() {
  const th = app.status.toolhead || {};
  return { min: th.axis_minimum || [0, 0, 0], max: th.axis_maximum || [300, 300, 300] };
}

function plan() {
  const set = sv();
  if (set.blade_width === undefined) return null;
  const ax = axes();
  return M.planPushes(parts(), set, ax.min, ax.max);
}

function probe() {
  const names = Object.keys(app.config || {});
  const p = M.probeKind(names, sv().probe_type);
  const opts = (app.config || {})[p.section] || {};
  const off = Math.abs(parseFloat(opts.x_offset || 0)) + Math.abs(parseFloat(opts.y_offset || 0));
  let label = "setup.probe_none";
  if (p.kind === "eddy") label = "setup.probe_eddy";
  else if (p.kind === "contact") label = off > 0.5 ? "setup.probe_offset" : "setup.probe_contact";
  return { section: p.section, kind: p.kind, nozzle: p.kind === "contact" && off <= 0.5, label };
}

function homed() { return String((app.status.toolhead || {}).homed_axes || "").toLowerCase().includes("xyz"); }

function phase() {
  if (app.conn !== "online") return "offline";
  if (app.klippy === "shutdown" || app.klippy === "error") return "shutdown";
  // until the first status arrives, nothing is known about the bed
  if (app.klippy !== "ready" || !app.loaded) return "offline";
  const st = aeState();
  const ps = app.status.print_stats || {};
  if (M.ejectRunning(st, app.status)) {
    const bed = app.status.heater_bed;
    const set = sv();
    // in the background the macro says itself whether it still cools
    if (st.bg) return st.cooling ? "cooling" : "working";
    if (!st.swept && bed && set.cool_mode === "temperature" && bed.target === 0 && bed.temperature > M.coolTarget(st, set) + 0.3) return "cooling";
    return "working";
  }
  if (ps.state === "printing") return "printing";
  if (ps.state === "paused") return "paused";
  if (leftover().length) return "waiting";
  if (app.hasQueue && app.queue.state === "paused" && app.queue.jobs.length && !parts().length) return "waiting";
  return "idle";
}

// Why the printer cannot take a command right now, or "".
function blocked() {
  const ph = phase();
  if (ph === "offline" || ph === "shutdown") return "act.why_offline";
  if (ph === "printing" || ph === "paused") return "act.why_printing";
  if (ph === "working" || ph === "cooling") return "act.why_busy";
  if ((app.status.idle_timeout || {}).state === "Printing") return "act.why_busy";
  return "";
}

export {
  $, aeState, app, axes, blocked, camUrl, client, DEMO, DOCS, duration, fmtClock, fmtDate, fmtSize, h, has, head,
  homed, icon, iso, lang, leftover, M, MACROS, num, params, parts, phase, plan, polygons, probe, prompts, Q, s,
  setLang, settings, STATE, store, sv, t
};
