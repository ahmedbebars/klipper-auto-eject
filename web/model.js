/* klipper-auto-eject web page: pure logic, no DOM.
 *
 * Everything here mirrors what the Klipper macros do, so the page can show
 * the push lanes and check a file before it is printed. tests/test_web.py
 * runs these functions under Node and compares them with the macros.
 */
"use strict";

(function (root) {
  const DIRECTIONS = ["front", "back", "left", "right"];

  /* ------------------------------------------------------------ settings */

  // Same layering as the macros: defaults < settings file < saved values.
  function mergeSettings(defaults, file, saved) {
    const values = Object.assign({}, defaults || {}, file || {}, saved || {});
    const source = {};
    for (const key of Object.keys(values)) {
      if (saved && key in saved) source[key] = "saved";
      else if (file && key in file && defaults && key in defaults &&
               !sameValue(file[key], defaults[key])) source[key] = "file";
      else if (file && key in file && !(defaults && key in defaults)) source[key] = "file";
      else source[key] = "default";
    }
    return { values, source };
  }

  function sameValue(a, b) {
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // Read auto_eject_settings.cfg: sections, the comment above each
  // variable_ line, an inline comment, and choices written as
  //   "name" - what it does
  // or a sentence with several quoted words that include the default.
  function parseSettingsTemplate(text) {
    const lines = String(text).replace(/\r/g, "").split("\n");
    const sections = [];
    let section = null;
    let pending = [];
    let started = false;
    const ruler = (l) => /^#\s*-{5,}\s*$/.test(l);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!started) {
        if (/^\[gcode_macro _AUTO_EJECT_SETTINGS\]/.test(line)) started = true;
        continue;
      }
      if (/^gcode:/.test(line)) break;
      if (ruler(line) && i + 2 < lines.length && ruler(lines[i + 2])) {
        section = { title: lines[i + 1].replace(/^#\s*/, "").trim(), items: [] };
        sections.push(section);
        pending = [];
        i += 2;
        continue;
      }
      if (/^\s*$/.test(line)) { pending = []; continue; }
      if (/^#/.test(line)) { pending.push(line.replace(/^#\s?/, "")); continue; }
      const m = /^variable_([a-z0-9_]+)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      if (!section) { section = { title: "General", items: [] }; sections.push(section); }
      let value = m[2];
      let inline = "";
      const hash = findComment(value);
      if (hash >= 0) { inline = value.slice(hash + 1).trim(); value = value.slice(0, hash).trim(); }
      section.items.push(describe(m[1], pending, inline, parseValue(value)));
      pending = [];
    }
    return sections;
  }

  // the first # outside quotes
  function findComment(s) {
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { if (ch === q) q = null; }
      else if (ch === '"' || ch === "'") q = ch;
      else if (ch === "#") return i;
    }
    return -1;
  }

  // Klipper reads variable_ values with Python's ast.literal_eval.
  function parseValue(raw) {
    const v = String(raw).trim();
    if (v === "True") return true;
    if (v === "False") return false;
    if (v === "None") return null;
    if (/^-?\d+$/.test(v)) return parseInt(v, 10);
    if (/^-?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(v)) return parseFloat(v);
    const q = /^(["'])(.*)\1$/.exec(v);
    if (q) return q[2];
    try { return JSON.parse(v.replace(/'/g, '"').replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null")); }
    catch (e) { return v; }
  }

  function describe(key, comment, inline, def) {
    const desc = [];
    const choices = [];
    let last = null;
    for (const l of comment) {
      if (/^\s*"[^"]+"\s+-\s+/.test(l)) {
        // one or more  "name" - what it does  on this line
        const re = /"([^"]+)"\s+-\s+(.*?)(?=,?\s*"[^"]+"\s+-\s|$)/g;
        let c;
        while ((c = re.exec(l)) !== null) {
          last = { value: c[1], desc: c[2].replace(/,\s*$/, "").trim() };
          choices.push(last);
        }
        continue;
      }
      if (last && /^\s{4,}\S/.test(l)) { last.desc += " " + l.trim(); continue; }
      last = null;
      desc.push(l.trim());
    }
    let text = desc.join(" ").replace(/\s+/g, " ").trim();
    if (!choices.length && typeof def === "string") {
      const words = [];
      const re = /"([A-Za-z0-9_]+)"/g;
      let w;
      while ((w = re.exec(text)) !== null) if (!words.includes(w[1])) words.push(w[1]);
      if (words.length >= 2 && words.includes(def)) for (const v of words) choices.push({ value: v, desc: "" });
    }
    if (!text && inline) text = inline;
    else if (inline) text = text + " (" + inline + ")";
    const unit = /^(mm\/min|mm\/s\^2|mm\^3\/s|mm|ms|amps|A|seconds|s|C)\b/.exec(inline);
    return {
      key,
      desc: text,
      choices,
      unit: unit ? unit[1].replace("amps", "A").replace("seconds", "s").replace("mm/s^2", "mm/s²").replace("mm^3/s", "mm³/s") : "",
      def
    };
  }

  /* --------------------------------------------------------------- parts */

  // _AUTO_EJECT_STATE records: [name, x0, x1, y0, y1, cx, cy, points]
  function recordsFromExcludeObjects(objects) {
    const out = [];
    for (const o of objects || []) {
      const pts = o.polygon || [];
      if (!pts.length) continue;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
      }
      const cx = o.center ? o.center[0] : (x0 + x1) / 2;
      const cy = o.center ? o.center[1] : (y0 + y1) / 2;
      out.push([String(o.name).replace(/['"]/g, ""), r2(x0), r2(x1), r2(y0), r2(y1), r2(cx), r2(cy), [], pts]);
    }
    return out;
  }

  function r2(v) { return Math.round(v * 100) / 100; }

  /* --------------------------------------------------------------- pushes */

  // The push plan of _AUTO_EJECT_RUN, step by step.
  //   records  _AUTO_EJECT_STATE.objects
  //   s        merged settings
  //   axisMin, axisMax  toolhead.axis_minimum / axis_maximum
  // Returns { pushes: [{x0, y0, x1, y1, c, clamped}], error, strategy, ... }
  function planPushes(records, s, axisMin, axisMax, opts) {
    opts = opts || {};
    const strategy0 = String(opts.strategy || s.strategy || "columns").toLowerCase();
    const direction = String(s.direction || "front").toLowerCase();
    const result = { strategy: strategy0, direction, pushes: [], clamped: false, error: null, conflict: null };
    if (!DIRECTIONS.includes(direction)) { result.error = "direction"; return result; }
    const ai = direction === "front" || direction === "back" ? 1 : 0;
    const ci = 1 - ai;
    const sign = direction === "front" || direction === "left" ? -1 : 1;
    const aLo = axisMin[ai], aHi = axisMax[ai], cLo = axisMin[ci], cHi = axisMax[ci];
    const aEnd = typeof s.push_end === "string" ? (sign < 0 ? aLo : aHi) : Number(s.push_end);
    const dFar = -sign * (sign < 0 ? aHi : aLo);
    const half = s.blade_width / 2;
    const step = s.blade_width - s.column_overlap;
    Object.assign(result, { ai, ci, sign, aEnd, dFar, half });

    const boxes = [];
    let cmin = 999999, cmax = -999999;
    for (const r of records || []) {
      if (opts.only && !opts.only.includes(r[0])) continue;
      const a0 = r[1 + 2 * ai], a1 = r[2 + 2 * ai], c0 = r[1 + 2 * ci], c1 = r[2 + 2 * ci];
      const d0 = Math.min(-sign * a0, -sign * a1), d1 = Math.max(-sign * a0, -sign * a1);
      boxes.push([d0, d1, c0, c1, r[0]]);
      if (c0 < cmin) cmin = c0;
      if (c1 > cmax) cmax = c1;
    }
    let strategy = strategy0;
    if (!boxes.length && strategy !== "full_width") {
      if (s.no_objects_action === "full_width") strategy = "full_width";
      else { result.strategy = "skip"; return result; }
    }
    result.strategy = strategy;

    const list = [];
    if (strategy === "objects") {
      const sorted = boxes.slice().sort((a, b) => a[0] - b[0]);
      sorted.forEach((bx, i) => {
        const c = (bx[2] + bx[3]) / 2;
        const dStart = bx[1] + s.rear_clearance + s.blade_offset;
        sorted.forEach((o, j) => {
          if (j > i && !result.conflict && o[3] > c - half - s.side_margin && o[2] < c + half + s.side_margin &&
              o[1] > bx[1] && o[0] < dStart + s.head_depth) result.conflict = [o[4], bx[4]];
        });
        list.push([c, dStart, [bx[4]]]);
      });
    } else {
      const rLo = (strategy === "full_width" ? cLo : cmin) + half - s.column_overlap / 2;
      const rHi = strategy === "full_width" ? cHi : cmax;
      for (let k = 0; k < 100; k++) {
        const c = rLo + k * step;
        if (!(c - half < rHi)) continue;
        let dmax = -999999;
        const names = [];
        for (const bx of boxes) {
          if (bx[3] > c - half && bx[2] < c + half) {
            names.push(bx[4]);
            if (bx[1] > dmax) dmax = bx[1];
          }
        }
        if (strategy === "full_width") list.push([c, dFar, names]);
        else if (dmax > -999999) list.push([c, dmax + s.rear_clearance + s.blade_offset, names]);
      }
    }
    for (const p of list) {
      const clamped = p[1] > dFar + 0.001;
      if (clamped) result.clamped = true;
      const cc = Math.min(Math.max(p[0], cLo), cHi);
      const aStart = Math.min(Math.max(-sign * Math.min(p[1], dFar), aLo), aHi);
      const start = ai === 1 ? [cc, aStart] : [aStart, cc];
      const end = ai === 1 ? [cc, aEnd] : [aEnd, cc];
      result.pushes.push({ x0: start[0], y0: start[1], x1: end[0], y1: end[1], c: cc, clamped, parts: p[2] });
    }
    return result;
  }

  /* ---------------------------------------------------------- probe kind */

  // Same detection as _AUTO_EJECT_PROBE_INFO, from configfile.config names.
  function probeKind(sectionNames, probeType) {
    const names = Array.from(sectionNames || []);
    let sec = "", kind = "none";
    for (const n of names) if (!sec && (n === "probe" || n === "bltouch")) { sec = n; kind = "contact"; }
    for (const n of names) {
      if (!sec && (n.startsWith("probe_eddy_current") || n.startsWith("probe_eddy_ng") ||
                   ["beacon", "cartographer", "scanner"].includes(n))) { sec = n; kind = "eddy"; }
    }
    if (sec && (probeType === "contact" || probeType === "eddy")) kind = probeType;
    return { section: sec, kind };
  }

  /* ---------------------------------------------------------- file check */

  // EXCLUDE_OBJECT_DEFINE NAME=part_1 CENTER=100,120 POLYGON=[[x,y],...]
  function parseObjectDefines(text) {
    const out = [];
    const re = /^\s*EXCLUDE_OBJECT_DEFINE\b(.*)$/gim;
    let m;
    const seen = new Set();
    while ((m = re.exec(text)) !== null) {
      const args = m[1];
      const name = /\bNAME=(\S+)/i.exec(args);
      const center = /\bCENTER=([-\d.]+),([-\d.]+)/i.exec(args);
      const poly = /\bPOLYGON=(\[\[.*?\]\])/i.exec(args);
      if (!name || seen.has(name[1])) continue;
      seen.add(name[1]);
      let polygon = [];
      if (poly) { try { polygon = JSON.parse(poly[1]); } catch (e) { polygon = []; } }
      out.push({ name: name[1], center: center ? [parseFloat(center[1]), parseFloat(center[2])] : null, polygon });
    }
    return out;
  }

  // Lines that run AUTO_EJECT, outside comments, in the end of a file.
  function findEjectCommand(text) {
    const lines = String(text).split(/\r?\n/);
    for (const l of lines) {
      const code = l.split(";")[0].trim();
      if (/^AUTO_EJECT(\s|$)/i.test(code)) return code;
    }
    return null;
  }

  // The first macro after AUTO_EJECT in the end G-code, like PRINT_END, or
  // null. End macros usually retract the filament, which Klipper refuses
  // once AUTO_EJECT has let the nozzle cool.
  const HARMLESS = /^(?:[GMT]\d+|SET_\w+|TURN_OFF_HEATERS|BED_MESH_CLEAR|RESPOND|SAVE_VARIABLE|UPDATE_DELAYED_GCODE|EXCLUDE_OBJECT\w*|TIMELAPSE_\w+|AUTO_EJECT\w*)$/i;
  function macroAfterEject(text) {
    let seen = false;
    for (const l of String(text).split(/\r?\n/)) {
      const word = l.split(";")[0].trim().split(/\s+/)[0];
      if (!word) continue;
      if (!seen) seen = /^AUTO_EJECT$/i.test(word);
      else if (!HARMLESS.test(word)) return word.toUpperCase();
    }
    return null;
  }

  // A console message that deserves a notification on the phone, or null.
  // { kind, text }: kind names the notification (note.<kind>).
  const NOTICES = [
    [/STILL ON THE BED/, "stuck"],
    [/^AUTO_EJECT_GUARD: .*(still on the bed|may still be on the bed)/, "guard"],
    [/too thin to push/, "thin"],
    [/the print ended and \d+ part\(s\) are still on the bed/, "left"],
    [/the parts box is (almost )?full/, "bin"]
  ];
  function noticeFor(line) {
    const text = String(line).replace(/^(\/\/|!!)\s*/, "").trim();
    for (const [re, kind] of NOTICES) if (re.test(text)) return { kind, text };
    return null;
  }

  // Where the auto_eject notifier sends to: "ntfy", "telegram", "discord",
  // "other" or "". Only the kind: the address holds a token, never shown.
  function notifierKind(config) {
    const scheme = String(((config || {})["notifier auto_eject"] || {}).url || "").split("://")[0].toLowerCase();
    if (!scheme || scheme.indexOf(":") >= 0 || scheme.indexOf("/") >= 0) return "";
    return { ntfy: "ntfy", ntfys: "ntfy", tgram: "telegram", discord: "discord" }[scheme] || "other";
  }
  // The ntfy topic of the auto_eject notifier in Moonraker's config, or "".
  function ntfyTopic(config) {
    const url = String(((config || {})["notifier auto_eject"] || {}).url || "");
    const m = /^ntfys?:\/\/(?:[^/@?]*@)?(?:[^/?]*\/)?([A-Za-z0-9_-]+)/.exec(url);
    return m ? m[1] : "";
  }

  // Slicers write the print height in the header or the config block.
  function findHeight(text) {
    const pats = [/^;\s*max_z_height:\s*([\d.]+)/im, /^;\s*Max Z:\s*([\d.]+)/im, /^;MAXZ:\s*([\d.]+)/im];
    for (const p of pats) {
      const m = p.exec(text);
      if (m) return parseFloat(m[1]);
    }
    return null;
  }

  // Everything the page tells the user about one file.
  //   head, tail  the start and end of the file (strings)
  //   meta        Moonraker metadata (object_height ...) or {}
  function checkFile(head, tail, meta, s, axisMin, axisMax) {
    const objects = parseObjectDefines(head + "\n" + tail);
    const records = recordsFromExcludeObjects(objects);
    const height = (meta && meta.object_height) || findHeight(head) || findHeight(tail) || 0;
    const command = findEjectCommand(tail);
    const thin = height > 0 && s.min_part_height > 0 && height < s.min_part_height &&
                 String(s.thin_parts_action).toLowerCase() === "ignore";
    const plan = planPushes(records, s, axisMin, axisMax);
    const checks = [];
    checks.push(records.length ? { ok: "ok", key: "check.labels_ok", vars: { n: records.length } }
                               : { ok: "bad", key: "check.labels_bad" });
    const after = command ? macroAfterEject(tail) : null;
    checks.push(!command ? { ok: "warn", key: "check.line_bad" }
      : after ? { ok: "warn", key: "check.line_order", vars: { cmd: command, macro: after } }
      : { ok: "ok", key: "check.line_ok", vars: { cmd: command } });
    if (height > 0) {
      checks.push(thin ? { ok: "warn", key: "check.thin", vars: { h: fmt(height), m: fmt(s.min_part_height) } }
                       : { ok: "ok", key: "check.height_ok", vars: { h: fmt(height) } });
    }
    if (records.length && !thin) {
      const far = plan.pushes.filter((p) => p.clamped);
      checks.push(far.length ? { ok: "bad", key: "check.reach_bad", vars: { name: (far[0].parts || [])[0] || "" } }
                             : { ok: "ok", key: "check.reach_ok", vars: { n: plan.pushes.length } });
    }
    const worst = checks.some((c) => c.ok === "bad") ? "bad" : checks.some((c) => c.ok === "warn") ? "warn" : "ok";
    return { objects, records, height, command, thin, plan, checks, verdict: worst };
  }

  function fmt(v) { return (Math.round(v * 10) / 10).toString(); }

  /* -------------------------------------------------------------- prompts */

  // Mainsail/Fluidd action:prompt protocol, so the page can show the setup
  // dialogs itself.
  function PromptParser() {
    this.state = null;      // the dialog being built
    this.shown = null;      // the dialog on screen
    this.group = null;
  }
  PromptParser.prototype.feed = function (line) {
    const m = /^\/\/\s*action:(prompt_[a-z_]+)\s?(.*)$/.exec(String(line).trim());
    if (!m) return null;
    const cmd = m[1], arg = m[2];
    const button = (a) => {
      const parts = a.split("|");
      return { label: parts[0], gcode: parts.length > 1 && parts[1] ? parts[1] : parts[0], color: parts[2] || "" };
    };
    switch (cmd) {
      case "prompt_begin": this.state = { title: arg, items: [], footer: [] }; this.group = null; return null;
      case "prompt_end": this.state = null; this.shown = null; return "close";
      case "prompt_show": if (this.state) { this.shown = this.state; return "show"; } return null;
    }
    if (!this.state) return null;
    switch (cmd) {
      case "prompt_text": this.state.items.push({ type: "text", text: arg }); break;
      case "prompt_button": {
        const b = button(arg);
        const last = this.state.items[this.state.items.length - 1];
        // buttons in a row share one line, like in Mainsail
        if (this.group) this.group.buttons.push(b);
        else if (last && last.type === "buttons" && !last.grouped) last.buttons.push(b);
        else this.state.items.push({ type: "buttons", buttons: [b] });
        break;
      }
      case "prompt_button_group_start": this.group = { type: "buttons", buttons: [], grouped: true }; this.state.items.push(this.group); break;
      case "prompt_button_group_end": this.group = null; break;
      case "prompt_footer_button": this.state.footer.push(button(arg)); break;
    }
    return null;
  };

  /* ---------------------------------------------------------------- misc */

  function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h) return h + "h " + String(m).padStart(2, "0") + "m";
    if (m) return m + "m " + String(sec % 60).padStart(2, "0") + "s";
    return sec + "s";
  }

  // A value as AUTO_EJECT_SET wants it.
  function settingArg(value) {
    if (value === true) return "true";
    if (value === false) return "false";
    return String(value).trim();
  }

  // AUTO_EJECT_SET refuses these, so the page does too.
  function validSettingText(text) {
    const t = String(text).trim();
    return t !== "" && !/['"#;\s]/.test(t);
  }

  // Short labels for the bed map. Slicers give every part of a plate the
  // same long name (MODEL.STL_3_ID_0_COPY_0), so drop the words all the
  // names share at the start and at the end and keep what tells them apart.
  function shortNames(names) {
    const words = names.map((n) => String(n).split(/(?<=[._\- ])/));
    const join = (w) => w.join("").replace(/^[._\- ]+|[._\- ]+$/g, "");
    if (names.length < 2 || new Set(names).size !== names.length) return names.map(String);
    const same = (pick) => words.every((w) => pick(w) === pick(words[0]));
    let head = 0, tail = 0;
    const min = Math.min(...words.map((w) => w.length));
    while (head < min - 1 && same((w) => w[head])) head++;
    while (tail < min - 1 - head && same((w) => w[w.length - 1 - tail].replace(/[._\- ]+$/, ""))) tail++;
    const out = words.map((w) => join(w.slice(head, w.length - tail)));
    return new Set(out).size === out.length && out.every(Boolean) ? out : names.map(String);
  }

  // The farm: printers that need someone first, then the ones that will
  // soon (printing, the nearest end first), then the free and the offline.
  const FARM_RANK = { needs: 0, stopped: 1, paused: 2, ejecting: 3, printing: 4, idle: 5, off: 6, offline: 7 };
  function farmOrder(printers) {
    const rank = (p) => (FARM_RANK[p.phase] === undefined ? 7 : FARM_RANK[p.phase]);
    return printers.slice().sort((a, b) => rank(a) - rank(b) ||
      (a.phase === "printing" ? (a.eta === null || a.eta === undefined ? 1e9 : a.eta) - (b.eta === null || b.eta === undefined ? 1e9 : b.eta) : 0) ||
      String(a.name).localeCompare(String(b.name), "en", { numeric: true }));
  }
  // Which of the farm's filters a printer is under.
  function farmKind(p) {
    if (p.phase === "needs" || p.phase === "stopped" || p.phase === "paused") return "needs";
    if (p.phase === "printing" || p.phase === "ejecting") return "printing";
    if (p.phase === "idle") return "idle";
    if (p.phase === "off") return "off";
    return "offline";
  }
  function farmCounts(printers) {
    const out = { needs: 0, printing: 0, idle: 0, off: 0, offline: 0 };
    for (const p of printers) out[farmKind(p)]++;
    return out;
  }
  // The printers a filter ("all", "needs"...) and a search show: the search
  // looks in the name, the address, the group and the file.
  function farmFilter(printers, kind, query) {
    const q = String(query || "").trim().toLowerCase();
    return (printers || []).filter((p) => (!kind || kind === "all" || farmKind(p) === kind) &&
      (!q || [p.name, p.host, p.group, p.filename].some((v) => String(v || "").toLowerCase().includes(q))));
  }
  // The printers under their groups, in name order, and those without one last.
  function farmGroups(printers) {
    const by = new Map();
    for (const p of printers || []) {
      const g = String(p.group || "");
      if (!by.has(g)) by.set(g, []);
      by.get(g).push(p);
    }
    return Array.from(by.entries())
      .sort((a, b) => (a[0] === "") - (b[0] === "") || a[0].localeCompare(b[0], "en", { numeric: true }))
      .map(([group, list]) => ({ group, printers: list }));
  }
  // Is an eject really running? The macro's busy flag stays set when an
  // error stops it; Klipper itself is busy (idle_timeout "Printing") while
  // a macro runs, and an eject in the end G-code is part of the print. An
  // eject cooling in the background (cool_background) runs with Klipper free.
  function ejectRunning(st, status) {
    if (!st || !st.busy) return false;
    if (st.bg) return true;
    const s = status || {};
    return (s.print_stats || {}).state === "printing" || (s.idle_timeout || {}).state === "Printing";
  }
  // What a farm printer can update, from its {name: {version, remote, behind,
  // type}}: a git repository when it is behind (a local change only differs
  // in its name), anything else when its version is not the latest.
  function farmPending(updates) {
    const u = updates || {};
    return Object.keys(u).filter((k) => u[k].type === "git_repo" ? u[k].behind > 0
      : u[k].behind > 0 || !!(u[k].remote && u[k].version && u[k].remote !== u[k].version && u[k].remote !== "?")).sort();
  }
  // The board that is furthest behind Klipper on a farm printer, as firmwareAge says.
  function farmFirmware(fw) {
    let worst = null;
    const rank = (a) => a.state === "older" ? (a.by === null ? 1e9 : a.by) : a.state === "unknown" ? -2 : -1;
    for (const [, v] of (fw && fw.boards) || []) {
      const age = firmwareAge(v, fw.klipper);
      if (!worst || rank(age) > rank(worst)) worst = age;
    }
    return worst;
  }
  // Where Open goes: through Tailscale when this page is opened through it
  // (a phone away from the printers' network), if that printer has it.
  // A printer's maintenance reminder: how far it is, null without one.
  function farmService(p) {
    if (!p.service_every || p.service_since === null || p.service_since === undefined) return null;
    const share = p.service_since / p.service_every;
    return { since: p.service_since, every: p.service_every, due: share >= 1, near: share >= 0.9 && share < 1 };
  }

  // Away (through Tailscale) and that printer has no Tailscale: no link, its
  // local address would not open.
  function farmAway(hostname) {
    return /\.ts\.net$/i.test(hostname) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname);
  }
  function farmLink(p, hostname) {
    return farmAway(hostname) ? p.page_remote || null : p.page || null;
  }

  // What a copy of settings offers: each setting with its value, ticked
  // unless each printer keeps its own (its notifier's name) or AUTO_EJECT_SET
  // cannot take the value (a G-code line: the settings file only).
  const KEEP_OWN = ["notify"];
  function copyList(values, keys) {
    return (keys || []).filter((k) => values && k in values).sort().map((key) => {
      const ok = validSettingText(settingArg(values[key]));
      return { key, value: values[key], ok, tick: ok && !KEEP_OWN.includes(key) };
    });
  }

  // The links a printer's QR label can hold, the one to use first: its page
  // on the home network, and through Tailscale; first the kind this page is
  // open on now. This printer: the page open now.
  function farmQrLinks(p, here) {
    here = here || {};
    const away = farmAway(here.hostname || "");
    if (p.local) return here.page ? [{ kind: away ? "remote" : "lan", url: here.page }] : [];
    const out = [];
    if (p.page) out.push({ kind: "lan", url: p.page });
    if (p.page_remote) out.push({ kind: "remote", url: p.page_remote });
    return away ? out.reverse() : out;
  }

  // What a farm card can offer: the bed is clear, start the queue, stop.
  function farmActions(p) {
    const out = [];
    if (p.phase === "needs" && ["leftover", "parts", "done", "cancelled", "error"].includes(p.reason)) out.push("clear");
    // cooling with the printer free: push now, or the parts went by hand
    if (p.phase === "ejecting" && p.reason === "cooling") out.push("push", "clear");
    if (p.phase === "needs" && p.reason === "bin") out.push("bin_empty");
    if (p.queue === "paused" && p.jobs > 0 && ["idle", "needs"].includes(p.phase) && !["leftover", "parts", "done", "cancelled", "error", "bin"].includes(p.reason)) out.push("continue");
    // print one of its files: only a free printer (the farm checks it again)
    if (p.phase === "idle" || (p.phase === "needs" && p.reason === "queue")) out.push("print");
    if (p.phase === "printing") out.push("pause", "cancel");
    if (p.phase === "paused") out.push("resume", "cancel");
    if (["printing", "paused", "ejecting"].includes(p.phase)) out.push("estop");
    return out;
  }

  // The production report as a CSV file (a spreadsheet opens it): one line
  // a printer, then the whole farm. Quoted where a name needs it.
  function farmReportCsv(report, labels) {
    const q = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const line = (cells) => cells.map(q).join(",");
    const rows = [line(labels)];
    for (const r of report.printers || []) {
      rows.push(r.error ? line([r.name, r.group || "", "", "", "", "", "", ""])
        : line([r.name, r.group || "", r.jobs, r.ok, r.stopped, r.rate === null ? "" : r.rate, r.hours, r.grams]));
    }
    const tt = report.total || {};
    rows.push(line(["", "", tt.jobs, tt.ok, tt.stopped, tt.rate === null || tt.rate === undefined ? "" : tt.rate, tt.hours, tt.grams]));
    return rows.join("\r\n") + "\r\n";
  }

  // A farm printer's spool runs low: under 50 g, or under a tenth of a full one.
  function farmSpoolLow(spool) {
    if (!spool || typeof spool.left !== "number") return false;
    return spool.left < Math.max(50, (spool.full || 0) * 0.1);
  }

  // One command for several printers: for each, the selected printers it can
  // be done on now (what each one's card offers), so the rest are left out.
  const FARM_BULK = ["clear", "continue", "push", "pause", "resume", "send", "queue", "power_on", "power_off", "settings", "labels", "cancel", "estop"];
  function farmBulk(printers, ids) {
    const chosen = new Set(ids || []);
    const selected = (printers || []).filter((p) => chosen.has(p.id));
    const actions = {};
    for (const a of FARM_BULK) actions[a] = [];
    for (const p of selected) {
      const can = farmActions(p);
      for (const a of can) if (actions[a]) actions[a].push(p);
      if (can.includes("print")) actions.send.push(p);
      // the farm queue: any of them, each copy waits for one to be free
      actions.queue.push(p);
      const devs = p.power || [];
      if (devs.some((d) => d.status !== "on")) actions.power_on.push(p);
      // never off while it prints or clears its bed: the farm refuses it too
      if (devs.some((d) => d.status === "on") && !["printing", "paused", "ejecting"].includes(p.phase)) actions.power_off.push(p);
      // settings from another printer: not while it clears its bed (the farm refuses it too)
      if (p.auto_eject && !["offline", "off", "stopped", "ejecting"].includes(p.phase)) actions.settings.push(p);
      if (p.local || p.page || p.page_remote) actions.labels.push(p);
    }
    return { selected, actions };
  }

  // The whole farm today: prints that ended well, the others, and the hours
  // printed in all.
  function farmToday(printers) {
    const out = { ok: 0, bad: 0, hours: 0 };
    for (const p of printers) {
      const s = p.stats;
      if (!s) continue;
      out.ok += s.today_ok || 0;
      out.bad += s.today_bad || 0;
      out.hours += s.hours || 0;
    }
    out.hours = Math.round(out.hours);
    return out;
  }

  // ---- the slicer's G-code, ready to paste
  // End-of-print macros in the printer's config (configfile.config), the
  // usual names first: PRINT_END, END_PRINT, DEMON_END...
  const END_FIRST = ["PRINT_END", "END_PRINT", "DEMON_END"];
  function endMacros(sections) {
    const rank = (n) => (END_FIRST.indexOf(n) < 0 ? END_FIRST.length : END_FIRST.indexOf(n));
    return Object.keys(sections || {}).map((k) => /^gcode_macro\s+(\S+)$/i.exec(k)).filter(Boolean)
      .map((m) => m[1].toUpperCase())
      .filter((n) => !n.startsWith("_") && !/^AUTO_EJECT/.test(n) && n.split("_").some((w) => w === "END" || w === "FINISH"))
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }
  // The end macro a sliced file runs: the last of the printer's end macros
  // called in it, or null.
  function endMacroInFile(text, macros) {
    const known = new Set((macros || []).map((m) => String(m).toUpperCase()));
    let found = null;
    for (const l of String(text).split(/\r?\n/)) {
      const word = l.split(";")[0].trim().split(/\s+/)[0].toUpperCase();
      if (word && known.has(word)) found = word;
    }
    return found;
  }
  // A macro set the printer runs, from its config sections, for what the
  // slicer card says differently: DEMON Klipper Essentials checks its own
  // start lines, and can switch the printer off after a print. null for none.
  function macroSet(sections) {
    const entries = Object.entries(sections || {}).map(([k, v]) => [k.toLowerCase(), v || {}]);
    const has = (name) => entries.some(([k]) => k === name);
    if (!has("gcode_macro demon_start") && !has("gcode_macro _demon_version")) return null;
    const hw = (entries.find(([k]) => k === "gcode_macro _hardware_variables") || [null, {}])[1];
    const relay = /^true$/i.test(String(hw.variable_shutdown_relay || "").trim());
    // AUTO_EJECT_GUARD in DEMON's first hook, which runs inside DEMON_START
    const sec = (name) => (entries.find(([k]) => k === name) || [null, {}])[1];
    const on = (v) => /^true$/i.test(String(v || "").trim());
    const ceal = sec("gcode_macro _custom_expansion_active_list");
    const guardHook = on(ceal.variable_ceal_master_enable) && on(ceal.variable_pre_start) &&
      /^\s*AUTO_EJECT_GUARD\b/im.test(String(sec("gcode_macro _custom_pre_start").gcode || ""));
    return { name: "demon", autoOff: relay && has("output_pin printer_auto_off"), guardHook };
  }
  // Which slicer wrote a file (Moonraker's metadata "slicer"): orca, prusa, cura or null.
  function slicerKind(name) {
    const s = String(name || "");
    if (/orca|bambu/i.test(s)) return "orca";
    if (/prusa|super/i.test(s)) return "prusa";
    if (/cura/i.test(s)) return "cura";
    return null;
  }
  // The end G-code to paste: the end macro, then AUTO_EJECT. Cura has no
  // placeholder for the print height.
  function slicerEndGcode(kind, macro) {
    const eject = kind === "cura" ? "AUTO_EJECT HOME=1" : "AUTO_EJECT HEIGHT=[max_layer_z] HOME=1";
    return (macro ? macro + "\n" : "") + eject;
  }

  // Pictures of the print: the slicer puts them in the G-code, Moonraker
  // saves them next to it and lists them in the file's metadata. The one to
  // show `want` pixels wide: the smallest at least that wide, else the largest.
  function thumbPick(thumbs, want) {
    const list = (Array.isArray(thumbs) ? thumbs : []).filter((t) => t && t.relative_path && t.width > 0)
      .sort((a, b) => a.width - b.width);
    if (!list.length) return null;
    return list.find((t) => t.width >= want) || list[list.length - 1];
  }
  // Its address on Moonraker: relative to the G-code file's folder.
  function thumbPath(file, thumb) {
    if (!thumb || !thumb.relative_path) return "";
    const f = String(file || "");
    const dir = f.lastIndexOf("/") >= 0 ? f.slice(0, f.lastIndexOf("/") + 1) : "";
    const parts = (dir + thumb.relative_path).split("/").filter((s) => s && s !== ".");
    if (parts.includes("..")) return "";
    return "/server/files/gcodes/" + parts.map(encodeURIComponent).join("/");
  }
  // What a file's metadata says about the print; null where it says nothing.
  function fileFacts(m) {
    m = m || {};
    const n = (v) => (typeof v === "number" && isFinite(v) && v > 0 ? v : null);
    const kinds = String(m.filament_type || "").split(/[;,]/).map((s) => s.trim()).filter((s) => s && s !== "?");
    return {
      time: n(m.estimated_time),
      grams: n(m.filament_weight_total),
      metres: n(m.filament_total) ? Math.round(m.filament_total / 100) / 10 : null,
      height: n(m.object_height),
      layer: n(m.layer_height),
      layers: n(m.layer_count),
      nozzle: n(m.nozzle_diameter),
      material: Array.from(new Set(kinds)).join(" / "),
      slicer: m.slicer ? String(m.slicer) + (m.slicer_version ? " " + m.slicer_version : "") : ""
    };
  }

  // ----- the motors: every stepper with a TMC driver Klipper knows

  // Drivers whose DRV_STATUS carries the StallGuard reading (the load).
  // The TMC2208/2209/2224 keep theirs in another register Klipper does not report.
  const LOAD_DRIVERS = ["tmc2130", "tmc2240", "tmc2660", "tmc5160"];

  // The steppers with a TMC driver, in axis order: X, Y, Z, then the extruders.
  // On CoreXY and CoreXZ the two belt motors are A (stepper_x) and B (stepper_y).
  function tmcSteppers(objects, kinematics) {
    const out = [];
    for (const o of objects || []) {
      const m = /^(tmc\d{4})\s+(\S+)$/.exec(String(o));
      if (!m) continue;
      const stepper = m[2];
      const ax = /^stepper_([a-z])(\d*)$/.exec(stepper);
      const ex = /^extruder(\d*)$/.exec(stepper);
      let title = stepper, rank = 9, motor = "";
      if (ax) {
        title = ax[1].toUpperCase() + ax[2];
        rank = "xyzabc".indexOf(ax[1]) >= 0 ? "xyzabc".indexOf(ax[1]) : 6;
        const k = String(kinematics || "");
        if (/^(corexy|corexz|hybrid_corexy|hybrid_corexz)$/.test(k) && !ax[2]) {
          if (ax[1] === "x") motor = "A";
          else if (ax[1] === (k.indexOf("xz") >= 0 ? "z" : "y")) motor = "B";
        }
      } else if (ex) {
        title = "E" + ex[1];
        rank = 7;
      }
      out.push({ obj: o, driver: m[1], stepper, title, motor, extruder: !!ex, reportsLoad: LOAD_DRIVERS.indexOf(m[1]) >= 0,
        order: rank * 100 + (ax && ax[2] ? Number(ax[2]) : ex && ex[1] ? Number(ex[1]) : 0) });
    }
    return out.sort((a, b) => a.order - b.order || a.stepper.localeCompare(b.stepper));
  }

  // What the driver's status flags mean, worst first. Klipper leaves out the
  // flags that are 0. Open load (ola/olb) is only a hint: drivers show it at
  // standstill and at high speed even with the coil connected.
  const DRIVER_FLAGS = {
    ot: "bad", s2ga: "bad", s2gb: "bad", s2vsa: "bad", s2vsb: "bad", t150: "bad", t157: "bad", uv_cp: "bad",
    otpw: "warn", t120: "warn", t143: "warn",
    ola: "info", olb: "info"
  };
  const LEVEL_RANK = { bad: 0, warn: 1, info: 2 };
  function driverFlags(drv) {
    const out = [];
    for (const k of Object.keys(drv || {})) {
      if (DRIVER_FLAGS[k] && drv[k]) out.push({ flag: k, level: DRIVER_FLAGS[k] });
    }
    return out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.flag.localeCompare(b.flag));
  }

  // The StallGuard readings in short: now (the median of the last few, as
  // single readings jump), the lowest so far and the highest, for the line.
  // It is not a load in percent: the reading also drops at low speed, so
  // only the driver's warnings and the motor's temperature raise an alarm.
  // null readings are moments without one (slow or still).
  function stallguard(readings, recent) {
    const all = (readings || []).filter((v) => typeof v === "number" && isFinite(v));
    if (all.length < 5) return { wait: true, n: all.length };
    const sorted = all.slice().sort((a, b) => a - b);
    const last = all.slice(-(recent || 10)).sort((a, b) => a - b);
    return { wait: false, n: all.length, now: last[Math.floor(last.length / 2)], low: sorted[0], high: sorted[sorted.length - 1] };
  }

  // Temperature sensors on the motors themselves: temperature_sensor or
  // temperature_fan named after the motor (motor_x, stepper_x, motor_a for
  // a CoreXY belt motor, motor_e for the extruder…).
  function motorSensor(stepper, objects) {
    const want = [stepper.stepper.toLowerCase(), "motor_" + stepper.title.toLowerCase()];
    if (stepper.motor) want.push("motor_" + stepper.motor.toLowerCase());
    if (stepper.extruder) want.push("motor_extruder", "extruder_motor");
    for (const o of objects || []) {
      const m = /^temperature_(?:sensor|fan)\s+(\S+)$/.exec(String(o));
      if (m && want.indexOf(m[1].toLowerCase()) >= 0) return o;
    }
    return null;
  }

  // ----- the hardware page: what Klipper and Moonraker tell about the machine

  // A config section by name, any case: Klipper's objects keep the case of
  // printer.cfg, its settings are lower case.
  function cfgSection(config, name) {
    const want = String(name).toLowerCase();
    for (const k of Object.keys(config || {})) if (k.toLowerCase() === want) return config[k] || {};
    return {};
  }

  // Every part of the machine Klipper reports, sorted into the page's
  // sections. A board's own temperature is the temperature_sensor (or
  // temperature_fan) with sensor_type temperature_mcu on that board.
  function hwParts(objects, config) {
    const out = { mcus: [], can: [], heaters: [], fans: [], sensors: [], filament: [], hostSensor: null };
    const objs = (objects || []).map(String);
    const has = (o) => objs.indexOf(o) >= 0;
    for (const o of objs) {
      const sp = o.indexOf(" ");
      const kind = sp < 0 ? o : o.slice(0, sp);
      const name = sp < 0 ? "" : o.slice(sp + 1);
      const cfg = cfgSection(config, o);
      if (kind === "mcu") {
        const serial = String(cfg.serial || "");
        const conn = cfg.canbus_uuid ? "can" : /klipper_host_mcu/.test(serial) ? "host" : /\/dev\/serial\/by-id\/usb-|ttyACM/.test(serial) ? "usb" : serial ? "uart" : "";
        out.mcus.push({ obj: o, name: name || "mcu", main: !name, conn, sensor: null });
      } else if (kind === "canbus_stats") out.can.push({ obj: o, name });
      else if (/^extruder\d*$/.test(kind) || kind === "heater_bed" || kind === "heater_generic") {
        out.heaters.push({ obj: o, name: name || kind, kind });
      } else if (["fan", "heater_fan", "controller_fan", "fan_generic", "temperature_fan"].indexOf(kind) >= 0) {
        out.fans.push({ obj: o, name: name || kind, kind });
      } else if (kind === "temperature_sensor" || (kind === "temperature_host" && !has("temperature_fan " + name))) {
        out.sensors.push({ obj: o, name, kind });
      } else if (kind === "filament_switch_sensor" || kind === "filament_motion_sensor") {
        out.filament.push({ obj: o, name, kind });
      }
    }
    // the boards' and the computer's own temperatures
    for (const s of out.sensors.concat(out.fans.filter((f) => f.kind === "temperature_fan"))) {
      const cfg = cfgSection(config, s.obj);
      const type = String(cfg.sensor_type || (s.kind === "temperature_host" ? "temperature_host" : "")).toLowerCase();
      if (type === "temperature_mcu") {
        const mcu = String(cfg.sensor_mcu || "mcu").toLowerCase();
        const m = out.mcus.find((x) => x.name.toLowerCase() === mcu);
        if (m && !m.sensor) { m.sensor = s.obj; s.board = true; }
      } else if (type === "temperature_host" && !out.hostSensor) {
        out.hostSensor = s.obj; s.board = true;
      }
    }
    out.mcus.sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0) || (a.conn === "host") - (b.conn === "host") || a.name.localeCompare(b.name));
    return out;
  }

  // The flow through the hotend in mm³/s from the filament's speed (mm/s).
  function flowRate(velocity, diameter) {
    const d = Number(diameter) > 0 ? Number(diameter) : 1.75;
    return Math.abs(Number(velocity) || 0) * Math.PI * d * d / 4;
  }

  // Seconds until the eject pushes anyway while it waits for the bed to cool
  // (cool_timeout), or until cool_time is up; null when it is not waiting.
  // The macros keep the start in Klipper's print time.
  function coolLeft(state, set, estimated) {
    if (!state || !state.cooling || typeof estimated !== "number") return null;
    const limit = Number((set || {}).cool_mode === "time" ? set.cool_time : (set || {}).cool_timeout);
    if (!(limit > 0)) return null;
    return Math.max(0, (Number(state.cool_start) || 0) + limit - estimated);
  }

  // ----- the spool, with Spoolman: does the queue fit on what is left?
  // The same rules as push/spool.py, which stops the queue with the page closed.

  // Grams of filament for a length (mm) of the spool's filament.
  function lengthGrams(mm, filament) {
    const f = filament || {}, d = Number(f.diameter) > 0 ? Number(f.diameter) : 1.75, rho = Number(f.density);
    if (!(Number(mm) > 0) || !(rho > 0)) return null;
    return Number(mm) * Math.PI * d * d / 4 * rho / 1000;
  }

  // Grams a file needs: the slicer's weight or, without one, its length on
  // the spool's filament. null when it cannot be told, and for a file that
  // prints more than one filament, which one spool cannot be checked for.
  function fileGrams(m, filament) {
    m = m || {};
    if ((m.filament_weights || []).filter((w) => Number(w) > 0).length > 1 || Number(m.filament_change_count) > 0) return null;
    if (Number(m.filament_weight_total) > 0) return Number(m.filament_weight_total);
    return lengthGrams(m.filament_total, filament);
  }

  // What the print running now still needs: the part of it not printed yet,
  // by filament used (mm) when the file gives its length, else by progress.
  function gramsLeft(m, used, progress, filament) {
    const all = fileGrams(m, filament);
    if (all === null) return null;
    const total = Number((m || {}).filament_total);
    const done = total > 0 && Number(used) >= 0 ? Number(used) / total : Number(progress) || 0;
    return all * (1 - Math.min(1, Math.max(0, done)));
  }

  // The queue against the spool. left: grams on it now; now: grams the print
  // running still needs (0 for none, null unknown); jobs: grams for each
  // queued job (null unknown). A job is "short" when it would leave less than
  // reserve, and from the first job that cannot be told on nothing can.
  // stopAt: the job the queue must not start (-1 none).
  function spoolPlan(left, now, jobs, reserve) {
    if (typeof left !== "number" || !isFinite(left)) return null;
    const keep = Number(reserve) > 0 ? Number(reserve) : 0;
    let rest = now === null ? null : left - (now || 0);
    const out = { left, now, reserve: keep, after: rest, nowShort: rest !== null && (now || 0) > 0 && rest < keep, jobs: [], stopAt: -1, fit: 0 };
    for (const g of jobs || []) {
      if (rest === null || g === null || g === undefined) {
        rest = null;
        out.jobs.push({ grams: g === undefined ? null : g, left: null, fit: "unknown" });
        continue;
      }
      rest -= g;
      const short = rest < keep;
      if (short && out.stopAt < 0) out.stopAt = out.jobs.length;
      if (!short && out.stopAt < 0) out.fit++;
      out.jobs.push({ grams: g, left: rest, fit: out.stopAt >= 0 ? "short" : "ok" });
    }
    return out;
  }

  // The spool's name as Mainsail shows it: maker, filament, colour.
  function spoolName(spool) {
    const f = (spool || {}).filament || {};
    return [(f.vendor || {}).name, f.name || f.material].filter(Boolean).join(" ") || (spool && spool.id ? "#" + spool.id : "");
  }

  // ----- Klipper's updates, and the boards' firmware against Klipper

  // "v0.13.0-816-gee2c6fb6-dirty" -> { tag: "v0.13.0", count: 816, sha: "ee2c6fb6", dirty: true }
  function parseVersion(v) {
    const m = /^(v?\d+(?:\.\d+)*)(?:-(\d+)-g([0-9a-f]{4,40}))?(-dirty)?/i.exec(String(v || "").trim());
    if (!m) return null;
    return { tag: m[1], count: m[2] ? Number(m[2]) : 0, sha: m[3] ? m[3].toLowerCase() : null, dirty: !!m[4] };
  }
  function cmpTags(a, b) {
    const x = a.replace(/^v/i, "").split(".").map(Number), y = b.replace(/^v/i, "").split(".").map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
  }
  // A board's firmware against Klipper on the computer: "same", "older" (by
  // `by` updates when both are on one release), "newer" or "unknown".
  function firmwareAge(mcuVersion, hostVersion) {
    const a = parseVersion(mcuVersion), b = parseVersion(hostVersion);
    if (!a || !b) return { state: "unknown", by: null };
    const c = cmpTags(a.tag, b.tag) || a.count - b.count;
    if (c === 0) return { state: a.sha && b.sha && a.sha !== b.sha ? "unknown" : "same", by: 0 };
    return { state: c < 0 ? "older" : "newer", by: a.tag === b.tag ? Math.abs(a.count - b.count) : null };
  }
  // The files of a change that run on the boards, not on the computer.
  function boardCode(files) {
    return (files || []).map((f) => (typeof f === "string" ? f : f && f.filename) || "").filter((f) => /^(src|lib)\//.test(f));
  }
  // Klipper's notes in docs/Config_Changes.md that a change adds: what may
  // need a change in printer.cfg. patch: the file's diff.
  function configNotes(patch) {
    const added = String(patch || "").split("\n").filter((l) => /^\+(?!\+\+)/.test(l)).map((l) => l.slice(1)).join("\n");
    const out = [];
    const re = /(?:^|\n)(\d{8}):\s*([\s\S]*?)(?=\n\d{8}:|$)/g;
    let m;
    while ((m = re.exec(added)) !== null) {
      out.push({ date: m[1].slice(0, 4) + "-" + m[1].slice(4, 6) + "-" + m[1].slice(6), text: m[2].replace(/\s+/g, " ").trim() });
    }
    return out;
  }
  // What part of Klipper an update is about, from the "area: what" of its
  // first line. A guess from Klipper's own habits; "other" when unknown.
  const UPDATE_AREAS = [
    ["docs", /^docs?$/],
    ["config", /^config$/],
    ["firmware", /^(src|lib|stm32\w*|rp2040|rp2350|atsam\w*|lpc176x|avr|hc32f460|ar100|pru|linux|sched|command|board|canserial|usb\w*|spicmds|i2ccmds|sensor_cs1237)$/],
    ["drivers", /^tmc\w*$/],
    ["shaping", /^(input_shaper|shaper\w*|resonance_tester|adxl345|lis2dw|lis3dh|mpu9250|icm20948|bmi160|accelerometer)$/],
    ["probe", /^(probe\w*|bltouch|smart_effector|ldc1612|load_cell\w*|hx71x|ads1220)$/],
    ["bed", /^(bed_mesh|z_tilt\w*|quad_gantry_level|screws_tilt_adjust|bed_tilt|bed_screws|axis_twist_compensation|z_thermal_adjust)$/],
    ["fans", /^(fan\w*|heater_fan|controller_fan|temperature_fan)$/],
    ["heat", /^(heaters?|heater_\w+|pid_calibrate|temperature_\w+|thermistor|adc_temperature|spi_temperature|verify_heater)$/],
    ["extruder", /^(extruder\w*|pressure_advance|firmware_retraction|filament_\w+)$/],
    ["motion", /^(toolhead|stepper\w*|kinematics|corexy|corexz|cartesian|delta|deltesian|hybrid_core\w+|polar|rotary_delta|winch|trapq|itersolve|motion_report|manual_stepper|force_move|homing\w*|endstop\w*)$/],
    ["gcode", /^(gcode\w*|webhooks|api_server|print_stats|virtual_sdcard|exclude_object|save_variables|respond|pause_resume|idle_timeout|display_status|skew_correction)$/],
    ["display", /^(display|menu|lcd\w*|st7920|uc1701|hd44780|neopixel|led\w*|dotstar|pca95\d\d)$/],
    ["link", /^(mcu|serialhdl|clocksync|reactor|chelper|msgproto|canbus\w*|serial\w*)$/],
    ["tools", /^(scripts?|tests?|graph\w*|klippy|build|workflows?|github)$/]
  ];
  function updateArea(subject) {
    const m = /^\s*([\w./-]+)(?:\s*,\s*[\w./-]+)*\s*:/.exec(String(subject || ""));
    if (!m) return "other";
    const word = m[1].toLowerCase().replace(/\.(py|c|h)$/, "").split("/").pop();
    const hit = UPDATE_AREAS.find(([, re]) => re.test(word));
    return hit ? hit[0] : "other";
  }
  // How many of the updates are about each area, most first.
  function updateAreas(commits) {
    const n = {};
    for (const c of commits || []) {
      const a = updateArea(c.subject !== undefined ? c.subject : String(c.message || "").split("\n")[0]);
      n[a] = (n[a] || 0) + 1;
    }
    return Object.entries(n).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([area, count]) => ({ area, count }));
  }

  // ----- a report to paste into a GitHub issue

  // Addresses do not belong in a public issue: IP addresses (the printer's,
  // Tailscale's), Tailscale names and local host names become placeholders.
  function scrubReport(text) {
    return String(text)
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "x.x.x.x")
      .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:ts\.net|local|lan|home|internal)\b/gi, "<host>");
  }
  // f: what the page knows, gathered by the app. Markdown, in English, for
  // the issue form's fields: printer, versions, settings, console.
  function supportReport(f) {
    f = f || {};
    const L = [];
    const v = f.versions || {}, m = f.machine || {}, st = f.state || {};
    const row = (k, val) => { if (val !== undefined && val !== null && val !== "") L.push("- " + k + ": " + val); };
    L.push("### Versions");
    row("klipper-auto-eject", v.autoEject || "?");
    row("Klipper", v.klipper || "?");
    for (const b of f.boards || []) row("Board " + b.name, [b.version, b.chip].filter(Boolean).join(" · "));
    row("Moonraker", v.moonraker);
    row("Web page", v.web);
    row("Macro set", m.macroSet || "none found");
    row("Computer", f.host);
    L.push("", "### Printer");
    row("Kinematics", m.kinematics);
    row("Travel", m.travel);
    row("Probe", m.probe);
    row("Spoolman", m.spoolman);
    L.push("", "### State");
    row("Klipper", [st.klippy, st.klippyMsg].filter(Boolean).join(": "));
    row("Print", st.print);
    row("Job queue", st.queue);
    row("Stored parts", st.parts);
    row("Left on the bed", st.leftover);
    row("Ejecting", st.busy === undefined ? undefined : st.busy ? "yes" : "no");
    L.push("", "### Settings changed from the defaults");
    const set = f.settings || [];
    if (!set.length) L.push("None: every setting is at its default.");
    else {
      L.push("| Setting | Value | Set in |", "|---|---|---|");
      for (const s of set) L.push("| `" + s.key + "` | `" + JSON.stringify(s.value) + "` | " + (s.source === "saved" ? "the web page" : "auto_eject_settings.cfg") + " |");
    }
    L.push("", "### Console (auto-eject lines and errors, newest last)", "```");
    for (const line of f.log || []) L.push(String(line).replace(/```/g, "'''"));
    if (!(f.log || []).length) L.push("(none)");
    L.push("```");
    return scrubReport(L.join("\n"));
  }

  // A fan with a tachometer that should turn and does not.
  function fanStopped(fan) {
    return !!fan && typeof fan.rpm === "number" && (fan.speed || 0) >= 0.25 && fan.rpm < 1;
  }

  // A heater that reached its target and then cannot hold it at full power
  // for 30 s (a weak heater, a draught, a loose cartridge), or that runs far
  // above it. Warming up at full power is normal: only after it got there.
  function heaterWatch(state, h, now) {
    const st = Object.assign({ target: null, reached: false, since: null }, state || {});
    const target = h.target || 0, temp = h.temperature, power = h.power || 0;
    if (target !== st.target) { st.target = target; st.reached = false; st.since = null; }
    let level = null, reason = null;
    if (target > 0 && typeof temp === "number") {
      if (Math.abs(temp - target) <= 2) st.reached = true;
      if (st.reached && temp < target - 5 && power >= 0.95) {
        if (st.since === null) st.since = now;
        if (now - st.since >= 30) { level = "warn"; reason = "cant_hold"; }
      } else st.since = null;
      if (temp > target + 15) { level = "bad"; reason = "above"; }
    } else st.since = null;
    return { state: st, level, reason };
  }

  // The Raspberry Pi's throttling flags from Moonraker: now (bad) or since boot (warn).
  function throttleFlags(ts) {
    return ((ts && ts.flags) || []).map((f) => ({ flag: f, level: /^Previously/i.test(f) ? "warn" : "bad" }));
  }

  // What the computer's figures call for: hot, out of memory, disk nearly full.
  function hostChecks(proc, disk) {
    const out = [];
    const t = proc && proc.cpu_temp;
    if (typeof t === "number") {
      if (t >= 85) out.push({ key: "cpu_hot", level: "bad", v: t });
      else if (t >= 75) out.push({ key: "cpu_hot", level: "warn", v: t });
    }
    const mem = proc && proc.system_memory;
    if (mem && mem.total > 0 && mem.available / mem.total < 0.08) out.push({ key: "memory_low", level: "warn", v: Math.round(100 * mem.available / mem.total) });
    if (disk && disk.total > 0 && disk.free < Math.min(1e9, disk.total * 0.05)) out.push({ key: "disk_low", level: "warn", v: disk.free });
    return out;
  }

  // How much a counter grew since the page first saw it (it starts again
  // from 0 when Klipper restarts).
  function grew(base, now) {
    if (typeof now !== "number") return 0;
    if (typeof base !== "number" || now < base) return 0;
    return now - base;
  }

  const api = {
    DIRECTIONS, shortNames, mergeSettings, parseSettingsTemplate, parseValue, recordsFromExcludeObjects,
    planPushes, probeKind, parseObjectDefines, findEjectCommand, macroAfterEject, findHeight, checkFile,
    noticeFor, ntfyTopic, notifierKind, farmOrder, farmKind, farmCounts, farmFilter, farmGroups, farmPending, ejectRunning, farmBulk, FARM_BULK, farmSpoolLow, farmReportCsv, farmFirmware, farmActions, farmToday, farmLink, farmAway, farmQrLinks, copyList, farmService, thumbPick, thumbPath, fileFacts, tmcSteppers, driverFlags, stallguard, motorSensor,
    hwParts, fanStopped, heaterWatch, throttleFlags, hostChecks, grew, cfgSection, flowRate, coolLeft,
    lengthGrams, fileGrams, gramsLeft, spoolPlan, spoolName, parseVersion, firmwareAge, boardCode, configNotes, updateArea, updateAreas, scrubReport, supportReport, endMacros, endMacroInFile, slicerKind, slicerEndGcode,
    PromptParser, formatDuration, settingArg, validSettingText, macroSet
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AEModel = api;
})(typeof window !== "undefined" ? window : this);
