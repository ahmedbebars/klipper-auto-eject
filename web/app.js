/* klipper-auto-eject web page: the app.
 *
 * Plain JavaScript, no build step and nothing loaded from the internet.
 * Everything the page shows comes from Moonraker; everything it does is a
 * G-code command (AUTO_EJECT ..., AUTO_EJECT_SET ...) or a Moonraker job
 * queue call, so it never does anything the console could not.
 */
"use strict";

(function () {
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
      if (!st.swept && bed && set.cool_mode === "temperature" && bed.target === 0 && bed.temperature > set.cool_temp + 0.3) return "cooling";
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
    sel.onchange = () => { lang = sel.value; store("ae.lang", lang); chromeSig = ""; refresh(); renderPrompt(); };
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

  /* =========================================================== overview */

  const STATE_ICON = { idle: "ok", printing: "layers", paused: "pause", cooling: "thermo", working: "push", waiting: "alert", offline: "info", shutdown: "stop" };

  // The box under the drop edge: how full, and "I emptied it".
  function binChip(set) {
    const n = aeState().bin || 0, cap = Number(set.bin_capacity) || 0;
    if (!cap && !n) return null;
    const cls = cap && n >= cap ? " bad" : cap && n >= Math.ceil(cap * 0.8) ? " warn" : "";
    return h("button", { type: "button", class: "chip" + cls, title: t("bin.empty"), onclick: doBinEmpty }, icon("tray"),
      h("span", { text: t("bin.chip") + ":" }), h("b", { text: cap ? num(n, 0) + " / " + num(cap, 0) : num(n, 0) }));
  }
  // The spool on the printer, with Spoolman: what is left.
  function spoolChip() {
    const d = (app.spool || {}).data;
    if (!d || typeof d.remaining_weight !== "number") return null;
    return h("a", { class: "chip" + (spoolTrouble(spoolCheck()) ? " warn" : ""), href: "#/queue", title: M.spoolName(d) }, icon("spool"),
      h("span", { text: t("spool.chip") + ":" }), h("b", { text: spoolGrams(d.remaining_weight) }));
  }
  function doBinEmpty() {
    confirm(t("bin.empty"), t("bin.empty_confirm"), t("bin.empty")).then((ok) => { if (ok) gcode("AUTO_EJECT_BIN_EMPTY"); });
  }

  function heroText() {
    const ph = phase();
    const st = aeState();
    const set = sv();
    const ps = app.status.print_stats || {};
    const n = parts().length;
    const hgt = st.height || 0;
    let sub;
    const loading = ph === "offline" && app.conn === "online" && (!app.klippy || app.klippy === "ready");
    if (loading) return { ph, title: t("status.loading"), sub: t("status.sub.loading") };
    if (ph === "offline") sub = t("status.sub.offline");
    else if (ph === "shutdown") sub = app.klippyMsg || "";
    else if (ph === "cooling") {
      const vars = { now: num((app.status.heater_bed || {}).temperature || 0), target: num(set.cool_temp, 0) };
      // it pushes anyway after cool_timeout: say when
      const left = M.coolLeft(st, set, (app.status.toolhead || {}).estimated_print_time);
      sub = left === null ? t("status.sub.cooling", vars) : t("status.sub.cooling_by", Object.assign(vars, { at: iso(fmtClock(Date.now() / 1000 + left)) }));
    }
    else if (ph === "working") sub = st.swept ? t("status.sub.checking") : t("status.sub.working");
    else if (ph === "printing" || ph === "paused") {
      const info = ps.info || {};
      sub = info.total_layer ? t("status.sub.printing", { file: ps.filename, l: num(info.current_layer || 0, 0), t: num(info.total_layer, 0) })
                             : t("status.sub.printing_nolayer", { file: ps.filename });
    } else if (leftover().length) sub = t("status.sub.leftover", { names: leftover().join(lang === "ar" ? "، " : ", ") });
    else if (ph === "waiting") sub = t("status.sub.queue_paused");
    else if (n) sub = hgt > 0 ? t("status.sub.parts", { n: num(n, 0), h: num(hgt) }) : t("status.sub.parts_noh", { n: num(n, 0) });
    else sub = t("status.sub.clear");
    return { ph, title: t("status." + ph), sub };
  }

  function progress() {
    const ph = phase();
    if (ph === "printing" || ph === "paused") {
      const p = (app.status.display_status || {}).progress || (app.status.virtual_sdcard || {}).progress || 0;
      const ps = app.status.print_stats || {};
      const left = p > 0.01 ? (ps.print_duration || 0) * (1 - p) / p : 0;
      return { value: p, text: t("status.eta", { p: num(p * 100, 0), left: duration(left) }) };
    }
    if (ph === "cooling") {
      const bed = (app.status.heater_bed || {}).temperature || 0;
      const target = sv().cool_temp;
      const start = Math.max(app.coolStart || bed, bed);
      const v = start > target ? (start - bed) / (start - target) : 1;
      return { value: Math.max(0.02, Math.min(1, v)), text: "⁦" + num(bed) + " → " + num(target, 0) + " °C⁩" };
    }
    if (ph === "working") {
      const pl = plan();
      const total = pl ? pl.pushes.length : 0;
      return { value: total ? Math.max(0.04, app.lanesDone.size / total) : 0.5, text: total ? num(app.lanesDone.size, 0) + " / " + num(total, 0) : "" };
    }
    return null;
  }

  function viewOverview() {
    const ph = phase();
    const set = sv();
    const n = parts().length;
    const why = blocked();
    const lo = leftover();
    const dir = String(set.direction || "front");
    const edge = t("edge." + dir);

    // ----- status
    const ht = heroText();
    const job = (app.status.print_stats || {}).filename || "";
    const jm = job ? app.meta[job] : null;
    if (job && !jm) meta(job).then(() => refresh("overview"));
    const jobPic = jm ? thumbSrc(job, jm, 300) : "";
    const hero = h("section", { class: "card hero", "data-state": ht.ph },
      h("div", { class: "hero-top" },
        h("div", { class: "hero-ic" }, icon(STATE_ICON[ht.ph], "lg")),
        h("div", { style: { minWidth: 0, flex: "1" } }, h("h1", { text: ht.title }), h("p", { "data-live": "sub", text: ht.sub })),
        jobPic ? thumbBox(jobPic, "hero") : null));
    const pr = progress();
    if (pr) {
      hero.appendChild(h("div", { class: "progress" }, h("i", { "data-live": "bar", style: { width: (pr.value * 100).toFixed(1) + "%" } })));
      hero.appendChild(h("div", { class: "prog-text" }, h("span", { "data-live": "ptext", text: pr.text })));
    }
    const bed = app.status.heater_bed;
    hero.appendChild(h("div", { class: "chips" },
      bed ? h("span", { class: "chip" }, icon("thermo"), h("span", { text: t("c.bed") }),
        h("b", { class: "ltr", "data-live": "bed", text: num(bed.temperature) + " °C" })) : null,
      h("span", { class: "chip" }, icon("box"), h("b", { text: num(n, 0) }), h("span", { text: t("facts.parts") })),
      binChip(set),
      spoolChip(),
      app.hasQueue ? h("a", { class: "chip", href: "#/queue" }, icon("queue"), h("span", { text: t("facts.queue") + ":" }),
        h("b", { text: t("facts.queue_value", { n: num(app.queue.jobs.length, 0) }) })) : null,
      farmShown() && farm.data.printers.length > 1 ? h("a", { class: "chip" + (farmNeeds() ? " bad" : ""), href: "#/farm" }, icon("farm"),
        h("span", { text: t("nav.farm") + ":" }),
        h("b", { text: farmNeeds() ? t("farm.count.needs", { n: num(farmNeeds(), 0) }) : t("farm.count.all", { n: num(farm.data.printers.length, 0) }) })) : null));

    // ----- leftover warning
    const left = lo.length ? h("div", { class: "banner bad" }, icon("alert"),
      h("div", { class: "grow" }, h("b", { text: t("leftover.title") }),
        h("div", { text: t("leftover.body", { names: lo.join(", ") }) }),
        h("div", { class: "btns" },
          h("button", { type: "button", class: "btn sm", disabled: !!why, onclick: () => gcode(homed() ? "AUTO_EJECT" : "AUTO_EJECT HOME=1") }, icon("push"), t("leftover.retry")),
          h("button", { type: "button", class: "btn sm", disabled: !!why, onclick: doClear }, icon("hand"), t("act.clear"))))) : null;

    // ----- actions
    const ejectWhy = why || (n ? "" : "act.why_empty");
    const mainLabel = homed() ? t("act.eject") : t("act.home_eject");
    const st0 = aeState();
    const bgCool = !!(st0.bg && st0.cooling);
    const actions = bgCool ? h("section", { class: "card" },
      h("h2", null, icon("push"), t("act.title")),
      h("div", { class: "act-main" },
        h("button", { type: "button", class: "btn primary lg block", disabled: !!st0.push_now, onclick: doPushNow }, icon("push"), t("act.push_now")),
        h("div", { class: "desc", text: st0.push_now ? t("act.push_soon") : t("act.bg_desc") })),
      h("div", { class: "act-list" },
        actRow("hand", t("act.clear"), t("act.bg_clear_desc"), "", doClear))) : h("section", { class: "card" },
      h("h2", null, icon("push"), t("act.title")),
      h("div", { class: "act-main" },
        h("button", { type: "button", class: "btn primary lg block", disabled: !!ejectWhy, onclick: doEject }, icon("push"), mainLabel),
        h("div", { class: "desc", text: ejectWhy ? t(ejectWhy) : (homed() ? t("act.eject_desc") : t("act.home_eject_desc")) })),
      h("div", { class: "act-list" },
        actRow("eye", t("act.dry"), t("act.dry_desc"), why || (n ? "" : "act.why_empty"), doDry),
        actRow("hand", t("act.clear"), t("act.clear_desc"), why || (n ? "" : "act.why_empty"), doClear),
        app.hasQueue && app.queue.state === "paused" ? actRow("play", t("act.continue"), t("act.continue_desc"), why, () => gcode("AUTO_EJECT_CONTINUE")) : null));

    // ----- bed
    const pl = plan();
    const bedCard = h("section", { class: "card" },
      h("h2", null, icon("overview"), t("bed.title"),
        h("span", { class: "right", text: pl && pl.pushes.length ? t("bed.pushes", { n: num(pl.pushes.length, 0) }) + " · " + t("facts.drop") + ": " + edge : "" })),
      bedMap(pl, { live: true }),
      h("div", { class: "legend" },
        h("span", null, h("i", { class: "p" }), t("bed.parts")),
        h("span", null, h("i", { class: "l" }), t("bed.lanes")),
        lo.length ? h("span", null, h("i", { class: "x" }), t("bed.leftover")) : null,
        h("span", null, h("i", { class: "t" }), t("bed.nozzle"))),
      pl && pl.clamped ? h("p", { class: "note", style: { color: "var(--bad)", marginTop: "10px" } }, icon("alert"),
        t("bed.far", { name: (pl.pushes.find((p) => p.clamped).parts || [])[0] || "" })) : null);

    // ----- facts
    const pb = probe();
    const facts = h("section", { class: "card" }, h("h2", null, icon("info"), t("facts.title")),
      h("dl", { class: "facts" },
        fact(t("facts.height"), aeState().height > 0 ? t("c.mm", { v: num(aeState().height) }) : "—"),
        fact(t("facts.blade"), set.blade_width !== undefined ? t("facts.blade_value", { w: num(set.blade_width, 0), o: num(set.blade_offset) }) : "—"),
        fact(t("facts.push_when"), set.cool_mode === "temperature" ? h("span", { class: "ltr", text: num(set.cool_temp, 0) + " °C" })
          : set.cool_mode === "time" ? duration(set.cool_time) : t("facts.none")),
        fact(t("facts.drop"), edge),
        fact(t("facts.probe"), t(pb.label) + (pb.section ? " [" + pb.section + "]" : "")),
        app.hasQueue ? fact(t("facts.queue"), t("facts.queue_value", { n: num(app.queue.jobs.length, 0) })) : null));

    const cam = app.webcams.find((w) => w.enabled !== false);
    const camera = cam ? h("section", { class: "card camera" }, h("h2", null, icon("camera"), t("camera.title"), h("span", { class: "right", text: cam.name })),
      h("img", { alt: cam.name, src: camUrl(cam), "data-live": "cam" })) : null;

    const box = aeState().bin || 0, boxCap = Number(set.bin_capacity) || 0;
    const boxFull = boxCap > 0 && box >= boxCap ? h("div", { class: "banner bad" }, icon("tray"),
      h("div", { class: "grow" }, h("b", { text: t("bin.full_title") }),
        h("div", { text: t("bin.full_body", { n: num(box, 0), cap: num(boxCap, 0) }) }),
        h("div", { class: "btns" }, h("button", { type: "button", class: "btn sm", onclick: doBinEmpty }, icon("ok"), t("bin.empty"))))) : null;
    const sp = spoolCheck();
    const spoolLow = spoolTrouble(sp) && (sp.nowShort || (sp.stopAt === 0 && app.queue.state === "paused")) ? h("div", { class: "banner warn" }, icon("spool"),
      h("div", { class: "grow" }, h("b", { text: t(sp.nowShort ? "spool.now_title" : "spool.stopped_title") }),
        h("div", { text: sp.nowShort ? t("spool.now_short", { g: num(sp.now, 0), left: num(Math.max(0, sp.left), 0), reserve: num(sp.reserve, 0) })
                                     : t("spool.stopped_body", { g: num(sp.jobs[0].grams, 0), left: num(Math.max(0, sp.after), 0), reserve: num(sp.reserve, 0) }) }),
        h("div", { class: "btns" }, h("a", { class: "btn sm", href: "#/queue" }, icon("queue"), t("spool.see_queue"))))) : null;
    const el = h("div", null, left, boxFull, spoolLow, h("div", { class: "cols" },
      h("div", { class: "stack" }, hero, actions, camera),
      h("div", { class: "stack" }, bedCard, facts)));

    return {
      el,
      update() {
        const ht2 = heroText();
        const subEl = $('[data-live="sub"]', el);
        if (subEl) subEl.textContent = ht2.sub;
        const p2 = progress();
        const bar = $('[data-live="bar"]', el);
        if (bar && p2) bar.style.width = (p2.value * 100).toFixed(1) + "%";
        const pt = $('[data-live="ptext"]', el);
        if (pt && p2) pt.textContent = p2.text;
        const b2 = $('[data-live="bed"]', el);
        if (b2 && app.status.heater_bed) b2.textContent = num(app.status.heater_bed.temperature) + " °C";
        updateTool(el);
      }
    };
  }
  viewOverview.sig = function () {
    const st = aeState();
    const ps = app.status.print_stats || {};
    const m = settings();
    return JSON.stringify([phase(), parts().map((r) => r.slice(0, 5)), st.leftover, st.height, homed(), blocked(), ps.filename,
      m && m.values, app.queue.state, app.queue.jobs.length, app.hasQueue, Object.keys(app.config).length, app.webcams.length,
      Array.from(app.lanesDone), Object.keys(polygons()).length, farmShown() && farm.data.printers.length, farmNeeds(), st.bin,
      !!(ps.filename && app.meta[ps.filename]), spoolSig(), !!st.push_now]);
  };

  function camUrl(cam) {
    // an MJPEG stream plays in an <img>; anything else shows snapshots
    const u = /mjpeg/.test(cam.service || "") || !cam.snapshot_url ? cam.stream_url || "" : cam.snapshot_url;
    if (/^https?:/.test(u) || u.startsWith("/")) return u;
    return "/" + u.replace(/^\.?\//, "");
  }

  function actRow(ic, title, desc, why, fn) {
    return h("div", { class: "act-row" }, icon(ic, "lead"),
      h("div", { class: "txt" }, h("b", { text: title }), h("span", { text: why ? t(why) : desc })),
      h("button", { type: "button", class: "btn sm", disabled: !!why, onclick: fn, "aria-label": title }, icon("play")));
  }

  function fact(label, value) {
    return h("div", { class: "fact" }, h("dt", { text: label }), h("dd", null, value));
  }

  function doEject() {
    const set = sv();
    confirm(homed() ? t("act.eject") : t("act.home_eject"),
      t("act.eject_confirm", { n: num(parts().length, 0), edge: edgeIn(set.direction) }), t("act.eject"))
      .then((ok) => { if (ok) gcode(homed() ? "AUTO_EJECT" : "AUTO_EJECT HOME=1"); });
  }
  // an edge name inside a sentence
  function edgeIn(dir) {
    const name = t("edge." + (dir || "front"));
    return lang === "en" ? name.toLowerCase() : name;
  }

  function doDry() {
    confirm(t("act.dry"), t("act.dry_confirm"), t("act.dry"))
      .then((ok) => { if (ok) gcode(homed() ? "AUTO_EJECT DRY=1" : "AUTO_EJECT DRY=1 HOME=1"); });
  }
  function doPushNow() {
    confirm(t("act.push_now"), t("act.push_confirm"), t("act.push_now"))
      .then((ok) => { if (ok) gcode("AUTO_EJECT_PUSH_NOW"); });
  }
  function doClear() {
    confirm(t("act.clear"), t("act.clear_confirm"), t("act.clear"), "danger")
      .then((ok) => { if (ok) gcode("AUTO_EJECT_CLEAR"); });
  }

  /* ============================================================ bed map */

  // Top view in printer millimetres, the front of the bed at the bottom.
  function bedMap(pl, opts) {
    opts = opts || {};
    const set = sv();
    const ax = axes();
    const x0 = ax.min[0], x1 = ax.max[0], y0 = ax.min[1], y1 = ax.max[1];
    const W = x1 - x0, H = y1 - y0;
    const pad = Math.max(W, H) * 0.075;
    const X = (x) => x - x0 + pad;
    const Y = (y) => y1 - y + pad;
    const svg = s("svg", { viewBox: "0 0 " + (W + 2 * pad) + " " + (H + 2 * pad), role: "img", "aria-label": t("bed.title"), direction: "ltr" });
    const defs = s("defs", null, s("marker", { id: "ae-arrow" + (opts.id || ""), viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse" },
      s("path", { d: "M0,0 L10,5 L0,10 z", class: "bm-arrow-head" })));
    svg.appendChild(defs);
    svg.appendChild(s("rect", { class: "bm-bed", x: X(x0), y: Y(y1), width: W, height: H, rx: 6 }));
    const grid = s("g");
    const step = W > 260 ? 50 : 25;
    for (let gx = Math.ceil(x0 / step) * step; gx <= x1; gx += step) grid.appendChild(s("line", { class: "bm-grid", x1: X(gx), x2: X(gx), y1: Y(y0), y2: Y(y1) }));
    for (let gy = Math.ceil(y0 / step) * step; gy <= y1; gy += step) grid.appendChild(s("line", { class: "bm-grid", x1: X(x0), x2: X(x1), y1: Y(gy), y2: Y(gy) }));
    svg.appendChild(grid);

    // the drop edge
    const dir = String(set.direction || "front");
    const bar = pad * 0.28;
    const dropText = t("bed.drop").toUpperCase();
    const textAttrs = { class: "bm-drop-text", "text-anchor": "middle", "font-size": pad * 0.36 };
    if (dir === "front") {
      svg.appendChild(s("rect", { class: "bm-drop", x: X(x0), y: Y(y0) + 2, width: W, height: bar, rx: bar / 2 }));
      svg.appendChild(s("text", Object.assign({ x: X(x0) + W / 2, y: Y(y0) + bar + pad * 0.5 }, textAttrs), dropText));
    } else if (dir === "back") {
      svg.appendChild(s("rect", { class: "bm-drop", x: X(x0), y: Y(y1) - bar - 2, width: W, height: bar, rx: bar / 2 }));
      svg.appendChild(s("text", Object.assign({ x: X(x0) + W / 2, y: Y(y1) - bar - pad * 0.25 }, textAttrs), dropText));
    } else if (dir === "left") {
      svg.appendChild(s("rect", { class: "bm-drop", x: X(x0) - bar - 2, y: Y(y1), width: bar, height: H, rx: bar / 2 }));
      svg.appendChild(s("text", Object.assign({ transform: "translate(" + (X(x0) - bar - pad * 0.2) + "," + (Y(y1) + H / 2) + ") rotate(-90)" }, textAttrs), dropText));
    } else {
      svg.appendChild(s("rect", { class: "bm-drop", x: X(x1) + 2, y: Y(y1), width: bar, height: H, rx: bar / 2 }));
      svg.appendChild(s("text", Object.assign({ transform: "translate(" + (X(x1) + bar + pad * 0.55) + "," + (Y(y1) + H / 2) + ") rotate(90)" }, textAttrs), dropText));
    }
    if (dir !== "front") svg.appendChild(s("text", { class: "bm-label", x: X(x0) + W / 2, y: Y(y0) + pad * 0.62, "text-anchor": "middle", "font-size": pad * 0.32 }, t("edge.front")));

    // push lanes
    if (pl && set.blade_width) {
      const half = set.blade_width / 2;
      pl.pushes.forEach((p, i) => {
        const cls = "bm-lane" + (p.clamped ? " far" : "") + (opts.live && app.lanesDone.has(i) ? " done" : "");
        let rx, ry, rw, rh;
        if (pl.ai === 1) { rx = X(p.c - half); rw = set.blade_width; ry = Y(Math.max(p.y0, p.y1)); rh = Math.abs(p.y1 - p.y0); }
        else { rx = X(Math.min(p.x0, p.x1)); rw = Math.abs(p.x1 - p.x0); ry = Y(p.c + half); rh = set.blade_width; }
        svg.appendChild(s("rect", { class: cls, x: rx, y: ry, width: rw, height: rh, rx: 3 }));
        svg.appendChild(s("line", { class: "bm-arrow", x1: X(p.x0), y1: Y(p.y0), x2: X(p.x1), y2: Y(p.y1), "marker-end": "url(#ae-arrow" + (opts.id || "") + ")" }));
      });
    }

    // parts
    const recs = opts.records || parts();
    const polys = opts.polygons || polygons();
    const lo = new Set(opts.records ? [] : leftover());
    const short = M.shortNames(recs.map((r) => r[0]));
    recs.forEach((r, k) => {
      const cls = "bm-part" + (lo.has(r[0]) ? " left" : "");
      const poly = polys[r[0]] || r[8];
      if (poly && poly.length > 2) svg.appendChild(s("polygon", { class: cls, points: poly.map((p) => X(p[0]) + "," + Y(p[1])).join(" ") }));
      else svg.appendChild(s("rect", { class: cls, x: X(r[1]), y: Y(r[4]), width: Math.max(1, r[2] - r[1]), height: Math.max(1, r[4] - r[3]), rx: 2 }));
      if (r[2] - r[1] > 34 && recs.length <= 16) {
        const name = short[k].length > 14 ? short[k].slice(0, 13) + "…" : short[k];
        svg.appendChild(s("text", { class: "bm-name", x: X((r[1] + r[2]) / 2), y: Y(r[3]) + pad * 0.32, "text-anchor": "middle", "font-size": pad * 0.26 }, name));
      }
    });
    if (!recs.length) svg.appendChild(s("text", { class: "bm-label", x: X(x0) + W / 2, y: Y(y0) - H / 2, "text-anchor": "middle", "font-size": pad * 0.42 },
      t(opts.live && !app.loaded ? "status.sub.loading" : "bed.empty")));

    // toolhead and blade
    if (opts.live) {
      const g = s("g", { class: "bm-tool", "data-live": "tool" });
      const off = Number(set.blade_offset) || 0, half = (Number(set.blade_width) || 60) / 2;
      const sign = dir === "front" || dir === "left" ? -1 : 1;
      let bx1, by1, bx2, by2;
      if (dir === "front" || dir === "back") { bx1 = -half; bx2 = half; by1 = by2 = -sign * off; }
      else { by1 = -half; by2 = half; bx1 = bx2 = sign * off; }
      const k = Math.max(W, H) / 350;
      g.appendChild(s("line", { class: "bm-blade", x1: bx1, y1: by1, x2: bx2, y2: by2 }));
      g.appendChild(s("rect", { class: "bm-head", x: -16 * k, y: -16 * k, width: 32 * k, height: 32 * k, rx: 6 * k, opacity: 0.18 }));
      g.appendChild(s("circle", { class: "bm-nozzle", r: 4.5 * k }));
      g.dataset.ox = String(pad - x0);
      g.dataset.oy = String(y1 + pad);
      svg.appendChild(g);
    }
    return h("div", { class: "bedmap" }, svg);
  }

  function updateTool(el) {
    const g = $('[data-live="tool"]', el);
    const pos = (app.status.toolhead || {}).position;
    if (!g || !pos) return;
    const x = pos[0] + Number(g.dataset.ox), y = Number(g.dataset.oy) - pos[1];
    g.style.transform = "translate(" + x.toFixed(1) + "px, " + y.toFixed(1) + "px)";
    g.style.display = homed() ? "" : "none";
  }

  /* ============================================================== queue */

  const queueUi = { file: "", filter: "" };

  function viewQueue() {
    if (!app.hasQueue) return { el: h("div", null, head("queue.title"), h("div", { class: "card empty" }, icon("queue"), h("p", { text: t("queue.unavailable") }))) };
    if (app.files === null) loadFiles();
    const q = app.queue;
    const paused = q.state === "paused";
    const set = sv();
    const sp = spoolCheck();
    const fil = ((app.spool || {}).data || {}).filament;
    let total = 0;
    const rows = q.jobs.map((j, i) => {
      const m = app.meta[j.filename];
      if (!m) meta(j.filename).then(() => refresh("queue"));
      total += (m && m.estimated_time) || 0;
      let badge = h("span", { class: "badge", text: t("queue.badge.unknown") });
      if (m && m.object_height) {
        const thin = set.min_part_height > 0 && m.object_height < set.min_part_height && set.thin_parts_action === "ignore";
        badge = thin ? h("span", { class: "badge warn", text: t("queue.badge.thin") }) : h("span", { class: "badge ok", text: t("queue.badge.ok") });
      }
      const g = m ? M.fileGrams(m, fil) : null;
      const short = !!sp && sp.action !== "off" && !!sp.jobs[i] && sp.jobs[i].fit === "short";
      return h("div", { class: "row" + (i === 0 && !paused ? " now" : "") + (short ? " short" : "") },
        h("span", { class: "num", text: num(i + 1, 0) }),
        thumbBox(m ? thumbSrc(j.filename, m, 96) : null, "sm"),
        h("div", { class: "grow" }, h("div", { class: "name ltr", text: j.filename }),
          h("div", { class: "sub" }, m && m.estimated_time ? duration(m.estimated_time) : "", m && m.object_height ? " · " + t("c.mm", { v: num(m.object_height) }) : "",
            g !== null ? " · " + t("spool.g", { g: num(g, 0) }) : "")),
        short ? h("span", { class: "badge bad", text: t("queue.badge.spool") }) : badge,
        h("button", { type: "button", class: "icon-btn", title: t("queue.remove"), "aria-label": t("queue.remove"),
          onclick: () => client.call("server.job_queue.delete_job", { job_ids: [j.job_id] }).then(() => toast(t("queue.removed"))).catch((e) => toast(e.message, "bad")) }, icon("trash")));
    });

    // the files, with their pictures, as on "Check a file"
    const qf = queueUi.filter.toLowerCase();
    const files = (app.files || []).filter((f) => !qf || f.path.toLowerCase().includes(qf));
    const watch = lazyRows(meta, (el, m) => fillFileRow(el, m, thumbSrc(el.dataset.file, m, 96)));
    const pickList = app.files === null ? h("div", { class: "empty" }, h("span", { class: "spinner" }))
      : files.length ? h("div", { class: "list files pick" }, files.slice(0, 300).map((f) => {
          const m = app.meta[f.path];
          const row = fileRow(f, m, m ? thumbSrc(f.path, m, 96) : null, () => { queueUi.file = f.path; refresh("queue"); }, f.path === queueUi.file ? "active" : "");
          if (!m) watch(row);
          return row;
        }))
      : h("div", { class: "empty" }, icon("file"), h("p", { text: t("check.no_files") }));
    const search = h("div", { class: "search" }, icon("search"),
      h("input", { class: "input", type: "search", placeholder: t("check.search"), "aria-label": t("check.search"), value: queueUi.filter, "data-keep": "q-search",
        oninput: (e) => { queueUi.filter = e.target.value; refresh("queue"); } }));
    const copies = h("input", { class: "input", type: "number", min: 1, max: 50, value: 1, "data-keep": "q-copies", style: { width: "90px" } });

    const ps = app.status.print_stats || {};
    if (["printing", "paused"].includes(ps.state) && ps.filename) {
      const p = (app.status.display_status || {}).progress || 0;
      const pm = app.meta[ps.filename];
      if (!pm) meta(ps.filename).then(() => refresh("queue"));
      rows.unshift(h("div", { class: "row now" }, h("span", { class: "num" }, icon("play")),
        thumbBox(pm ? thumbSrc(ps.filename, pm, 96) : null, "sm"),
        h("div", { class: "grow" }, h("div", { class: "name ltr", text: ps.filename }),
          h("div", { class: "sub", text: t("queue.now") + " · " + num(p * 100, 0) + " %" }))));
    }
    const el = h("div", null,
      head("queue.title", "queue.intro"),
      h("div", { class: "cols" },
        h("div", { class: "stack" },
          h("section", { class: "card" },
            h("h2", null, icon("queue"), t("queue.title"),
              h("span", { class: "right" }, h("span", { class: "badge " + (paused ? "warn" : "ok"), text: t("queue.state." + (q.state || "ready")) }))),
            rows.length ? h("div", { class: "list" }, rows) : h("div", { class: "empty" }, icon("queue"), h("p", { text: t("queue.empty") })),
            h("div", { class: "toolbar", style: { marginTop: "14px" } },
              paused ? h("button", { type: "button", class: "btn primary", onclick: startQueue }, icon("play"), t("queue.start"))
                     : h("button", { type: "button", class: "btn", onclick: () => client.call("server.job_queue.pause").catch((e) => toast(e.message, "bad")) }, icon("pause"), t("queue.pause")),
              q.jobs.length ? h("span", { class: "muted", text: t("queue.total", { n: num(q.jobs.length, 0), t: duration(total) }) }) : null)),
          spoolCard(sp)),
        h("div", { class: "stack" },
          h("section", { class: "card" },
            h("h2", null, icon("plus"), t("queue.add")),
            search,
            h("div", { style: { marginTop: "10px" } }, pickList),
            h("div", { class: "form-row", style: { marginTop: "12px" } },
              h("div", { class: "grow pick-chosen" }, queueUi.file ? h("span", { class: "name ltr", text: queueUi.file }) : h("span", { class: "muted", text: t("queue.pick_hint") })),
              h("label", { class: "field" }, h("span", { text: t("queue.copies") }), copies),
              h("button", { type: "button", class: "btn primary", disabled: !queueUi.file, onclick: () => {
                const f = queueUi.file;
                const n = Math.max(1, Math.min(50, parseInt(copies.value, 10) || 1));
                if (!f) return;
                client.call("server.job_queue.post_job", { filenames: Array(n).fill(f), reset: false })
                  .then(() => toast(t("queue.added", { n: num(n, 0) }), "ok")).catch((e) => toast(e.message, "bad"));
              } }, icon("plus"), t("queue.add_button")))),
          h("section", { class: "card" },
            h("p", { class: "note" }, icon(app.autoTransition ? "ok" : "info"), h("span", { text: app.autoTransition ? t("queue.auto_on") : t("queue.auto_off") })),
            h("p", { class: "note", style: { marginTop: "10px" } }, icon("info"), h("span", null, t("guide.slicer"), " ", h("code", { class: "ltr", text: "AUTO_EJECT HEIGHT=[max_layer_z] HOME=1" }))),
            // without Spoolman: say what it would add, once, quietly
            app.spool ? null : h("p", { class: "note", style: { marginTop: "10px" } }, icon("spool"), h("span", null, t("spool.hint"), " ",
              h("a", { href: DOCS + "/blob/main/docs/" + (lang === "ar" ? "ar/" : "") + "spoolman.md", target: "_blank", rel: "noopener", text: t("spool.hint_link") })))))));
    return { el };
  }
  viewQueue.sig = function () {
    const ps = app.status.print_stats || {};
    return JSON.stringify([app.hasQueue, app.queue, ps.state, ps.filename, Math.round(((app.status.display_status || {}).progress || 0) * 100), app.autoTransition, (app.files || []).length, Object.keys(app.meta).length, sv().min_part_height, sv().thin_parts_action, queueUi.file, queueUi.filter,
      spoolSig()]);
  };

  // A queue whose next job the spool cannot finish asks before it starts.
  function startQueue() {
    const p = spoolCheck();
    const go = () => client.call("server.job_queue.start").catch((e) => toast(e.message, "bad"));
    if (!spoolTrouble(p) || p.stopAt !== 0) return go();
    confirm(t("spool.start_title"), t("spool.start_body", { g: num(p.jobs[0].grams, 0), left: num(Math.max(0, p.after), 0), reserve: num(p.reserve, 0) }), t("queue.start"))
      .then((ok) => { if (ok) go(); });
  }

  function spoolSig() {
    const sp = app.spool;
    const p = spoolCheck();
    return sp ? [sp.connected, sp.id, sp.data && Math.round(sp.data.remaining_weight || 0), sp.data && sp.data.filament && sp.data.filament.id,
      (sp.list || []).length, !!sp.list, !!sp.listing, app.spoolmanUrl, p && [p.nowShort, p.stopAt, p.fit, p.jobs.map((j) => j.fit)]] : null;
  }

  // The spool on the printer: what is left, and whether the queue fits.
  function spoolCard(p) {
    const sp = app.spool;
    if (!sp) return null;
    const link = /^https?:\/\//i.test(app.spoolmanUrl) ? h("a", { class: "right", href: app.spoolmanUrl, target: "_blank", rel: "noopener" },
      t("spool.open"), icon("external")) : null;
    const head = h("h2", null, icon("spool"), t("spool.title"), link);
    const picker = () => {
      if (!sp.list) return h("button", { type: "button", class: "btn sm", disabled: !!sp.listing, onclick: loadSpools }, icon("spool"), t("spool.change"));
      return h("label", { class: "field grow" }, h("span", { text: t("spool.change") }),
        h("select", { class: "input", onchange: (e) => useSpool(e.target.value === "" ? null : e.target.value) },
          h("option", { value: "", text: t("spool.none"), selected: sp.id === null }),
          sp.list.map((x) => h("option", { value: String(x.id), selected: x.id === sp.id,
            text: "#" + x.id + " · " + M.spoolName(x) + (typeof x.remaining_weight === "number" ? " · " + t("spool.g", { g: num(x.remaining_weight, 0) }) : "") }))));
    };
    if (sp.connected === undefined) return h("section", { class: "card" }, head, h("div", { class: "empty" }, h("span", { class: "spinner" })));
    if (!sp.connected) return h("section", { class: "card" }, head, h("p", { class: "note" }, icon("alert"), h("span", { text: t("spool.offline") })));
    if (sp.id === null) return h("section", { class: "card" }, head, h("p", { class: "note" }, icon("info"), h("span", { text: t("spool.unset") })),
      h("div", { class: "toolbar", style: { marginTop: "12px" } }, picker()));
    const d = sp.data || {}, f = d.filament || {};
    const full = Number(d.initial_weight) || Number(f.weight) || 0;
    const left = typeof d.remaining_weight === "number" ? d.remaining_weight : null;
    const color = /^[0-9a-f]{6}$/i.test(f.color_hex || "") ? "#" + f.color_hex : "";
    let line = null;
    if (left === null) line = h("p", { class: "note" }, icon("info"), h("span", { text: t("spool.no_weight") }));
    else if (!p || p.action === "off") line = null;
    else if (p.nowShort) line = h("p", { class: "note bad" }, icon("alert"), h("span", { text: t("spool.now_short", { g: num(p.now, 0), left: num(Math.max(0, p.left), 0), reserve: num(p.reserve, 0) }) }));
    else if (p.stopAt >= 0) {
      const j = p.jobs[p.stopAt];
      line = h("p", { class: "note warn" }, icon("alert"), h("span", { text: t(p.action === "stop" ? "spool.stops_at" : "spool.short_at",
        { n: num(p.stopAt + 1, 0), g: num(j.grams, 0), left: num(Math.max(0, j.left + j.grams), 0), reserve: num(p.reserve, 0) }) }));
    } else if (p.jobs.some((j) => j.fit === "unknown")) {
      line = h("p", { class: "note" }, icon("info"), h("span", { text: t("spool.unknown_at", { n: num(p.jobs.findIndex((j) => j.fit === "unknown") + 1, 0) }) }));
    } else if (p.jobs.length) line = h("p", { class: "note ok" }, icon("ok"), h("span", { text: t("spool.fits", { left: num(Math.max(0, p.jobs[p.jobs.length - 1].left), 0) }) }));
    return h("section", { class: "card" }, head,
      h("div", { class: "spool-head" },
        h("span", { class: "spool-swatch", style: color ? { background: color } : null }),
        h("div", { class: "grow" }, h("b", { text: M.spoolName(d) }),
          h("div", { class: "sub ltr", text: ["#" + d.id, f.material, f.diameter ? num(f.diameter, 2) + " mm" : ""].filter(Boolean).join(" · ") })),
        left !== null ? h("div", { class: "spool-left" }, h("b", { text: spoolGrams(left) }), full ? h("span", { class: "sub", text: t("spool.of", { g: num(full, 0) }) }) : null) : null),
      left !== null && full ? h("div", { class: "meter" + (spoolTrouble(p) ? " warn" : "") }, h("i", { style: { width: Math.max(1, Math.min(100, left / full * 100)).toFixed(1) + "%" } })) : null,
      line,
      h("div", { class: "toolbar", style: { marginTop: "12px" } }, picker()));
  }

  function head(titleKey, introKey, extra) {
    return h("div", { class: "view-head" }, h("div", null, h("h1", { text: t(titleKey) }), introKey ? h("p", { text: t(introKey) }) : null), extra || null);
  }

  /* ============================================================== check */

  const check = { file: "", result: null, loading: false, error: "", filter: "" };

  function runCheck(file) {
    check.file = file;
    check.loading = true;
    check.result = null;
    check.error = "";
    refresh("check");
    const path = "/server/files/gcodes/" + file.split("/").map(encodeURIComponent).join("/");
    const info = (app.files || []).find((f) => f.path === file) || {};
    const size = info.size || 0;
    const chunk = 524288;
    const headP = client.fetchText(path, "0-" + (chunk - 1));
    // a server that ignores Range sends the whole file the first time
    const tailP = headP.then((text) => (size > chunk && text.length < chunk * 1.5 ? client.fetchText(path, "-" + chunk) : text));
    Promise.all([headP, tailP, meta(file)]).then(([headText, tailText, m]) => {
      if (check.file !== file) return;
      const ax = axes();
      check.result = M.checkFile(headText, tailText || headText, m || {}, sv(), ax.min, ax.max);
      check.slicer = M.slicerKind((m || {}).slicer);
      check.tail = String(tailText || headText).slice(-262144);
      check.endMacro = M.endMacroInFile(check.tail, M.endMacros(app.config));
    }).catch((e) => { check.error = e.message; }).then(() => { check.loading = false; refresh("check"); });
  }

  function viewCheck() {
    if (app.files === null) loadFiles();
    const q = check.filter.toLowerCase();
    const files = (app.files || []).filter((f) => !q || f.path.toLowerCase().includes(q));
    const search = h("div", { class: "search" }, icon("search"),
      h("input", { class: "input", type: "search", placeholder: t("check.search"), "aria-label": t("check.search"), value: check.filter, "data-keep": "c-search",
        oninput: (e) => { check.filter = e.target.value; refresh("check"); } }));
    const watch = lazyRows(meta, (el, m) => fillFileRow(el, m, thumbSrc(el.dataset.file, m, 96)));
    const list = app.files === null ? h("div", { class: "empty" }, h("span", { class: "spinner" }))
      : files.length ? h("div", { class: "list files" }, files.slice(0, 300).map((f) => {
          const m = app.meta[f.path];
          const row = fileRow(f, m, m ? thumbSrc(f.path, m, 96) : null, () => runCheck(f.path), f.path === check.file ? "active" : "");
          if (!m) watch(row);
          return row;
        }))
      : h("div", { class: "empty" }, icon("file"), h("p", { text: t("check.no_files") }));
    const fm = check.file ? app.meta[check.file] : null;
    const top = fm && (check.loading || check.result || check.error) ? fileHead(check.file, fm) : null;

    let result;
    if (check.loading) result = h("div", { class: "empty" }, h("span", { class: "spinner" }), h("p", { text: t("check.reading") }));
    else if (check.error) result = h("div", { class: "banner bad" }, icon("alert"), h("div", { text: t("c.error", { e: check.error }) }));
    else if (check.result) {
      const r = check.result;
      const vIcon = r.verdict === "ok" ? "ok" : r.verdict === "warn" ? "alert" : "bad";
      result = h("div", null,
        h("div", { class: "verdict " + r.verdict }, icon(vIcon),
          h("div", null, h("b", { text: t("check.verdict_" + r.verdict) }), top ? null : h("span", { class: "ltr", text: check.file }))),
        h("ul", { class: "checks" }, r.checks.map((c) => h("li", { class: c.ok }, icon(c.ok === "ok" ? "ok" : c.ok === "warn" ? "alert" : "bad"),
          h("span", { text: t(c.key, Object.assign({}, c.vars, c.vars && c.vars.n !== undefined ? { n: num(c.vars.n, 0) } : {})) })))),
        r.checks.some((c) => /^check\.(line_bad|line_order|labels_bad)$/.test(c.key)) ? h("div", { class: "toolbar", style: { marginTop: "12px" } },
          h("button", { type: "button", class: "btn primary", onclick: () => {
            if (check.slicer) slicerUi.kind = check.slicer;
            if (check.endMacro) slicerUi.found = { file: check.file, kind: check.slicer, tail: check.tail };
            slicerUi.scroll = true;
            location.hash = "#/setup";
          } }, icon("copy"), t("check.fix"))) : null,
        r.records.length ? h("div", { class: "check-map" }, bedMap(r.plan, { records: r.records, polygons: Object.fromEntries(r.objects.map((o) => [o.name.replace(/['"]/g, ""), o.polygon])), id: "c" })) : null,
        app.hasQueue ? h("div", { class: "toolbar", style: { marginTop: "14px" } },
          h("button", { type: "button", class: "btn", onclick: () => client.call("server.job_queue.post_job", { filenames: [check.file], reset: false })
            .then(() => toast(t("queue.added", { n: num(1, 0) }), "ok")).catch((e) => toast(e.message, "bad")) }, icon("plus"), t("check.add"))) : null);
    } else result = h("div", { class: "empty" }, icon("check"), h("p", { text: t("check.pick") }));

    return {
      el: h("div", null, head("check.title", "check.intro"),
        h("div", { class: "cols side" },
          h("section", { class: "card" }, search, h("div", { style: { marginTop: "10px" } }, list)),
          h("section", { class: "card" }, top, result)))
    };
  }
  viewCheck.sig = function () {
    return JSON.stringify([(app.files || []).length, app.files === null, check.file, check.loading, check.error, !!check.result, check.filter, app.hasQueue,
      !!(check.file && app.meta[check.file])]);
  };

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

  /* ----- pictures of the prints */

  // This printer's picture of a file, "" when the slicer put none in it.
  function thumbSrc(file, m, want) {
    const path = M.thumbPath(file, M.thumbPick((m || {}).thumbnails, want));
    return path ? client.fileUrl(path) : "";
  }
  // A square with the picture: grey while it loads (src null), a plain one without.
  function thumbBox(src, cls, onFail) {
    const box = h("div", { class: "thumb" + (cls ? " " + cls : "") });
    if (src === null || src === undefined) { box.classList.add("wait"); return box; }
    if (!src) { box.classList.add("none"); box.appendChild(icon("box")); return box; }
    const img = h("img", { alt: "", decoding: "async", src });
    img.addEventListener("error", () => { box.classList.add("none"); img.replaceWith(icon("box")); if (onFail) onFail(); });
    if (inkOf.has(src)) { if (inkOf.get(src)) box.classList.add("ink-" + inkOf.get(src)); }
    else img.addEventListener("load", () => { const k = ink(img); inkOf.set(src, k); if (k) box.classList.add("ink-" + k); });
    box.appendChild(img);
    return box;
  }
  // A black part on a dark page (or a white one on a light page) would not
  // show: how dark the part in the picture is, to put it on a backdrop that
  // stands it out. "" for a picture with its own background, or one from
  // another site that the page may not read.
  const inkOf = new Map();
  function ink(img) {
    try {
      const n = 24, c = document.createElement("canvas");
      c.width = c.height = n;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, n, n);
      const d = g.getImageData(0, 0, n, n).data;
      let sum = 0, seen = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        seen++;
      }
      if (!seen || seen > n * n * 0.95) return "";
      const l = sum / seen / 255;
      return l < 0.25 ? "dark" : l > 0.8 ? "light" : "";
    } catch (e) { return ""; }
  }
  function grams(f) {
    return f.grams ? num(f.grams, f.grams < 10 ? 1 : 0) + " g" : f.metres ? num(f.metres, 1) + " m" : "";
  }
  // The line under a file's name: print time, filament, height, material.
  function factsLine(m) {
    if (m === undefined) return h("div", { class: "facts-line wait" }, h("i"));
    const f = M.fileFacts(m);
    const bits = [["clock", f.time ? duration(f.time) : ""], ["spool", grams(f)], ["height", f.height ? t("c.mm", { v: num(f.height) }) : ""]]
      .filter((b) => b[1]).map((b) => h("span", null, icon(b[0]), h("span", { text: b[1] })));
    if (f.material) bits.push(h("span", { class: "mat ltr", text: f.material }));
    return h("div", { class: "facts-line" }, bits);
  }
  // A file's picture and everything its metadata tells, above a check.
  function fileHead(file, m) {
    const f = M.fileFacts(m);
    const rows = [];
    const add = (key, v) => { if (v) rows.push(h("dt", { text: t(key) }), h("dd", { text: v })); };
    add("file.time", f.time ? duration(f.time) : "");
    add("file.filament", [f.grams ? num(f.grams, f.grams < 10 ? 1 : 0) + " g" : "", f.metres ? num(f.metres, 1) + " m" : ""].filter(Boolean).join(" · "));
    add("file.height", f.height ? t("c.mm", { v: num(f.height) }) : "");
    add("file.layer", [f.layer ? t("c.mm", { v: num(f.layer, 2) }) : "", f.layers ? t("file.layers", { n: num(f.layers, 0) }) : ""].filter(Boolean).join(" · "));
    add("file.material", [f.material, f.nozzle ? t("file.nozzle", { v: num(f.nozzle, 2) }) : ""].filter(Boolean).join(" · "));
    add("file.slicer", f.slicer);
    return h("div", { class: "file-head" }, thumbBox(thumbSrc(file, m, 300), "lg"),
      h("div", { class: "grow" }, h("div", { class: "fh-name ltr", text: file }), rows.length ? h("dl", { class: "fh-facts" }, rows) : null));
  }
  // Fill rows in as they come into view: a long list reads only what is seen.
  function lazyRows(load, fill) {
    const go = (el) => load(el.dataset.file).then((m) => { if (el.isConnected) fill(el, m || {}); }, () => {});
    if (!("IntersectionObserver" in window)) return go;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { io.unobserve(e.target); go(e.target); }
    }), { rootMargin: "150px" });
    return (el) => io.observe(el);
  }
  function fillFileRow(el, m, src) {
    const box = el.querySelector(".thumb");
    if (box) box.replaceWith(thumbBox(src));
    const line = el.querySelector(".facts-line");
    if (line) line.replaceWith(factsLine(m));
  }
  // One G-code file in a list: its picture, name, facts, size and date.
  function fileRow(f, m, src, onclick, extra) {
    return h("button", { type: "button", class: "row file-row" + (extra ? " " + extra : ""), "data-file": f.path, title: f.path, onclick },
      thumbBox(m ? src : null),
      h("div", { class: "grow" }, h("div", { class: "name ltr", text: f.path }), factsLine(m),
        h("div", { class: "sub", text: t("check.size", { size: iso(fmtSize(f.size)), date: iso(fmtDate(f.modified)) }) })));
  }

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
  const PAGE_FILES = ["index.html", "app.js", "model.js", "qr.js", "style.css", "lang/en.js", "lang/ar.js"];
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
      else if (tag !== pageTags) { app.pageUpdate = true; chromeSig = ""; refresh(); }
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

  /* =========================================================== settings */

  const settingsUi = { filter: "", edits: {}, sending: {}, n: 0, changedOnly: false };

  function viewSettings() {
    const m = settings();
    if (!m) return { el: h("div", null, head("settings.title"), h("div", { class: "card empty" }, h("span", { class: "spinner" }))) };
    if (app.template === null) loadTemplate();
    const tpl = app.template || [];
    const known = new Set();
    const sections = tpl.map((sec) => {
      sec.items.forEach((i) => known.add(i.key));
      return { title: has("sec." + (sec.items[0] || {}).key) ? t("sec." + sec.items[0].key) : sec.title, items: sec.items };
    });
    const extra = Object.keys(m.values).filter((k) => !known.has(k)).sort().map((k) => ({ key: k, desc: "", choices: [], unit: "", def: m.values[k] }));
    if (extra.length) sections.push({ title: t("settings.other"), items: extra });
    const q = settingsUi.filter.toLowerCase();
    const persist = "save_variables" in app.status || DEMO;
    const mine = (it) => m.source[it.key] && m.source[it.key] !== "default";
    const cards = [], nav = [];
    let changedAll = 0;
    sections.forEach((sec, i) => {
      const items = sec.items.filter((it) => it.key in m.values);
      const changed = items.filter(mine).length;
      changedAll += changed;
      const rows = items.filter((it) => !q || it.key.includes(q) || describeSetting(it).toLowerCase().includes(q))
        .filter((it) => !settingsUi.changedOnly || mine(it)).map((it) => settingRow(it, m));
      if (!rows.length) return;
      const id = "set-sec-" + i;
      cards.push(h("section", { class: "card set-section", id }, h("h2", { text: sec.title }), rows));
      // the sections at the side: where each is, and how many are your own values
      nav.push(h("button", { type: "button", class: "set-nav-item", onclick: () => { const s = document.getElementById(id); if (s) s.scrollIntoView({ behavior: "smooth", block: "start" }); } },
        h("span", { class: "grow", text: sec.title }), changed ? h("span", { class: "badge accent", text: num(changed, 0) }) : null));
    });
    const el = h("div", null,
      head("settings.title", "settings.intro"),
      app.template === false ? h("div", { class: "banner" }, icon("info"), h("div", { text: t("settings.unavailable") })) : null,
      !persist ? h("div", { class: "banner" }, icon("info"), h("div", { text: t("settings.no_persist") })) : null,
      h("div", { class: "set-tools" },
        h("div", { class: "search" }, icon("search"),
          h("input", { class: "input", type: "search", placeholder: t("settings.search"), "aria-label": t("settings.search"), value: settingsUi.filter, "data-keep": "s-search",
            oninput: (e) => { settingsUi.filter = e.target.value; refresh("settings"); } })),
        h("label", { class: "switch" },
          h("input", { type: "checkbox", checked: settingsUi.changedOnly, onchange: (e) => { settingsUi.changedOnly = e.target.checked; refresh("settings"); } }),
          h("span", { text: t("settings.changed_only") })),
        h("span", { class: "muted set-count", text: t("settings.changed_n", { n: num(changedAll, 0) }) })),
      h("div", { class: "set-layout" },
        nav.length ? h("nav", { class: "set-nav", "aria-label": t("settings.sections") }, nav) : null,
        cards.length ? h("div", { class: "stack" }, cards)
          : h("div", { class: "card empty", text: t(settingsUi.changedOnly && !q ? "settings.none_changed" : "settings.none") })));
    return { el };
  }
  viewSettings.sig = function () {
    const m = settings();
    return JSON.stringify([m && m.values, m && m.source, !!app.template, app.template === false, settingsUi.filter, settingsUi.edits, settingsUi.sending, settingsUi.n, settingsUi.changedOnly]);
  };

  function describeSetting(it) {
    if (lang !== "en" && AE_TEXT[lang] && AE_TEXT[lang]["set." + it.key]) return AE_TEXT[lang]["set." + it.key];
    return it.desc || (AE_TEXT.en["set." + it.key] || "");
  }

  const UNITS = {
    blade_offset: "mm", blade_width: "mm", column_overlap: "mm", head_depth: "mm", side_margin: "mm", push_z: "mm",
    blade_clearance: "mm", rear_clearance: "mm", z_hop: "mm", min_safe_z: "mm", push_z_min: "mm", cool_temp: "°C",
    cool_timeout: "s", cool_time: "s", min_part_height: "mm", verify_z: "mm", home_clearance: "mm", home_edge_margin: "mm",
    nozzle_clearance: "mm", nozzle_probe_max_temp: "°C", nozzle_part_max_temp: "°C", purge_height: "mm", purge_start_z: "mm", purge_retract: "mm", purge_gap: "mm",
    purge_edge_margin: "mm", filament_diameter: "mm", blade_lift: "mm", push_end: "mm"
  };

  function settingRow(it, m) {
    const key = it.key;
    const value = m.values[key];
    const src = m.source[key];
    const edit = settingsUi.edits[key];
    const changed = edit !== undefined && String(edit) !== String(value);
    const setEdit = (v) => { settingsUi.edits[key] = v; refresh("settings"); };
    const sending = settingsUi.sending[key];
    let control;
    if (typeof value === "boolean") {
      const cur = edit !== undefined ? edit === true || edit === "true" : value;
      control = h("label", { class: "switch" },
        h("input", { type: "checkbox", checked: cur, disabled: !!sending, "aria-label": key, onchange: (e) => save(key, e.target.checked) }),
        h("span", { text: cur ? t("settings.on") : t("settings.off") }));
    } else if (it.choices && it.choices.length >= 2 && typeof value === "string") {
      const cur = edit !== undefined ? edit : value;
      control = h("select", { class: "select", disabled: !!sending, "aria-label": key, onchange: (e) => save(key, e.target.value) },
        it.choices.map((c) => h("option", { value: c.value, selected: c.value === cur, title: c.desc,
          text: lang !== "en" && has("opt." + key + "." + c.value) ? t("opt." + key + "." + c.value) : c.value })));
    } else {
      const cur = edit !== undefined ? edit : String(value);
      const valid = M.validSettingText(cur) && (typeof value !== "number" || /^-?\d+(\.\d+)?$/.test(String(cur).trim()));
      const input = h("input", {
        class: "input" + (typeof value === "number" ? "" : " wide") + (valid ? "" : " bad"), value: cur, "data-keep": "set-" + key, disabled: !!sending,
        inputmode: typeof value === "number" ? "decimal" : null, "aria-label": key, spellcheck: "false",
        oninput: (e) => { settingsUi.edits[key] = e.target.value; refreshSoon(); },
        onkeydown: (e) => { if (e.key === "Enter" && valid) save(key, e.target.value); if (e.key === "Escape") { delete settingsUi.edits[key]; refresh("settings"); } }
      });
      const unit = UNITS[key] || it.unit;
      control = h("div", { class: "ctl" },
        typeof value === "number" && unit ? h("span", { class: "with-unit" }, input, h("span", { class: "unit", text: unit })) : input,
        changed && !sending ? h("button", { type: "button", class: "btn primary sm", disabled: !valid, onclick: () => save(key, settingsUi.edits[key]) }, t("settings.save")) : null);
    }
    // only your own values are marked: a default needs no badge
    const badge = src === "saved" ? h("span", { class: "badge accent", text: t("settings.src.saved") })
      : src === "file" ? h("span", { class: "badge blue", text: t("settings.src.file") }) : null;
    return h("div", { class: "set-row" + (changed ? " changed" : "") + (src === "saved" || src === "file" ? " custom" : "") },
      h("div", { class: "set-text" },
        h("div", { class: "k" }, h("code", { class: "ltr", text: key }), badge),
        h("div", { class: "d", text: describeSetting(it).replace(/:\s*$/, ".") }),
        chosen(it, value) ? h("div", { class: "d chosen" }, h("code", { class: "ltr", text: String(value) }), " ", chosen(it, value)) : null,
        sending ? h("div", { class: "d sending" }, icon("clock"), h("span", { text: t(sending.later ? "settings.after_eject" : "settings.sending") })) : null),
      h("div", { class: "ctl" }, control,
        src === "saved" && !sending ? h("button", { type: "button", class: "icon-btn", title: t("settings.reset_title"), "aria-label": t("settings.reset_title"), onclick: () => reset(key) }, icon("reset")) : null));
  }

  // what the selected choice does, from the settings file (English only)
  function chosen(it, value) {
    if (lang !== "en" || !it.choices || !it.choices.length) return "";
    const c = it.choices.find((x) => x.value === value);
    return c && c.desc ? c.desc.replace(/\.$/, "") : "";
  }

  let soon = null;
  function refreshSoon() { clearTimeout(soon); soon = setTimeout(() => refresh("settings"), 150); }

  function save(key, value) {
    const arg = M.settingArg(value);
    if (!M.validSettingText(arg)) { toast(t("settings.bad"), "bad"); return; }
    send(key, "AUTO_EJECT_SET KEY=" + key + " VALUE=" + arg, value, "settings.saved");
  }
  function reset(key) {
    send(key, "AUTO_EJECT_SET KEY=" + key + " RESET=1", null, "settings.reset_done");
  }
  // One change at a time for each setting: another click would only queue
  // the same command again. While the bed is being cleared Klipper takes no
  // command until the eject has finished, so a change made then waits.
  function send(key, script, value, doneKey) {
    if (settingsUi.sending[key]) return;
    const later = M.ejectRunning(aeState(), app.status) && !aeState().bg;     // in the background, Klipper is free
    const ask = later ? confirm(t("settings.busy_title"), t("settings.busy_body"), t("settings.busy_ok")) : Promise.resolve(true);
    ask.then((ok) => {
      // a switch or a list already shows the new value: draw it again
      if (!ok) { settingsUi.n++; refresh("settings"); return; }
      settingsUi.sending[key] = { later };
      if (value === null) delete settingsUi.edits[key];
      else settingsUi.edits[key] = value;
      refresh("settings");
      client.gcode(script).then(() => toast(t(doneKey, { k: key }), "ok"),
        (e) => toast(later && /closed|connected/.test(e.message) ? t("settings.busy_lost", { k: key }) : cleanError(e.message), "bad"))
        .then(() => { delete settingsUi.sending[key]; delete settingsUi.edits[key]; refresh("settings"); });
    });
  }

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
          icon(FARM_ACT[a][0]), t(FARM_ACT[a][1]))),
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
      h("div", { class: "fc-acts" }, M.farmActions(p).map((a) => h("button", { type: "button", class: "btn sm " + ACT[a][2], onclick: () => farmAct(p, a) }, icon(ACT[a][0]), t(ACT[a][1]))),
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

  /* -------------------------------------------------------- the farm queue */

  // One list for the whole farm: each file printed so many times, each copy
  // on the next free printer it may go to. push/farm.py sends them and
  // follows each one; the page shows it and changes the list.
  function queueCall(body) {
    return farmCall("/queue", body).then(() => loadFarm()).catch((e) => toast(cleanError(e.message), "bad"));
  }
  function farmQueueCard(all) {
    const q = farm.data.queue;
    if (!q) return null;                               // a farm service from before the queue
    const byId = {};
    all.forEach((p) => { byId[p.id] = p; });
    const name = (id) => (byId[id] || {}).name || id;
    const list = (ids) => ids.map(name).join(lang === "ar" ? "، " : ", ");
    // the ones whose card says nothing: a card that needs you has its own Bed is clear
    const waiting = (q.need_clear || []).filter((id) => byId[id] && byId[id].phase === "idle");
    const job = (j, i) => {
      const printing = j.now.filter((r) => r.state === "printing").map((r) => r.printer);
      const sending = j.now.filter((r) => r.state === "sending").map((r) => r.printer);
      const facts = [t("fq.made", { done: num(j.done, 0), copies: num(j.copies, 0) })];
      if (printing.length) facts.push(t("fq.printing", { names: list(printing) }));
      if (sending.length) facts.push(t("fq.sending", { names: list(sending) }));
      if (j.stopped) facts.push(t("fq.stopped", { n: num(j.stopped, 0) }));
      if (j.left) facts.push(t("fq.left", { n: num(j.left, 0) }));
      const under = j.done + j.stopped + j.now.length;     // made or on their way: the fewest copies it can have
      return h("div", { class: "fq-job" + (j.left || j.now.length ? "" : " fq-finished") },
        h("div", { class: "fq-main" },
          h("div", { class: "fq-name" }, h("b", { class: "ltr", title: j.name, text: j.name }),
            j.material ? h("span", { class: "badge", text: j.material }) : null),
          h("div", { class: "progress fq-bar" }, h("i", { style: { width: num(j.copies ? 100 * j.done / j.copies : 0, 1) + "%" } })),
          h("div", { class: "muted fq-facts", dir: "auto", text: facts.join(" · ") }),
          h("div", { class: "muted fq-on", dir: "auto", text: t("fq.on", { names: list(j.printers) }) }),
          j.error ? h("p", { class: "note bad" }, icon("alert"), h("span", { text: t("fq.error", { error: j.error }) })) : null),
        h("div", { class: "fq-acts" },
          h("button", { type: "button", class: "icon-btn", title: t("fq.up"), "aria-label": t("fq.up"), disabled: i === 0,
            onclick: () => queueCall({ id: j.id, move: -1 }) }, icon("up")),
          h("button", { type: "button", class: "icon-btn", title: t("fq.down"), "aria-label": t("fq.down"), disabled: i === q.jobs.length - 1,
            onclick: () => queueCall({ id: j.id, move: 1 }) }, icon("down")),
          h("span", { class: "fq-count" },
            h("button", { type: "button", class: "icon-btn", title: t("fq.less"), "aria-label": t("fq.less"), disabled: j.copies <= Math.max(1, under),
              onclick: () => queueCall({ id: j.id, copies: j.copies - 1 }) }, icon("minus")),
            h("b", { title: t("fq.copies"), text: num(j.copies, 0) }),
            h("button", { type: "button", class: "icon-btn", title: t("fq.more"), "aria-label": t("fq.more"),
              onclick: () => queueCall({ id: j.id, copies: j.copies + 1 }) }, icon("plus"))),
          h("button", { type: "button", class: "icon-btn", title: t("fq.remove"), "aria-label": t("fq.remove"),
            onclick: () => confirm(t("fq.remove"), t("fq.remove_q", { name: j.name }), t("fq.remove"), "danger")
              .then((yes) => { if (yes) queueCall({ id: j.id, remove: true }); }) }, icon("trash"))));
    };
    return h("section", { class: "card fq", style: { marginTop: "16px" } },
      h("h2", null, icon("queue"), t("fq.title"),
        h("span", { class: "right" },
          q.jobs.length ? h("div", { class: "seg", role: "group", "aria-label": t("fq.title") }, [[true, "play", "fq.running"], [false, "pause", "fq.paused"]].map(([v, ic, k]) =>
            h("button", { type: "button", class: "seg-btn" + (q.running === v ? " active" : ""), "aria-pressed": q.running === v ? "true" : "false",
              onclick: () => { if (q.running !== v) queueCall({ running: v }); } }, icon(ic), t(k)))) : null,
          h("button", { type: "button", class: "btn sm", onclick: () => queueAdd([]) }, icon("plus"), t("fq.add")))),
      waiting.length ? h("div", { class: "fq-wait" },
        h("p", { class: "note warn" }, icon("hand"), h("span", { text: t("fq.wait") })),
        h("div", { class: "toolbar" }, waiting.map((id) => h("button", { type: "button", class: "btn sm", onclick: () => queueCall({ cleared: id }) },
          icon("ok"), h("span", { dir: "auto", text: name(id) }))))) : null,
      q.jobs.length ? h("div", { class: "fq-jobs" }, q.jobs.map(job))
        : h("p", { class: "note" }, icon("info"), h("span", { text: t("fq.empty") })));
  }

  // a file into the farm queue: how many copies, and the printers it may go to
  function queueAdd(pre) {
    const picker = h("input", { type: "file", accept: ".gcode,.g,.gco,.bgcode", style: { display: "none" } });
    const printers = (farm.data && farm.data.printers) || [];
    const ui = { file: null, copies: 1, sel: new Set(pre.map((p) => p.id)), sending: null };
    const close = () => { if (ui.sending === null) closeModal("fqadd"); };
    const send = () => {
      const copies = Math.round(Number(ui.copies));
      if (!(copies >= 1 && copies <= 999)) return toast(t("fq.copies_bad"), "bad");
      const ids = printers.filter((p) => ui.sel.has(p.id)).map((p) => p.id);
      ui.sending = 0;
      draw();
      const done = (r) => { ui.sending = null; closeModal("fqadd"); toast(t("fq.added", { name: ui.file.name, n: num(copies, 0) }), "ok"); loadFarm(); return r; };
      const failed = (e) => { ui.sending = null; draw(); toast(cleanError(e.message), "bad"); };
      if (DEMO) return client.farm("/queue/upload", { name: ui.file.name, size: ui.file.size, copies, printers: ids }).then(done, failed);
      const x = new XMLHttpRequest();
      x.open("POST", FARM_API + "/queue/upload?name=" + encodeURIComponent(ui.file.name) + "&copies=" + copies + "&printers=" + ids.map(encodeURIComponent).join(","));
      x.upload.onprogress = (e) => { if (e.lengthComputable) { ui.sending = e.loaded / e.total; draw(); } };
      x.onload = () => {
        let j = {};
        try { j = JSON.parse(x.responseText || "{}"); } catch (e) { /* not JSON */ }
        if (x.status >= 200 && x.status < 300) done(j); else failed(new Error(j.error || "HTTP " + x.status));
      };
      x.onerror = () => failed(new Error(t("farm.upload_failed")));
      x.send(ui.file);
    };
    picker.addEventListener("change", () => { if (picker.files[0]) { ui.file = picker.files[0]; draw(); } });
    const tick = (ids, on) => { ids.forEach((id) => { if (on) ui.sel.add(id); else ui.sel.delete(id); }); draw(); };
    function draw() {
      const busy = ui.sending !== null;
      const row = (p) => h("label", { class: "copy-row" },
        h("input", { type: "checkbox", checked: ui.sel.has(p.id), disabled: busy, onchange: (e) => tick([p.id], e.target.checked) }),
        h("span", { dir: "auto", text: p.name + (p.local ? " · " + t("farm.this") : "") }),
        h("span", { class: "muted fq-hint", text: ["offline", "off"].includes(p.phase) ? t("farm.phase." + p.phase) : p.auto_eject ? "" : t("fq.no_ae") }));
      const groups = M.farmGroups(printers);
      const body = h("div", null,
        h("p", { class: "muted", text: t("fq.add_intro") }),
        h("div", { class: "toolbar", style: { margin: "10px 0" } },
          h("button", { type: "button", class: "btn", disabled: busy, onclick: () => picker.click() }, icon("file"), t("farm.choose_file")),
          ui.file ? h("span", { class: "ltr muted", text: ui.file.name + " · " + fmtSize(ui.file.size) }) : null),
        h("label", { class: "field", style: { maxWidth: "160px" } }, h("span", { text: t("fq.copies") }),
          h("input", { class: "input", type: "number", min: 1, max: 999, step: 1, value: ui.copies, disabled: busy, oninput: (e) => { ui.copies = e.target.value; } })),
        h("div", { class: "field", style: { marginTop: "12px" } }, h("span", { text: t("fq.printers") })),
        h("div", { class: "copy-list" }, groups.map((g) => [
          groups.length > 1 || g.group ? h("label", { class: "copy-row fq-group" },
            h("input", { type: "checkbox", disabled: busy, checked: g.printers.every((p) => ui.sel.has(p.id)),
              onchange: (e) => tick(g.printers.map((p) => p.id), e.target.checked) }),
            h("b", { dir: "auto", text: g.group || t("farm.no_group") }), h("span")) : null,
          g.printers.map(row)])),
        h("p", { class: "note", style: { marginTop: "8px" } }, icon("info"), h("span", { text: t("fq.add_note") })),
        busy ? h("div", { class: "progress", style: { marginTop: "10px" } }, h("i", { style: { width: num(ui.sending * 100, 1) + "%" } })) : null,
        picker);
      modal("fqadd", t("fq.add_title"), body, [
        h("button", { type: "button", class: "btn", disabled: busy, onclick: close, text: t("c.close") }),
        h("button", { type: "button", class: "btn primary", disabled: busy || !ui.file || !ui.sel.size, onclick: send },
          busy ? h("span", { class: "spinner" }) : icon("queue"), t("fq.go"))
      ], close);
    }
    draw();
  }

  /* ------------------------------------- settings for a kind of printer */

  // One printer's auto-eject settings onto others, or a set saved under a
  // name (a kind of printer). Each printer gets only what it has and what
  // differs; the farm says what it kept as it was.
  function copySettings(targets) {
    const close = () => closeModal("copy");
    const printers = (farm.data && farm.data.printers) || [];
    const sources = printers.filter((p) => p.auto_eject && !["offline", "off", "stopped"].includes(p.phase));
    const sets = () => (farm.data && farm.data.sets) || [];
    const ui = { from: "", list: null, values: null, err: "", tick: new Set(), busy: false, done: null, name: "" };
    const nameOf = (from) => from.startsWith("s:") ? from.slice(2) : (printers.find((p) => "p:" + p.id === from) || {}).name || "";
    const names = (list) => list.map((p) => p.name).join(lang === "ar" ? "، " : ", ");
    const show = (k, v) => (v === true ? t("settings.on") : v === false ? t("settings.off") : String(v)) + (UNITS[k] && typeof v === "number" ? " " + UNITS[k] : "");
    const choose = (from) => {
      Object.assign(ui, { from, list: null, values: null, err: "", done: null, name: "" });
      const fill = (values, keys) => {
        ui.values = values;
        ui.list = M.copyList(values, keys);
        ui.tick = new Set(ui.list.filter((x) => x.tick).map((x) => x.key));
      };
      if (from.startsWith("s:")) {
        const set = sets().find((x) => x.name === from.slice(2));
        if (set) fill(set.values, Object.keys(set.values));
        else ui.err = t("farm.copy_gone");
        return draw();
      }
      draw();
      farmCall("/" + from.slice(2) + "/settings").then((r) => {
        if (ui.from === from) { fill(r.settings.values, r.settings.changed); draw(); }
      }).catch((e) => { if (ui.from === from) { ui.err = cleanError(e.message); draw(); } });
    };
    const chosen = () => {
      const out = {};
      for (const k of ui.tick) out[k] = ui.values[k];
      return out;
    };
    const go = () => {
      const values = chosen();
      ui.busy = true;
      draw();
      Promise.all(targets.map((p) => farmCall("/" + p.id + "/settings", { values })
        .then((r) => ({ p, r: r.result }), (e) => ({ p, err: cleanError(e.message) })))).then((done) => {
        ui.busy = false;
        ui.done = done;
        draw();
        const bad = done.filter((x) => x.err).length;
        toast(bad ? t("farm.copy_partly", { n: num(done.length - bad, 0), m: num(done.length, 0) }) : t("farm.copy_done", { n: num(done.length, 0) }), bad ? "bad" : "ok");
      });
    };
    const save = () => {
      const name = ui.name.trim();
      if (!name) return;
      farmCall("/sets", { name, values: chosen(), from: nameOf(ui.from) }).then(() => {
        toast(t("farm.copy_saved", { name }), "ok");
        return loadFarm();
      }).then(() => choose("s:" + name.replace(/\s+/g, " "))).catch((e) => toast(cleanError(e.message), "bad"));
    };
    const remove = () => {
      const name = ui.from.slice(2);
      confirm(t("farm.copy_delete"), t("farm.copy_delete_q", { name }), t("farm.copy_delete"), "danger").then((yes) => {
        if (!yes) return;
        farmCall("/sets", { remove: name }).then(() => loadFarm()).then(() => choose(sources.length ? "p:" + (sources.find((p) => !targets.includes(p)) || sources[0]).id : ""))
          .catch((e) => toast(cleanError(e.message), "bad"));
      });
    };
    const result = (x) => {
      if (x.err) return h("span", { class: "bad-text", text: x.err });
      const r = x.r || {};
      const kept = Object.keys(r.skipped || {});
      return h("span", null,
        t("farm.copy_result", { changed: num((r.changed || []).length, 0), same: num((r.same || []).length, 0) }),
        kept.length ? " " + t("farm.copy_kept", { list: kept.map((k) => k + " (" + t("farm.copy_why." + r.skipped[k]) + ")").join(", ") }) : "",
        (r.changed || []).length && r.kept === false ? " " + t("farm.copy_restart") : "");
    };
    const draw = () => {
      const fromSet = ui.from.startsWith("s:");
      const n = ui.tick.size;
      const body = h("div", { class: "copy" },
        h("label", { class: "field" }, h("span", { text: t("farm.copy_from") }),
          h("select", { class: "select", onchange: (e) => choose(e.target.value) },
            h("optgroup", { label: t("farm.copy_printers") }, sources.map((p) =>
              h("option", { value: "p:" + p.id, selected: ui.from === "p:" + p.id, text: p.name + (p.local ? " · " + t("farm.this") : "") }))),
            sets().length ? h("optgroup", { label: t("farm.copy_sets") }, sets().map((x) =>
              h("option", { value: "s:" + x.name, selected: ui.from === "s:" + x.name, text: x.name }))) : null)),
        h("p", { class: "muted", style: { margin: "8px 0 12px" } }, t("farm.copy_to", { n: num(targets.length, 0), names: names(targets) })),
        ui.err ? h("p", { class: "note bad" }, icon("alert"), h("span", { text: ui.err }))
          : !ui.list ? h("div", { class: "empty" }, h("span", { class: "spinner" }))
          : !ui.list.length ? h("p", { class: "note" }, icon("info"), h("span", { text: t("farm.copy_none", { name: nameOf(ui.from) }) }))
          : h("div", null,
            h("p", { class: "note" }, icon("info"), h("span", { text: t(fromSet ? "farm.copy_note_set" : "farm.copy_note", { name: nameOf(ui.from) }) })),
            h("div", { class: "copy-list" }, ui.list.map((x) => h("label", { class: "copy-row" + (x.ok ? "" : " off"), title: describeSetting({ key: x.key }) },
              h("input", { type: "checkbox", checked: ui.tick.has(x.key), disabled: !x.ok || ui.busy,
                onchange: (e) => { if (e.target.checked) ui.tick.add(x.key); else ui.tick.delete(x.key); draw(); } }),
              h("code", { class: "ltr", text: x.key }),
              h("span", { class: "ltr copy-v", text: show(x.key, x.value) }),
              x.ok ? null : h("span", { class: "muted copy-why", text: t("farm.copy_why.file") })))),
            !fromSet && n ? h("div", { class: "toolbar copy-save" },
              h("input", { class: "input", type: "text", maxlength: 40, dir: "auto", value: ui.name, placeholder: t("farm.copy_name_ph"), "aria-label": t("farm.copy_save"),
                oninput: (e) => { ui.name = e.target.value; }, onkeydown: (e) => { if (e.key === "Enter") save(); } }),
              h("button", { type: "button", class: "btn sm", onclick: save }, icon("plus"), t("farm.copy_save"))) : null),
        ui.done ? h("div", { class: "copy-done" }, ui.done.map((x) => h("div", { class: "copy-res" + (x.err ? " bad" : "") },
          icon(x.err ? "bad" : "ok"), h("b", { dir: "auto", text: x.p.name }), result(x)))) : null);
      modal("copy", t("farm.copy_title"), body, [
        fromSet ? h("button", { type: "button", class: "btn danger", onclick: remove }, icon("trash"), t("farm.copy_delete")) : null,
        h("button", { type: "button", class: "btn", onclick: close, text: t("c.close") }),
        h("button", { type: "button", class: "btn primary", disabled: !n || ui.busy || !ui.list, onclick: go },
          ui.busy ? h("span", { class: "spinner" }) : icon("copy"), t("farm.copy_go", { n: num(targets.length, 0) }))
      ], close);
    };
    const start = sources.find((p) => !targets.includes(p)) || sources[0];
    if (start) choose("p:" + start.id);
    else if (sets().length) choose("s:" + sets()[0].name);
    else { ui.err = t("farm.copy_nothing"); draw(); }
  }

  /* ------------------------------------------------------- QR labels */

  // A label for a printer: its name and a QR code of its page, printed and
  // stuck on it, so a phone camera opens the page.
  function qrHere() {
    return { hostname: location.hostname, page: new URL("../", location.href).href };
  }
  function qrSvg(url) {
    const q = Q.qrPath(Q.qrEncode(url, { level: "M" }), 4);
    return s("svg", { class: "qr", viewBox: "0 0 " + q.size + " " + q.size, role: "img", "aria-label": url, "shape-rendering": "crispEdges" },
      s("rect", { width: q.size, height: q.size, fill: "#fff" }), s("path", { d: q.d, fill: "#000" }));
  }
  function qrShort(url) { return url.replace(/^https?:\/\//, "").replace(/\/$/, ""); }
  function qrLabel(p, url) {
    return h("div", { class: "qr-label" }, qrSvg(url),
      h("b", { class: "qr-name", dir: "auto", text: p.name }),
      p.group ? h("span", { class: "qr-group", dir: "auto", text: p.group }) : null,
      h("span", { class: "qr-url ltr", text: qrShort(url) }));
  }
  // the labels alone on the paper; the page comes back after printing
  function qrPrint(labels) {
    const old = document.getElementById("print-sheet");
    if (old) old.remove();
    const sheet = h("div", { id: "print-sheet" }, labels);
    document.body.appendChild(sheet);
    document.documentElement.classList.add("printing");
    const done = () => {
      document.documentElement.classList.remove("printing");
      sheet.remove();
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  }
  // the label as a picture, for a label printer's own app
  function qrPng(p, url) {
    const qr = Q.qrEncode(url, { level: "M" });
    const unit = Math.max(4, Math.floor(560 / (qr.size + 8)));
    const side = (qr.size + 8) * unit;
    const c = h("canvas", { width: side, height: side + 170 });
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#000";
    qr.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) g.fillRect((x + 4) * unit, (y + 4) * unit, unit, unit); }));
    const font = getComputedStyle(document.body).fontFamily;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.font = "700 " + Math.round(side / 11) + "px " + font;
    g.fillText(p.name, side / 2, side + 40, side - 40);
    g.font = Math.round(side / 20) + "px " + font;
    if (p.group) g.fillText(p.group, side / 2, side + 90, side - 40);
    g.font = Math.round(side / 26) + "px ui-monospace, monospace";
    g.fillText(qrShort(url), side / 2, side + 140, side - 40);
    c.toBlob((blob) => {
      const a = h("a", { href: URL.createObjectURL(blob), download: "qr-" + (p.name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || p.id) + ".png" });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, "image/png");
  }
  // one printer's label, or a sheet of them for the printers selected
  function qrDialog(printers) {
    const close = () => closeModal("qr");
    const here = qrHere();
    const items = printers.map((p) => ({ p, links: M.farmQrLinks(p, here) })).filter((x) => x.links.length);
    if (!items.length) { toast(t("farm.qr_none"), "bad"); return; }
    const kinds = ["lan", "remote"].filter((k) => items.some((x) => x.links.some((l) => l.kind === k)));
    let kind = items[0].links[0].kind;
    const urlOf = (x) => (x.links.find((l) => l.kind === kind) || x.links[0]).url;
    const one = items.length === 1 ? items[0] : null;
    const draw = () => {
      const labels = () => items.map((x) => qrLabel(x.p, urlOf(x)));
      modal("qr", one ? t("farm.qr_title", { name: one.p.name }) : t("farm.qr_labels") + " (" + num(items.length, 0) + ")", h("div", null,
        kinds.length > 1 ? h("div", { class: "seg", role: "tablist", "aria-label": t("farm.qr_where") }, kinds.map((k) =>
          h("button", { type: "button", role: "tab", class: "seg-btn" + (kind === k ? " active" : ""), "aria-selected": kind === k ? "true" : "false",
            onclick: () => { kind = k; draw(); } }, t("farm.qr_" + k)))) : null,
        h("p", { class: "note", style: { margin: "10px 0" } }, icon("info"), h("span", { text: t("farm.qr_note_" + kind) })),
        h("div", { class: one ? "qr-preview" : "qr-preview qr-many" }, labels()),
        items.length < printers.length ? h("p", { class: "muted", text: t("farm.qr_some", { n: num(printers.length - items.length, 0) }) }) : null), [
        one ? h("button", { type: "button", class: "btn", onclick: () => qrPng(one.p, urlOf(one)) }, icon("download"), t("farm.qr_png")) : null,
        h("button", { type: "button", class: "btn", onclick: close, text: t("c.close") }),
        h("button", { type: "button", class: "btn primary", onclick: () => qrPrint(labels()) }, icon("file"), t("farm.qr_print"))
      ], close);
    };
    draw();
  }

  // ----- rename or remove one printer
  function editPrinter(p) {
    const close = () => closeModal("edit");
    const name = h("input", { class: "input", type: "text", value: p.name, maxlength: 40, dir: "auto" });
    const groupNames = Array.from(new Set((farm.data.printers || []).map((x) => x.group).filter(Boolean))).sort();
    const group = h("input", { class: "input", type: "text", value: p.group || "", maxlength: 30, dir: "auto", list: "farm-groups", placeholder: t("farm.group_ph") });
    const devices = p.power || [];
    const offAfter = devices.length ? h("select", { class: "select" }, [0, 15, 30, 60, 120, 240].map((m) =>
      h("option", { value: m, selected: m === (p.auto_off || 0), text: m ? t("farm.auto_off_min", { n: num(m, 0) }) : t("farm.auto_off_never") }))) : null;
    const offDevice = devices.length > 1 ? h("select", { class: "select ltr" }, devices.map((d) =>
      h("option", { value: d.device, selected: d.device === p.auto_off_device, text: d.device }))) : null;
    const hasStats = !!(p.stats && (p.stats.hours || p.stats.recent));
    const serviceEvery = hasStats ? h("select", { class: "select" }, [0, 100, 200, 300, 500, 1000].map((n) =>
      h("option", { value: n, selected: n === (p.service_every || 0), text: n ? t("farm.service_every", { n: num(n, 0) }) : t("farm.auto_off_never") }))) : null;
    const serviceDone = () => farmCall("/printers", { id: p.id, service_done: true })
      .then(() => { toast(t("farm.service_saved", { name: p.name }), "ok"); close(); loadFarm(); }).catch((e) => toast(cleanError(e.message), "bad"));
    const save = () => farmCall("/printers", { rename: p.id, name: name.value })
      .then(() => group.value.trim() !== (p.group || "") ? farmCall("/printers", { id: p.id, group: group.value }) : null)
      .then(() => offAfter ? farmCall("/printers", { id: p.id, auto_off: parseInt(offAfter.value, 10) || 0,
        device: offDevice ? offDevice.value : devices[0].device }) : null)
      .then(() => serviceEvery && (parseInt(serviceEvery.value, 10) || 0) !== (p.service_every || 0)
        ? farmCall("/printers", { id: p.id, service_every: parseInt(serviceEvery.value, 10) || 0 }) : null)
      .then(() => { close(); loadFarm(); }).catch((e) => toast(cleanError(e.message), "bad"));
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
    const remove = () => confirm(t("farm.remove"), t("farm.remove_confirm", { name: p.name }), t("farm.remove"), "danger").then((ok) => {
      if (ok) farmCall("/printers", { remove: p.id }).then(() => { close(); loadFarm(); }).catch((e) => toast(cleanError(e.message), "bad"));
    });
    modal("edit", p.name, h("div", null,
      h("label", { class: "field" }, h("span", { text: t("farm.name") }), name),
      h("div", { class: "toolbar", style: { marginTop: "8px", justifyContent: "space-between" } },
        h("span", { class: "muted ltr", text: p.local ? location.host : p.host }),
        h("span", { class: "toolbar" },
          p.auto_eject && !["offline", "off", "stopped", "ejecting"].includes(p.phase)
            ? h("button", { type: "button", class: "btn sm", onclick: () => { close(); copySettings([p]); } }, icon("copy"), t("farm.copy_here")) : null,
          p.local || p.page || p.page_remote ? h("button", { type: "button", class: "btn sm", onclick: () => { close(); qrDialog([p]); } }, icon("qr"), t("farm.qr")) : null)),
      h("label", { class: "field", style: { marginTop: "12px" } }, h("span", { text: t("farm.group") }), group,
        h("datalist", { id: "farm-groups" }, groupNames.map((g) => h("option", { value: g })))),
      h("p", { class: "note", style: { marginTop: "6px" } }, icon("info"), h("span", { text: t("farm.group_note") })),
      offAfter ? h("div", { style: { marginTop: "14px", display: "grid", gap: "8px" } },
        h("label", { class: "field" }, h("span", { text: t("farm.auto_off") }), offAfter),
        offDevice ? h("label", { class: "field" }, h("span", { text: t("farm.auto_off_device") }), offDevice) : null,
        h("p", { class: "note" }, icon("info"), h("span", { text: t("farm.auto_off_note") }))) : null,
      serviceEvery ? h("div", { style: { marginTop: "14px", display: "grid", gap: "8px" } },
        h("label", { class: "field" }, h("span", { text: t("farm.service") }), serviceEvery),
        M.farmService(p) ? h("div", { class: "toolbar" },
          h("span", { class: "muted", text: t("farm.service_since", { n: num(p.service_since, 0) }) }),
          h("button", { type: "button", class: "btn sm", onclick: serviceDone }, icon("ok"), t("farm.service_done"))) : null) : null), [
      p.local ? null : h("button", { type: "button", class: "btn danger", onclick: remove }, icon("trash"), t("farm.remove")),
      h("button", { type: "button", class: "btn", onclick: close, text: t("c.cancel") }),
      h("button", { type: "button", class: "btn primary", onclick: save, text: t("farm.save") })
    ], close);
    name.focus();
    name.select();
  }

  /* =========================================================== hardware */

  // Everything Klipper and Moonraker tell about the machine: the boards and
  // their links, the motors and drivers, heaters, fans, the computer,
  // sensors and the camera. Read while this tab is open: Klipper once a
  // second, the computer every two, the rest now and then. Read only.
  const hw = {
    status: {}, at: 0, proc: null, sys: null, disk: null, jobs: null, cam: null,
    hist: {}, temps: {}, flow: {}, fil: {}, quiet: {}, events: [], seen: {}, base: {}, heat: {}, fanOff: {}, camFails: 0,
    procAt: 0, slowAt: 0, camAt: 0, mcuInfo: {}, busy: false
  };
  const KEEP = 600;                // ten minutes, one reading a second
  const LEVEL_RANK = { info: 1, warn: 2, bad: 3 };

  function motorList() {
    return M.tmcSteppers(app.objects || [], ((app.config || {}).printer || {}).kinematics);
  }
  function motorName(m) {
    return m.extruder ? t("motors.extruder", { n: m.title.slice(1) }).trim() : m.title;
  }
  function hwParts() {
    const p = M.hwParts(app.objects || [], app.config || {});
    p.heaters.sort((a, b) => (a.kind === "heater_bed") - (b.kind === "heater_bed") || a.obj.localeCompare(b.obj));
    return p;
  }
  function pretty(name) { return String(name).replace(/[_-]+/g, " ").trim(); }
  function boardName(b) {
    return b.main ? t("hw.board_main") : b.conn === "host" ? t("hw.board_host") : pretty(b.name);
  }
  function heaterName(x) {
    if (x.kind === "heater_bed") return t("hw.heater.bed");
    if (/^extruder\d*$/.test(x.kind)) return (t("hw.heater.extruder") + " " + x.kind.slice(8)).trim();
    return pretty(x.name);
  }
  function fanName(f) { return f.kind === "fan" ? t("hw.fan.fan") : pretty(f.name); }
  function bytesText(b) {
    if (typeof b !== "number") return "—";
    return b >= 1e9 ? num(b / 1e9, 1) + " GB" : b >= 1e6 ? num(b / 1e6, 0) + " MB" : num(b / 1e3, 0) + " KB";
  }
  // a warning while this tab is open, at most once a minute each
  function hwEvent(key, level, text, now) {
    if (!hw.seen[key] || now - hw.seen[key] > 60) hw.events.unshift({ time: now, level, text });
    hw.seen[key] = now;
    hw.events.splice(40);
  }

  function pollHardware() {
    if (route() !== "hardware" || document.hidden || app.conn !== "online" || hw.busy) return;
    const now = Date.now() / 1000;
    const jobs = [];
    if (app.klippy === "ready") jobs.push(pollKlipper(now));
    if (now - hw.procAt >= 2) { hw.procAt = now; jobs.push(pollComputer(now)); }
    if (now - hw.slowAt >= 60) { hw.slowAt = now; jobs.push(pollSlow()); }
    if (now - hw.camAt >= 5) { hw.camAt = now; jobs.push(pollCamera(now)); }
    hw.busy = true;
    Promise.all(jobs).catch(() => {}).then(() => { hw.busy = false; hw.at = now; refresh("hardware"); });
  }

  function pollKlipper(now) {
    const P = hwParts(), list = motorList();
    const objects = { stepper_enable: null, system_stats: null };
    if (list.some((m) => m.extruder)) { objects.motion_report = ["live_extruder_velocity"]; objects.toolhead = ["extruder"]; }
    for (const m of list) {
      objects[m.obj] = null;
      const sn = M.motorSensor(m, app.objects);
      if (sn) objects[sn] = ["temperature"];
    }
    for (const b of P.mcus) objects[b.obj] = hw.mcuInfo[b.obj] ? ["last_stats"] : ["last_stats", "mcu_version", "mcu_constants"];
    for (const c of P.can) objects[c.obj] = null;
    for (const x of P.heaters) objects[x.obj] = ["temperature", "target", "power"];
    for (const f of P.fans) objects[f.obj] = null;
    for (const x of P.sensors) objects[x.obj] = ["temperature", "measured_min_temp", "measured_max_temp"];
    for (const x of P.filament) objects[x.obj] = ["filament_detected", "enabled"];
    return client.call("printer.objects.query", { objects }).then((r) => {
      const st = r.status || {};
      const printing = ["printing", "paused"].includes((app.status.print_stats || {}).state);
      // motors: StallGuard while they turn, and the drivers' warnings
      const on = (st.stepper_enable || {}).steppers || {};
      for (const m of list) {
        const d = (st[m.obj] || {}).drv_status || {};
        const hist = hw.hist[m.stepper] || (hw.hist[m.stepper] = []);
        // a reading only while it turns: Klipper leaves a zero out, and a slow motor gives none
        const moving = on[m.stepper] !== false && !d.stst;
        hist.push(m.reportsLoad && moving && typeof d.sg_result === "number" ? d.sg_result : null);
        if (hist.length > KEEP) hist.splice(0, hist.length - KEEP);
        // turning, again and again, without a reading: too slow for StallGuard
        hw.quiet[m.stepper] = moving && hist[hist.length - 1] === null ? (hw.quiet[m.stepper] || 0) + 1 : hist[hist.length - 1] === null ? hw.quiet[m.stepper] || 0 : 0;
        // the extruder: its flow, from the filament's speed
        if (m.extruder) {
          const active = (st.toolhead || {}).extruder || "extruder";
          const v = active === m.stepper ? Math.abs((st.motion_report || {}).live_extruder_velocity || 0) : 0;
          const f = hw.flow[m.stepper] || (hw.flow[m.stepper] = []);
          // the flow of 1 mm/s of this filament: the filament's speed back from the flow shown
          hw.fil[m.stepper] = M.flowRate(1, M.cfgSection(app.config, m.stepper).filament_diameter);
          f.push(v * hw.fil[m.stepper]);
          if (f.length > KEEP) f.splice(0, f.length - KEEP);
        }
        for (const f of M.driverFlags(d)) {
          if (f.level !== "info") hwEvent(m.stepper + f.flag, f.level, motorName(m) + ": " + t("motors.flag." + f.flag), now);
        }
      }
      // boards: what was sent again and what came back broken, since this page saw them
      for (const b of P.mcus) {
        const ms = st[b.obj] || {};
        if (ms.mcu_version) hw.mcuInfo[b.obj] = { version: ms.mcu_version, chip: (ms.mcu_constants || {}).MCU || "" };
        const ls = ms.last_stats || {};
        const base = hw.base[b.obj];
        if (!base || ls.bytes_retransmit < base.retransmit || ls.bytes_invalid < base.invalid) {
          hw.base[b.obj] = { retransmit: ls.bytes_retransmit, invalid: ls.bytes_invalid, lastR: ls.bytes_retransmit, lastI: ls.bytes_invalid };
        } else {
          if (ls.bytes_retransmit > base.lastR) hwEvent(b.obj + "r", "warn", t("hw.ev_resent", { b: boardName(b), n: num(ls.bytes_retransmit - base.lastR, 0) }), now);
          if (ls.bytes_invalid > base.lastI) hwEvent(b.obj + "i", "warn", t("hw.ev_invalid", { b: boardName(b), n: num(ls.bytes_invalid - base.lastI, 0) }), now);
          base.lastR = ls.bytes_retransmit; base.lastI = ls.bytes_invalid;
        }
      }
      for (const c of P.can) {
        const cs = st[c.obj] || {};
        const key = "can " + c.obj, base = hw.base[key];
        const sum = (cs.rx_error || 0) + (cs.tx_error || 0) + (cs.tx_retries || 0);
        if (!base || sum < base.sum) hw.base[key] = { sum, first: sum };
        else if (sum > base.sum) { hwEvent(key, "warn", t("hw.ev_can", { b: pretty(c.name), n: num(sum - base.sum, 0) }), now); base.sum = sum; }
        if (cs.bus_state && cs.bus_state !== "active") hwEvent(key + "s", cs.bus_state === "warn" ? "warn" : "bad", t("hw.ev_can_state", { b: pretty(c.name), s: t("hw.can_state." + cs.bus_state) }), now);
      }
      // heaters: their last ten minutes, and whether they hold their target
      for (const x of P.heaters) {
        const hs = st[x.obj] || {};
        const temps = hw.temps[x.obj] || (hw.temps[x.obj] = []);
        temps.push(typeof hs.temperature === "number" ? hs.temperature : null);
        if (temps.length > KEEP) temps.splice(0, temps.length - KEEP);
        const w = M.heaterWatch(hw.heat[x.obj], hs, now);
        hw.heat[x.obj] = w.state;
        hw.heat[x.obj].level = w.level; hw.heat[x.obj].reason = w.reason;
        if (w.level) hwEvent(x.obj + w.reason, w.level, t("hw.heater." + w.reason, { h: heaterName(x) }), now);
      }
      // fans with a speed sensor that should turn and do not, for 5 s
      for (const f of P.fans) {
        if (M.fanStopped(st[f.obj])) {
          hw.fanOff[f.obj] = (hw.fanOff[f.obj] || 0) + 1;
          if (hw.fanOff[f.obj] >= 5) hwEvent(f.obj, "bad", t("hw.fan_stopped", { f: fanName(f) }), now);
        } else hw.fanOff[f.obj] = 0;
      }
      for (const x of P.filament) {
        const fs = st[x.obj] || {};
        if (fs.enabled && fs.filament_detected === false && printing) hwEvent(x.obj, "warn", t("hw.ev_filament", { s: pretty(x.name) }), now);
      }
      hw.status = st;
    }).catch(() => {});
  }

  function pollComputer(now) {
    return client.call("machine.proc_stats").then((p) => {
      hw.proc = p;
      for (const f of M.throttleFlags(p.throttled_state)) hwEvent("thr" + f.flag, f.level, t("hw.throttle") + ": " + throttleText(f.flag), now);
      for (const c of M.hostChecks(p, hw.disk)) hwEvent("host" + c.key, c.level, hostText(c), now);
      // network errors and drops on a CAN interface (Wi-Fi drops are common and harmless)
      for (const [iface, n] of Object.entries(p.network || {})) {
        if (!/^can\d/.test(iface)) continue;
        const key = "net " + iface, sum = (n.rx_errs || 0) + (n.tx_errs || 0) + (n.rx_drop || 0) + (n.tx_drop || 0);
        const base = hw.base[key];
        if (!base || sum < base.sum) hw.base[key] = { sum };
        else if (sum > base.sum) { hwEvent(key, "warn", t("hw.ev_net", { i: iface, n: num(sum - base.sum, 0) }), now); base.sum = sum; }
      }
    }).catch(() => {});
  }

  function pollSlow() {
    return Promise.all([
      hw.sys ? null : client.call("machine.system_info").then((r) => { hw.sys = r.system_info || r; }).catch(() => {}),
      client.call("server.files.get_directory", { path: "gcodes", extended: false }).then((r) => { hw.disk = r.disk_usage || null; }).catch(() => {}),
      client.call("server.history.list", { limit: 30, order: "desc" }).then((r) => { hw.jobs = r.jobs || []; }).catch(() => {})
    ]);
  }

  // The camera: ustreamer's own state when it is there, else a picture
  function pollCamera(now) {
    const cam = app.webcams.find((w) => w.enabled !== false && w.snapshot_url);
    if (!cam) { hw.cam = null; return Promise.resolve(); }
    const snap = camUrl(cam);
    const stateUrl = snap.replace(/\?.*$/, "").replace(/\/?$/, "/") + "state";
    const ctl = "AbortController" in window ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), 4000);
    const opts = { cache: "no-store", signal: ctl ? ctl.signal : undefined };
    return fetch(stateUrl, opts).then((r) => (r.ok ? r.json() : Promise.reject(new Error("no state"))))
      .then((j) => { const src = (j.result || {}).source || {}; hw.cam = { online: !!src.online, fps: src.captured_fps, res: src.resolution, name: cam.name }; })
      .catch(() => fetch(snap + (snap.includes("?") ? "&" : "?") + "t=" + Date.now(), opts)
        .then((r) => { hw.cam = { online: r.ok, name: cam.name }; }))
      .catch(() => { hw.cam = { online: false, name: cam.name }; })
      .then(() => {
        clearTimeout(timer);
        hw.camFails = hw.cam && hw.cam.online ? 0 : hw.camFails + 1;
        if (hw.camFails >= 3) hwEvent("cam", "warn", t("hw.cam_down_sum"), now);
      });
  }

  function throttleText(flag) {
    const keys = { "Under-Voltage Detected": "undervolt_now", "Previously Under-Volted": "undervolt_before", "Frequency Capped": "capped_now",
      "Previously Frequency Capped": "capped_before", "Currently Throttled": "throttled_now", "Previously Throttled": "throttled_before",
      "Temperature Limit Active": "templimit_now", "Previously Temperature Limited": "templimit_before" };
    return keys[flag] ? t("hw.thr." + keys[flag]) : flag;
  }
  function hostText(c) {
    if (c.key === "cpu_hot") return t("hw.cpu_hot", { v: num(c.v, 0) });
    if (c.key === "memory_low") return t("hw.memory_low", { v: num(c.v, 0) });
    return t("hw.disk_low", { v: iso(bytesText(c.v)) });
  }

  function viewHardware() {
    if (!(app.objects || []).length) {
      return { el: h("div", null, head("hw.title", "hw.intro"), h("section", { class: "card empty" }, icon("chip"), h("p", { text: t("hw.waiting") }))) };
    }
    const list = motorList(), P = hwParts();
    const sect = (id, ic, title, extra) => h("section", { class: "card hw-sec", id: "hw-" + id }, h("h2", null, icon(ic), t(title)), h("div", { "data-live": id }), extra || null);
    const el = h("div", null, head("hw.title", "hw.intro", reportButton()),
      h("div", { class: "banner", "data-live": "hsum", hidden: true }),
      h("div", { class: "hw-kpis", "data-live": "kpis" }),
      h("h2", { class: "hw-head", id: "hw-boards" }, icon("chip"), t("hw.boards")),
      h("div", { class: "hw-grid", "data-live": "boards" }),
      list.length ? h("h2", { class: "hw-head", id: "hw-motors" }, icon("motor"), t("motors.title")) : null,
      list.length ? h("div", { class: "motor-grid" }, list.map((m) => h("section", { class: "card mcard", "data-motor": m.stepper },
        h("div", { class: "mc-top" },
          h("div", { class: "mc-ic" }, icon("motor")),
          h("div", { class: "grow" },
            h("div", { class: "mc-name" }, h("b", { text: motorName(m) }),
              m.motor ? h("span", { class: "badge", text: t("motors.belt", { m: m.motor }) }) : null),
            h("div", { class: "mc-sub ltr", text: m.stepper + " · " + m.driver.toUpperCase() })),
          h("span", { class: "badge", "data-f": "state" })),
        h("div", { class: "mc-load" },
          h("div", { class: "mc-row" }, h("span", { text: t(m.extruder ? "motors.flow" : "motors.load") }), h("b", { class: "ltr", "data-f": "loadtxt", text: "…" })),
          m.reportsLoad || m.extruder ? h("div", { class: "meter" }, h("i", { "data-f": "bar" })) : null,
          m.reportsLoad || m.extruder ? s("svg", { class: "spark", viewBox: "0 0 300 56", preserveAspectRatio: "none", "data-f": "spark", "aria-hidden": "true" }) : null,
          h("div", { class: "mc-note", "data-f": "loadnote" })),
        h("dl", { class: "mc-kv" },
          h("dt", { text: t("motors.current") }), h("dd", { "data-f": "current", text: "…" }),
          h("dt", { text: t("motors.temp") }), h("dd", { "data-f": "temp", text: "…" })),
        h("div", { class: "chips", "data-f": "flags" })))) : null,
      P.heaters.length ? h("h2", { class: "hw-head", id: "hw-heaters" }, icon("thermo"), t("hw.heaters")) : null,
      P.heaters.length ? h("div", { class: "hw-grid", "data-live": "heaters" }) : null,
      h("div", { class: "cols hw-cols" },
        h("div", { class: "stack" },
          P.fans.length ? sect("fans", "fan", "hw.fans") : null,
          sect("host", "server", "hw.host")),
        h("div", { class: "stack" },
          P.sensors.length || P.filament.length ? sect("sensors", "thermo", "hw.sensors") : null,
          app.webcams.some((w) => w.enabled !== false && w.snapshot_url) ? sect("camera", "camera", "hw.camera") : null,
          sect("events", "alert", "hw.events"))),
      h("p", { class: "note", style: { marginTop: "14px" } }, icon(app.push.id && app.push.hardware ? "ok" : "phone"),
        h("span", { text: t(app.push.id && app.push.hardware ? "hw.push_on" : app.push.key ? "hw.push_off" : "hw.push_none") })),
      // what the figures mean, folded away until asked for
      h("details", { class: "hw-about" }, h("summary", null, icon("info"), h("span", { text: t("hw.about") })),
        h("p", { class: "note" }, icon("info"), h("span", { text: t("hw.explain_boards") })),
        list.length ? h("p", { class: "note" }, icon("info"), h("span", { text: t("motors.explain") })) : null,
        list.length ? h("p", { class: "note" }, icon("thermo"), h("span", { text: t("motors.sensor_tip") })) : null));
    return { el, update: () => paintHardware(el, list, P) };
  }
  viewHardware.sig = function () {
    return JSON.stringify([(app.objects || []).length, Object.keys(app.config || {}).length, motorList().map((m) => m.obj + m.motor), app.klippy,
      app.webcams.length, app.push.id, app.push.hardware, app.push.key]);
  };

  function paintHardware(el, list, P) {
    if (!hw.at) return;
    let worst = null;                      // [level, text]
    const note = (level, text) => { if (!worst || LEVEL_RANK[level] > LEVEL_RANK[worst[0]]) worst = [level, text]; };
    const st = hw.status || {};
    const live = (id) => el.querySelector('[data-live="' + id + '"]');
    const chip = (level, text, ic) => h("span", { class: "chip " + (level === "info" ? "" : level) }, icon(ic || (level === "ok" ? "ok" : level === "info" ? "info" : "alert")), h("span", { text }));
    const stats = (rows, cls0) => h("div", { class: "mini-stats" + (cls0 ? " " + cls0 : "") }, rows.filter(Boolean).map(([k, v, cls, wide]) =>
      h("div", { class: "ms" + (cls ? " " + cls : "") + (wide ? " wide" : "") }, h("span", { text: k }), h("b", { text: v }))));
    // for the tiles at the top
    const kpi = { boards: 0, boardsWarn: 0, motorsWarn: 0, cpu: null, cpuT: null };

    // ----- boards
    const boards = live("boards");
    if (boards) boards.replaceChildren(...P.mcus.map((b) => {
      const ls = (st[b.obj] || {}).last_stats || {};
      const info = hw.mcuInfo[b.obj] || {};
      const base = hw.base[b.obj] || {};
      const temp = b.sensor && st[b.sensor] ? st[b.sensor].temperature : null;
      const can = P.can.find((c) => c.name.toLowerCase() === b.name.toLowerCase());
      const cs = can ? st[can.obj] || {} : null;
      const resent = typeof ls.bytes_retransmit === "number" ? num(ls.bytes_retransmit, 0) + (ls.bytes_retransmit > (base.retransmit || 0) ? " (" + t("hw.since_open", { n: num(ls.bytes_retransmit - base.retransmit, 0) }) + ")" : "") : "—";
      const chips = [];
      if (base.lastR > base.retransmit) chips.push(chip("warn", t("hw.chip_resent")));
      if (base.lastI > base.invalid) chips.push(chip("warn", t("hw.chip_invalid")));
      if (cs && cs.bus_state && cs.bus_state !== "active") chips.push(chip(cs.bus_state === "warn" ? "warn" : "bad", t("hw.can_state." + cs.bus_state)));
      for (const c of chips) note(c.classList.contains("bad") ? "bad" : "warn", boardName(b) + ": " + c.textContent);
      kpi.boards++;
      if (chips.length) kpi.boardsWarn++;
      return h("section", { class: "card hcard" },
        h("div", { class: "mc-top" }, h("div", { class: "mc-ic" }, icon(b.conn === "host" ? "server" : "chip")),
          h("div", { class: "grow" }, h("div", { class: "mc-name" }, h("b", { text: boardName(b) })),
            h("div", { class: "mc-sub ltr", text: [info.chip, b.main || b.conn === "host" ? "" : b.name].filter(Boolean).join(" · ") || b.obj })),
          b.conn ? h("span", { class: "badge", text: t("hw.conn." + b.conn) }) : null),
        stats([
          [t("hw.mcu_load"), typeof ls.mcu_awake === "number" ? iso(num(ls.mcu_awake * 100, 1) + " %") : "—"],
          [t("hw.mcu_rtt"), typeof ls.srtt === "number" ? iso(num(ls.srtt * 1000, 1) + " ms") : "—"],
          temp !== null && temp !== undefined ? [t("hw.mcu_temp"), iso(num(temp, 0) + " °C"), temp >= 75 ? "warn" : ""] : null,
          [t("hw.mcu_bad_bytes"), resent + " · " + (typeof ls.bytes_invalid === "number" ? num(ls.bytes_invalid, 0) : "—")],
          cs ? [t("hw.can_bus"), t("hw.can_state." + (cs.bus_state || "active")) + " · " + t("hw.can_errors", { rx: num(cs.rx_error || 0, 0), tx: num(cs.tx_error || 0, 0), r: num(cs.tx_retries || 0, 0) }), "", true] : null,
          info.version ? [t("hw.mcu_fw"), info.version, "", true] : null]),
        info.version ? noteLine(firmwareNote(info.version), "upd-gap") : null,
        chips.length ? h("div", { class: "chips" }, chips) : h("div", { class: "chips" }, chip("ok", t("hw.link_ok"))));
    }));

    // ----- motors (cards drawn once; their figures here)
    const on = (st.stepper_enable || {}).steppers || {};
    for (const m of list) {
      const card = el.querySelector('[data-motor="' + m.stepper + '"]');
      if (!card) continue;
      const f = (name) => card.querySelector('[data-f="' + name + '"]');
      const ms = st[m.obj] || {};
      const d = ms.drv_status || {};
      const state = on[m.stepper] === false ? "off" : d.stst ? "holding" : "moving";
      f("state").textContent = t("motors.state." + state);
      f("state").className = "badge " + (state === "moving" ? "blue" : state === "holding" ? "ok" : "");
      f("current").textContent = typeof ms.run_current === "number" ? t("motors.amps", { run: num(ms.run_current, 2), hold: num(ms.hold_current, 2) }) : "—";
      const sensor = M.motorSensor(m, app.objects);
      const mt = sensor && st[sensor] && typeof st[sensor].temperature === "number" ? st[sensor].temperature : null;
      const temps = [];
      if (mt !== null) temps.push(t("motors.temp_motor", { v: num(mt, 0) }));
      if (typeof ms.temperature === "number") temps.push(t("motors.temp_driver", { v: num(ms.temperature, 0) }));
      f("temp").textContent = temps.length ? temps.join(" · ") : t("motors.temp_none");
      f("temp").className = mt !== null && mt >= 80 ? "bad" : mt !== null && mt >= 65 ? "warn" : "";
      if (mt !== null && mt >= 65) note(mt >= 80 ? "bad" : "warn", t("motors.sum_hot", { m: motorName(m), v: num(mt, 0) }));
      const motorWarn = (mt !== null && mt >= 65) || M.driverFlags(d).some((x) => x.level !== "info");
      if (motorWarn) kpi.motorsWarn++;
      // StallGuard: higher is easier; no alarm from it (it also drops at low speed)
      const G = M.stallguard(hw.hist[m.stepper]);
      const txt = f("loadtxt");
      if (m.extruder) {
        // an extruder turns too slowly for StallGuard: its flow tells more
        const fl = hw.flow[m.stepper] || [];
        const peak = Math.max(0, ...fl);
        const recent = fl.slice(-5).sort((a, b) => a - b);
        const now = recent.length ? recent[Math.floor(recent.length / 2)] : 0;
        txt.textContent = num(now, 1) + " mm³/s";
        f("bar").style.width = num(Math.max(1, Math.min(100, 100 * now / Math.max(1, peak))), 1) + "%";
        f("loadnote").textContent = now > 0.05 || peak > 0.05
          ? t("motors.flow_note", { fil: iso(num(now / (hw.fil[m.stepper] || 1), 1) + " mm/s"), peak: iso(num(peak, 1) + " mm³/s") })
          : t("motors.flow_idle");
        drawSpark(f("spark"), fl, 0, Math.max(1, peak));
      } else if (m.reportsLoad && G.wait && (hw.quiet[m.stepper] || 0) >= 30) {
        txt.textContent = "—";
        f("loadnote").textContent = t("motors.too_slow");
        drawSpark(f("spark"), [], 0, 1);
      } else if (!m.reportsLoad) {
        txt.textContent = "—";
        f("loadnote").textContent = t("motors.no_load", { d: m.driver.toUpperCase() });
      } else if (G.wait) {
        txt.textContent = "…";
        f("loadnote").textContent = t("motors.load_wait");
        drawSpark(f("spark"), [], 0, 1);
      } else {
        txt.textContent = num(G.now, 0);
        f("bar").style.width = num(Math.max(2, Math.min(100, 100 * G.now / Math.max(1, G.high))), 1) + "%";
        f("loadnote").textContent = t("motors.load_note", { low: num(G.low, 0) });
        drawSpark(f("spark"), hw.hist[m.stepper], 0, G.high);
      }
      const flags = M.driverFlags(d);
      f("flags").replaceChildren(...(flags.length ? flags.map((x) => chip(x.level, t("motors.flag." + x.flag))) : [chip("ok", t("motors.flags_ok"))]));
      for (const x of flags) if (x.level !== "info") note(x.level, t("motors.sum_flag", { m: motorName(m), what: t("motors.flag." + x.flag) }));
    }

    // ----- heaters
    const heaters = live("heaters");
    if (heaters) heaters.replaceChildren(...P.heaters.map((x) => {
      const hs = st[x.obj] || {};
      const w = hw.heat[x.obj] || {};
      const target = hs.target || 0;
      const temps = (hw.temps[x.obj] || []).filter((v) => v !== null);
      const lo = Math.min(...temps.concat([target || Infinity])), hi = Math.max(...temps.concat([target]));
      const svg = s("svg", { class: "spark", viewBox: "0 0 300 56", preserveAspectRatio: "none", "aria-hidden": "true" });
      drawSpark(svg, hw.temps[x.obj] || [], lo - 2, hi + 2, target > 0 ? target : null);
      if (w.level) note(w.level, t("hw.heater." + w.reason, { h: heaterName(x) }));
      const stateKey = !target ? "off" : Math.abs((hs.temperature || 0) - target) <= 2 ? "holding" : (hs.temperature || 0) < target ? "heating" : "cooling";
      return h("section", { class: "card hcard" },
        h("div", { class: "mc-top" }, h("div", { class: "mc-ic" }, icon("thermo")),
          h("div", { class: "grow" }, h("div", { class: "mc-name" }, h("b", { text: heaterName(x) })), h("div", { class: "mc-sub ltr", text: x.obj })),
          h("span", { class: "badge " + (stateKey === "holding" ? "ok" : stateKey === "heating" ? "blue" : ""), text: t("hw.heat_state." + stateKey) })),
        h("div", { class: "mc-row" }, h("span", { text: t("hw.heater_temp") }),
          h("b", { class: "ltr", text: (typeof hs.temperature === "number" ? num(hs.temperature, 1) : "—") + " °C" + (target ? " / " + num(target, 0) : "") })),
        h("div", { class: "meter" }, h("i", { style: { width: num(Math.max(1, (hs.power || 0) * 100), 0) + "%" } })),
        h("div", { class: "mc-note", text: t("hw.heater_power", { p: iso(num((hs.power || 0) * 100, 0) + " %") }) }),
        svg,
        w.level ? h("div", { class: "chips" }, chip(w.level, t("hw.heater." + w.reason, { h: heaterName(x) }))) : null);
    }));

    // ----- fans
    const fans = live("fans");
    if (fans) fans.replaceChildren(h("div", { class: "list" }, P.fans.map((f) => {
      const fs = st[f.obj] || {};
      const stopped = (hw.fanOff[f.obj] || 0) >= 5;
      if (stopped) note("bad", t("hw.fan_stopped", { f: fanName(f) }));
      const extra = [];
      if (typeof fs.rpm === "number") extra.push(num(fs.rpm, 0) + " RPM");
      if (f.kind === "temperature_fan" && typeof fs.temperature === "number") extra.push(num(fs.temperature, 0) + " / " + num(fs.target || 0, 0) + " °C");
      return h("div", { class: "row hw-row" },
        h("div", { class: "grow" }, h("div", { class: "name", dir: "auto", text: fanName(f) }),
          h("div", { class: "sub", text: t("hw.fan_kind." + f.kind) + (extra.length ? " · " : "") }, extra.length ? h("span", { class: "ltr", text: extra.join(" · ") }) : null)),
        stopped ? h("span", { class: "badge bad", text: t("hw.fan_stopped_short") }) : null,
        h("div", { class: "hw-pct" }, h("div", { class: "meter" }, h("i", { style: { width: num((fs.speed || 0) * 100, 0) + "%" } })),
          h("b", { class: "ltr", text: num((fs.speed || 0) * 100, 0) + " %" })));
    })));

    // ----- the computer
    const host = live("host");
    if (host) {
      const p = hw.proc || {}, sys = (hw.sys || {}), cpu = sys.cpu_info || {};
      const mem = p.system_memory || {};
      const hostT = P.hostSensor && st[P.hostSensor] ? st[P.hostSensor].temperature : null;
      const cpuT = typeof p.cpu_temp === "number" ? p.cpu_temp : hostT;
      const disk = hw.disk;
      const thr = M.throttleFlags(p.throttled_state);
      for (const c of M.hostChecks(p, disk)) note(c.level, hostText(c));
      kpi.cpu = typeof (p.system_cpu_usage || {}).cpu === "number" ? p.system_cpu_usage.cpu : null;
      kpi.cpuT = typeof cpuT === "number" ? cpuT : null;
      kpi.hostLevel = M.hostChecks(p, disk).concat(thr).reduce((w, c) => ((LEVEL_RANK[c.level] || 0) > (LEVEL_RANK[w] || 0) ? c.level : w), "ok");
      for (const f of thr) note(f.level, t("hw.throttle") + ": " + throttleText(f.flag));
      const nets = Object.entries(p.network || {}).filter(([k]) => k !== "lo");
      const ss = st.system_stats || {};
      host.replaceChildren(...[
        stats([
          [t("hw.cpu"), typeof (p.system_cpu_usage || {}).cpu === "number" ? t("hw.cpu_val", { p: iso(num(p.system_cpu_usage.cpu, 0) + " %"), c: num(cpu.cpu_count || 0, 0) }) : "—"],
          [t("hw.cpu_temp"), typeof cpuT === "number" ? iso(num(cpuT, 0) + " °C") : "—", cpuT >= 85 ? "bad" : cpuT >= 75 ? "warn" : ""],
          [t("hw.memory"), mem.total ? t("hw.mem_val", { used: iso(bytesText((mem.total - mem.available) * 1024)), total: iso(bytesText(mem.total * 1024)) }) : "—"],
          [t("hw.disk"), disk ? t("hw.disk_val", { free: iso(bytesText(disk.free)), total: iso(bytesText(disk.total)) }) : "—"],
          [t("hw.klipper_load"), typeof ss.sysload === "number" ? num(ss.sysload, 2) : "—"],
          [t("hw.uptime"), typeof p.system_uptime === "number" ? duration(p.system_uptime) : "—"]], "roomy"),
        thr.length ? h("div", { class: "chips" }, thr.map((f) => chip(f.level, throttleText(f.flag)))) : null,
        nets.length ? h("h3", { class: "hw-sub", text: t("hw.network") }) : null,
        nets.length ? h("div", { class: "list" }, nets.map(([iface, n]) => {
          const can = ((sys.canbus || {})[iface]) || null;
          const errs = (n.rx_errs || 0) + (n.tx_errs || 0), drops = (n.rx_drop || 0) + (n.tx_drop || 0);
          return h("div", { class: "row hw-row" },
            h("div", { class: "grow" }, h("div", { class: "name ltr", text: iface }),
              h("div", { class: "sub" }, h("span", { class: "ltr", text: bytesText(n.rx_bytes) + " ↓ · " + bytesText(n.tx_bytes) + " ↑" + (can ? " · " + num(can.bitrate / 1000, 0) + " kbit/s · " + can.driver : "") }))),
            h("span", { class: "badge " + (errs ? "warn" : ""), text: t("hw.net_errs", { e: num(errs, 0), d: num(drops, 0) }) }));
        })) : null].filter(Boolean));
    }

    // ----- sensors
    const sensors = live("sensors");
    if (sensors) {
      const rows = P.sensors.filter((x) => !list.some((m) => M.motorSensor(m, app.objects) === x.obj)).map((x) => {
        const ts = st[x.obj] || {};
        return h("div", { class: "row hw-row" },
          h("div", { class: "grow" }, h("div", { class: "name", dir: "auto", text: pretty(x.name) }),
            h("div", { class: "sub", text: x.board ? t("hw.sensor_board") : typeof ts.measured_min_temp === "number" ? t("hw.min_max", { min: num(ts.measured_min_temp, 0), max: num(ts.measured_max_temp, 0) }) : "" })),
          h("b", { class: "ltr", text: typeof ts.temperature === "number" ? num(ts.temperature, 1) + " °C" : "—" }));
      }).concat(P.filament.map((x) => {
        const fs = st[x.obj] || {};
        const state = fs.enabled === false ? "off" : fs.filament_detected ? "yes" : "no";
        if (state === "no") note("info", t("hw.ev_filament", { s: pretty(x.name) }));
        return h("div", { class: "row hw-row" },
          h("div", { class: "grow" }, h("div", { class: "name", dir: "auto", text: pretty(x.name) }), h("div", { class: "sub", text: t("hw.fil_kind." + x.kind) })),
          h("span", { class: "badge " + (state === "yes" ? "ok" : state === "no" ? "warn" : ""), text: t("hw.fil." + state) }));
      }));
      sensors.replaceChildren(rows.length ? h("div", { class: "list" }, rows) : h("p", { class: "muted", text: "—" }));
    }

    // ----- camera
    const camera = live("camera");
    if (camera) {
      const c = hw.cam;
      if (c && !c.online && hw.camFails >= 3) note("warn", t("hw.cam_down_sum"));
      camera.replaceChildren(!c ? h("p", { class: "muted", text: "…" }) : h("div", { class: "row hw-row", style: { padding: 0, border: 0 } },
        h("div", { class: "grow" }, h("div", { class: "name", dir: "auto", text: c.name || t("hw.camera") }),
          h("div", { class: "sub ltr", text: c.online && c.res ? t("hw.cam_ok", { w: c.res.width, h: c.res.height, fps: num(c.fps || 0, 0) }) : "" })),
        h("span", { class: "badge " + (c.online ? "ok" : "bad"), text: t(c.online ? "hw.cam_answer" : "hw.cam_down") })));
    }

    // ----- warnings while open, and prints that stopped
    const events = live("events");
    if (events) {
      const failed = (hw.jobs || []).filter((j) => ["error", "klippy_shutdown", "klippy_disconnect", "interrupted", "server_exit"].includes(j.status)).slice(0, 6);
      events.replaceChildren(
        hw.events.length ? h("div", { class: "list" }, hw.events.slice(0, 12).map((e) => h("div", { class: "row hw-row" },
          h("span", { class: "badge " + (e.level === "info" ? "" : e.level), text: new Date(e.time * 1000).toLocaleTimeString([], { hour12: false }) }),
          h("div", { class: "grow", dir: "auto", text: e.text })))) : h("p", { class: "muted", text: t("hw.events_none") }),
        h("h3", { class: "hw-sub", text: t("hw.failed") }),
        hw.jobs === null ? h("p", { class: "muted", text: "…" }) : failed.length ? h("div", { class: "list" }, failed.map((j) => h("div", { class: "row hw-row" },
          h("div", { class: "grow" }, h("div", { class: "name ltr", text: j.filename }),
            h("div", { class: "sub", text: fmtDate(j.start_time, true) + " · " + t("hw.job." + j.status) }))))) : h("p", { class: "muted", text: t("hw.failed_none") }));
    }

    const kpis = live("kpis");
    if (kpis) {
      const go = (id) => () => { const target = document.getElementById(id); if (target) target.scrollIntoView({ behavior: "smooth", block: "start" }); };
      const tile = (id, ic, label, value, subText, level) => h("button", { type: "button", class: "kpi " + (level || ""), onclick: go(id) },
        h("span", { class: "kpi-top" }, icon(ic), h("span", { text: label })),
        h("b", { class: "ltr", text: value }),
        h("span", { class: "kpi-sub", text: subText }));
      const tiles = [tile("hw-boards", "chip", t("hw.boards"), num(kpi.boards, 0),
        kpi.boardsWarn ? t("hw.kpi_warn", { n: num(kpi.boardsWarn, 0) }) : t("hw.kpi_links_ok"), kpi.boardsWarn ? "warn" : "ok")];
      if (list.length) tiles.push(tile("hw-motors", "motor", t("motors.title"), num(list.length, 0),
        kpi.motorsWarn ? t("hw.kpi_warn", { n: num(kpi.motorsWarn, 0) }) : t("hw.kpi_motors_ok"), kpi.motorsWarn ? "warn" : "ok"));
      for (const x of P.heaters.slice(0, 2)) {
        const hs = st[x.obj] || {}, w = hw.heat[x.obj] || {};
        tiles.push(tile("hw-heaters", "thermo", heaterName(x),
          (typeof hs.temperature === "number" ? num(hs.temperature, 0) : "—") + (hs.target ? " / " + num(hs.target, 0) : "") + " °C",
          hs.target ? t("hw.kpi_heater_on", { p: num((hs.power || 0) * 100, 0) }) : t("hw.heat_state.off"), w.level || (hs.target ? "ok" : "")));
      }
      tiles.push(tile("hw-host", "server", t("hw.host"), kpi.cpuT !== null ? num(kpi.cpuT, 0) + " °C" : "—",
        kpi.cpu !== null ? t("hw.kpi_cpu", { p: num(kpi.cpu, 0) }) : "", kpi.hostLevel || "ok"));
      if (hw.cam) tiles.push(tile("hw-camera", "camera", t("hw.camera"), hw.cam.online ? (hw.cam.fps ? num(hw.cam.fps, 0) + " fps" : t("hw.cam_answer")) : t("hw.cam_down"),
        hw.cam.online && hw.cam.res ? hw.cam.res.width + "×" + hw.cam.res.height : "", hw.cam.online ? "ok" : "bad"));
      kpis.replaceChildren(...tiles);
    }

    const sum = live("hsum");
    if (sum) {
      sum.hidden = false;
      sum.className = "banner " + (worst ? (worst[0] === "info" ? "" : worst[0]) : "ok");
      sum.replaceChildren(icon(worst ? (worst[0] === "info" ? "info" : "alert") : "ok"), h("div", { class: "grow", text: worst ? worst[1] : t("hw.sum_ok") }));
    }
  }

  // The last ten minutes as a line, newest on the right; a dashed line for a target.
  function drawSpark(svg, hist, lo, hi, guide) {
    if (!svg) return;
    const W = 300, H = 56, span = Math.max(1e-6, hi - lo);
    const y = (v) => (H - 3 - Math.max(0, Math.min(1, (v - lo) / span)) * (H - 6)).toFixed(1);
    const segs = [];
    let seg = [];
    const start = KEEP - hist.length;
    hist.forEach((v, i) => {
      if (v === null) { if (seg.length > 1) segs.push(seg); seg = []; return; }
      seg.push(((start + i) / (KEEP - 1) * W).toFixed(1) + "," + y(v));
    });
    if (seg.length > 1) segs.push(seg);
    svg.replaceChildren(
      ...(guide !== null && guide !== undefined ? [s("line", { x1: 0, x2: W, y1: y(guide), y2: y(guide), class: "spark-guide" })] : []),
      ...segs.map((p) => s("polyline", { points: p.join(" "), class: "spark-line" })));
  }

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

  function viewUpdates() {
    loadUpdates();
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
          boards.length ? h("section", { class: "card" }, h("h2", null, icon("chip"), t("upd.boards")), boards) : null,
          others.length ? h("section", { class: "card" }, h("h2", null, icon("layers"), t("upd.others")), others.map(other)) : null))
    };
  }
  viewUpdates.sig = function () {
    const vi = upd.status;
    // drawn again once connected, so it can ask
    return JSON.stringify([app.conn, (app.objects || []).length, !!vi, vi && Object.entries(vi).map(([k, c]) => [k, c.version, c.remote_version, (c.commits_behind || []).length]),
      app.klipperVersion, upd.mcus, Object.keys(upd.res).length, upd.open,
      farmShown() && farm.data.printers.map((p) => [p.id, p.name, p.phase, p.updates, p.firmware, p.job])]);
  };

  /* ==================================================== pictures, bigger */

  // A picture under the mouse shows bigger next to it, anywhere in the page:
  // a file's thumbnail, a camera, a drawing. Only with a mouse: a finger
  // opens what it touches. A picture already shown large is left as it is.
  const zoom = { el: null, img: null, timer: 0, x: 0, y: 0 };
  function zoomHide() {
    clearTimeout(zoom.timer);
    if (zoom.el) zoom.el.hidden = true;
  }
  function zoomPlace() {
    const el = zoom.el;
    if (!el || el.hidden) return;
    const gap = 18, edge = 12;
    let left = zoom.x + gap, top = zoom.y + gap;
    if (left + el.offsetWidth > innerWidth - edge) left = Math.max(edge, zoom.x - gap - el.offsetWidth);
    if (top + el.offsetHeight > innerHeight - edge) top = Math.max(edge, innerHeight - edge - el.offsetHeight);
    el.style.left = left + "px";
    el.style.top = top + "px";
  }
  function zoomShow(img) {
    if (!zoom.el) {
      zoom.img = h("img", { alt: "" });
      zoom.el = h("div", { class: "zoom-pop", "aria-hidden": "true", hidden: true }, zoom.img);
      zoom.img.addEventListener("load", zoomPlace);
      document.body.appendChild(zoom.el);
    }
    // the part's backdrop, as its thumbnail has it
    const thumb = img.closest(".thumb");
    zoom.el.className = "zoom-pop" + (thumb && thumb.classList.contains("ink-dark") ? " ink-dark" : thumb && thumb.classList.contains("ink-light") ? " ink-light" : "");
    zoom.img.src = img.currentSrc || img.src;
    zoom.img.style.width = Math.min(420, Math.max(240, img.naturalWidth || 420)) + "px";
    zoom.el.hidden = false;
    zoomPlace();
  }
  if (window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches) {
    document.addEventListener("mouseover", (e) => {
      const img = e.target instanceof HTMLImageElement ? e.target : null;
      if (!img || !img.src || img.closest(".zoom-pop, .top") || !img.complete) return;
      if (img.getBoundingClientRect().width >= 300) return;          // large already
      zoom.x = e.clientX;
      zoom.y = e.clientY;
      clearTimeout(zoom.timer);
      zoom.timer = setTimeout(() => zoomShow(img), 180);
    });
    document.addEventListener("mousemove", (e) => { zoom.x = e.clientX; zoom.y = e.clientY; zoomPlace(); }, { passive: true });
    document.addEventListener("mouseout", (e) => { if (e.target instanceof HTMLImageElement) zoomHide(); });
    document.addEventListener("mousedown", zoomHide);
    window.addEventListener("scroll", zoomHide, { capture: true, passive: true });
    window.addEventListener("hashchange", zoomHide);
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
})();
