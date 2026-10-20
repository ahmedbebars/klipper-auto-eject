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
    download: "M12 3v12 M7 10l5 5 5-5 M4 21h16",
    external: "M14 3h7v7 M10 14L21 3 M21 14v7H3V3h7",
    reset: "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5",
    restart: "M21 12a9 9 0 1 1-3-6.7L21 8 M21 3v5h-5",
    wand: "M15 4V2 M15 16v-2 M8 9h2 M20 9h2 M17.8 11.8L19 13 M17.8 6.2L19 5 M12.2 6.2L11 5 M12.2 11.8L3 21",
    box: "M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8"
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
    files: null,
    meta: {},
    webcams: [],
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
    if (st.busy) {
      const bed = app.status.heater_bed;
      const set = sv();
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
      if ((info.components || []).includes("webcam")) client.call("server.webcams.list").then((r) => { app.webcams = r.webcams || []; refresh(); }).catch(() => {});
      client.call("server.config").then((r) => {
        const jq = (r.config || {}).job_queue;
        app.autoTransition = jq ? !!jq.automatic_transition : null;
        refresh();
      }).catch(() => {});
      if (app.klippy === "ready") klippyReady();
      else refresh();
      if (app.files === null && (route() === "check" || route() === "queue")) loadFiles();
    }).catch((e) => {
      if (/unauthori/i.test(e.message)) { app.conn = "unauthorized"; refresh(); }
    });
    client.call("printer.info").then((r) => { app.host = r.hostname || ""; refresh(); }).catch(() => {});
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
      app.klippy = diff.webhooks.state;
      app.klippyMsg = diff.webhooks.state_message || "";
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
    refresh("activity");
  });

  client.on("notify_job_queue_changed", (p) => {
    const d = p[0] || {};
    if (d.updated_queue) app.queue.jobs = d.updated_queue;
    if (d.queue_state) app.queue.state = d.queue_state;
    refresh();
  });

  client.on("notify_filelist_changed", () => { app.files = null; if (route() === "check" || route() === "queue") loadFiles(); });

  function loadQueue() {
    return client.call("server.job_queue.status").then((r) => {
      app.queue = { jobs: r.queued_jobs || [], state: r.queue_state || "" };
      refresh();
    }).catch(() => {});
  }

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

  function confirm(title, body, okLabel, okClass) {
    return new Promise((resolve) => {
      const close = (v) => { root.remove(); resolve(v); };
      const root = h("div", { class: "modal-back", onclick: (e) => { if (e.target === root) close(false); } },
        h("div", { class: "modal", role: "dialog", "aria-modal": "true" },
          h("header", null, h("h3", { text: title })),
          h("div", { class: "body" }, h("p", { text: body })),
          h("footer", null,
            h("button", { type: "button", class: "btn", onclick: () => close(false), text: t("c.cancel") }),
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
    { id: "queue", icon: "queue", render: viewQueue },
    { id: "check", icon: "check", render: viewCheck },
    { id: "setup", icon: "setup", render: viewSetup },
    { id: "settings", icon: "settings", render: viewSettings },
    { id: "activity", icon: "activity", render: viewActivity },
    { id: "guide", icon: "guide", render: viewGuide }
  ];

  function route() {
    const r = location.hash.replace(/^#\/?/, "").split("/")[0];
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
        const res = view.render();
        box.replaceChildren(res.el);
        if (keep) restoreInputs(box, keep);
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

  window.addEventListener("hashchange", () => { refresh(); $("#main").focus({ preventScroll: true }); window.scrollTo(0, 0); });

  /* ============================================================= chrome */

  let chromeSig = "";
  function renderChrome() {
    const ph = phase();
    const id = route();
    const sig = [lang, id, app.conn, app.klippy, ph, app.host, app.hasQueue, app.queue.jobs.length, leftover().length, app.hasMacros].join("|");
    if (sig === chromeSig) return;
    chromeSig = sig;
    const dir = (AE_LANGS[lang] || {}).dir || "ltr";
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.title = t("app.title") + (app.host ? " · " + app.host : "");
    document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
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
    const back = $("#back");
    back.hidden = DEMO;          // the demo has no printer dashboard to go back to
    back.replaceChildren(icon("home"));
    back.title = t("app.back");
    back.setAttribute("aria-label", t("app.back"));

    const nav = $("#nav");
    nav.replaceChildren(...VIEWS.filter((v) => v.id !== "queue" || app.hasQueue || DEMO).map((v) => {
      const count = v.id === "queue" && app.queue.jobs.length ? h("span", { class: "count", text: num(app.queue.jobs.length, 0) }) : null;
      return h("a", { href: "#/" + v.id, class: v.id === id ? "active" : "", "aria-current": v.id === id ? "page" : null },
        icon(v.icon), h("span", { text: t("nav." + v.id) }), count);
    }), h("div", { class: "foot" }, h("a", { href: DOCS, target: "_blank", rel: "noopener", text: "klipper-auto-eject" })));

    // one banner for the most important thing
    const b = $("#banner");
    let banner = null;
    if (app.conn === "unauthorized") banner = ["bad", "alert", t("conn.unauthorized")];
    else if (app.conn === "online" && (app.klippy === "shutdown" || app.klippy === "error")) {
      banner = ["bad", "alert", t("conn.shutdown", { msg: app.klippyMsg || app.klippy }),
        h("button", { type: "button", class: "btn sm", onclick: () => confirm(t("conn.restart"), t("conn.restart_confirm"), t("conn.restart"))
          .then((ok) => { if (ok) client.call("printer.firmware_restart").catch((e) => toast(e.message, "bad")); }) }, icon("restart"), t("conn.restart"))];
    } else if (app.conn === "online" && app.klippy === "ready" && app.hasMacros === false) banner = ["bad", "alert", t("conn.missing")];
    else if (DEMO) banner = ["demo", "info", t("app.demo_note")];
    if (banner) {
      b.className = "banner " + banner[0];
      b.replaceChildren(...[icon(banner[1]), h("div", { class: "grow" }, h("div", { text: banner[2] })), banner[3]].filter(Boolean));
      b.hidden = false;
    } else b.hidden = true;
  }

  /* =========================================================== overview */

  const STATE_ICON = { idle: "ok", printing: "layers", paused: "pause", cooling: "thermo", working: "push", waiting: "alert", offline: "info", shutdown: "stop" };

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
    else if (ph === "cooling") sub = t("status.sub.cooling", { now: num((app.status.heater_bed || {}).temperature || 0), target: num(set.cool_temp, 0) });
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
    const hero = h("section", { class: "card hero", "data-state": ht.ph },
      h("div", { class: "hero-top" },
        h("div", { class: "hero-ic" }, icon(STATE_ICON[ht.ph], "lg")),
        h("div", { style: { minWidth: 0 } }, h("h1", { text: ht.title }), h("p", { "data-live": "sub", text: ht.sub }))));
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
      app.hasQueue ? h("a", { class: "chip", href: "#/queue" }, icon("queue"), h("span", { text: t("facts.queue") + ":" }),
        h("b", { text: t("facts.queue_value", { n: num(app.queue.jobs.length, 0) }) })) : null));

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
    const actions = h("section", { class: "card" },
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

    const el = h("div", null, left, h("div", { class: "cols" },
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
      Array.from(app.lanesDone), Object.keys(polygons()).length]);
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

  function viewQueue() {
    if (!app.hasQueue) return { el: h("div", null, head("queue.title"), h("div", { class: "card empty" }, icon("queue"), h("p", { text: t("queue.unavailable") }))) };
    if (app.files === null) loadFiles();
    const q = app.queue;
    const paused = q.state === "paused";
    const set = sv();
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
      return h("div", { class: "row" + (i === 0 && !paused ? " now" : "") },
        h("span", { class: "num", text: num(i + 1, 0) }),
        h("div", { class: "grow" }, h("div", { class: "name ltr", text: j.filename }),
          h("div", { class: "sub" }, m && m.estimated_time ? duration(m.estimated_time) : "", m && m.object_height ? " · " + t("c.mm", { v: num(m.object_height) }) : "")),
        badge,
        h("button", { type: "button", class: "icon-btn", title: t("queue.remove"), "aria-label": t("queue.remove"),
          onclick: () => client.call("server.job_queue.delete_job", { job_ids: [j.job_id] }).then(() => toast(t("queue.removed"))).catch((e) => toast(e.message, "bad")) }, icon("trash")));
    });

    const fileOpts = (app.files || []).map((f) => h("option", { value: f.path, text: f.path }));
    const pick = h("select", { class: "select ltr", "data-keep": "q-file", style: { width: "100%" } }, h("option", { value: "", text: "— " + t("queue.pick") + " —" }), fileOpts);
    const copies = h("input", { class: "input", type: "number", min: 1, max: 50, value: 1, "data-keep": "q-copies", style: { width: "90px" } });

    const ps = app.status.print_stats || {};
    if (["printing", "paused"].includes(ps.state) && ps.filename) {
      const p = (app.status.display_status || {}).progress || 0;
      rows.unshift(h("div", { class: "row now" }, h("span", { class: "num" }, icon("play")),
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
              paused ? h("button", { type: "button", class: "btn primary", onclick: () => client.call("server.job_queue.start").catch((e) => toast(e.message, "bad")) }, icon("play"), t("queue.start"))
                     : h("button", { type: "button", class: "btn", onclick: () => client.call("server.job_queue.pause").catch((e) => toast(e.message, "bad")) }, icon("pause"), t("queue.pause")),
              q.jobs.length ? h("span", { class: "muted", text: t("queue.total", { n: num(q.jobs.length, 0), t: duration(total) }) }) : null))),
        h("div", { class: "stack" },
          h("section", { class: "card" },
            h("h2", null, icon("plus"), t("queue.add")),
            h("div", { class: "form-row" },
              h("label", { class: "field grow" }, h("span", { text: t("queue.pick") }), pick),
              h("label", { class: "field" }, h("span", { text: t("queue.copies") }), copies),
              h("button", { type: "button", class: "btn primary", onclick: () => {
                const f = pick.value;
                const n = Math.max(1, Math.min(50, parseInt(copies.value, 10) || 1));
                if (!f) return;
                client.call("server.job_queue.post_job", { filenames: Array(n).fill(f), reset: false })
                  .then(() => toast(t("queue.added", { n: num(n, 0) }), "ok")).catch((e) => toast(e.message, "bad"));
              } }, icon("plus"), t("queue.add_button")))),
          h("section", { class: "card" },
            h("p", { class: "note" }, icon(app.autoTransition ? "ok" : "info"), h("span", { text: app.autoTransition ? t("queue.auto_on") : t("queue.auto_off") })),
            h("p", { class: "note", style: { marginTop: "10px" } }, icon("info"), h("span", null, t("guide.slicer"), " ", h("code", { class: "ltr", text: "AUTO_EJECT HEIGHT=[max_layer_z] HOME=1" })))))));
    return { el };
  }
  viewQueue.sig = function () {
    const ps = app.status.print_stats || {};
    return JSON.stringify([app.hasQueue, app.queue, ps.state, ps.filename, Math.round(((app.status.display_status || {}).progress || 0) * 100), app.autoTransition, (app.files || []).length, Object.keys(app.meta).length, sv().min_part_height, sv().thin_parts_action]);
  };

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
    }).catch((e) => { check.error = e.message; }).then(() => { check.loading = false; refresh("check"); });
  }

  function viewCheck() {
    if (app.files === null) loadFiles();
    const q = check.filter.toLowerCase();
    const files = (app.files || []).filter((f) => !q || f.path.toLowerCase().includes(q));
    const search = h("div", { class: "search" }, icon("search"),
      h("input", { class: "input", type: "search", placeholder: t("check.search"), value: check.filter, "data-keep": "c-search",
        oninput: (e) => { check.filter = e.target.value; refresh("check"); } }));
    const list = app.files === null ? h("div", { class: "empty" }, h("span", { class: "spinner" }))
      : files.length ? h("div", { class: "list files" }, files.slice(0, 300).map((f) =>
          h("button", { type: "button", class: "row" + (f.path === check.file ? " active" : ""), onclick: () => runCheck(f.path) },
            icon("file"), h("div", { class: "grow" }, h("div", { class: "name ltr", text: f.path }),
              h("div", { class: "sub", text: t("check.size", { size: fmtSize(f.size), date: new Date(f.modified * 1000).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : undefined) }) })))))
      : h("div", { class: "empty" }, icon("file"), h("p", { text: t("check.no_files") }));

    let result;
    if (check.loading) result = h("div", { class: "empty" }, h("span", { class: "spinner" }), h("p", { text: t("check.reading") }));
    else if (check.error) result = h("div", { class: "banner bad" }, icon("alert"), h("div", { text: t("c.error", { e: check.error }) }));
    else if (check.result) {
      const r = check.result;
      const vIcon = r.verdict === "ok" ? "ok" : r.verdict === "warn" ? "alert" : "bad";
      result = h("div", null,
        h("div", { class: "verdict " + r.verdict }, icon(vIcon),
          h("div", null, h("b", { text: t("check.verdict_" + r.verdict) }), h("span", { class: "ltr", text: check.file }))),
        h("ul", { class: "checks" }, r.checks.map((c) => h("li", { class: c.ok }, icon(c.ok === "ok" ? "ok" : c.ok === "warn" ? "alert" : "bad"),
          h("span", { text: t(c.key, Object.assign({}, c.vars, c.vars && c.vars.n !== undefined ? { n: num(c.vars.n, 0) } : {})) })))),
        r.records.length ? h("div", { class: "check-map" }, bedMap(r.plan, { records: r.records, polygons: Object.fromEntries(r.objects.map((o) => [o.name.replace(/['"]/g, ""), o.polygon])), id: "c" })) : null,
        app.hasQueue ? h("div", { class: "toolbar", style: { marginTop: "14px" } },
          h("button", { type: "button", class: "btn", onclick: () => client.call("server.job_queue.post_job", { filenames: [check.file], reset: false })
            .then(() => toast(t("queue.added", { n: num(1, 0) }), "ok")).catch((e) => toast(e.message, "bad")) }, icon("plus"), t("check.add"))) : null);
    } else result = h("div", { class: "empty" }, icon("check"), h("p", { text: t("check.pick") }));

    return {
      el: h("div", null, head("check.title", "check.intro"),
        h("div", { class: "cols side" },
          h("section", { class: "card" }, search, h("div", { style: { marginTop: "10px" } }, list)),
          h("section", { class: "card" }, result)))
    };
  }
  viewCheck.sig = function () {
    return JSON.stringify([(app.files || []).length, app.files === null, check.file, check.loading, check.error, !!check.result, check.filter, app.hasQueue]);
  };

  function fmtSize(b) {
    if (!b) return "";
    if (b > 1048576) return num(b / 1048576) + " MB";
    return num(b / 1024, 0) + " KB";
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
              h("dt", { text: t("setup.probe") }), h("dd", { text: t(pb.label) })))),
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
              stlRow("setup.cube", "setup.cube_desc", "test_hollow_cube.stl"))))));
    return { el };
  }
  viewSetup.sig = function () { return JSON.stringify([sv(), blocked(), Object.keys(app.config).length, parts().length]); };

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

  const settingsUi = { filter: "", edits: {} };

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
    const cards = [];
    for (const sec of sections) {
      const rows = sec.items.filter((it) => it.key in m.values).filter((it) => !q || it.key.includes(q) || describeSetting(it).toLowerCase().includes(q))
        .map((it) => settingRow(it, m));
      if (rows.length) cards.push(h("section", { class: "card set-section" }, h("h2", { text: sec.title }), rows));
    }
    const el = h("div", null,
      head("settings.title", "settings.intro",
        h("div", { class: "search", style: { minWidth: "240px" } }, icon("search"),
          h("input", { class: "input", type: "search", placeholder: t("settings.search"), value: settingsUi.filter, "data-keep": "s-search",
            oninput: (e) => { settingsUi.filter = e.target.value; refresh("settings"); } }))),
      app.template === false ? h("div", { class: "banner" }, icon("info"), h("div", { text: t("settings.unavailable") })) : null,
      !persist ? h("div", { class: "banner" }, icon("info"), h("div", { text: t("settings.no_persist") })) : null,
      cards.length ? h("div", { class: "stack" }, cards) : h("div", { class: "card empty", text: t("settings.none") }));
    return { el };
  }
  viewSettings.sig = function () {
    const m = settings();
    return JSON.stringify([m && m.values, m && m.source, !!app.template, app.template === false, settingsUi.filter, settingsUi.edits]);
  };

  function describeSetting(it) {
    if (lang !== "en" && AE_TEXT[lang] && AE_TEXT[lang]["set." + it.key]) return AE_TEXT[lang]["set." + it.key];
    return it.desc || (AE_TEXT.en["set." + it.key] || "");
  }

  const UNITS = {
    blade_offset: "mm", blade_width: "mm", column_overlap: "mm", head_depth: "mm", side_margin: "mm", push_z: "mm",
    blade_clearance: "mm", rear_clearance: "mm", z_hop: "mm", min_safe_z: "mm", push_z_min: "mm", cool_temp: "°C",
    cool_timeout: "s", cool_time: "s", min_part_height: "mm", verify_z: "mm", home_clearance: "mm", home_edge_margin: "mm",
    nozzle_clearance: "mm", nozzle_probe_max_temp: "°C", purge_height: "mm", purge_start_z: "mm", purge_retract: "mm", purge_gap: "mm",
    purge_edge_margin: "mm", filament_diameter: "mm", blade_lift: "mm", push_end: "mm"
  };

  function settingRow(it, m) {
    const key = it.key;
    const value = m.values[key];
    const src = m.source[key];
    const edit = settingsUi.edits[key];
    const changed = edit !== undefined && String(edit) !== String(value);
    const setEdit = (v) => { settingsUi.edits[key] = v; refresh("settings"); };
    let control;
    if (typeof value === "boolean") {
      const cur = edit !== undefined ? edit === true || edit === "true" : value;
      control = h("label", { class: "switch" },
        h("input", { type: "checkbox", checked: cur, "aria-label": key, onchange: (e) => save(key, e.target.checked) }),
        h("span", { text: cur ? t("settings.on") : t("settings.off") }));
    } else if (it.choices && it.choices.length >= 2 && typeof value === "string") {
      const cur = edit !== undefined ? edit : value;
      control = h("select", { class: "select", "aria-label": key, onchange: (e) => save(key, e.target.value) },
        it.choices.map((c) => h("option", { value: c.value, selected: c.value === cur, title: c.desc,
          text: lang !== "en" && has("opt." + key + "." + c.value) ? t("opt." + key + "." + c.value) : c.value })));
    } else {
      const cur = edit !== undefined ? edit : String(value);
      const valid = M.validSettingText(cur) && (typeof value !== "number" || /^-?\d+(\.\d+)?$/.test(String(cur).trim()));
      const input = h("input", {
        class: "input" + (typeof value === "number" ? "" : " wide") + (valid ? "" : " bad"), value: cur, "data-keep": "set-" + key,
        inputmode: typeof value === "number" ? "decimal" : null, "aria-label": key, spellcheck: "false",
        oninput: (e) => { settingsUi.edits[key] = e.target.value; refreshSoon(); },
        onkeydown: (e) => { if (e.key === "Enter" && valid) save(key, e.target.value); if (e.key === "Escape") { delete settingsUi.edits[key]; refresh("settings"); } }
      });
      const unit = UNITS[key] || it.unit;
      control = h("div", { class: "ctl" },
        typeof value === "number" && unit ? h("span", { class: "with-unit" }, input, h("span", { class: "unit", text: unit })) : input,
        changed ? h("button", { type: "button", class: "btn primary sm", disabled: !valid, onclick: () => save(key, settingsUi.edits[key]) }, t("settings.save")) : null);
    }
    const badge = src === "saved" ? h("span", { class: "badge accent", text: t("settings.src.saved") })
      : src === "file" ? h("span", { class: "badge blue", text: t("settings.src.file") }) : h("span", { class: "badge", text: t("settings.src.default") });
    return h("div", { class: "set-row" + (changed ? " changed" : "") },
      h("div", null,
        h("div", { class: "k" }, h("code", { class: "ltr", text: key }), badge),
        h("div", { class: "d", text: describeSetting(it).replace(/:\s*$/, ".") }),
        chosen(it, value) ? h("div", { class: "d chosen" }, h("code", { class: "ltr", text: String(value) }), " ", chosen(it, value)) : null),
      h("div", { class: "ctl" }, control,
        src === "saved" ? h("button", { type: "button", class: "btn ghost sm", title: t("settings.reset"), onclick: () => reset(key) }, icon("reset"), t("settings.reset")) : null));
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
    client.gcode("AUTO_EJECT_SET KEY=" + key + " VALUE=" + arg).then(() => {
      delete settingsUi.edits[key];
      toast(t("settings.saved", { k: key }), "ok");
      refresh("settings");
    }).catch((e) => { toast(cleanError(e.message), "bad"); delete settingsUi.edits[key]; refresh("settings"); });
  }
  function reset(key) {
    client.gcode("AUTO_EJECT_SET KEY=" + key + " RESET=1").then(() => {
      delete settingsUi.edits[key];
      toast(t("settings.reset_done", { k: key }), "ok");
    }).catch((e) => toast(cleanError(e.message), "bad"));
  }

  /* =========================================================== activity */

  const activityUi = { only: true };

  function isAe(text) { return /auto[_ -]?eject|probe: at|action:prompt/i.test(text); }

  function viewActivity() {
    const lines = app.log.filter((l) => !activityUi.only || isAe(l.text)).filter((l) => !/action:prompt/.test(l.text)).slice(-400).reverse();
    const toggle = h("label", { class: "switch" },
      h("input", { type: "checkbox", checked: activityUi.only, onchange: (e) => { activityUi.only = e.target.checked; refresh("activity"); } }),
      h("span", { text: t("activity.only") }));
    const el = h("div", null, head("activity.title", null, toggle),
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
  refresh();
  client.connect();
})();
