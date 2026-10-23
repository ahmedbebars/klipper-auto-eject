/* klipper-auto-eject web page. Hardware: motors, boards, the computer, the network and the camera.
 */

import { app, camUrl, client, duration, fmtDate, h, head, icon, iso, M, num, s, t } from "./core.js";
import { refresh, route } from "../app.js";
import { firmwareNote, noteLine, reportButton } from "./updates.js";

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

export { boardName, hwParts, pollHardware, viewHardware };
