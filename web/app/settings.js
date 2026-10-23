/* klipper-auto-eject web page. The Settings.
 */

import { aeState, app, client, DEMO, h, has, head, icon, lang, M, num, settings, t } from "./core.js";
import { cleanError, confirm, loadTemplate, refresh, toast } from "../app.js";

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
  cool_timeout: "s", cool_time: "s", min_part_height: "mm", max_part_height: "mm", verify_z: "mm", home_clearance: "mm", home_edge_margin: "mm",
  nozzle_clearance: "mm", nozzle_probe_max_temp: "°C", nozzle_part_max_temp: "°C", purge_height: "mm", purge_start_z: "mm", purge_retract: "mm", purge_gap: "mm",
  purge_edge_margin: "mm", filament_diameter: "mm", blade_lift: "mm", push_end: "mm"
};

function settingRow(it, m) {
  const key = it.key;
  const value = m.values[key];
  const src = m.source[key];
  const edit = settingsUi.edits[key];
  const changed = edit !== undefined && String(edit) !== String(value);
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

export { describeSetting, UNITS, viewSettings };
