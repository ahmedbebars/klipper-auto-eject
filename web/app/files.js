/* klipper-auto-eject web page. The Print queue and Check a file, with the pictures of the prints.
 */

import {
  app, axes, client, DOCS, duration, fmtDate, fmtSize, h, head, icon, iso, lang, M, num, sv, t
} from "./core.js";
import {
  confirm, fileList, loadFiles, loadSpools, meta, refresh, spoolCheck, spoolGrams, spoolTrouble, toast, useSpool
} from "../app.js";
import { bedMap } from "./overview.js";
import { slicerUi } from "./setup.js";

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
      const tall = typeof set.max_part_height === "number" && m.object_height > set.max_part_height;
      badge = thin ? h("span", { class: "badge warn", text: t("queue.badge.thin") })
        : tall ? h("span", { class: "badge warn", text: t("queue.badge.tall") })
        : h("span", { class: "badge ok", text: t("queue.badge.ok") });
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
    : files.length ? fileList(queueUi, "queue", files, "list files pick", (f) => {
        const m = app.meta[f.path];
        const row = fileRow(f, m, m ? thumbSrc(f.path, m, 96) : null, () => { queueUi.file = f.path; refresh("queue"); }, f.path === queueUi.file ? "active" : "");
        if (!m) watch(row);
        return row;
      })
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
  return JSON.stringify([app.hasQueue, app.queue, ps.state, ps.filename, Math.round(((app.status.display_status || {}).progress || 0) * 100), app.autoTransition, (app.files || []).length, Object.keys(app.meta).length, sv().min_part_height, sv().thin_parts_action, sv().max_part_height, queueUi.file, queueUi.filter, queueUi.shown,
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
    : files.length ? fileList(check, "check", files, "list files", (f) => {
        const m = app.meta[f.path];
        const row = fileRow(f, m, m ? thumbSrc(f.path, m, 96) : null, () => runCheck(f.path), f.path === check.file ? "active" : "");
        if (!m) watch(row);
        return row;
      })
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
  return JSON.stringify([(app.files || []).length, app.files === null, check.file, check.loading, check.error, !!check.result, check.filter, check.shown, app.hasQueue,
    !!(check.file && app.meta[check.file])]);
};

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

export { fileRow, fillFileRow, lazyRows, spoolSig, thumbBox, thumbSrc, viewCheck, viewQueue };
