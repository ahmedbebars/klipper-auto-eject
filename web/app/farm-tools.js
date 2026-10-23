/* klipper-auto-eject web page. The farm's tools: the farm queue, settings for a kind of printer and QR
 * labels.
 */

import { client, DEMO, fmtSize, h, icon, lang, M, num, Q, s, t } from "./core.js";
import { cleanError, confirm, toast } from "../app.js";
import { describeSetting, UNITS } from "./settings.js";
import { closeModal, farm, FARM_API, farmCall, loadFarm, modal } from "./farm.js";

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

export { copySettings, editPrinter, farmQueueCard, qrDialog, queueAdd };
