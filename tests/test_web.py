"""The web page (web/): its logic must match the macros it shows.

The page draws the push lanes and checks files with web/model.js. These
tests run that code under Node and compare it with what the macros do in
the simulator, so the page never shows a plan the printer would not run.
"""

import json
import pathlib
import re
import shutil
import subprocess

import pytest

from klipper_sim import MacroError, Printer, rect

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="Node.js is not installed")


def js(fn, *args):
    out = subprocess.run([NODE, str(ROOT / "tests" / "web_runner.js")],
                         input=json.dumps({"fn": fn, "args": list(args)}),
                         capture_output=True, text=True, check=True, encoding="utf-8")
    return json.loads(out.stdout)


def merged(p):
    st = p.status
    s = dict(st["gcode_macro _AUTO_EJECT_DEFAULTS"])
    s.update(st["gcode_macro _AUTO_EJECT_SETTINGS"])
    s.update(st["gcode_macro _AUTO_EJECT_OVERRIDES"]["data"])
    return s


def dry_run_starts(p):
    """Start point of every push in a dry run: the move before each pause."""
    lines = p.execute("AUTO_EJECT", DRY=1)
    pause = "G4 P%d" % merged(p)["dry_pause"]
    starts = []
    for i, line in enumerate(lines):
        if line == pause:
            w = dict(re.findall(r"([XY])(-?[0-9.]+)", lines[i - 1]))
            starts.append((float(w["X"]), float(w["Y"])))
    return starts


LAYOUTS = {
    "grid": [("a", rect(60, 60, 100, 100)), ("b", rect(150, 70, 200, 120)),
             ("c", rect(250, 60, 290, 110)), ("d", rect(70, 220, 120, 270)),
             ("e", rect(180, 240, 230, 300))],
    "one": [("solo", rect(200, 180, 260, 230))],
    "edge": [("near_far", rect(100, 395, 150, 440)), ("x", rect(300, 20, 340, 60))],
    "spread": [("p%d" % i, rect(30 + i * 50, 40 + (i % 3) * 120, 60 + i * 50, 90 + (i % 3) * 120))
               for i in range(7)],
}


@needs_node
@pytest.mark.parametrize("direction", ["front", "back", "left", "right"])
@pytest.mark.parametrize("strategy", ["columns", "full_width", "objects"])
@pytest.mark.parametrize("layout", sorted(LAYOUTS))
def test_push_lanes_match_the_macro(direction, strategy, layout):
    if strategy == "objects" and layout in ("grid", "spread"):
        pytest.skip("parts stand in each other's way: the macro refuses")
    p = Printer(extra_settings={"direction": direction, "strategy": strategy,
                                "blade_width": 70.0, "blade_offset": 35.0})
    p.set_objects(LAYOUTS[layout])
    starts = dry_run_starts(p)
    th = p.status["toolhead"]
    plan = js("planPushes", p.status["gcode_macro _AUTO_EJECT_STATE"]["objects"], merged(p),
              list(th["axis_minimum"]), list(th["axis_maximum"]))
    got = [(round(q["x0"], 3), round(q["y0"], 3)) for q in plan["pushes"]]
    assert got == pytest.approx(starts, abs=0.002)
    assert plan["strategy"] == strategy


@needs_node
def test_page_finds_the_part_the_blade_cannot_get_behind():
    p = Printer()
    p.set_objects(LAYOUTS["edge"])
    p.execute("AUTO_EJECT", DRY=1)
    th = p.status["toolhead"]
    plan = js("planPushes", p.status["gcode_macro _AUTO_EJECT_STATE"]["objects"], merged(p),
              list(th["axis_minimum"]), list(th["axis_maximum"]))
    assert plan["clamped"]
    far = [q for q in plan["pushes"] if q["clamped"]]
    assert far and "near_far" in far[0]["parts"]
    # and the macro refuses the real thing
    with pytest.raises(MacroError, match="too close to the far edge"):
        p.execute("AUTO_EJECT", COOL=0)


@needs_node
def test_objects_strategy_conflict_is_reported_like_the_macro():
    p = Printer(extra_settings={"strategy": "objects"})
    p.set_objects([("front", rect(100, 50, 150, 100)), ("behind", rect(110, 130, 160, 170))])
    with pytest.raises(MacroError, match="sits where the blade must come down"):
        p.execute("AUTO_EJECT", DRY=1)
    th = p.status["toolhead"]
    plan = js("planPushes", p.status["gcode_macro _AUTO_EJECT_STATE"]["objects"], merged(p),
              list(th["axis_minimum"]), list(th["axis_maximum"]))
    assert plan["conflict"] == ["behind", "front"]


# ------------------------------------------------------------------ settings
@needs_node
def test_every_setting_is_described():
    text = (ROOT / "config" / "auto_eject_settings.cfg").read_text(encoding="utf-8")
    sections = js("parseSettingsTemplate", text)
    items = {i["key"]: i for s in sections for i in s["items"]}
    defaults = Printer().status["gcode_macro _AUTO_EJECT_DEFAULTS"]
    assert set(items) == set(defaults)
    en = lang_keys("en")
    for key, it in items.items():
        assert it["desc"] or ("set." + key) in en, key
        assert it["def"] == defaults[key], key


@needs_node
def test_choices_come_from_the_settings_file():
    text = (ROOT / "config" / "auto_eject_settings.cfg").read_text(encoding="utf-8")
    items = {i["key"]: i for s in js("parseSettingsTemplate", text) for i in s["items"]}
    choices = {k: [c["value"] for c in v["choices"]] for k, v in items.items() if v["choices"]}
    assert choices["direction"] == ["front", "back", "left", "right"]
    assert choices["strategy"] == ["columns", "objects", "full_width"]
    assert choices["cool_mode"] == ["temperature", "time", "none"]
    assert choices["no_objects_action"] == ["skip", "full_width", "error"]
    # free text, not a list
    for key in ("current_steppers", "blade_lift", "push_end", "verify_probe_gcode"):
        assert key not in choices
    for key, values in choices.items():
        assert items[key]["def"] in values, key


@needs_node
def test_merge_marks_where_each_value_comes_from():
    out = js("mergeSettings", {"a": 1, "b": 2, "c": 3}, {"a": 1, "b": 5, "c": 3}, {"c": 9})
    assert out["values"] == {"a": 1, "b": 5, "c": 9}
    assert out["source"] == {"a": "default", "b": "file", "c": "saved"}


@needs_node
@pytest.mark.parametrize("names, labels", [
    # OrcaSlicer: one model copied around the plate
    (["CUTTERS.STL_10_ID_8_COPY_0", "CUTTERS.STL_1_ID_5_COPY_0", "CUTTERS.STL_2_ID_1_COPY_0"],
     ["10_ID_8", "1_ID_5", "2_ID_1"]),
    (["cube.stl_id_0_copy_0", "cube.stl_id_0_copy_1"], ["0", "1"]),
    # whole words only: PART_1 is not a prefix of PART_12
    (["PART_10", "PART_12"], ["10", "12"]),
    (["cube", "bracket"], ["cube", "bracket"]),
    (["only_one"], ["only_one"]),
    (["twin", "twin"], ["twin", "twin"]),
])
def test_bed_map_labels_keep_what_differs(names, labels):
    assert js("shortNames", names) == labels


# ----------------------------------------------------------------- file check
GCODE_HEAD = """; generated by OrcaSlicer
; max_z_height: 15.50
EXCLUDE_OBJECT_DEFINE NAME=star CENTER=100,120 POLYGON=[[80,100],[120,100],[120,140],[80,140]]
EXCLUDE_OBJECT_DEFINE NAME=ring CENTER=200,120 POLYGON=[[180,100],[220,100],[220,140],[180,140]]
PRINT_START
"""
GCODE_TAIL = """G1 X10 Y10
PRINT_END
M84
AUTO_EJECT HEIGHT=15.50 HOME=1 ; clear the bed
; EXECUTABLE_BLOCK_END
; CONFIG_BLOCK_START
; machine_end_gcode = PRINT_END\\nAUTO_EJECT HEIGHT=[max_layer_z] HOME=1
; CONFIG_BLOCK_END
"""


def check(head, tail, meta=None, **settings):
    p = Printer(extra_settings=settings)
    th = p.status["toolhead"]
    return js("checkFile", head, tail, meta or {}, merged(p), list(th["axis_minimum"]), list(th["axis_maximum"]))


@needs_node
def test_check_a_good_file():
    r = check(GCODE_HEAD, GCODE_TAIL)
    assert r["verdict"] == "ok"
    assert [o["name"] for o in r["objects"]] == ["star", "ring"]
    assert r["height"] == 15.5
    assert r["command"] == "AUTO_EJECT HEIGHT=15.50 HOME=1"


@needs_node
def test_auto_eject_before_the_end_macro_is_flagged():
    # the end macro's retract would fail on the nozzle AUTO_EJECT let cool
    tail = GCODE_TAIL.replace("PRINT_END\nM84\nAUTO_EJECT HEIGHT=15.50 HOME=1 ; clear the bed\n",
                              "AUTO_EJECT HEIGHT=[max_layer_z]\n; printing object ENDGCODE\nDEMON_END\n")
    r = check(GCODE_HEAD, tail)
    order = [c for c in r["checks"] if c["key"] == "check.line_order"]
    assert order and order[0]["vars"]["macro"] == "DEMON_END"
    assert r["verdict"] == "warn"


@needs_node
def test_auto_eject_only_in_the_config_block_does_not_count():
    tail = GCODE_TAIL.replace("AUTO_EJECT HEIGHT=15.50 HOME=1 ; clear the bed\n", "")
    r = check(GCODE_HEAD, tail)
    assert r["command"] is None
    assert r["verdict"] == "warn"


@needs_node
def test_check_unlabelled_and_thin_files():
    r = check("; max_z_height: 80\nPRINT_START\n", GCODE_TAIL)
    assert r["verdict"] == "bad"
    assert any(c["key"] == "check.labels_bad" for c in r["checks"])
    r = check(GCODE_HEAD.replace("15.50", "0.48"), GCODE_TAIL)
    assert r["thin"] and r["verdict"] == "warn"
    # metadata from Moonraker wins over the file header
    r = check(GCODE_HEAD, GCODE_TAIL, {"object_height": 1.2})
    assert r["thin"]


# --------------------------------------------------------------------- dialogs
@needs_node
def test_page_shows_the_real_setup_dialog():
    p = Printer()
    p.set_machine(probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.4})
    lines = p.execute("AUTO_EJECT_SETUP")
    console = []
    for line in lines:
        m = re.match(r'RESPOND TYPE=command MSG="(.*)"$', line)
        if m:
            console.append("// " + m.group(1))
    out = js("prompt", console)
    assert out["events"][-1] == "show"
    dialog = out["shown"]
    assert dialog["title"].startswith("Auto-eject setup")
    buttons = [b for it in dialog["items"] if it["type"] == "buttons" for b in it["buttons"]] + dialog["footer"]
    assert any(b["gcode"].startswith("AUTO_EJECT_SETUP STEP=") for b in buttons)
    assert all(b["label"] for b in buttons)


# ------------------------------------------------------------------- languages
def lang_keys(code):
    text = (WEB / "lang" / (code + ".js")).read_text(encoding="utf-8")
    return dict(re.findall(r'^\s*"([a-z0-9_.]+)":\s*"((?:[^"\\]|\\.)*)"', text, re.M))


def test_arabic_has_every_text():
    en, ar = lang_keys("en"), lang_keys("ar")
    assert len(en) > 150
    assert sorted(set(en) - set(ar)) == []
    for key in en:
        assert set(re.findall(r"\{\w+\}", en[key])) == set(re.findall(r"\{\w+\}", ar[key])), key


@needs_node
@pytest.mark.parametrize("name", ["app.js", "demo.js", "model.js", "moonraker.js", "sw.js", "lang/en.js", "lang/ar.js"])
def test_scripts_parse(name):
    subprocess.run([NODE, "--check", str(WEB / name)], check=True)


def test_page_loads_only_local_files():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    for src in re.findall(r'(?:src|href)="([^"#]+)"', html):
        if src.startswith("data:") or src == "/":
            continue
        assert "://" not in src, src
        assert (WEB / src.split("?")[0]).exists(), src
    for code in ("en", "ar"):
        assert 'src="lang/%s.js"' % code in html


def test_page_only_sends_known_commands():
    """Everything the page runs is a documented macro or a dialog button."""
    app = (WEB / "app.js").read_text(encoding="utf-8")
    sent = set(re.findall(r'gcode\(\s*(?:homed\(\) \? )?"([A-Z_]+)', app))
    sent |= set(re.findall(r'"(AUTO_EJECT[A-Z_]*)', app))
    known = {"AUTO_EJECT", "AUTO_EJECT_SET", "AUTO_EJECT_SETUP", "AUTO_EJECT_CALIBRATE",
             "AUTO_EJECT_CLEAR", "AUTO_EJECT_CONTINUE", "AUTO_EJECT_NOTIFY_TEST", "RESPOND",
             "AUTO_EJECT_GUARD",            # only shown, to paste into the slicer
             "AUTO_EJECT_BIN_EMPTY"}
    assert sent <= known, sent - known
    macros = Printer().macros
    for name in known - {"RESPOND"}:
        assert name in macros, name


# ------------------------------------------------------------- the app (PWA)
def png_size(path):
    data = path.read_bytes()
    assert data[:8] == bytes.fromhex("89504e470d0a1a0a"), path
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def test_manifest_makes_an_installable_app():
    m = json.loads((WEB / "manifest.json").read_text(encoding="utf-8"))
    assert m["name"] and m["short_name"] and m["display"] == "standalone"
    assert m["start_url"] == "./" and m["scope"] == "./"
    sizes = set()
    for icon in m["icons"]:
        path = WEB / icon["src"]
        assert path.exists(), icon["src"]
        if icon["type"] == "image/png":
            w, h = png_size(path)
            assert "%dx%d" % (w, h) == icon["sizes"], icon["src"]
            sizes.add((w, icon["purpose"]))
    assert (192, "any") in sizes and (512, "any") in sizes and (512, "maskable") in sizes
    assert png_size(WEB / "icons" / "apple-touch-icon.png") == (180, 180)


def test_service_worker_caches_files_that_exist():
    sw = (WEB / "sw.js").read_text(encoding="utf-8")
    shell = re.findall(r'"([^"]+)"', sw[sw.index("const SHELL"):sw.index("];")])
    assert "index.html" in shell and "app.js" in shell
    for name in shell:
        if name != "./":
            assert (WEB / name).exists(), name
    # the farm's live answers and camera pictures are never kept
    assert 'url.pathname.startsWith(API)' in sw and 'ROOT + "api/"' in sw


def test_page_is_an_app_only_where_browsers_allow_it():
    app = (WEB / "app.js").read_text(encoding="utf-8")
    assert 'navigator.serviceWorker.register("sw.js")' in app
    assert "window.isSecureContext && !DEMO" in app        # not in the demo, not over plain HTTP
    html = (WEB / "index.html").read_text(encoding="utf-8")
    assert 'rel="manifest" href="manifest.json"' in html
    assert "viewport-fit=cover" in html                   # room for notches


def test_every_section_has_a_short_label_for_the_phone_tab_bar():
    en = (WEB / "lang" / "en.js").read_text(encoding="utf-8")
    for view in ("overview", "farm", "queue", "check", "setup", "settings", "hardware", "activity", "guide"):
        assert '"navs.%s"' % view in en, view


# -------------------------------------------------------------- notifications
@needs_node
@pytest.mark.parametrize("line, kind", [
    ("!! AUTO_EJECT: 'cube' is STILL ON THE BED after 2 retries. Stopping so the next job does not start.", "stuck"),
    ("!! AUTO_EJECT_GUARD: stencil still on the bed, 0.4 mm tall, too thin for the blade.", "guard"),
    ("!! AUTO_EJECT_GUARD: 1 part(s) from an earlier print may still be on the bed, and this probe cannot check", "guard"),
    ("// AUTO_EJECT: the parts are only 0.5 mm tall (min_part_height 2.0), too thin to push.", "thin"),
    ("// AUTO_EJECT: the print ended and 3 part(s) are still on the bed. Take them off.", "left"),
    ("// AUTO_EJECT: bed verified clear (15 probe points)", None),
    ("// AUTO_EJECT: re-homing X and Y", None),
])
def test_which_messages_notify_the_phone(line, kind):
    out = js("noticeFor", line)
    assert (out or {}).get("kind") == kind
    if out:
        assert not out["text"].startswith(("!!", "//"))


@needs_node
def test_the_ntfy_topic_comes_from_moonrakers_config():
    conf = {"notifier auto_eject": {"url": "ntfys://auto-eject-1a2b?click=https://x/auto-eject/&priority=high"}}
    assert js("ntfyTopic", conf) == "auto-eject-1a2b"
    assert js("ntfyTopic", {"notifier auto_eject": {"url": "ntfys://tk_x@ntfy.example.com/alerts"}}) == "alerts"
    assert js("ntfyTopic", {"notifier telegram": {"url": "tgram://a/b"}}) == ""


# ------------------------------------------------------------------- the farm
def card(name, phase, reason="", **kw):
    return dict({"name": name, "phase": phase, "reason": reason, "eta": None, "jobs": 0, "queue": "ready"}, **kw)


@needs_node
def test_farm_shows_who_needs_you_first():
    printers = [card("e", "idle"), card("d", "printing", eta=900), card("c", "offline"), card("b", "needs", "done"),
                card("a", "printing", eta=60), card("f", "stopped"), card("g", "printing")]
    assert [p["name"] for p in js("farmOrder", printers)] == ["b", "f", "a", "d", "g", "e", "c"]
    assert js("farmCounts", printers) == {"needs": 2, "printing": 3, "idle": 1, "off": 0, "offline": 1}
    assert js("farmCounts", [card("x", "off")])["off"] == 1
    assert [p["name"] for p in js("farmOrder", [card("o", "offline"), card("s", "off"), card("i", "idle")])] == ["i", "s", "o"]
    assert js("farmOrder", [card("printer 10", "idle"), card("printer 9", "idle")])[0]["name"] == "printer 9"


@needs_node
@pytest.mark.parametrize("p, actions", [
    (card("a", "needs", "done"), ["clear"]),
    (card("a", "needs", "leftover", queue="paused", jobs=3), ["clear"]),     # the bed first, then the queue
    (card("a", "needs", "queue", queue="paused", jobs=3), ["continue", "print"]),
    (card("a", "idle", queue="paused", jobs=2), ["continue", "print"]),
    (card("a", "idle", queue="paused", jobs=0), ["print"]),
    (card("a", "printing"), ["pause", "cancel", "estop"]),
    (card("a", "paused", "paused"), ["resume", "cancel", "estop"]),
    (card("a", "ejecting"), ["estop"]),
    (card("a", "stopped", "shutdown"), []),
    (card("a", "offline"), []),
    (card("a", "off"), []),
    (card("a", "needs", "bin", queue="paused", jobs=3), ["bin_empty"]),     # the box first, then the queue
])
def test_farm_card_buttons(p, actions):
    assert js("farmActions", p) == actions


def test_farm_api_matches_the_page():
    """The page calls only what push/farm.py answers, through nginx's /auto-eject/api/."""
    app = (WEB / "app.js").read_text(encoding="utf-8")
    assert 'const FARM_API = "../api/farm"' in app
    farm_py = (WEB.parent / "push" / "farm.py").read_text(encoding="utf-8")
    for action in re.findall(r'(clear|continue|estop): \["', app):
        assert '"%s"' % action in farm_py, action
    install = (WEB.parent / "install.sh").read_text(encoding="utf-8")
    assert "location ^~ /auto-eject/api/ {" in install and "proxy_pass http://127.0.0.1:7128/;" in install
    assert 'default=7128' in (WEB.parent / "push" / "auto_eject_push.py").read_text(encoding="utf-8")


@needs_node
def test_farm_today_adds_up_every_printer():
    printers = [card("a", "idle", stats={"hours": 10.4, "today_ok": 3, "today_bad": 1}),
                card("b", "printing", stats={"hours": 20.3, "today_ok": 2, "today_bad": 0}),
                card("c", "offline")]
    assert js("farmToday", printers) == {"ok": 5, "bad": 1, "hours": 31}


# ---------------------------------------------------------------- the slicer
@needs_node
def test_the_end_macro_comes_from_the_printers_macros():
    voron = {"gcode_macro _CUSTOM_PRE_END": {}, "gcode_macro Z_ASCENDER": {}, "gcode_macro DEMON_END": {},
             "gcode_macro _AUTO_EJECT_FINISH": {}, "gcode_macro PRINT_START": {}, "probe": {}}
    assert js("endMacros", voron) == ["DEMON_END"]
    both = {"gcode_macro end_print": {}, "gcode_macro PRINT_END": {}, "gcode_macro PRINT_FINISH_BEEP": {}}
    assert js("endMacros", both) == ["PRINT_END", "END_PRINT", "PRINT_FINISH_BEEP"]
    assert js("endMacros", {}) == []


@needs_node
def test_the_end_macro_a_file_runs():
    tail = "G1 X10\nDEMON_END ; the end macro\nAUTO_EJECT HEIGHT=12 HOME=1\n; PRINT_END is only a comment here\n"
    assert js("endMacroInFile", tail, ["DEMON_END", "PRINT_END"]) == "DEMON_END"
    assert js("endMacroInFile", "G1 X1\nM84\n", ["PRINT_END"]) is None


@needs_node
@pytest.mark.parametrize("name, kind", [("OrcaSlicer", "orca"), ("BambuStudio", "orca"), ("PrusaSlicer", "prusa"),
                                        ("SuperSlicer", "prusa"), ("Cura_SteamEngine", "cura"), ("", None), (None, None)])
def test_which_slicer_wrote_a_file(name, kind):
    assert js("slicerKind", name) == kind


@needs_node
def test_the_end_gcode_to_paste_matches_the_docs():
    assert js("slicerEndGcode", "orca", "DEMON_END") == "DEMON_END\nAUTO_EJECT HEIGHT=[max_layer_z] HOME=1"
    assert js("slicerEndGcode", "cura", "PRINT_END") == "PRINT_END\nAUTO_EJECT HOME=1"
    assert js("slicerEndGcode", "prusa", None) == "AUTO_EJECT HEIGHT=[max_layer_z] HOME=1"
    docs = (WEB.parent / "docs" / "slicer-setup.md").read_text(encoding="utf-8")
    assert "PRINT_END\nAUTO_EJECT HEIGHT=[max_layer_z] HOME=1" in docs
    assert "PRINT_END\nAUTO_EJECT HOME=1" in docs                       # Cura


@needs_node
@pytest.mark.parametrize("line", [
    "// AUTO_EJECT: the parts box is almost full (24 of 30 parts).",
    "// AUTO_EJECT: the parts box is full (30 of 30 parts). Empty it, then run AUTO_EJECT_BIN_EMPTY.",
    "!! AUTO_EJECT_GUARD: the parts box is full (30 of 30 parts). Empty it, run AUTO_EJECT_BIN_EMPTY, then start the print again.",
])
def test_the_parts_box_notifies(line):
    assert js("noticeFor", line)["kind"] == "bin"


@needs_node
@pytest.mark.parametrize("hostname, url", [
    ("192.168.1.102", "http://192.168.1.12/"),                      # at home: the local address
    ("farm.tail1234.ts.net", "http://100.70.1.12/"),          # away, through Tailscale
    ("100.70.1.5", "http://100.70.1.12/"),
])
def test_open_goes_through_tailscale_when_away(hostname, url):
    p = {"page": "http://192.168.1.12/", "page_remote": "http://100.70.1.12/"}
    assert js("farmLink", p, hostname) == url
    # without Tailscale on that printer: no link away, its local address would not open
    away = js("farmAway", hostname)
    assert js("farmLink", {"page": "http://192.168.1.30/", "page_remote": None}, hostname) == (None if away else "http://192.168.1.30/")


@needs_node
def test_the_maintenance_chip():
    assert js("farmService", {"service_every": 0, "service_since": None}) is None
    assert js("farmService", {"service_every": 500, "service_since": 120}) == {"since": 120, "every": 500, "due": False, "near": False}
    assert js("farmService", {"service_every": 500, "service_since": 460})["near"] is True
    assert js("farmService", {"service_every": 500, "service_since": 543})["due"] is True


# ------------------------------------------------------ pictures of the prints
THUMBS = [{"width": 300, "height": 300, "relative_path": ".thumbs/part-300x300.png"},
          {"width": 32, "height": 32, "relative_path": ".thumbs/part-32x32.png"},
          {"width": 48, "height": 48}]


@needs_node
def test_the_picture_of_a_file():
    assert js("thumbPick", THUMBS, 96)["width"] == 300
    assert js("thumbPick", THUMBS, 20)["width"] == 32
    assert js("thumbPick", THUMBS, 900)["width"] == 300
    assert js("thumbPick", [], 96) is None and js("thumbPick", None, 96) is None
    assert js("thumbPath", "part.gcode", THUMBS[0]) == "/server/files/gcodes/.thumbs/part-300x300.png"
    assert js("thumbPath", "jobs/my part.gcode", {"relative_path": ".thumbs/my part-32x32.png"}) == \
        "/server/files/gcodes/jobs/.thumbs/my%20part-32x32.png"
    assert js("thumbPath", "part.gcode", {"relative_path": "../moonraker.conf"}) == ""


@needs_node
def test_what_a_files_metadata_tells():
    f = js("fileFacts", {"estimated_time": 4321, "filament_weight_total": 12.5, "filament_total": 4210.0, "object_height": 15.5,
                         "layer_height": 0.2, "layer_count": 78, "nozzle_diameter": 0.4, "filament_type": "PLA;PLA;PETG",
                         "slicer": "OrcaSlicer", "slicer_version": "2.3.0"})
    assert f == {"time": 4321, "grams": 12.5, "metres": 4.2, "height": 15.5, "layer": 0.2, "layers": 78, "nozzle": 0.4,
                 "material": "PLA / PETG", "slicer": "OrcaSlicer 2.3.0"}
    # a slicer that tells nothing, or a file Moonraker could not read
    empty = {"time": None, "grams": None, "metres": None, "height": None, "layer": None, "layers": None, "nozzle": None,
             "material": "", "slicer": ""}
    assert js("fileFacts", {}) == empty and js("fileFacts", None) == empty
    assert js("fileFacts", {"estimated_time": 0, "filament_type": "?"}) == empty


# ----------------------------------------------------------------- the motors
OBJECTS = ["tmc2209 extruder", "tmc5160 stepper_y", "tmc5160 stepper_x", "tmc2209 stepper_z2", "tmc2209 stepper_z",
           "tmc2209 stepper_z1", "temperature_sensor motor_a", "temperature_fan motor_e", "heater_bed", "tmc2240 extruder1"]


@needs_node
def test_every_motor_with_a_tmc_driver_in_axis_order():
    got = js("tmcSteppers", OBJECTS, "corexy")
    assert [(m["title"], m["motor"], m["driver"], m["reportsLoad"]) for m in got] == [
        ("X", "A", "tmc5160", True), ("Y", "B", "tmc5160", True), ("Z", "", "tmc2209", False),
        ("Z1", "", "tmc2209", False), ("Z2", "", "tmc2209", False), ("E", "", "tmc2209", False), ("E1", "", "tmc2240", True)]
    # a bed slinger has no belt motors A and B
    assert {m["motor"] for m in js("tmcSteppers", OBJECTS, "cartesian")} == {""}
    # CoreXZ: the belt motors are X and Z
    assert [m["motor"] for m in js("tmcSteppers", ["tmc2209 stepper_x", "tmc2209 stepper_z"], "corexz")] == ["A", "B"]
    assert js("tmcSteppers", ["heater_bed", "fan"], "corexy") == []


@needs_node
def test_driver_warnings_worst_first():
    assert js("driverFlags", {"cs_actual": 16, "otpw": 1, "ola": 1, "s2ga": 1, "stst": 1}) == [
        {"flag": "s2ga", "level": "bad"}, {"flag": "otpw", "level": "warn"}, {"flag": "ola", "level": "info"}]
    assert js("driverFlags", {"cs_actual": 16, "sg_result": 120}) == []
    assert js("driverFlags", None) == []


@needs_node
def test_the_stallguard_reading_in_short():
    assert js("stallguard", [120, None, 118])["wait"] is True             # too few readings yet
    g = js("stallguard", [120, 118, None, 40, 125, 130, 122, None, 119, 7, 121, 124])
    assert g["wait"] is False and g["now"] == 121 and g["low"] == 7 and g["high"] == 130
    assert g["n"] == 10                                                  # moments without a reading are left out
    assert js("stallguard", None)["wait"] is True


def test_stallguard_raises_no_alarm():
    # it also drops at low speed: only driver warnings and motor temperatures sum the tab up
    app = (WEB / "app.js").read_text(encoding="utf-8")
    assert "sum_load" not in app
    for name in ("en", "ar"):
        assert "motors.sum_load" not in (WEB / "lang" / (name + ".js")).read_text(encoding="utf-8")


@needs_node
def test_a_motors_own_temperature_sensor():
    motors = js("tmcSteppers", OBJECTS, "corexy")
    x, y, e = motors[0], motors[1], motors[5]
    assert js("motorSensor", x, OBJECTS) == "temperature_sensor motor_a"   # the CoreXY name
    assert js("motorSensor", y, OBJECTS) is None
    assert js("motorSensor", e, OBJECTS) == "temperature_fan motor_e"
    assert js("motorSensor", x, ["temperature_sensor stepper_x"]) == "temperature_sensor stepper_x"


# --------------------------------------------------------------- the hardware
HW_OBJECTS = ["gcode", "mcu", "canbus_stats toolboard", "mcu toolboard", "mcu host", "filament_switch_sensor runout",
              "filament_motion_sensor motion", "heaters", "heater_fan hotend_fan", "fan", "heater_bed",
              "temperature_sensor toolboard", "controller_fan electronics", "temperature_fan board_fan",
              "temperature_host host_fan", "temperature_fan host_fan", "extruder", "temperature_sensor chamber"]
HW_CONFIG = {"mcu": {"serial": "/dev/serial/by-id/usb-Klipper_stm32h723xx_X-if00"}, "mcu toolboard": {"canbus_uuid": "0123456789ab"},
             "mcu host": {"serial": "/tmp/klipper_host_mcu"},
             "temperature_sensor toolboard": {"sensor_type": "temperature_mcu", "sensor_mcu": "toolboard"},
             "temperature_fan board_fan": {"sensor_type": "temperature_mcu", "sensor_mcu": "mcu"},
             "temperature_fan host_fan": {"sensor_type": "temperature_host"},
             "temperature_sensor chamber": {"sensor_type": "Generic 3950"}}


@needs_node
def test_the_machines_parts_sorted_into_the_page():
    p = js("hwParts", HW_OBJECTS, HW_CONFIG)
    assert [(m["name"], m["conn"], m["sensor"]) for m in p["mcus"]] == [
        ("mcu", "usb", "temperature_fan board_fan"), ("toolboard", "can", "temperature_sensor toolboard"), ("host", "host", None)]
    assert [c["name"] for c in p["can"]] == ["toolboard"]
    assert sorted(x["kind"] for x in p["heaters"]) == ["extruder", "heater_bed"]
    assert [f["kind"] for f in p["fans"]] == ["heater_fan", "fan", "controller_fan", "temperature_fan", "temperature_fan"]
    # the host sensor inside a temperature fan is not listed twice
    assert [x["obj"] for x in p["sensors"]] == ["temperature_sensor toolboard", "temperature_sensor chamber"]
    assert p["hostSensor"] == "temperature_fan host_fan"
    assert len(p["filament"]) == 2
    # a serial board, and settings in another case than the objects
    q = js("hwParts", ["mcu", "mcu pico"], {"MCU": {"serial": "/dev/ttyAMA0"}, "mcu PICO": {"serial": "/dev/serial/by-id/usb-Klipper_rp2040-if00"}})
    assert [m["conn"] for m in q["mcus"]] == ["uart", "usb"]


@needs_node
def test_a_fan_that_should_turn_and_does_not():
    assert js("fanStopped", {"speed": 1.0, "rpm": 0}) is True
    assert js("fanStopped", {"speed": 1.0, "rpm": 6800}) is False
    assert js("fanStopped", {"speed": 0.1, "rpm": 0}) is False       # too slow to tell
    assert js("fanStopped", {"speed": 1.0, "rpm": None}) is False    # no speed sensor


@needs_node
def test_a_heater_that_cannot_hold_its_target():
    w = js("heaterWatch", None, {"temperature": 25, "target": 220, "power": 1.0}, 0)
    assert w["level"] is None                                        # warming up at full power is normal
    w = js("heaterWatch", w["state"], {"temperature": 219.5, "target": 220, "power": 0.4}, 100)
    assert w["state"]["reached"] is True and w["level"] is None
    w = js("heaterWatch", w["state"], {"temperature": 212, "target": 220, "power": 1.0}, 200)
    assert w["level"] is None                                        # not yet 30 s
    w = js("heaterWatch", w["state"], {"temperature": 211, "target": 220, "power": 1.0}, 235)
    assert (w["level"], w["reason"]) == ("warn", "cant_hold")
    w = js("heaterWatch", w["state"], {"temperature": 25, "target": 0, "power": 0}, 240)
    assert w["level"] is None and w["state"]["reached"] is False     # a new target starts again
    assert js("heaterWatch", None, {"temperature": 250, "target": 220, "power": 0}, 0)["reason"] == "above"


@needs_node
def test_the_computers_warnings():
    assert js("throttleFlags", {"bits": 327685, "flags": ["Under-Voltage Detected", "Previously Under-Volted"]}) == [
        {"flag": "Under-Voltage Detected", "level": "bad"}, {"flag": "Previously Under-Volted", "level": "warn"}]
    assert js("throttleFlags", None) == []
    assert js("hostChecks", {"cpu_temp": 44, "system_memory": {"total": 2000, "available": 1500}}, {"total": 3e10, "free": 2e10}) == []
    got = js("hostChecks", {"cpu_temp": 88, "system_memory": {"total": 2000, "available": 100}}, {"total": 3e10, "free": 5e8})
    assert [(c["key"], c["level"]) for c in got] == [("cpu_hot", "bad"), ("memory_low", "warn"), ("disk_low", "warn")]
    assert js("grew", 9, 12) == 3 and js("grew", 9, 2) == 0 and js("grew", None, 5) == 0


@needs_node
def test_the_flow_through_the_hotend():
    assert round(js("flowRate", 1.0, 1.75), 3) == 2.405          # 1 mm/s of 1.75 mm filament
    assert round(js("flowRate", -5.47, "1.75"), 1) == 13.2         # a retraction counts its speed, the config gives text
    assert round(js("flowRate", 2.0, None), 2) == 4.81             # no diameter: 1.75
    assert round(js("flowRate", 1.0, 2.85), 2) == 6.38


@needs_node
def test_when_the_cooling_pushes_anyway():
    st = {"cooling": True, "cool_start": 1000.0}
    assert js("coolLeft", st, {"cool_mode": "temperature", "cool_timeout": 1800}, 1600.0) == 1200
    assert js("coolLeft", st, {"cool_mode": "time", "cool_time": 600, "cool_timeout": 1800}, 1500.0) == 100
    assert js("coolLeft", st, {"cool_mode": "temperature", "cool_timeout": 1800}, 5000.0) == 0    # due now
    assert js("coolLeft", {"cooling": False, "cool_start": 1000.0}, {"cool_timeout": 1800}, 1600.0) is None
    assert js("coolLeft", st, {"cool_mode": "temperature", "cool_timeout": 0}, 1600.0) is None   # no limit
    assert js("coolLeft", st, {"cool_timeout": 1800}, None) is None                            # no print time yet


@needs_node
def test_the_slicer_card_knows_demon():
    demon = {"gcode_macro DEMON_START": {"gcode": ""}, "gcode_macro DEMON_END": {"gcode": ""},
             "gcode_macro _HARDWARE_VARIABLES": {"variable_shutdown_relay": "False"}}
    assert js("macroSet", demon) == {"name": "demon", "autoOff": False}
    # auto power-off: a relay, and the switch DEMON reads
    demon["gcode_macro _HARDWARE_VARIABLES"]["variable_shutdown_relay"] = "True"
    assert js("macroSet", demon)["autoOff"] is False
    demon["output_pin PRINTER_AUTO_OFF"] = {"pin": "PA0"}
    assert js("macroSet", demon)["autoOff"] is True
    # found by its version macro too, in any case
    assert js("macroSet", {"gcode_macro _demon_version": {}})["name"] == "demon"
    assert js("macroSet", {"gcode_macro PRINT_START": {}, "gcode_macro PRINT_END": {}}) is None
    assert js("macroSet", None) is None
