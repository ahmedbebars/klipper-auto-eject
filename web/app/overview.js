/* klipper-auto-eject web page. The Overview: the printer's state, its buttons and the bed map.
 */

import {
  $, aeState, app, axes, blocked, camUrl, duration, fmtClock, h, homed, icon, iso, lang, leftover, M, num, parts,
  phase, plan, polygons, probe, s, settings, sv, t
} from "./core.js";
import { cleanError, confirm, gcode, meta, refresh, spoolCheck, spoolGrams, spoolTrouble, toast } from "../app.js";
import { spoolSig, thumbBox, thumbSrc } from "./files.js";
import { farm, farmNeeds, farmShown } from "./farm.js";

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

// The main switch: push the parts off after each print, or leave them for you.
// Hidden with macros older than the "enabled" setting.
const power = { busy: false, n: 0 };
function powerCard(set) {
  if (typeof set.enabled !== "boolean") return null;
  const on = set.enabled;
  return h("section", { class: "card ae-power" + (on ? "" : " off") },
    h("div", { class: "ae-power-ic" }, icon(on ? "push" : "hand", "lg")),
    h("div", { class: "txt" }, h("b", { text: t(on ? "power.on_title" : "power.off_title") }),
      h("span", { text: t(power.busy ? "settings.sending" : on ? "power.on_desc" : "power.off_desc") })),
    h("label", { class: "switch big" },
      h("input", { type: "checkbox", checked: on, disabled: power.busy, "aria-label": t("power.label"), onchange: (e) => doPower(e.target.checked) }),
      h("span", { text: t(on ? "settings.on" : "settings.off") })));
}
// While the bed is being cleared Klipper takes no command until the eject
// has finished, so the change waits for it.
function doPower(on) {
  const later = M.ejectRunning(aeState(), app.status) && !aeState().bg;
  const ask = later ? confirm(t("settings.busy_title"), t("settings.busy_body"), t("settings.busy_ok")) : Promise.resolve(true);
  ask.then((ok) => {
    // the switch already shows the new value: draw it again
    if (!ok) { power.n++; refresh("overview"); return; }
    power.busy = true;
    refresh("overview");
    gcode("AUTO_EJECT_SET KEY=enabled VALUE=" + (on ? "on" : "off"), { quiet: true })
      .then(() => toast(t(on ? "power.done_on" : "power.done_off"), "ok"), (e) => toast(cleanError(e.message), "bad"))
      .then(() => { power.busy = false; refresh("overview"); });
  });
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
    const vars = { now: num((app.status.heater_bed || {}).temperature || 0), target: num(M.coolTarget(st, set), 0) };
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
    const target = M.coolTarget(aeState(), sv());
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
  const set = sv();
  const n = parts().length;
  const why = blocked();
  const lo = leftover();
  // switched off nothing is pushed: the page says so instead of an error
  const pushWhy = why || (set.enabled === false ? "act.why_off" : "");
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
        h("button", { type: "button", class: "btn sm", disabled: !!pushWhy, title: pushWhy ? t(pushWhy) : null, onclick: () => gcode(homed() ? "AUTO_EJECT" : "AUTO_EJECT HOME=1") }, icon("push"), t("leftover.retry")),
        h("button", { type: "button", class: "btn sm", disabled: !!why, onclick: doClear }, icon("hand"), t("act.clear"))))) : null;

  // ----- actions
  const ejectWhy = pushWhy || (n ? "" : "act.why_empty");
  const mainLabel = homed() ? t("act.eject") : t("act.home_eject");
  const st0 = aeState();
  const bgCool = !!(st0.bg && st0.cooling);
  const actions = bgCool ? h("section", { class: "card" },
    h("h2", null, icon("push"), t("act.title")),
    h("div", { class: "act-main" },
      h("button", { type: "button", class: "btn primary lg block", disabled: !!st0.push_now || set.enabled === false, onclick: doPushNow }, icon("push"), t("act.push_now")),
      h("div", { class: "desc", text: set.enabled === false ? t("act.why_off") : st0.push_now ? t("act.push_soon") : t("act.bg_desc") })),
    h("div", { class: "act-list" },
      actRow("hand", t("act.bg_take"), t("act.bg_clear_desc"), "", () => doTake(st0.bg_held)))) : h("section", { class: "card" },
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
  const el = h("div", null, powerCard(set), left, boxFull, spoolLow, h("div", { class: "cols" },
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
    !!(ps.filename && app.meta[ps.filename]), spoolSig(), !!st.push_now, power.busy, power.n]);
};

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
// the parts go by hand while the bed cools: the queue waits for "continue"
function doTake(held) {
  confirm(t("act.bg_take"), t("act.bg_take_confirm") + (held ? " " + t("act.bg_take_queue") : ""), t("act.bg_take"))
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

export { actRow, bedMap, doDry, viewOverview };
