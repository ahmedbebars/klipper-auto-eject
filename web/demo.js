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
  const PARK = [175, 340, 40];

  // Settings the demo printer's own settings file changes.
  const DEMO_FILE = {
    blade_offset: 62.0, blade_width: 100.0, push_z: 0.8, blade_lift: 2.1,
    push_current: 0.45, cool_temp: 32
  };

  // Used when ../config/auto_eject_settings.cfg cannot be read.
  const FALLBACK_DEFAULTS = {
    strategy: "columns", direction: "front", no_objects_action: "skip", blade_offset: 20.0,
    blade_width: 80.0, column_overlap: 15.0, head_depth: 40.0, side_margin: 5.0, push_z: 1.5,
    blade_lift: "unknown", push_end: "auto", rear_clearance: 10.0, cool_mode: "temperature",
    cool_temp: 32, cool_timeout: 1800, min_part_height: 2.0, thin_parts_action: "ignore",
    verify: true, push_current: 0.5, retries: 1
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
      height: 15.5, layer: 0.2, time: 6900, eject: true,
      parts: [
        ["star_1", star(95, 120, 34)], ["heart_1", heart(175, 120, 34)], ["circle_1", circle(255, 120, 32, 28)],
        ["star_2", star(95, 205, 34)], ["heart_2", heart(175, 205, 34)], ["circle_2", circle(255, 205, 32, 28)]
      ]
    },
    "calibration_cubes_x3.gcode": {
      height: 10.0, layer: 0.2, time: 2700, eject: true,
      parts: [["cube_1", rect(110, 150, 140, 180)], ["cube_2", rect(160, 150, 190, 180)], ["cube_3", rect(210, 150, 240, 180)]]
    },
    "stencil_logo.gcode": {
      height: 0.48, layer: 0.24, time: 1500, eject: true,
      parts: [["stencil", rect(110, 110, 240, 240)]]
    },
    "wall_bracket.gcode": {
      height: 32.0, layer: 0.25, time: 8100, eject: true,
      parts: [["bracket", rect(140, 290, 210, 335)]]
    },
    "keychains_x12.gcode": {
      height: 4.0, layer: 0.2, time: 3300, eject: false,
      parts: (function () {
        const p = [];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++)
          p.push(["tag_" + (r * 4 + c + 1), rect(80 + c * 50, 110 + r * 45, 115 + c * 50, 135 + r * 45)]);
        return p;
      })()
    },
    "vase_no_labels.gcode": { height: 120.0, layer: 0.3, time: 9600, eject: false, parts: [], labels: false }
  };

  /* -------------------------------------------------------------- demo */

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
      "gcode_macro _AUTO_EJECT_STATE": { objects: [], height: 15.5, job: "cookie_cutters_x6.gcode", leftover: [],
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
        this.status["gcode_macro _AUTO_EJECT_OVERRIDES"] = { data: { cool_temp: 32, push_z: 0.8 } };
        this.open = true;
        setInterval(() => this.tick(), 200);
        setTimeout(() => this.emit("open"), 300);
        // ?demo=eject starts clearing the bed by itself
        if (new URLSearchParams(location.search).get("demo") === "eject") {
          setTimeout(() => this.runGcode("AUTO_EJECT").catch(() => {}), 1500);
        }
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
        this.say("// AUTO_EJECT: waiting for the bed to reach " + s.cool_temp + " C, fan over the parts");
        const gap = (st.height || 0) + s.cool_tour_gap;
        await this.moveTo(null, null, gap, 500);
        let guard = 0;
        while (this.status.heater_bed.temperature > s.cool_temp && guard++ < 40) {
          for (const r of st.objects) {
            await this.moveTo(r[5], r[6], null, 350);
            await this.sleep(250);
            if (this.status.heater_bed.temperature <= s.cool_temp) break;
          }
        }
        this.status.fan.speed = 0;
        this.touch("fan");
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
      this.state({ objects: [], height: 0, busy: false });
      this.setParts([]);
      await this.moveTo(PARK[0], PARK[1], PARK[2], 900);
    } finally {
      this.state({ busy: false });
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
      this.touch("print_stats"); this.touch("virtual_sdcard"); this.touch("display_status");
      if (i === 2) { this.capture(); this.state({ job: name, height: 0 }); }
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
        return this.autoEject(params);
      case "AUTO_EJECT_CLEAR":
        this.state({ objects: [], height: 0, leftover: [] });
        this.setParts([]);
        this.say("// AUTO_EJECT: stored parts forgotten, the bed is treated as clear");
        this.nextJobSoon();
        return;
      case "AUTO_EJECT_CONTINUE":
        this.say("// action:prompt_end");
        this.setParts([]);
        this.queue.state = "ready";
        this.queueChanged("state_changed");
        this.say("// AUTO_EJECT: job queue started");
        this.nextJobSoon();
        return;
      case "AUTO_EJECT_SET": return this.set(params);
      case "AUTO_EJECT_SETUP": return this.setup(String(params.STEP || "start").toLowerCase(), params.VALUE);
      case "AUTO_EJECT_CALIBRATE": return this.setup("calibrate");
      case "RESPOND":
        if (/prompt_end/.test(line)) this.say("// action:prompt_end");
        return;
      default:
        this.say("// Unknown command in the demo: " + cmd);
    }
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

  Demo.prototype.fetchText = function (path) {
    const name = decodeURIComponent(path.replace(/^.*\/server\/files\/gcodes\//, ""));
    if (path.indexOf("/server/files/gcodes/") >= 0) return Promise.resolve(this.gcodeText(name));
    return fetch(path).then((r) => r.text());
  };

  /* ---------------------------------------------------------------- RPC */

  Demo.prototype.gcode = function (script) { return this.call("printer.gcode.script", { script }); };

  Demo.prototype.call = function (method, params) {
    params = params || {};
    const ok = (v) => new Promise((resolve) => setTimeout(() => resolve(v), 60));
    const st = this.status;
    switch (method) {
      case "server.connection.identify": return ok({ connection_id: 1 });
      case "server.info": return ok({ klippy_connected: true, klippy_state: st.webhooks.state, components: ["job_queue", "webcam", "file_manager"], moonraker_version: "demo" });
      case "printer.info": return ok({ state: st.webhooks.state, hostname: "demo-printer", software_version: "demo" });
      case "printer.objects.list":
        return ok({ objects: Object.keys(st).concat(["gcode_macro AUTO_EJECT", "gcode_macro AUTO_EJECT_SET", "gcode_macro AUTO_EJECT_SETUP", "configfile", "probe"]) });
      case "printer.objects.query": {
        const out = {};
        for (const k of Object.keys(params.objects || {})) {
          if (k === "configfile") out.configfile = { config: { printer: {}, probe: { x_offset: "0", y_offset: "0" }, respond: {}, exclude_object: {}, save_variables: {} },
                                                     settings: { probe: { x_offset: 0, y_offset: 0, z_offset: -0.4 } } };
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
        const f = FILES[params.filename];
        if (!f) return Promise.reject(new Error("not found"));
        return ok({ filename: params.filename, object_height: f.height, layer_height: f.layer, estimated_time: f.time, slicer: "OrcaSlicer", size: 2000000 });
      }
      case "server.gcode_store": return ok({ gcode_store: this.log.slice(-(params.count || 100)) });
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
    { id: "f1", name: "voron-01", host: "192.168.1.21", auto_eject: true, kind: "printing", file: "clips_x12_PLA_1h40m.gcode", time: 6000, at: 0.35, layers: 120 },
    { id: "f2", name: "voron-02", host: "192.168.1.22", auto_eject: true, kind: "leftover", file: "hooks_x8_PETG.gcode", left: ["hook_3"] },
    { id: "f3", name: "ender3-s1", host: "192.168.1.30", auto_eject: false, kind: "done", file: "bracket_PETG_2h5m.gcode" },
    { id: "f4", name: "prusa-mk3s", host: "192.168.1.31", auto_eject: false, kind: "printing", file: "vase_PLA_4h.gcode", time: 14400, at: 0.82, layers: 610 },
    { id: "f5", name: "sovol-sv06", host: "192.168.1.33", auto_eject: false, kind: "offline" }
  ];
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
    return { id: "local", name: this.farmLocalName || "demo-printer", host: "127.0.0.1", local: true, auto_eject: true, camera: false,
      phase, reason, state: ps.state, filename: ps.filename, message: phase === "stopped" ? st.webhooks.state_message : ps.message,
      progress, eta: phase === "printing" && progress > 0.01 ? Math.round(ps.print_duration * (1 - progress) / progress) : null,
      layer: info.current_layer, layers: info.total_layer, bed: st.heater_bed.temperature, bed_target: st.heater_bed.target,
      nozzle: st.extruder.temperature, parts: (ae.objects || []).length, leftover: ae.leftover || [],
      jobs: this.queue.jobs.length, queue: this.queue.state };
  };

  Demo.prototype.farmCard = function (f) {
    const now = Date.now() / 1000;
    if (!this.farmStart) this.farmStart = now;
    const base = { id: f.id, name: f.name, host: f.host, local: false, auto_eject: f.auto_eject, camera: false,
      page: "http://" + f.host + (f.auto_eject ? "/auto-eject/" : "/"), parts: 0, leftover: [], jobs: f.jobs || 0, queue: "ready" };
    if (f.kind === "offline") return Object.assign(base, { phase: "offline" });
    const card = Object.assign(base, { state: "standby", filename: f.file || "", message: "", bed: 23, bed_target: 0, nozzle: 24, progress: 0, eta: null });
    if (f.kind === "printing") {
      // a print that runs 40 times faster than a real one, then starts again
      const p = (f.at + (now - (f.start || this.farmStart)) * 40 / f.time) % 1;
      return Object.assign(card, { phase: "printing", reason: "", state: "printing", progress: p, eta: Math.round(f.time * (1 - p)),
        layer: Math.max(1, Math.round(p * f.layers)), layers: f.layers, bed: 60, bed_target: 60, nozzle: 215, jobs: 3 });
    }
    if (f.kind === "leftover") return Object.assign(card, { phase: "needs", reason: "leftover", state: "complete", leftover: f.left, parts: 8, queue: "paused", jobs: 4 });
    if (f.kind === "done") return Object.assign(card, { phase: "needs", reason: "done", state: "complete", progress: 1 });
    return Object.assign(card, { phase: "idle", reason: "", filename: "" });
  };

  // What the farm API (push/farm.py) answers, for the demo's Farm tab.
  Demo.prototype.farm = function (path, body) {
    const ok = (v) => new Promise((resolve) => setTimeout(() => resolve(v), 120));
    const fail = (msg) => new Promise((resolve, reject) => setTimeout(() => reject(new Error(msg)), 120));
    if (!this.farmList) { this.farmList = FARM.map((f) => Object.assign({}, f)); this.farmScan = { running: false, found: [], finished: null }; }
    if (path === "") return ok({ printers: [this.farmLocal()].concat(this.farmList.map((f) => this.farmCard(f))), scan: this.farmScan });
    if (path === "/scan") {
      this.farmScan = { running: true, found: [], finished: null };
      setTimeout(() => {
        const have = new Set(this.farmList.map((f) => f.host));
        this.farmScan = { running: false, found: FARM_FOUND.filter((f) => !have.has(f.host)), finished: Date.now() / 1000 };
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
        return ok({ added });
      }
      if (body.remove) { this.farmList = this.farmList.filter((f) => f.id !== body.remove); return ok({ removed: true }); }
      if (body.rename) {
        const f = body.rename === "local" ? null : this.farmList.find((x) => x.id === body.rename);
        if (body.rename === "local") this.farmLocalName = String(body.name || "").trim();
        else if (f) f.name = String(body.name || "").trim() || f.host;
        return ok({ renamed: true });
      }
    }
    const m = /^\/([^/]+)\/(continue|clear|estop)$/.exec(path);
    if (m) {
      if (m[1] === "local") {
        if (m[2] === "estop") return this.call("printer.emergency_stop").then((r) => ({ result: r }));
        if (m[2] === "continue") return this.call("server.job_queue.start").then((r) => ({ result: r }));
        return this.gcode("AUTO_EJECT_CLEAR").then((r) => ({ result: r }));
      }
      const f = this.farmList.find((x) => x.id === m[1]);
      if (!f) return fail("not found");
      if (m[2] === "clear") f.kind = "idle";
      if (m[2] === "estop") f.kind = "offline";
      if (m[2] === "continue") { f.kind = "printing"; f.file = f.file || "next_job.gcode"; f.time = 5400; f.at = 0; f.layers = 90; f.start = Date.now() / 1000; }
      return ok({ result: "ok" });
    }
    return fail("not found");
  };

  root.AEDemo = Demo;
})(window);
