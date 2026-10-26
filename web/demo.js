/* klipper-auto-eject web page: demo mode.
 *
 * Open the page with ?demo to try it without a printer. This stands in for
 * Moonraker: a printer that prints, cools the bed, pushes the parts off and
 * checks the bed, with a job queue and a few G-code files to check. Time
 * runs faster than on a real printer.
 */
"use strict";

(function (root) {
  const M = root.AEModel;
  const BED = { min: [0, 0, -5, 0], max: [350, 350, 330, 0] };
  const T0 = Date.now() / 1000;     // Klipper's print time counts from its start
  const PARK = [175, 340, 40];

  // Settings the demo printer's own settings file changes.
  const DEMO_FILE = {
    blade_offset: 62.0, blade_width: 100.0, push_z: 0.8, blade_lift: 2.1,
    push_current: 0.45, cool_temp: 32, bin_capacity: 30
  };

  // Used when ../config/auto_eject_settings.cfg cannot be read.
  const FALLBACK_DEFAULTS = {
    strategy: "columns", direction: "front", no_objects_action: "skip", blade_offset: 20.0,
    blade_width: 80.0, column_overlap: 15.0, head_depth: 40.0, side_margin: 5.0, push_z: 1.5,
    blade_lift: "unknown", push_end: "auto", rear_clearance: 10.0, cool_mode: "temperature",
    cool_temp: 32, cool_timeout: 1800, min_part_height: 2.0, thin_parts_action: "ignore",
    max_part_height: 25.0, verify: true, push_current: 0.5, retries: 1
  };

  /* ------------------------------------------------------------ shapes */

  function circle(cx, cy, r, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push([round(cx + r * Math.cos(a)), round(cy + r * Math.sin(a))]);
    }
    return out;
  }
  function star(cx, cy, r) {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      out.push([round(cx + rr * Math.cos(a)), round(cy + rr * Math.sin(a))]);
    }
    return out;
  }
  function heart(cx, cy, r) {
    const out = [];
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      out.push([round(cx + (x / 17) * r), round(cy + (y / 17) * r)]);
    }
    return out;
  }
  function rect(x0, y0, x1, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
  function round(v) { return Math.round(v * 1000) / 1000; }

  const FILES = {
    "cookie_cutters_x6.gcode": {
      height: 15.5, layer: 0.2, time: 6900, eject: true, material: "PLA", color: "#ff7a1a",
      parts: [
        ["star_1", star(95, 120, 34)], ["heart_1", heart(175, 120, 34)], ["circle_1", circle(255, 120, 32, 28)],
        ["star_2", star(95, 205, 34)], ["heart_2", heart(175, 205, 34)], ["circle_2", circle(255, 205, 32, 28)]
      ]
    },
    "calibration_cubes_x3.gcode": {
      height: 10.0, layer: 0.2, time: 2700, eject: true, material: "PLA", color: "#19a7a0",
      parts: [["cube_1", rect(110, 150, 140, 180)], ["cube_2", rect(160, 150, 190, 180)], ["cube_3", rect(210, 150, 240, 180)]]
    },
    "stencil_logo.gcode": {
      height: 0.48, layer: 0.24, time: 1500, eject: true, material: "PETG", color: "#18191c",
      parts: [["stencil", rect(110, 110, 240, 240)]]
    },
    "wall_bracket.gcode": {
      height: 32.0, layer: 0.25, time: 8100, eject: true, material: "PETG", color: "#2f6fdf",
      parts: [["bracket", rect(140, 290, 210, 335)]]
    },
    "keychains_x12.gcode": {
      height: 4.0, layer: 0.2, time: 3300, eject: false, material: "PLA", color: "#e5484d",
      parts: (function () {
        const p = [];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++)
          p.push(["tag_" + (r * 4 + c + 1), rect(80 + c * 50, 110 + r * 45, 115 + c * 50, 135 + r * 45)]);
        return p;
      })()
    },
    "vase_no_labels.gcode": { height: 120.0, layer: 0.3, time: 9600, eject: false, parts: [], labels: false, material: "PLA", color: "#8e5bd8" }
  };

  /* ---------------------------------------------------- the pictures */

  // What the slicer would have drawn: the parts seen from the front, a
  // little above. The other farm printers' files get a shape from their name.
  function demoShape(name) {
    const f = FILES[name];
    if (f) return { parts: f.parts.length ? f.parts.map((p) => p[1]) : [circle(175, 175, 40, 36)], height: f.height, color: f.color, material: f.material };
    const n = String(name).toLowerCase();
    const material = ((/(PLA|PETG|ABS|ASA|TPU)/i.exec(name) || [])[1] || "PLA").toUpperCase();
    const grid = (cols, rows, w, d, gap, mk) => {
      const out = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(mk(100 + c * (w + gap), 120 + r * (d + gap), w, d));
      return out;
    };
    if (/vase/.test(n)) return { parts: [circle(175, 175, 45, 40)], height: 150, color: "#8e5bd8", material };
    if (/bracket/.test(n)) return { parts: [[[130, 150], [230, 150], [230, 172], [152, 172], [152, 236], [130, 236]]], height: 28, color: "#2f6fdf", material };
    if (/hook/.test(n)) return { parts: grid(4, 2, 18, 46, 16, (x, y, w, d) => rect(x, y, x + w, y + d)), height: 16, color: "#e5484d", material };
    if (/clip/.test(n)) return { parts: grid(4, 3, 20, 20, 12, (x, y, w) => circle(x + w / 2, y + w / 2, w / 2, 18)), height: 9, color: "#19a7a0", material };
    if (/stand/.test(n)) return { parts: [[[120, 150], [230, 150], [215, 215], [135, 215]]], height: 70, color: "#f5a524", material };
    return { parts: [rect(130, 140, 220, 210)], height: 22, color: "#ff7a1a", material };
  }
  function shade(hex, k) {
    const c = parseInt(hex.slice(1), 16);
    const m = (v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
    return "#" + [c >> 16, (c >> 8) & 255, c & 255].map((v) => m(v).toString(16).padStart(2, "0")).join("");
  }
  function thumbSvg(shape) {
    const all = [].concat(...shape.parts);
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const TILT = 0.55, RISE = 0.8;
    const w = (x1 - x0) || 1, d = (y1 - y0) * TILT, up = shape.height * RISE;
    const s = Math.min(232 / w, 232 / (d + up));
    const ox = 150 - (w * s) / 2, oy = 150 + ((d + up) * s) / 2;
    const P = (x, y, z) => (ox + (x - x0) * s).toFixed(1) + "," + (oy - (y - y0) * TILT * s - z * RISE * s).toFixed(1);
    const base = shape.color || "#ff7a1a";
    const out = [];
    // the parts at the back first, and in each its sides before its top
    shape.parts.slice().sort((a, b) => Math.min(...b.map((p) => p[1])) - Math.min(...a.map((p) => p[1]))).forEach((poly) => {
      let area = 0;
      poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; });
      const sides = [];
      poly.forEach((a, i) => {
        const b = poly[(i + 1) % poly.length];
        let nx = b[1] - a[1], ny = -(b[0] - a[0]);
        if (area < 0) { nx = -nx; ny = -ny; }
        const len = Math.hypot(nx, ny) || 1;
        nx /= len; ny /= len;
        if (ny >= -0.02) return;                    // faces away: hidden
        const light = Math.max(0, nx * -0.45 + ny * -0.89);
        sides.push({ y: (a[1] + b[1]) / 2, d: [P(a[0], a[1], 0), P(b[0], b[1], 0), P(b[0], b[1], shape.height), P(a[0], a[1], shape.height)].join(" "),
          c: shade(base, -0.5 + light * 0.32) });
      });
      sides.sort((p, q) => q.y - p.y).forEach((f) => out.push('<polygon points="' + f.d + '" fill="' + f.c + '" stroke="' + f.c + '" stroke-width="0.6"/>'));
      out.push('<polygon points="' + poly.map((p) => P(p[0], p[1], shape.height)).join(" ") + '" fill="url(#top)" stroke="' + shade(base, -0.2) +
        '" stroke-width="1.2" stroke-linejoin="round"/>');
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">' +
      '<defs><linearGradient id="top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + shade(base, 0.32) + '"/>' +
      '<stop offset="1" stop-color="' + base + '"/></linearGradient>' +
      '<radialGradient id="sh"><stop offset="0" stop-color="#000" stop-opacity="0.22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>' +
      '<ellipse cx="150" cy="' + (oy + 2).toFixed(1) + '" rx="' + ((w * s) / 2 + 18).toFixed(1) + '" ry="14" fill="url(#sh)"/>' + out.join("") + "</svg>";
  }

  /* -------------------------------------------------------------- demo */

  // Moonraker's update manager: Klipper a few updates behind (Klipper's own
  // recent updates), Mainsail with a new version, the rest up to date
  const KLIPPER_VERSION = "v0.13.0-809-gc63b2951";
  const DEMO_MAIN_OLD = "v0.13.0-800-g9cb99754";    // the mainboard, behind Klipper until the board update
  const DEMO_DAY = 1792411200;      // 2026-10-19, noon UTC
  const kc = (sha, day, subject) => ({ sha, author: "Klipper", date: String(DEMO_DAY + day * 86400), subject, message: subject, tag: null });
  const DEMO_UPDATES = {
    klipper: {
      configured_type: "git_repo", owner: "Klipper3d", repo_name: "klipper", version: "v0.13.0-809", remote_version: "v0.13.0-816",
      current_hash: "c63b2951", remote_hash: "ee2c6fb6", commits_behind_count: 7,
      commits_behind: [
        kc("ee2c6fb6", 2, "sensor_cs1237: Combine cs1237_read_bits() calls in cs1237_write_config()"),
        kc("705d50dd", 2, "sensor_cs1237: Simplify flags handling in cs1237_read_adc()"),
        kc("a5b4f2ed", 2, "sensor_cs1237: Discard the first sample after a start"),
        kc("a08fc79f", 0, "icm20948: Select bank 0 before reading WHO_AM_I"),
        kc("9aa4439f", 0, "icm20948: Write ACCEL_SMPLRT_DIV in bank 2"),
        kc("01ca487b", 0, "icm20948: Reset FIFO with FIFO_RST"),
        kc("7b50c21a", 0, "icm20948: Fix clearing of FIFO overflow flag")
      ]
    },
    moonraker: { configured_type: "git_repo", owner: "Arksine", repo_name: "moonraker", version: "v0.11.0-4", remote_version: "v0.11.0-4", commits_behind: [] },
    mainsail: { configured_type: "web", owner: "mainsail-crew", repo_name: "mainsail", version: "v2.19.0", remote_version: "v2.20.0" },
    crowsnest: { configured_type: "git_repo", owner: "mainsail-crew", repo_name: "crowsnest", version: "v5.0.12-3", remote_version: "v5.0.12-3", commits_behind: [] },
    "klipper-auto-eject": { configured_type: "git_repo", owner: "ahmedbebars", repo_name: "klipper-auto-eject", version: "v0.15.0-1", remote_version: "v0.15.0-1", commits_behind: [] },
    system: { package_count: 0, package_list: [] }
  };
  // what GitHub tells about those updates: the files they change
  const DEMO_GITHUB = {
    "c63b2951...ee2c6fb6": { files: [{ filename: "klippy/extras/icm20948.py" }, { filename: "src/sensor_cs1237.c" }] },
    "9cb99754...c63b2951": { files: [{ filename: "docs/Config_Changes.md", patch: "@@ -8,6 +8,10 @@\n ## Changes\n \n+20261018: An error in the `PID_CALIBRATE` calculations has been\n+corrected: it recommended PID values twice their desired values. If\n+your heaters hold their temperature well, nothing needs to change.\n+\n" },
      { filename: "klippy/extras/pid_calibrate.py" }, { filename: "klippy/extras/tmc.py" }, { filename: "klippy/extras/tmc5262.py" }] }
  };

  function Demo() {
    this.handlers = {};
    this.open = false;
    this.isDemo = true;
    this.gen = 0;
    this.dirty = new Set();
    this.log = [];
    this.defaults = Object.assign({}, FALLBACK_DEFAULTS);
    this.queue = { state: "ready", jobs: [] };
    this.jobId = 1;
    // Spoolman: the spool on the printer is nearly empty, so the queue
    // shows where it runs out; another spool can be chosen
    const fil = (id, vendor, name, material, color, density) => ({ id, vendor: { id, name: vendor }, name, material, color_hex: color,
                                                                   density, diameter: 1.75, weight: 1000, spool_weight: 200 });
    this.spools = [
      { id: 3, remaining_weight: 33, used_weight: 967, initial_weight: 1000, filament: fil(1, "Generic", "PLA Orange", "PLA", "ff7a1a", 1.24) },
      { id: 5, remaining_weight: 780, used_weight: 220, initial_weight: 1000, filament: fil(2, "eSUN", "PLA+ Black", "PLA", "18191c", 1.24) },
      { id: 7, remaining_weight: 1000, used_weight: 0, initial_weight: 1000, filament: fil(3, "Polymaker", "PETG Blue", "PETG", "2f6fdf", 1.27) }
    ];
    this.spoolId = 3;
    this.parts = [];
    this.wizard = { step: "" };
    this.status = {
      webhooks: { state: "ready", state_message: "Printer is ready" },
      print_stats: { state: "complete", filename: "cookie_cutters_x6.gcode", print_duration: 6890, total_duration: 7012,
                     filament_used: 8123, info: { current_layer: 78, total_layer: 78 }, message: "" },
      virtual_sdcard: { progress: 1.0, is_active: false, file_position: 0 },
      display_status: { progress: 1.0, message: null },
      idle_timeout: { state: "Ready", printing_time: 0 },
      toolhead: { position: PARK.concat([0]), homed_axes: "xyz", axis_minimum: BED.min, axis_maximum: BED.max,
                  max_accel: 10000, estimated_print_time: 0 },
      heater_bed: { temperature: 51.4, target: 0, power: 0 },
      extruder: { temperature: 60.0, target: 0, power: 0 },
      fan: { speed: 0 },
      exclude_object: { objects: [], excluded_objects: [], current_object: null },
      "gcode_macro _AUTO_EJECT_STATE": { objects: [], height: 15.5, job: "cookie_cutters_x6.gcode", leftover: [], bin: 20,
                                         busy: false, swept: false, captured: true, abort: false },
      "gcode_macro _AUTO_EJECT_DEFAULTS": {},
      "gcode_macro _AUTO_EJECT_SETTINGS": {},
      "gcode_macro _AUTO_EJECT_OVERRIDES": { data: {} },
      save_variables: { variables: {} }
    };
    this.setParts(FILES["cookie_cutters_x6.gcode"].parts);
    this.capture();
    this.queue.jobs.push(this.newJob("calibration_cubes_x3.gcode"), this.newJob("cookie_cutters_x6.gcode"));
    this.say("// AUTO_EJECT: parts captured: 6 (cookie_cutters_x6.gcode)", -600);
  }

  Demo.prototype.on = function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); };
  Demo.prototype.emit = function (ev, data) {
    for (const fn of this.handlers[ev] || []) { try { fn(data); } catch (e) { console.error(e); } }
  };

  Demo.prototype.connect = function () {
    fetch("../config/auto_eject_settings.cfg").then((r) => r.ok ? r.text() : Promise.reject())
      .then((text) => {
        for (const sec of M.parseSettingsTemplate(text)) for (const it of sec.items) this.defaults[it.key] = it.def;
      }).catch(() => {}).then(() => {
        this.status["gcode_macro _AUTO_EJECT_DEFAULTS"] = Object.assign({}, this.defaults);
        this.status["gcode_macro _AUTO_EJECT_SETTINGS"] = Object.assign({}, this.defaults, DEMO_FILE);
        this.status["gcode_macro _AUTO_EJECT_OVERRIDES"] = { data: { cool_temp: 32, push_z: 0.8, max_part_height: 40.0 } };
        this.open = true;
        setInterval(() => this.tick(), 200);
        setTimeout(() => this.emit("open"), 300);
        // ?demo=eject starts clearing the bed by itself, ?demo=print the next print
        const mode = new URLSearchParams(location.search).get("demo");
        if (mode === "eject") setTimeout(() => this.runGcode("AUTO_EJECT").catch(() => {}), 1500);
        if (mode === "print") setTimeout(() => this.runGcode("AUTO_EJECT_CLEAR").catch(() => {}), 500);
      });
  };

  Demo.prototype.settings = function () {
    return Object.assign({}, this.status["gcode_macro _AUTO_EJECT_DEFAULTS"], this.status["gcode_macro _AUTO_EJECT_SETTINGS"],
                         this.status["gcode_macro _AUTO_EJECT_OVERRIDES"].data);
  };

  Demo.prototype.touch = function (name) { this.dirty.add(name); };

  Demo.prototype.tick = function () {
    const bed = this.status.heater_bed;
    // the bed cools on its own, faster with the fan on
    if (bed.target === 0 && bed.temperature > 26) {
      const rate = this.status.fan.speed > 0 ? 0.55 : 0.012;
      bed.temperature = Math.max(26, bed.temperature - rate * (bed.temperature - 25) / 25 - 0.02);
      this.touch("heater_bed");
    } else if (bed.target > 0 && bed.temperature < bed.target) {
      bed.temperature = Math.min(bed.target, bed.temperature + 1.5);
      this.touch("heater_bed");
    }
    // the hotend heats fast and cools back to where it started
    const hot = this.status.extruder;
    if (hot.target > 0 && hot.temperature < hot.target) {
      hot.temperature = Math.min(hot.target, hot.temperature + 4);
      this.touch("extruder");
    } else if (hot.target === 0 && hot.temperature > 60) {
      hot.temperature = Math.max(60, hot.temperature - 0.8);
      this.touch("extruder");
    }
    // full power while warming, a little to hold
    for (const h of [bed, hot]) {
      const power = h.target > 0 ? (h.temperature < h.target - 2 ? 1 : 0.3) : 0;
      if (power !== h.power) { h.power = power; this.touch(h === bed ? "heater_bed" : "extruder"); }
    }
    if (this.dirty.size) {
      const diff = {};
      for (const n of this.dirty) diff[n] = JSON.parse(JSON.stringify(this.status[n]));
      this.dirty.clear();
      this.emit("notify_status_update", [diff, Date.now() / 1000]);
    }
  };

  Demo.prototype.say = function (line, ago) {
    const entry = { message: line, time: Date.now() / 1000 + (ago || 0), type: "response" };
    this.log.push(entry);
    if (!ago) this.emit("notify_gcode_response", [line]);
  };

  Demo.prototype.newJob = function (filename) {
    return { filename, job_id: "demo" + (this.jobId++), time_added: Date.now() / 1000, time_in_queue: 0 };
  };

  Demo.prototype.queueChanged = function (action) {
    this.emit("notify_job_queue_changed", [{ action, updated_queue: this.queue.jobs.slice(), queue_state: this.queue.state }]);
  };

  Demo.prototype.setParts = function (parts) {
    this.parts = parts.map((p) => ({ name: p[0], polygon: p[1] }));
    this.status.exclude_object = {
      objects: this.parts.map((p) => {
        const r = M.recordsFromExcludeObjects([{ name: p.name, polygon: p.polygon }])[0];
        return { name: p.name, polygon: p.polygon, center: [r[5], r[6]] };
      }),
      excluded_objects: [], current_object: null
    };
    this.touch("exclude_object");
  };

  Demo.prototype.capture = function () {
    const recs = M.recordsFromExcludeObjects(this.status.exclude_object.objects).map((r) => r.slice(0, 8));
    this.status["gcode_macro _AUTO_EJECT_STATE"].objects = recs;
    this.touch("gcode_macro _AUTO_EJECT_STATE");
  };

  Demo.prototype.state = function (patch) {
    Object.assign(this.status["gcode_macro _AUTO_EJECT_STATE"], patch);
    this.touch("gcode_macro _AUTO_EJECT_STATE");
  };

  /* -------------------------------------------------------- motion */

  Demo.prototype.sleep = function (ms) {
    const gen = this.gen;
    return new Promise((resolve, reject) => setTimeout(() => (gen === this.gen ? resolve() : reject(new Error("stopped"))), ms));
  };

  Demo.prototype.moveTo = async function (x, y, z, ms) {
    const th = this.status.toolhead;
    const from = th.position.slice();
    const to = [x == null ? from[0] : x, y == null ? from[1] : y, z == null ? from[2] : z];
    const steps = Math.max(1, Math.round(ms / 100));
    for (let i = 1; i <= steps; i++) {
      await this.sleep(ms / steps);
      const f = i / steps;
      th.position = [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f, 0];
      th.estimated_print_time = Math.round((Date.now() / 1000 - T0) * 10) / 10;
      this.touch("toolhead");
    }
  };

  Demo.prototype.busy = function (on) {
    this.status.idle_timeout.state = on ? "Printing" : "Ready";
    this.touch("idle_timeout");
  };

  /* --------------------------------------------------------- AUTO_EJECT */

  Demo.prototype.autoEject = async function (params) {
    const s = this.settings();
    const st = this.status["gcode_macro _AUTO_EJECT_STATE"];
    const dry = params.DRY === "1";
    const h = parseFloat(params.HEIGHT || st.height || 0);
    if (h > 0 && h < s.min_part_height && s.thin_parts_action === "ignore" && !dry) {
      this.say("// AUTO_EJECT: the parts are only " + h.toFixed(1) + " mm tall (min_part_height " + s.min_part_height.toFixed(1) +
               "), too thin to push. They stay on the bed for you to remove.");
      this.queue.state = "paused";
      this.queueChanged("state_changed");
      this.say("// AUTO_EJECT: job queue paused until the bed is clear (AUTO_EJECT_CONTINUE)");
      this.state({ objects: [], height: 0 });
      this.prompt("Auto-eject - remove the parts", [
        "This print is only " + h.toFixed(1) + " mm tall, too thin for the blade, so it was left on the bed. Take it off by hand.",
        "The job queue waits until you confirm the bed is clear."
      ], [], [["Bed is clear - continue the queue", "AUTO_EJECT_CONTINUE", "primary"]]);
      return;
    }
    if (h > s.max_part_height && !dry) {
      this.say("// AUTO_EJECT: the parts are " + h.toFixed(1) + " mm tall, too tall to push (max_part_height " + s.max_part_height.toFixed(1) +
               "): the gantry would hit them. They stay on the bed for you to remove.");
      this.queue.state = "paused";
      this.queueChanged("state_changed");
      this.say("// AUTO_EJECT: job queue paused until the bed is clear (AUTO_EJECT_CONTINUE)");
      this.state({ height: h });
      this.prompt("Auto-eject - remove the parts", [
        "This print is " + h.toFixed(1) + " mm tall, too tall for the blade: the gantry would hit it. It was left on the bed: take it off by hand.",
        "The job queue waits until you confirm the bed is clear."
      ], [], [["Bed is clear - continue the queue", "_AUTO_EJECT_TALL_CLEAR", "primary"]]);
      return;
    }
    if (!this.status.toolhead.homed_axes.includes("z")) {
      if (params.HOME !== "1") throw new Error("AUTO_EJECT: printer is not homed. Run AUTO_EJECT HOME=1 to home safely around the parts, or remove them by hand.");
      this.busy(true);
      this.say("// AUTO_EJECT: homing X and Y, then Z at a free spot");
      await this.moveTo(350, 350, null, 1200);
      await this.moveTo(320, 330, null, 600);
      await this.moveTo(null, null, 10, 600);
      this.status.toolhead.homed_axes = "xyz";
      this.touch("toolhead");
    }
    if (params.HEIGHT) this.state({ height: h });
    const plan = M.planPushes(st.objects, s, BED.min, BED.max);
    if (plan.strategy === "skip") { this.say("// AUTO_EJECT: no labelled objects found, nothing to do"); return; }
    const zsafe = Math.max(this.status.toolhead.position[2] + s.z_hop, s.min_safe_z, (st.height || 0) + s.z_hop);
    this.busy(true);
    this.state({ busy: true, swept: false, leftover: [] });
    this.say("// AUTO_EJECT: strategy=" + plan.strategy + " direction=" + plan.direction + " objects=" + st.objects.length +
             " safe_z=" + zsafe.toFixed(1) + (dry ? " [DRY RUN]" : ""));
    try {
      if (!dry && s.cool_mode === "temperature") {
        this.status.heater_bed.target = 0;
        this.status.extruder.target = 0;
        this.status.fan.speed = s.cool_fan_speed;
        this.touch("heater_bed"); this.touch("extruder"); this.touch("fan");
        // cool_background: the printer takes commands while the bed cools
        const bg = !!s.cool_background;
        const live = () => this.status["gcode_macro _AUTO_EJECT_STATE"];
        const stop = () => bg && (live().push_now || !live().bg);
        this.say(bg ? "// AUTO_EJECT: cooling the bed to " + s.cool_temp + " C with the printer free. AUTO_EJECT_PUSH_NOW pushes at once; AUTO_EJECT_CLEAR if you take the parts off."
                    : "// AUTO_EJECT: waiting for the bed to reach " + s.cool_temp + " C, fan over the parts");
        this.state({ cooling: true, cool_start: Date.now() / 1000 - T0, bg, push_now: false });
        if (bg) this.busy(false);
        const gap = (st.height || 0) + s.cool_tour_gap;
        await this.moveTo(null, null, gap, 500);
        let guard = 0;
        while (this.status.heater_bed.temperature > s.cool_temp && guard++ < 40 && !stop()) {
          for (const r of st.objects) {
            await this.moveTo(r[5], r[6], null, 350);
            await this.sleep(250);
            if (this.status.heater_bed.temperature <= s.cool_temp || stop()) break;
          }
        }
        this.status.fan.speed = 0;
        this.touch("fan");
        if (bg && !live().bg) { this.state({ cooling: false }); return; }      // taken off by hand
        if (bg && live().push_now) this.say("// AUTO_EJECT: pushing now, as asked");
        if (bg) this.busy(true);
        this.state({ cooling: false });
      }
      await this.moveTo(null, null, zsafe, 400);
      for (const p of plan.pushes) {
        await this.moveTo(p.x0, p.y0, null, 700);
        if (dry) {
          await this.sleep(300);
          await this.moveTo(p.x1, p.y1, null, 1000);
        } else {
          await this.moveTo(null, null, s.push_z, 400);
          await this.moveTo(p.x1, p.y1, null, 1600);
        }
        await this.moveTo(null, null, zsafe, 400);
      }
      this.say("// AUTO_EJECT: " + (dry ? "dry run" : "sweep") + " finished (" + plan.pushes.length + " push" + (plan.pushes.length === 1 ? "" : "es") + ")");
      if (dry) return;
      this.state({ swept: true });
      this.say("// AUTO_EJECT: re-homing X and Y");
      await this.moveTo(350, 350, null, 1200);
      let n = 0;
      for (const r of st.objects) {
        const pts = [[r[1] + 3, r[3] + 3], [r[2] - 3, r[3] + 3], [r[1] + 3, r[4] - 3]];
        for (const pt of pts) {
          await this.moveTo(pt[0], pt[1], s.verify_z, 300);
          await this.moveTo(null, null, 0.2, 200);
          this.say("// probe: at " + pt[0].toFixed(3) + "," + pt[1].toFixed(3) + " bed will contact at z=-" + (0.27 + Math.random() * 0.04).toFixed(6));
          await this.moveTo(null, null, s.verify_z, 150);
          n++;
        }
      }
      this.say("// AUTO_EJECT: bed verified clear (" + n + " probe points)");
      const box = (this.status["gcode_macro _AUTO_EJECT_STATE"].bin || 0) + Math.max(1, this.parts.length);
      const cap = this.settings().bin_capacity || 0;
      this.state({ objects: [], height: 0, busy: false, bin: box });
      if (cap && box >= cap) this.say("// AUTO_EJECT: the parts box is full (" + box + " of " + cap + " parts). Empty it, then run AUTO_EJECT_BIN_EMPTY; the next print waits until then.");
      else if (cap && box >= Math.ceil(cap * 0.8) && box - Math.max(1, this.parts.length) < Math.ceil(cap * 0.8)) this.say("// AUTO_EJECT: the parts box is almost full (" + box + " of " + cap + " parts).");
      this.setParts([]);
      await this.moveTo(PARK[0], PARK[1], PARK[2], 900);
    } finally {
      this.state({ busy: false, bg: false, push_now: false });
      this.busy(false);
    }
    this.nextJobSoon();
  };

  Demo.prototype.nextJobSoon = function () {
    if (this.queue.state !== "ready" || !this.queue.jobs.length) return;
    if (this.status["gcode_macro _AUTO_EJECT_STATE"].objects.length) return;
    setTimeout(() => {
      if (this.queue.state !== "ready" || !this.queue.jobs.length || this.status.print_stats.state === "printing") return;
      const job = this.queue.jobs.shift();
      this.queue.state = "loading";
      this.queueChanged("job_loaded");
      setTimeout(() => { this.queue.state = "ready"; this.queueChanged("state_changed"); }, 1500);
      this.print(job.filename).catch(() => {});
    }, 2500);
  };

  // What the klipper-auto-eject service does with Spoolman (push/spool.py):
  // stop the queue before a job the spool on the printer cannot finish.
  Demo.prototype.spoolGuard = function () {
    const sp = this.spools.find((x) => x.id === this.spoolId);
    const next = this.queue.jobs[0], set = this.settings();
    if (!sp || !next || this.queue.state !== "ready" || String(set.spool_low_action || "stop") !== "stop") return;
    const ps = this.status.print_stats, fil = sp.filament;
    const now = ps.state === "printing" ? M.gramsLeft(this.fileMeta(ps.filename), ps.filament_used, this.status.virtual_sdcard.progress, fil) : 0;
    const reserve = Number(set.spool_reserve);
    const p = M.spoolPlan(sp.remaining_weight, now, [M.fileGrams(this.fileMeta(next.filename), fil)], isFinite(reserve) ? reserve : 10);
    if (p && p.stopAt === 0) { this.queue.state = "paused"; this.queueChanged("state_changed"); }
  };

  Demo.prototype.print = async function (name) {
    const f = FILES[name];
    const ps = this.status.print_stats;
    const total = Math.max(1, Math.round(f.height / f.layer));
    Object.assign(ps, { state: "printing", filename: name, print_duration: 0, total_duration: 0, info: { current_layer: 0, total_layer: total } });
    this.touch("print_stats");
    this.say("// Starting " + name);
    this.status.heater_bed.target = 55;
    this.status.extruder.target = 215;
    this.touch("heater_bed"); this.touch("extruder");
    this.busy(true);
    await this.moveTo(175, 175, 10, 900);
    this.setParts(f.parts);
    const steps = 48;
    for (let i = 1; i <= steps; i++) {
      const layer = Math.max(1, Math.round((i / steps) * total));
      const z = layer * f.layer;
      const part = this.parts.length ? this.parts[i % this.parts.length] : null;
      const pt = part ? part.polygon[(i * 3) % part.polygon.length] : [175 + 40 * Math.cos(i), 175 + 40 * Math.sin(i)];
      await this.moveTo(pt[0], pt[1], z, 380);
      ps.info = { current_layer: layer, total_layer: total };
      ps.print_duration = (i / steps) * f.time;
      ps.total_duration = ps.print_duration + 60;
      this.status.virtual_sdcard.progress = i / steps;
      this.status.display_status.progress = i / steps;
      const used = this.fileMeta(name).filament_total / steps;
      ps.filament_used = (i === 1 ? 0 : ps.filament_used || 0) + used;
      const spool = this.spools.find((x) => x.id === this.spoolId);
      if (spool) {
        const g = used * Math.PI * 1.75 * 1.75 / 4 * spool.filament.density / 1000;
        spool.remaining_weight = Math.round(Math.max(0, spool.remaining_weight - g) * 10) / 10;
        spool.used_weight = Math.round((spool.used_weight + g) * 10) / 10;
      }
      this.touch("print_stats"); this.touch("virtual_sdcard"); this.touch("display_status");
      if (i === 2) { this.capture(); this.state({ job: name, height: 0 }); }
      if (i === 4) this.spoolGuard();
      if (z > this.status["gcode_macro _AUTO_EJECT_STATE"].height) this.state({ height: Math.round(z * 100) / 100 });
    }
    this.status.extruder.target = 0;
    this.touch("extruder");
    if (f.eject) {
      try { await this.autoEject({ HEIGHT: String(f.height) }); } catch (e) { this.say("!! " + e.message); }
    } else {
      this.status.heater_bed.target = 0;
      this.touch("heater_bed");
      await this.moveTo(PARK[0], PARK[1], PARK[2], 900);
      this.busy(false);
    }
    Object.assign(ps, { state: "complete" });
    this.touch("print_stats");
  };

  /* ------------------------------------------------------------ prompts */

  Demo.prototype.prompt = function (title, texts, buttons, footer) {
    this.say("// action:prompt_end");
    this.say("// action:prompt_begin " + title);
    for (const t of texts) this.say("// action:prompt_text " + t);
    for (const b of buttons) this.say("// action:prompt_button " + b.join("|"));
    for (const b of footer) this.say("// action:prompt_footer_button " + b.join("|"));
    this.say("// action:prompt_show");
  };

  Demo.prototype.setup = function (step, value) {
    const close = ["Close", "AUTO_EJECT_SETUP STEP=close", "secondary"];
    switch (step) {
      case "close": this.say("// action:prompt_end"); return;
      case "direction":
        this.prompt("Auto-eject setup - 1 of 5 - drop edge", [
          "Which edge of the bed should the parts fall off? Pick the side with free space below it, away from cables and the frame."
        ], [["Front (Y-)", "AUTO_EJECT_SETUP STEP=prepare VALUE=front", "primary"], ["Back (Y+)", "AUTO_EJECT_SETUP STEP=prepare VALUE=back", "secondary"],
            ["Left (X-)", "AUTO_EJECT_SETUP STEP=prepare VALUE=left", "secondary"], ["Right (X+)", "AUTO_EJECT_SETUP STEP=prepare VALUE=right", "secondary"]], [close]);
        return;
      case "prepare":
        this.prompt("Auto-eject setup - 2 of 5 - the blade", [
          "Drop edge: " + (value || "front") + ".",
          "This is the demo, so the printer does not move. On your printer this step measures the blade with the probe, or asks for its size."
        ], [], [close, ["Next", "AUTO_EJECT_SETUP STEP=done", "primary"]]);
        return;
      case "done":
        this.prompt("Auto-eject setup - done", [
          "On a real printer the next steps are the blade width, an edge check and saving.",
          "After that, run a dry run and then a first eject while you watch."
        ], [], [["Close", "AUTO_EJECT_SETUP STEP=close", "primary"]]);
        return;
      case "calibrate":
        this.prompt("Auto-eject - measure the blade", [
          "Put the printed calibration block on the bed, warm (bed at most 55 C), and keep it stuck down.",
          "The printer touches the block with the nozzle and with the blade, and works out how far the blade is above and ahead of the nozzle.",
          "This is the demo, so nothing moves."
        ], [], [["Close", "AUTO_EJECT_SETUP STEP=close", "primary"]]);
        return;
      default:
        this.prompt("Auto-eject setup", [
          "This sets up pushing finished parts off the bed in five short steps: the drop edge, the blade, its width, an edge check and saving.",
          "Probe: contact probe [probe]. Keep the bed clear and stay close to the printer."
        ], [], [close, ["Start", "AUTO_EJECT_SETUP STEP=direction", "primary"]]);
    }
  };

  /* ------------------------------------------------------- AUTO_EJECT_SET */

  Demo.prototype.set = function (p) {
    const key = String(p.KEY || "").toLowerCase();
    const d = this.status["gcode_macro _AUTO_EJECT_DEFAULTS"];
    const ov = this.status["gcode_macro _AUTO_EJECT_OVERRIDES"];
    if (!(key in d)) throw new Error("AUTO_EJECT_SET: unknown setting '" + key + "'");
    const sv = this.status.save_variables.variables;
    if (p.RESET === "1") {
      const keep = Object.assign({}, ov.data);
      delete keep[key];
      ov.data = keep;
      delete sv["auto_eject_" + key];
      this.say("// AUTO_EJECT: " + key + " is back to the value in auto_eject_settings.cfg");
    } else {
      const raw = String(p.VALUE == null ? "" : p.VALUE).trim();
      const cur = this.settings()[key];
      if (!M.validSettingText(raw)) throw new Error("AUTO_EJECT_SET: '" + raw + "' is not a valid value for " + key);
      const num = /^-?\d+(\.\d*)?$/.test(raw);
      let v;
      if (typeof cur === "boolean") {
        if (!["1", "0", "true", "false", "yes", "no", "on", "off"].includes(raw.toLowerCase()))
          throw new Error("AUTO_EJECT_SET: " + key + " is on or off (true or false), not '" + raw + "'");
        v = ["1", "true", "yes", "on"].includes(raw.toLowerCase());
      } else if (num) v = parseFloat(raw);
      else if (typeof cur === "number") throw new Error("AUTO_EJECT_SET: " + key + " needs a number, not '" + raw + "'");
      else v = raw;
      ov.data = Object.assign({}, ov.data, { [key]: v });
      sv["auto_eject_" + key] = v;
      this.say("// AUTO_EJECT: " + key + " = " + (v === true ? "True" : v === false ? "False" : v) + " (kept after a restart)");
    }
    this.touch("gcode_macro _AUTO_EJECT_OVERRIDES");
    this.touch("save_variables");
  };

  /* ------------------------------------------------------------ G-code */

  Demo.prototype.runGcode = async function (script) {
    const line = script.trim();
    this.say("$ " + line);
    const [cmd, ...rest] = line.split(/\s+/);
    const params = {};
    for (const a of rest) { const i = a.indexOf("="); if (i > 0) params[a.slice(0, i).toUpperCase()] = a.slice(i + 1); }
    const busy = this.status.idle_timeout.state === "Printing";
    switch (cmd.toUpperCase()) {
      case "AUTO_EJECT":
        if (busy) throw new Error("AUTO_EJECT: the printer is busy");
        if (this.status["gcode_macro _AUTO_EJECT_STATE"].bg) throw new Error("AUTO_EJECT: the bed is already cooling before its eject. AUTO_EJECT_PUSH_NOW pushes at once.");
        return this.autoEject(params);
      case "AUTO_EJECT_PUSH_NOW": {
        const st = this.status["gcode_macro _AUTO_EJECT_STATE"];
        if (!(st.bg && st.cooling)) throw new Error("AUTO_EJECT_PUSH_NOW: no eject is waiting for the bed to cool");
        this.state({ push_now: true });
        this.say("// AUTO_EJECT: pushing once this cooling step ends, in a few seconds");
        return;
      }
      case "AUTO_EJECT_CLEAR": {
        const bg = this.status["gcode_macro _AUTO_EJECT_STATE"].bg;
        if (bg) this.state({ bg: false, cooling: false, push_now: false, busy: false });
        this.state({ objects: [], height: 0, leftover: [] });
        this.setParts([]);
        this.say("// AUTO_EJECT: stored parts forgotten, the bed is treated as clear");
        // taken off while the bed cooled: the queue waits for AUTO_EJECT_CONTINUE
        if (bg) this.say("// AUTO_EJECT: the cooling stopped and the job queue waits. Once your hands are out of the printer: AUTO_EJECT_CONTINUE (Bed is clear, continue the queue)");
        else this.nextJobSoon();
        return;
      }
      case "_AUTO_EJECT_TALL_CLEAR":
        await this.runGcode("AUTO_EJECT_CLEAR");
        return this.runGcode("AUTO_EJECT_CONTINUE");
      case "AUTO_EJECT_BIN_EMPTY":
        this.state({ bin: 0 });
        this.say("// AUTO_EJECT: parts box emptied, counting from 0");
        return;
      case "AUTO_EJECT_CONTINUE":
        if (this.status["gcode_macro _AUTO_EJECT_STATE"].bg) {
          throw new Error("AUTO_EJECT_CONTINUE: the bed is still cooling before its eject. Take the parts off and run AUTO_EJECT_CLEAR first, or wait for the eject.");
        }
        this.say("// action:prompt_end");
        this.setParts([]);
        this.queue.state = "ready";
        this.queueChanged("state_changed");
        this.say("// AUTO_EJECT: job queue started");
        this.nextJobSoon();
        return;
      case "AUTO_EJECT_SET":
        // as in Klipper, a command sent during the eject waits for its end
        while (this.status["gcode_macro _AUTO_EJECT_STATE"].busy && !this.status["gcode_macro _AUTO_EJECT_STATE"].bg) await this.sleep(200);
        return this.set(params);
      case "AUTO_EJECT_SETUP": return this.setup(String(params.STEP || "start").toLowerCase(), params.VALUE);
      case "AUTO_EJECT_CALIBRATE": return this.setup("calibrate");
      case "RESPOND":
        if (/prompt_end/.test(line)) this.say("// action:prompt_end");
        return;
      default:
        this.say("// Unknown command in the demo: " + cmd);
    }
  };

  /* -------------------------------------------------------------- motors */

  // The demo printer's motors for the Motors tab: CoreXY belt motors on
  // TMC5160 drivers (they report their load), Z and the extruder on TMC2209.
  const DEMO_MOTORS = {
    "tmc5160 stepper_x": { run: 0.8, base: 135 }, "tmc5160 stepper_y": { run: 0.8, base: 128 },
    "tmc2209 stepper_z": { run: 0.6 }, "tmc2209 stepper_z1": { run: 0.6 }, "tmc2209 extruder": { run: 0.65 }
  };
  Demo.prototype.motorStatus = function (k) {
    const st = this.status;
    const printing = st.print_stats.state === "printing" || st["gcode_macro _AUTO_EJECT_STATE"].busy;
    const t = Date.now() / 1000;
    if (k === "stepper_enable") {
      const on = printing || st.toolhead.homed_axes !== "";
      return { steppers: { stepper_x: on, stepper_y: on, stepper_z: on, stepper_z1: on, extruder: printing } };
    }
    if (/^temperature_sensor motor_/.test(k)) {
      const warm = 26 + (printing ? 20 : 8) + (k.endsWith("_a") ? 3 : 0);
      return { temperature: Math.round((warm + Math.sin(t / 40) * 0.8) * 10) / 10 };
    }
    const m = DEMO_MOTORS[k];
    const out = { run_current: m.run, hold_current: m.run, drv_status: { cs_actual: Math.round(m.run * 20) } };
    const moving = printing && (!k.includes("stepper_z") || Math.sin(t / 7) > 0.9);
    if (!moving) { out.drv_status.stst = 1; return out; }
    if (m.base) {
      // now and then a slow move gives no reading, and a fast corner works the motor hard
      const r = Math.sin(t * 1.7 + m.base) + Math.sin(t * 0.31);
      if (r < -1.2) return out;
      const dip = Math.sin(t / 23 + m.base) > 0.96 ? 0.55 : 0;
      out.drv_status.sg_result = Math.max(4, Math.round(m.base * (1 - dip) + Math.sin(t * 2.3 + m.base) * 18));
    }
    return out;
  };

  // The rest of the demo printer's hardware for the Hardware tab.
  const DEMO_HW = {
    mcu: { chip: "stm32h723xx" }, "mcu toolhead": { chip: "stm32g0b1xx" }, "canbus_stats toolhead": {}, system_stats: {},
    "heater_fan hotend_fan": {}, "controller_fan electronics": {}, fan: {},
    "temperature_sensor board": {}, "temperature_sensor toolhead": {}, "temperature_sensor computer": {}, "temperature_sensor chamber": {},
    "filament_switch_sensor runout": {}, motion_report: {}
  };
  Demo.prototype.hwStatus = function (k) {
    const st = this.status;
    const busy = st.print_stats.state === "printing" || st["gcode_macro _AUTO_EJECT_STATE"].busy;
    const t = Date.now() / 1000, wob = (n) => Math.round((n + Math.sin(t / 25 + n) * 0.6) * 10) / 10;
    const mcu = (chip, awake, sent) => ({ mcu_version: chip === "stm32h723xx" ? this.fwTo || DEMO_MAIN_OLD : KLIPPER_VERSION, mcu_constants: { MCU: chip },
      last_stats: { mcu_awake: awake, srtt: 0.0011, bytes_retransmit: sent, bytes_invalid: 0, freq: 1 } });
    switch (k) {
      case "mcu": return mcu("stm32h723xx", busy ? 0.008 : 0.002, 9);
      case "mcu toolhead": return mcu("stm32g0b1xx", busy ? 0.004 : 0.001, 0);
      case "canbus_stats toolhead": return { rx_error: 0, tx_error: 0, tx_retries: 0, bus_state: "active" };
      case "system_stats": return { sysload: busy ? 0.6 : 0.2, cputime: 120, memavail: 1430000 };
      case "fan": return { speed: busy ? 0.35 : 0, rpm: null };
      case "heater_fan hotend_fan": { const on = st.extruder.temperature > 50; return { speed: on ? 1 : 0, rpm: on ? Math.round(6800 + Math.sin(t) * 120) : 0 }; }
      case "controller_fan electronics": return { speed: busy ? 0.6 : 0, rpm: null };
      case "temperature_sensor board": return { temperature: wob(busy ? 41 : 34) };
      case "temperature_sensor toolhead": return { temperature: wob(busy ? 44 : 31) };
      case "temperature_sensor computer": return { temperature: wob(busy ? 53 : 47) };
      case "temperature_sensor chamber": return { temperature: wob(busy ? 33 : 26), measured_min_temp: 24.1, measured_max_temp: 35.8 };
      case "filament_switch_sensor runout": return { filament_detected: true, enabled: true };
      case "motion_report": return { live_extruder_velocity: st.print_stats.state === "printing" && st.extruder.target > 0 && st.extruder.temperature > st.extruder.target - 5 ? Math.max(0, 2.6 + Math.sin(t * 0.9) * 1.8 + Math.sin(t * 0.23) * 1.2) : 0 };
    }
    return {};
  };

  /* --------------------------------------------------------------- files */

  Demo.prototype.gcodeText = function (name) {
    const f = FILES[name];
    if (!f) return "";
    const out = ["; generated by OrcaSlicer (demo file)", "; max_z_height: " + f.height.toFixed(2), "; layer_height: " + f.layer, ""];
    if (f.labels !== false) {
      for (const [pn, poly] of f.parts) {
        const r = M.recordsFromExcludeObjects([{ name: pn, polygon: poly }])[0];
        out.push("EXCLUDE_OBJECT_DEFINE NAME=" + pn + " CENTER=" + r[5] + "," + r[6] + " POLYGON=" + JSON.stringify(poly));
      }
    }
    out.push("PRINT_START BED=55 EXTRUDER=215", "G1 X10 Y10 Z0.2", "; ... the print ...", "PRINT_END");
    if (f.eject) out.push("AUTO_EJECT HEIGHT=" + f.height.toFixed(2) + " HOME=1");
    out.push("; EXECUTABLE_BLOCK_END", "; CONFIG_BLOCK_START", "; machine_end_gcode = PRINT_END", "; CONFIG_BLOCK_END");
    return out.join("\n");
  };

  // A demo file's metadata, as Moonraker gives it.
  Demo.prototype.fileMeta = function (name) {
    const f = FILES[name], shape = demoShape(name);
    const hm = /_(\d+)h(\d+)?m?/.exec(name);
    const time = f ? f.time : hm ? Number(hm[1]) * 3600 + Number(hm[2] || 0) * 60 : 3000;
    const layer = f ? f.layer : 0.2;
    const stem = name.replace(/\.[^.]+$/, "");
    return { filename: name, object_height: shape.height, layer_height: layer, layer_count: Math.round(shape.height / layer),
      estimated_time: time, filament_weight_total: Math.round((time / 3600) * 13.5 * 10) / 10, filament_total: Math.round((time / 3600) * 4500),
      filament_type: shape.material, nozzle_diameter: 0.4, slicer: "OrcaSlicer", slicer_version: "2.3.0", size: 2000000,
      thumbnails: [32, 300].map((w) => ({ width: w, height: w, size: w * 90, relative_path: ".thumbs/" + stem + "-" + w + "x" + w + ".png" })) };
  };
  // The slicer's picture of a file, drawn here.
  Demo.prototype.thumbFor = function (name) {
    this.thumbs = this.thumbs || {};
    if (!this.thumbs[name]) this.thumbs[name] = "data:image/svg+xml," + encodeURIComponent(thumbSvg(demoShape(name)));
    return this.thumbs[name];
  };
  Demo.prototype.fileUrl = function (path) {
    const m = /\/\.thumbs\/([^/]+)-\d+x\d+\.png$/.exec(decodeURIComponent(path));
    return m ? this.thumbFor(m[1] + ".gcode") : path;
  };

  Demo.prototype.fetchText = function (path) {
    const name = decodeURIComponent(path.replace(/^.*\/server\/files\/gcodes\//, ""));
    if (path.indexOf("/server/files/gcodes/") >= 0) return Promise.resolve(this.gcodeText(name));
    return fetch(path).then((r) => r.text());
  };

  /* ---------------------------------------------------------------- RPC */

  Demo.prototype.github = function (path) {
    const m = /\/compare\/([0-9a-f]+\.\.\.[0-9a-f]+)$/.exec(path);
    const r = m && DEMO_GITHUB[m[1]];
    return r ? new Promise((resolve) => setTimeout(() => resolve(r), 400)) : Promise.reject(new Error("not in the demo"));
  };

  Demo.prototype.gcode = function (script) { return this.call("printer.gcode.script", { script }); };

  Demo.prototype.call = function (method, params) {
    params = params || {};
    const ok = (v) => new Promise((resolve) => setTimeout(() => resolve(v), 60));
    const st = this.status;
    switch (method) {
      case "server.connection.identify": return ok({ connection_id: 1 });
      case "server.info": return ok({ klippy_connected: true, klippy_state: st.webhooks.state, components: ["job_queue", "webcam", "file_manager", "spoolman"], moonraker_version: "demo" });
      case "printer.info": return ok({ state: st.webhooks.state, hostname: "demo-printer", software_version: KLIPPER_VERSION });
      case "machine.update.status": return ok({ busy: false, version_info: DEMO_UPDATES });
      case "printer.objects.list":
        return ok({ objects: Object.keys(st).concat(["gcode_macro AUTO_EJECT", "gcode_macro AUTO_EJECT_SET", "gcode_macro AUTO_EJECT_SETUP", "configfile", "probe"],
          Object.keys(DEMO_MOTORS), Object.keys(DEMO_HW), ["stepper_enable", "temperature_sensor motor_a", "temperature_sensor motor_b"]).filter((o, i, a) => a.indexOf(o) === i) });
      case "printer.objects.query": {
        const out = {};
        for (const k of Object.keys(params.objects || {})) {
          if (k === "configfile") out.configfile = { config: { printer: { kinematics: "corexy" }, probe: { x_offset: "0", y_offset: "0" }, respond: {}, exclude_object: {}, save_variables: {},
                                                               mcu: { serial: "/dev/serial/by-id/usb-Klipper_stm32h723xx_demo-if00" }, "mcu toolhead": { canbus_uuid: "0123456789ab" },
                                                               "temperature_sensor board": { sensor_type: "temperature_mcu" },
                                                               "temperature_sensor toolhead": { sensor_type: "temperature_mcu", sensor_mcu: "toolhead" },
                                                               "temperature_sensor computer": { sensor_type: "temperature_host" },
                                                               "gcode_macro PRINT_START": {}, "gcode_macro PRINT_END": {} },
                                                     settings: { probe: { x_offset: 0, y_offset: 0, z_offset: -0.4 } } };
          else if (DEMO_MOTORS[k] || k === "stepper_enable" || /^temperature_sensor motor_/.test(k)) out[k] = this.motorStatus(k);
          else if (DEMO_HW[k]) out[k] = this.hwStatus(k);
          else if (st[k]) out[k] = JSON.parse(JSON.stringify(st[k]));
        }
        return ok({ status: out, eventtime: Date.now() / 1000 });
      }
      case "printer.objects.subscribe": {
        const out = {};
        for (const k of Object.keys(params.objects || {})) if (st[k]) out[k] = JSON.parse(JSON.stringify(st[k]));
        return ok({ status: out, eventtime: Date.now() / 1000 });
      }
      case "server.config": return ok({ config: { job_queue: { load_on_startup: false, automatic_transition: true, job_transition_delay: 0.01 } } });
      case "server.job_queue.status": return ok({ queued_jobs: this.queue.jobs.slice(), queue_state: this.queue.state });
      case "server.spoolman.status": return ok({ spoolman_connected: true, pending_reports: [], spool_id: this.spoolId });
      case "server.spoolman.get_spool_id": return ok({ spool_id: this.spoolId });
      case "server.spoolman.post_spool_id": {
        this.spoolId = params.spool_id === null || params.spool_id === undefined ? null : Number(params.spool_id);
        setTimeout(() => this.emit("notify_active_spool_set", [{ spool_id: this.spoolId }]), 80);
        return ok({ spool_id: this.spoolId });
      }
      case "server.spoolman.proxy": {
        const one = /^\/v1\/spool\/(\d+)$/.exec(params.path || "");
        const copy = (v) => JSON.parse(JSON.stringify(v));
        if (one) {
          const sp = this.spools.find((x) => x.id === Number(one[1]));
          return ok(sp ? { response: copy(sp), error: null } : { response: null, error: { status_code: 404, message: "No spool with ID " + one[1] } });
        }
        if (/^\/v1\/spool(\?|$)/.test(params.path || "")) return ok({ response: copy(this.spools), error: null });
        return ok({ response: null, error: { status_code: 404, message: "Not found" } });
      }
      case "server.job_queue.post_job": {
        for (const f of params.filenames || []) this.queue.jobs.push(this.newJob(f));
        this.queueChanged("jobs_added");
        this.nextJobSoon();
        return ok({ queued_jobs: this.queue.jobs.slice(), queue_state: this.queue.state });
      }
      case "server.job_queue.delete_job": {
        const ids = params.job_ids || [];
        this.queue.jobs = this.queue.jobs.filter((j) => !ids.includes(j.job_id));
        this.queueChanged("jobs_removed");
        return ok({ queued_jobs: this.queue.jobs.slice(), queue_state: this.queue.state });
      }
      case "server.job_queue.pause": this.queue.state = "paused"; this.queueChanged("state_changed"); return ok({ queued_jobs: this.queue.jobs.slice(), queue_state: "paused" });
      case "server.job_queue.start": this.queue.state = "ready"; this.queueChanged("state_changed"); this.nextJobSoon(); return ok({ queued_jobs: this.queue.jobs.slice(), queue_state: "ready" });
      case "server.files.list":
        return ok(Object.keys(FILES).map((n, i) => ({ path: n, modified: Date.now() / 1000 - i * 86400 - 3600, size: 2000000 + i * 731000, permissions: "rw" })));
      case "server.files.metadata": {
        if (!FILES[params.filename]) return Promise.reject(new Error("not found"));
        return ok(this.fileMeta(params.filename));
      }
      case "server.gcode_store": return ok({ gcode_store: this.log.slice(-(params.count || 100)) });
      case "machine.proc_stats": {
        const busy = st.print_stats.state === "printing";
        const t = Date.now() / 1000;
        return ok({ cpu_temp: 47 + (busy ? 6 : 0) + Math.sin(t / 30), system_uptime: 86400 * 3 + (t % 86400), websocket_connections: 3,
          system_cpu_usage: { cpu: Math.round((busy ? 22 : 8) + Math.sin(t / 5) * 4) }, system_memory: { total: 2017104, available: 1430000, used: 587104 },
          throttled_state: null,
          network: { wlan0: { rx_bytes: 120e6 + t % 1e6, tx_bytes: 40e6, rx_errs: 0, tx_errs: 0, rx_drop: 12, tx_drop: 0 },
                     can0: { rx_bytes: 700123 + (t % 1e5), tx_bytes: 90000, rx_errs: 0, tx_errs: 0, rx_drop: 0, tx_drop: 0 } } });
      }
      case "machine.system_info":
        return ok({ system_info: { cpu_info: { cpu_count: 4, processor: "aarch64", total_memory: 2017104, memory_units: "kB" },
          canbus: { can0: { tx_queue_len: 128, bitrate: 1000000, driver: "gs_usb" } } } });
      case "server.files.get_directory": return ok({ dirs: [], files: [], disk_usage: { total: 30271217664, used: 8239288320, free: 20468293632 } });
      case "server.history.list":
        return ok({ count: 3, jobs: [
          { job_id: "3", filename: "keychains_x12.gcode", status: "completed", start_time: Date.now() / 1000 - 7200 },
          { job_id: "2", filename: "wall_bracket.gcode", status: "klippy_shutdown", start_time: Date.now() / 1000 - 86400 * 2 },
          { job_id: "1", filename: "stencil_logo.gcode", status: "completed", start_time: Date.now() / 1000 - 86400 * 3 }] });
      case "server.webcams.list": return ok({ webcams: [] });
      case "printer.gcode.script":
        return this.runGcode(params.script).then(() => "ok", (e) => {
          if (e.message !== "stopped") this.say("!! " + e.message);
          throw e;
        });
      case "printer.emergency_stop":
        this.gen++;
        st.webhooks = { state: "shutdown", state_message: "Shutdown due to emergency stop (demo)" };
        st.idle_timeout.state = "Ready";
        this.state({ busy: false });
        this.touch("webhooks"); this.touch("idle_timeout");
        this.say("!! Emergency stop");
        this.emit("notify_klippy_shutdown", []);
        return ok("ok");
      case "printer.firmware_restart":
      case "printer.restart":
        st.webhooks = { state: "ready", state_message: "Printer is ready" };
        st.toolhead.homed_axes = "";
        this.touch("webhooks"); this.touch("toolhead");
        setTimeout(() => this.emit("notify_klippy_ready", []), 800);
        return ok("ok");
      default:
        return Promise.reject(new Error("demo: " + method + " is not available"));
    }
  };

  /* --------------------------------------------------------------- farm */

  // A pretend farm for the Farm tab: this demo printer and five others,
  // two more to find when the network is searched.
  const FARM = [
    { id: "f1", spool: { id: 3, name: "Generic PLA Orange", material: "PLA", colour: "#f07f1e", left: 640, full: 1000 }, group: "Shelf A · Vorons", name: "voron-01", host: "192.168.1.21", auto_eject: true, kind: "printing", file: "clips_x12_PLA_1h40m.gcode", time: 6000, at: 0.35, layers: 120,
      stats: { hours: 842.5, jobs: 611, recent: 50, recent_ok: 49, today_ok: 6, today_bad: 0 }, service_every: 500, service_at: 300 },
    { id: "f2", spool: { id: 5, name: "Generic PETG Black", material: "PETG", colour: "#1b1b1b", left: 42, full: 1000 }, group: "Shelf A · Vorons", name: "voron-02", host: "192.168.1.22", auto_eject: true, kind: "leftover", file: "hooks_x8_PETG.gcode", left: ["hook_3"],
      stats: { hours: 1210, jobs: 903, recent: 50, recent_ok: 46, today_ok: 4, today_bad: 1 }, service_every: 1000, service_at: 760 },
    { id: "f3", group: "Shelf B", name: "ender3-s1", host: "192.168.1.30", auto_eject: false, kind: "done", file: "bracket_PETG_2h5m.gcode",
      power: [{ device: "printer", status: "on", locked: false }],
      stats: { hours: 356.2, jobs: 188, recent: 50, recent_ok: 44, today_ok: 2, today_bad: 0 } },
    { id: "f4", spool: { id: 7, name: "Prusament PLA Galaxy Black", material: "PLA", colour: "#3d3d4a", left: 812, full: 1000 }, group: "Shelf B", name: "prusa-mk3s", host: "192.168.1.31", auto_eject: false, kind: "printing", file: "vase_PLA_4h.gcode", time: 14400, at: 0.82, layers: 610,
      stats: { hours: 2034, jobs: 1240, recent: 50, recent_ok: 47, today_ok: 1, today_bad: 1 } },
    { id: "f5", group: "Shelf B", name: "sovol-sv06", host: "192.168.1.33", auto_eject: false, kind: "offline" },
    { id: "f6", group: "Shelf A · Vorons", name: "voron-03", host: "192.168.1.23", auto_eject: true, kind: "bin", bin: 40, bin_cap: 40,
      power: [{ device: "printer", status: "on", locked: true }],
      stats: { hours: 655, jobs: 480, recent: 50, recent_ok: 50, today_ok: 7, today_bad: 0 } },
    { id: "f7", group: "Shelf B", name: "kobra-2", host: "192.168.1.34", auto_eject: false, kind: "off", power: [{ device: "psu", status: "off", locked: true }] }
  ];
  // What each one's Moonraker tells of its versions, as push/farm.py reads them
  const V = (version, remote, behind, type) => ({ version, remote, behind: behind || 0, type: type || "git_repo" });
  const AE_V = "v0.15.0-4", KL_V = "v0.13.0-816", KL_FULL = "v0.13.0-816-gee2c6fb6", MR_V = "v0.11.0-4";
  const FARM_VERSIONS = {
    f1: { updates: { "klipper-auto-eject": V("v0.15.0-1", AE_V, 3), klipper: V(KL_V, KL_V), moonraker: V(MR_V, MR_V), mainsail: V("v2.20.0", "v2.20.0", 0, "web") },
      firmware: { klipper: KL_FULL, boards: [["mcu", KL_FULL], ["mcu EBBCan", KL_FULL]] } },
    f2: { updates: { "klipper-auto-eject": V("v0.15.0-1", AE_V, 3), klipper: V("v0.13.0-809", KL_V, 7), moonraker: V("v0.11.0-2", MR_V, 2), mainsail: V("v2.19.0", "v2.20.0", 0, "web") },
      firmware: { klipper: "v0.13.0-809-gc63b2951", boards: [["mcu", "v0.13.0-800-g9cb99754"], ["mcu EBBCan", "v0.13.0-809-gc63b2951"]] } },
    f3: { updates: { klipper: V("v0.13.0-809", KL_V, 7), moonraker: V(MR_V, MR_V), fluidd: V("v1.34.3", "v1.34.4", 0, "web") },
      firmware: { klipper: "v0.13.0-809-gc63b2951", boards: [["mcu", "v0.12.0-302-g87ac69363"]] } },
    f4: { updates: { klipper: V(KL_V, KL_V), moonraker: V("v0.11.0-2", MR_V, 2), mainsail: V("v2.20.0", "v2.20.0", 0, "web") },
      firmware: { klipper: KL_FULL, boards: [["mcu", KL_FULL]] } },
    f5: { updates: { klipper: V("v0.13.0-790", KL_V, 26), moonraker: V(MR_V, MR_V), mainsail: V("v2.18.1", "v2.20.0", 0, "web") },
      firmware: { klipper: "v0.13.0-790-g1a2b3c4d", boards: [["mcu", "v0.13.0-790-g1a2b3c4d"]] } },
    f6: { updates: { "klipper-auto-eject": V(AE_V, AE_V), klipper: V(KL_V, KL_V), moonraker: V(MR_V, MR_V), mainsail: V("v2.20.0", "v2.20.0", 0, "web") },
      firmware: { klipper: KL_FULL, boards: [["mcu", KL_FULL], ["mcu EBBCan", KL_FULL]] } }
  };
  const FARM_FOUND = [{ host: "192.168.1.40", port: 7125, name: "trident-300", klippy: "ready" },
                      { host: "192.168.1.41", port: 7125, name: "ender5-plus", klippy: "ready" }];

  Demo.prototype.farmLocal = function () {
    const st = this.status, ps = st.print_stats, ae = st["gcode_macro _AUTO_EJECT_STATE"];
    let phase = "idle", reason = "";
    if (st.webhooks.state !== "ready") { phase = "stopped"; reason = "shutdown"; }
    else if (ae.busy) phase = "ejecting";
    else if (ps.state === "printing") phase = "printing";
    else if (ps.state === "paused") { phase = "paused"; reason = "paused"; }
    else if ((ae.leftover || []).length) { phase = "needs"; reason = "leftover"; }
    else if ((ae.objects || []).length) { phase = "needs"; reason = "parts"; }
    else if (this.queue.state === "paused" && this.queue.jobs.length) { phase = "needs"; reason = "queue"; }
    const progress = st.virtual_sdcard.progress || 0;
    const info = ps.info || {};
    return { id: "local", name: this.farmLocalName || "demo-printer", host: "127.0.0.1", group: this.farmLocalGroup === undefined ? "Shelf A · Vorons" : this.farmLocalGroup,
      local: true, auto_eject: true, camera: false,
      phase, reason, state: ps.state, filename: ps.filename, message: phase === "stopped" ? st.webhooks.state_message : ps.message,
      progress, eta: phase === "printing" && progress > 0.01 ? Math.round(ps.print_duration * (1 - progress) / progress) : null,
      layer: info.current_layer, layers: info.total_layer, bed: st.heater_bed.temperature, bed_target: st.heater_bed.target,
      nozzle: st.extruder.temperature, parts: (ae.objects || []).length, leftover: ae.leftover || [],
      jobs: this.queue.jobs.length, queue: this.queue.state,
      stats: { hours: 128.4, jobs: 97, recent: 50, recent_ok: 48, today_ok: 3, today_bad: 0 },
      bin: ae.bin || 0, bin_cap: this.settings().bin_capacity || 0, power: null,
      updates: this.farmLocalUpdates(), firmware: { klipper: this.localKlipper || KLIPPER_VERSION, boards: [["mcu", this.fwTo || DEMO_MAIN_OLD], ["mcu toolhead", KLIPPER_VERSION]] },
      job: this.farmLocalJob || null };
  };
  Demo.prototype.farmLocalUpdates = function () {
    if (!this.localVersions) {
      this.localVersions = {};
      for (const [k, v] of Object.entries(DEMO_UPDATES)) {
        if (k !== "system") this.localVersions[k] = V(v.version, v.remote_version, v.commits_behind_count || (v.commits_behind || []).length, v.configured_type);
      }
    }
    return this.localVersions;
  };
  // An update asked through the farm: one software every two seconds, in the
  // order push/farm.py keeps.
  Demo.prototype.farmUpdate = function (id, names) {
    const local = id === "local";
    const f = local ? null : this.farmList.find((x) => x.id === id);
    if (!local && !f) return Promise.reject(new Error("not found"));
    const card = local ? this.farmLocal() : this.farmCard(f);
    const versions = local ? this.farmLocalUpdates() : f.updates || {};
    names = [].concat(names || []);
    if (!names.length || names.some((n) => !versions[n])) return Promise.reject(new Error(card.name + " has no such software to update"));
    if (["printing", "paused", "ejecting", "stopped", "offline", "off"].includes(card.phase)) return Promise.reject(new Error(card.name + " cannot update now (" + card.phase + ")"));
    const order = { klipper: 1, moonraker: 2, "klipper-auto-eject": 3 };
    names = Array.from(new Set(names)).sort((a, b) => (order[a] || 0) - (order[b] || 0) || a.localeCompare(b));
    const job = { names, done: [], state: "running", error: "", at: Date.now() / 1000 };
    if (local) this.farmLocalJob = job; else f.job = job;
    const step = () => {
      const name = names[job.done.length];
      if (!name) { job.state = "done"; job.at = Date.now() / 1000; return; }
      versions[name].version = versions[name].remote;
      versions[name].behind = 0;
      // the boards stay as they were: further behind the new Klipper
      if (name === "klipper") { if (local) this.localKlipper = KL_FULL; else if (f.firmware) f.firmware.klipper = KL_FULL; }
      job.done.push(name);
      setTimeout(step, 2000);
    };
    setTimeout(step, 2000);
    return new Promise((resolve) => setTimeout(() => resolve({ started: true }), 120));
  };

  Demo.prototype.farmCard = function (f) {
    const now = Date.now() / 1000;
    if (!this.farmStart) this.farmStart = now;
    const base = { id: f.id, name: f.name, host: f.host, group: f.group || "", local: false, auto_eject: f.auto_eject, camera: false,
      page: "http://" + f.host + (f.auto_eject ? "/auto-eject/" : "/"),
      page_remote: f.auto_eject ? "https://" + f.name + ".tail0000.ts.net/auto-eject/" : null, parts: 0, leftover: [], jobs: f.jobs || 0, queue: "ready",
      stats: f.stats || null, power: f.power ? f.power.map((d) => Object.assign({}, d)) : null, spool: f.spool || null,
      auto_off: f.auto_off || 0, auto_off_device: f.auto_off_device || "", bin: f.bin || 0, bin_cap: f.bin_cap || 0,
      service_every: f.service_every || 0,
      service_since: f.service_every && f.stats ? Math.round((f.stats.hours - (f.service_at || 0)) * 10) / 10 : null,
      updates: f.updates || null, firmware: f.firmware || null, job: f.job || null };
    if (f.kind === "offline") return Object.assign(base, { phase: "offline" });
    if (f.kind === "off") return Object.assign(base, { phase: "off" });
    const card = Object.assign(base, { state: "standby", filename: f.file || "", message: "", bed: 23, bed_target: 0, nozzle: 24, progress: 0, eta: null });
    if (f.kind === "printing" && f.once && (now - f.start) * 40 >= f.time) {
      // a copy from the farm queue ends: auto-eject clears the bed, or it waits for someone
      f.once.state = "done";
      f.once = null;
      f.kind = f.auto_eject ? "idle" : "done";
      if (!f.auto_eject) this.farmQ.need_clear.add(f.id);
    }
    if (f.kind === "printing") {
      // a print that runs 40 times faster than a real one, then starts again
      const p = (f.at + (now - (f.start || this.farmStart)) * 40 / f.time) % 1;
      return Object.assign(card, { phase: "printing", reason: "", state: "printing", progress: p, eta: Math.round(f.time * (1 - p)),
        layer: Math.max(1, Math.round(p * f.layers)), layers: f.layers, bed: 60, bed_target: 60, nozzle: 215, jobs: 3 });
    }
    if (f.kind === "leftover") return Object.assign(card, { phase: "needs", reason: "leftover", state: "complete", leftover: f.left, parts: 8, queue: "paused", jobs: 4 });
    if (f.kind === "done") return Object.assign(card, { phase: "needs", reason: "done", state: "complete", progress: 1 });
    if (f.kind === "bin") return Object.assign(card, { phase: "needs", reason: "bin", state: "complete", progress: 1, filename: "" });
    if (f.kind === "paused") {
      const p = Math.min(0.99, ((f.pausedAt || Date.now() / 1000) - (f.start || this.farmStart)) * 40 / f.time + (f.at || 0));
      return Object.assign(card, { phase: "paused", reason: "paused", state: "paused", progress: p, layer: Math.max(1, Math.round(p * f.layers)),
        layers: f.layers, bed: 60, bed_target: 60, nozzle: 205 });
    }
    if (f.kind === "cancelled") return Object.assign(card, { phase: "needs", reason: f.auto_eject ? "parts" : "cancelled", state: "cancelled", parts: f.auto_eject ? 1 : 0 });
    return Object.assign(card, { phase: "idle", reason: "", filename: "" });
  };

  // A pretend printer's settings: this printer's defaults with its own
  // changes; a copy sets only what differs, as the farm does.
  Demo.prototype.farmSettings = function (id, body) {
    const later = (v) => new Promise((resolve) => setTimeout(() => resolve(v), 250));
    const defaults = this.status["gcode_macro _AUTO_EJECT_DEFAULTS"];
    const f = id === "local" ? null : this.farmList.find((x) => x.id === id);
    if (id !== "local" && (!f || !f.auto_eject)) return Promise.reject(new Error("no auto-eject on this printer"));
    if (f && !f.over) f.over = { voron: { cool_temp: 38, push_z: 0.6, push_speed: 2400 } }[f.name.split("-")[0]] || {};
    const values = id === "local" ? this.settings() : Object.assign({}, defaults, f.over);
    const same = (a, b) => typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : a === b;
    if (body === undefined) {
      return later({ settings: { values, changed: Object.keys(defaults).filter((k) => !same(values[k], defaults[k])).sort(), kept: true } });
    }
    if (f && ["ejecting", "offline", "off"].includes(f.kind)) return Promise.reject(new Error(f.name + " cannot take settings now"));
    const out = { changed: [], same: [], skipped: {}, kept: true };
    for (const k of Object.keys(body.values || {}).sort()) {
      if (!(k in defaults)) out.skipped[k] = "unknown";
      else if (same(values[k], body.values[k])) out.same.push(k);
      else if (!M.validSettingText(M.settingArg(body.values[k]))) out.skipped[k] = "file";
      else {
        out.changed.push(k);
        if (f) f.over[k] = body.values[k];
        else this.status["gcode_macro _AUTO_EJECT_OVERRIDES"].data[k] = body.values[k];
      }
    }
    if (!f && out.changed.length) this.touch("gcode_macro _AUTO_EJECT_OVERRIDES");
    return later({ result: out });
  };

  // The farm queue as push/farm.py runs it: each copy to the next free
  // printer of its job, and a pretend print 40 times faster than a real one.
  Demo.prototype.farmQueue = function () {
    if (!this.farmQ) {
      const done = (printer) => ({ printer, state: "done" });
      this.farmQ = { running: true, need_clear: new Set(), jobs: [
        { id: "q1", name: "cookie_cutter_star_PLA.gcode", size: 1834000, copies: 12, printers: ["f1", "f2", "f6"], material: "PLA",
          runs: [done("f1"), done("f2"), done("f6"), done("f1"), done("f2")] },
        { id: "q2", name: "bracket_PETG_2h5m.gcode", size: 4215000, copies: 4, printers: ["f3", "f4"], material: "PETG", runs: [done("f3")] }] };
      this.farmQ.need_clear.add("f3");
    }
    return this.farmQ;
  };
  Demo.prototype.farmQueueView = function () {
    const q = this.farmQueue();
    const now = Date.now() / 1000;
    const cards = {};
    [this.farmLocal()].concat(this.farmList.map((f) => this.farmCard(f))).forEach((c) => { cards[c.id] = c; });
    const busy = new Set();
    q.jobs.forEach((j) => j.runs.forEach((r) => { if (r.state === "printing") busy.add(r.printer); }));
    const count = (j, s) => j.runs.filter((r) => r.state === s).length;
    const left = (j) => Math.max(0, j.copies - count(j, "done") - count(j, "stopped") - count(j, "printing"));
    if (q.running) {
      for (const j of q.jobs) {
        let n = left(j);
        for (const id of j.printers) {
          const f = this.farmList.find((x) => x.id === id);
          const c = cards[id];
          const spool = f && f.spool && f.spool.material;
          if (n <= 0 || !f || !c || busy.has(id) || c.phase !== "idle" || q.need_clear.has(id) || (spool && j.material && spool !== j.material)) continue;
          const run = { printer: id, state: "printing" };
          j.runs.push(run);
          Object.assign(f, { kind: "printing", file: "farm/" + j.name, time: 1800, at: 0, layers: 80, start: now, once: run });
          busy.add(id);
          n -= 1;
        }
      }
    }
    return { running: q.running, need_clear: Array.from(q.need_clear),
      jobs: q.jobs.map((j) => ({ id: j.id, name: j.name, size: j.size, copies: j.copies, printers: j.printers, material: j.material,
        done: count(j, "done"), stopped: count(j, "stopped"), left: left(j), error: "",
        now: j.runs.filter((r) => r.state === "printing").map((r) => ({ printer: r.printer, state: r.state })) })) };
  };
  Demo.prototype.farmQueueAdd = function (body) {
    const q = this.farmQueue();
    if (!/\.(gcode|g|gco|bgcode)$/i.test(body.name || "")) return Promise.reject(new Error("not a G-code file: " + body.name));
    if (!(body.printers || []).length) return Promise.reject(new Error("which printers may print it?"));
    const id = "q" + Date.now().toString(36);
    const m = /(PLA|PETG|ABS|ASA|TPU)/i.exec(body.name);
    q.jobs.push({ id, name: body.name, size: body.size, copies: body.copies, printers: body.printers, material: m ? m[1].toUpperCase() : "", runs: [] });
    return new Promise((resolve) => setTimeout(() => resolve({ added: id }), 400));
  };
  Demo.prototype.farmQueueChange = function (body) {
    const q = this.farmQueue();
    const later = (v) => new Promise((resolve) => setTimeout(() => resolve(v), 120));
    if ("running" in body) { q.running = !!body.running; return later({ saved: true }); }
    if ("cleared" in body) { q.need_clear.delete(body.cleared); return later({ saved: true }); }
    const i = q.jobs.findIndex((j) => j.id === body.id);
    if (i < 0) return Promise.reject(new Error("no such job"));
    const j = q.jobs[i];
    if (body.remove) q.jobs.splice(i, 1);
    else if ("copies" in body) {
      const under = j.runs.filter((r) => r.state !== "failed").length;
      if (!(body.copies >= under && body.copies <= 999)) return Promise.reject(new Error(under + " copies at least: they are made or under way"));
      j.copies = body.copies;
    } else if ("move" in body) {
      const to = Math.max(0, Math.min(q.jobs.length - 1, i + body.move));
      q.jobs.splice(to, 0, q.jobs.splice(i, 1)[0]);
    }
    return later({ saved: true });
  };

  // The board update (push/firmware_job.py), for the demo's Updates tab: the
  // mainboard is behind Klipper, and the button writes it in about ten seconds.
  Demo.prototype.firmware = function (path) {
    const ok = (v) => new Promise((resolve) => setTimeout(() => resolve(v), 120));
    const fail = (msg) => new Promise((resolve, reject) => setTimeout(() => reject(new Error(msg)), 120));
    const job = this.firmwareJob();
    if (path === "/update") {
      if (job && job.state === "running") return fail("The boards are being updated already.");
      const ps = this.status.print_stats.state;
      if (ps === "printing" || ps === "paused") return fail("The printer is " + ps + ".");
      this.fwStarted = Date.now();
      return ok({ started: true });
    }
    const main = this.fwTo || DEMO_MAIN_OLD;
    return ok({
      status: { klipper: KLIPPER_VERSION, rights: { usb: true, host: true }, boards: [
        { name: "mcu", chip: "stm32h723xx", link: "usb", version: main, age: this.fwTo ? "same" : "older", settings: "board", why: "", method: "usb" },
        { name: "toolhead", chip: "stm32g0b1xx", link: "can", version: KLIPPER_VERSION, age: "same", settings: "board", why: "", method: "can" }] },
      job
    });
  };
  Demo.prototype.firmwareJob = function () {
    if (!this.fwStarted) return null;
    const s = (Date.now() - this.fwStarted) / 1000;
    const step = s < 2 ? "checking" : s < 6 ? "building" : s < 10 ? "flashing" : s < 12 ? "starting" : "";
    if (!step) this.fwTo = KLIPPER_VERSION;
    const board = { checking: "waiting", building: "building", flashing: "flashing", starting: "written", "": "done" }[step];
    const lines = ["Klipper is " + KLIPPER_VERSION + ". To build: mcu (" + DEMO_MAIN_OLD + ")"];
    if (s >= 2) lines.push("Building mcu (stm32h723xx, from the settings it reports) ...");
    if (s >= 6) lines.push("  done in 4 s", "", "Klipper stops while these are flashed, in this order:",
      "  1. mcu: over USB with Klipper's flash script", "Flashing mcu ...");
    if (s >= 10) lines.push("  written.", "Klipper is starting ...");
    if (!step) lines.push("  mcu: now " + KLIPPER_VERSION);
    return { state: step ? "running" : "done", step, klipper: KLIPPER_VERSION, message: "", reboot: false, pid: 1,
      started: this.fwStarted / 1000, at: Math.min(Date.now(), this.fwStarted + 12000) / 1000,
      boards: [{ name: "mcu", how: "usb", version: DEMO_MAIN_OLD, state: board, why: "", code: "", now: step ? "" : KLIPPER_VERSION }],
      log: lines.join("\n") + "\n" };
  };

  // What the farm API (push/farm.py) answers, for the demo's Farm tab.
  Demo.prototype.farm = function (path, body) {
    const ok = (v) => new Promise((resolve) => setTimeout(() => resolve(v), 120));
    const fail = (msg) => new Promise((resolve, reject) => setTimeout(() => reject(new Error(msg)), 120));
    if (!this.farmList) {
      this.farmList = FARM.map((f) => Object.assign({}, f, FARM_VERSIONS[f.id] ? JSON.parse(JSON.stringify(FARM_VERSIONS[f.id])) : {}));
      this.farmScan = { running: false, found: [], finished: null };
    }
    if (!this.farmSets) this.farmSets = { "Voron 2.4 350": { values: { cool_temp: 38, push_z: 0.6, push_speed: 2400, verify: true }, from: "voron-01", saved: 0 } };
    if (path === "") return ok({ printers: [this.farmLocal()].concat(this.farmList.map((f) => this.farmCard(f))), scan: this.farmScan,
      settings: { report: this.farmReport || "" },
      sets: Object.keys(this.farmSets).sort().map((n) => Object.assign({ name: n }, this.farmSets[n])), queue: this.farmQueueView() });
    if (path === "/settings") { this.farmReport = body.report || ""; return ok({ saved: true }); }
    if (path === "/queue/upload") return this.farmQueueAdd(body);
    if (path === "/queue") return this.farmQueueChange(body);
    if (path === "/sets") {
      if (!this.farmSets) this.farmSets = {};
      if (body.remove) { const had = body.remove in this.farmSets; delete this.farmSets[body.remove]; return ok({ removed: had }); }
      const name = String(body.name || "").split(/\s+/).filter(Boolean).join(" ");
      if (!name || name.length > 40) return fail("a name of 1 to 40 characters");
      this.farmSets[name] = { values: Object.assign({}, body.values), from: body.from || "", saved: Math.round(Date.now() / 1000) };
      return ok({ saved: true });
    }
    const cs = /^\/([^/]+)\/settings$/.exec(path);
    if (cs) return this.farmSettings(cs[1], body);
    if (path === "/scan") {
      this.farmScan = { running: true, found: [], finished: null };
      setTimeout(() => {
        const have = new Set(this.farmList.map((f) => f.host));
        const skipped = this.farmSkipped || [];
        this.farmScan = { running: false, finished: Date.now() / 1000,
          found: FARM_FOUND.filter((f) => !have.has(f.host)).map((f) => Object.assign({}, f, { skipped: skipped.includes(f.host) })) };
      }, 3500);
      return ok({ started: true });
    }
    if (path === "/printers") {
      if (body.add) {
        const added = [];
        for (const e of body.add) {
          const host = String(e.host || "").split(":")[0];
          if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host)) return fail("not an address: " + e.host);
          if (!e.name && !FARM_FOUND.some((f) => f.host === host)) return fail("no printer answers at " + host);
          if (this.farmList.some((f) => f.host === host)) continue;
          const id = "n" + host.replace(/\D/g, "");
          this.farmList.push({ id, name: e.name || (FARM_FOUND.find((f) => f.host === host) || {}).name || host, host, auto_eject: false, kind: "idle" });
          added.push(id);
        }
        this.farmScan.found = this.farmScan.found.filter((f) => !this.farmList.some((x) => x.host === f.host));
        this.farmSkipped = (this.farmSkipped || []).filter((h) => !this.farmList.some((x) => x.host === h))
          .concat((body.skip || []).map((e) => e.host));
        return ok({ added });
      }
      if (body.remove) { this.farmList = this.farmList.filter((f) => f.id !== body.remove); return ok({ removed: true }); }
      if (body.service_every !== undefined || body.service_done) {
        const f = this.farmList.find((x) => x.id === body.id);
        if (f && body.service_every !== undefined) { f.service_every = body.service_every; f.service_at = f.service_at === undefined ? (f.stats || {}).hours || 0 : f.service_at; }
        if (f && body.service_done) f.service_at = (f.stats || {}).hours || 0;
        return ok({ saved: !!f });
      }
      if (body.auto_off !== undefined) {
        const f = this.farmList.find((x) => x.id === body.id);
        if (f) { f.auto_off = body.auto_off; f.auto_off_device = body.device || ""; }
        return ok({ saved: !!f });
      }
      if (body.group !== undefined) {
        const f = body.id === "local" ? null : this.farmList.find((x) => x.id === body.id);
        if (body.id === "local") this.farmLocalGroup = String(body.group || "").trim();
        else if (f) f.group = String(body.group || "").trim();
        return ok({ saved: true });
      }
      if (body.rename) {
        const f = body.rename === "local" ? null : this.farmList.find((x) => x.id === body.rename);
        if (body.rename === "local") this.farmLocalName = String(body.name || "").trim();
        else if (f) f.name = String(body.name || "").trim() || f.host;
        return ok({ renamed: true });
      }
    }
    // a file's facts for the print dialog, as push/farm.py sends them
    const mt = /^\/([^/]+)\/meta\?file=(.*)$/.exec(path);
    if (mt) {
      const m = this.fileMeta(decodeURIComponent(mt[2]));
      return ok({ meta: Object.assign({}, m, { thumbnails: undefined, thumbs: m.thumbnails.length }) });
    }
    // printing from the farm: the files, start one, send one
    const fl = /^\/([^/]+)\/(files|print|upload)$/.exec(path);
    if (fl) {
      const now = Date.now() / 1000;
      if (fl[1] === "local") {
        if (fl[2] === "files") return ok({ files: Object.keys(FILES).map((n, i) => ({ path: n, size: 2000000 + i * 731000, modified: now - i * 86400 - 3600 })) });
        if (fl[2] === "print") return this.call("server.job_queue.post_job", { filenames: [body.filename], reset: false }).then(() => ({ result: "ok" }));
        return ok({ result: { item: { path: body.name } } });
      }
      const f = this.farmList.find((x) => x.id === fl[1]);
      if (!f) return fail("not found");
      f.files = f.files || ["bracket_PETG_2h5m.gcode", "hooks_x8_PETG.gcode", "phone_stand_PLA_1h20m.gcode", "cable_clips_x20_PLA.gcode"]
        .map((n, i) => ({ path: n, size: 900000 + i * 410000, modified: now - (i + 1) * 5400 }));
      if (fl[2] === "files") return ok({ files: f.files.slice().sort((a, b) => b.modified - a.modified) });
      const free = f.kind === "idle";
      if (fl[2] === "upload") {
        if (body.print && !free) return fail(f.name + " cannot start a print now");
        f.files.push({ path: body.name, size: body.size || 0, modified: now });
      } else if (!free) return fail(f.name + " cannot start a print now");
      if (fl[2] === "print" || body.print) {
        Object.assign(f, { kind: "printing", file: fl[2] === "print" ? body.filename : body.name, time: 4800, at: 0, layers: 160, start: now });
      }
      return ok({ result: "ok" });
    }
    // the production report: from each pretend printer's statistics
    const rep = /^\/report\?period=(today|7|30)$/.exec(path);
    if (rep) {
      const days = rep[1] === "today" ? 1 : Number(rep[1]);
      const rows = [this.farmLocal()].concat(this.farmList.map((f) => this.farmCard(f))).map((p, i) => {
        if (p.phase === "offline") return { id: p.id, name: p.name, group: p.group, error: "not answering" };
        const s = p.stats || { today_ok: 3, today_bad: 0 };
        const done = rep[1] === "today" ? s.today_ok : Math.round((s.today_ok + 4) * days * (0.8 + (i % 3) * 0.1));
        const stopped = rep[1] === "today" ? s.today_bad : Math.round(days * ((i % 4) === 0 ? 0.4 : 0.15));
        const jobs = done + stopped;
        const hours = Math.round(jobs * (1.2 + (i % 5) * 0.3) * 10) / 10;
        return { id: p.id, name: p.name, group: p.group, jobs, ok: done, stopped, rate: jobs ? Math.round(100 * done / jobs) : null,
          hours, grams: Math.round(hours * 26), top: [] };
      });
      const good = rows.filter((r) => !r.error);
      const sum = (k) => good.reduce((a, r) => a + r[k], 0);
      const total = { jobs: sum("jobs"), ok: sum("ok"), stopped: sum("stopped"), hours: Math.round(sum("hours") * 10) / 10, grams: sum("grams") };
      total.rate = total.jobs ? Math.round(100 * total.ok / total.jobs) : null;
      return ok({ period: rep[1], since: 0, printers: rows, total });
    }
    const up = /^\/([^/]+)\/update$/.exec(path);
    if (up) return this.farmUpdate(up[1], body.names || body.name);
    const pw = /^\/([^/]+)\/power$/.exec(path);
    if (pw) {
      const f = this.farmList.find((x) => x.id === pw[1]);
      const d = f && (f.power || []).find((x) => x.device === body.device);
      if (!d) return fail("no power device " + body.device);
      if (body.action === "off" && f.kind === "printing") return fail("the printer is busy");
      d.status = body.action;
      if (body.action === "off") f.kind = "off";
      else if (f.kind === "off") f.kind = "idle";
      return ok({ result: { [d.device]: d.status } });
    }
    const m = /^\/([^/]+)\/(continue|clear|estop|bin_empty|pause|resume|cancel)$/.exec(path);
    if (m) {
      if (m[1] === "local") {
        if (m[2] === "estop") return this.call("printer.emergency_stop").then((r) => ({ result: r }));
        if (m[2] === "continue") return this.call("server.job_queue.start").then((r) => ({ result: r }));
        if (m[2] === "bin_empty") return this.gcode("AUTO_EJECT_BIN_EMPTY").then((r) => ({ result: r }));
        if (["pause", "resume", "cancel"].includes(m[2])) return ok({ result: "ok" });
        return this.gcode("AUTO_EJECT_CLEAR").then((r) => ({ result: r }));
      }
      const f = this.farmList.find((x) => x.id === m[1]);
      if (!f) return fail("not found");
      if (m[2] === "clear") { f.kind = "idle"; if (this.farmQ) this.farmQ.need_clear.delete(f.id); }
      if (m[2] === "bin_empty") { f.kind = "idle"; f.bin = 0; }
      if (m[2] === "pause" && f.kind === "printing") { f.kind = "paused"; f.pausedAt = Date.now() / 1000; }
      if (m[2] === "resume" && f.kind === "paused") { f.kind = "printing"; f.start = (f.start || this.farmStart) + (Date.now() / 1000 - f.pausedAt); }
      if (m[2] === "cancel") f.kind = "cancelled";
      if (m[2] === "estop") f.kind = "offline";
      if (m[2] === "continue") { f.kind = "printing"; f.file = f.file || "next_job.gcode"; f.time = 5400; f.at = 0; f.layers = 90; f.start = Date.now() / 1000; }
      return ok({ result: "ok" });
    }
    return fail("not found");
  };

  root.AEDemo = Demo;
})(window);
