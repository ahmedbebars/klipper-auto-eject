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
  function farmCounts(printers) {
    const out = { needs: 0, printing: 0, idle: 0, off: 0, offline: 0 };
    for (const p of printers) {
      if (p.phase === "needs" || p.phase === "stopped" || p.phase === "paused") out.needs++;
      else if (p.phase === "printing" || p.phase === "ejecting") out.printing++;
      else if (p.phase === "idle") out.idle++;
      else if (p.phase === "off") out.off++;
      else out.offline++;
    }
    return out;
  }
  // What a farm card can offer: the bed is clear, start the queue, stop.
  function farmActions(p) {
    const out = [];
    if (p.phase === "needs" && ["leftover", "parts", "done", "cancelled", "error"].includes(p.reason)) out.push("clear");
    if (p.phase === "needs" && p.reason === "bin") out.push("bin_empty");
    if (p.queue === "paused" && p.jobs > 0 && ["idle", "needs"].includes(p.phase) && !["leftover", "parts", "done", "cancelled", "error", "bin"].includes(p.reason)) out.push("continue");
    if (["printing", "paused", "ejecting"].includes(p.phase)) out.push("estop");
    return out;
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

  const api = {
    DIRECTIONS, shortNames, mergeSettings, parseSettingsTemplate, parseValue, recordsFromExcludeObjects,
    planPushes, probeKind, parseObjectDefines, findEjectCommand, macroAfterEject, findHeight, checkFile,
    noticeFor, ntfyTopic, farmOrder, farmCounts, farmActions, farmToday, endMacros, endMacroInFile, slicerKind, slicerEndGcode,
    PromptParser, formatDuration, settingArg, validSettingText
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AEModel = api;
})(typeof window !== "undefined" ? window : this);
