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
; EXECUTABLE_BLOCK_END
AUTO_EJECT HEIGHT=15.50 ; clear the bed
PRINT_END
; CONFIG_BLOCK_START
; machine_end_gcode = AUTO_EJECT HEIGHT=[max_layer_z]\\nPRINT_END
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
    assert r["command"] == "AUTO_EJECT HEIGHT=15.50"


@needs_node
def test_auto_eject_only_in_the_config_block_does_not_count():
    tail = GCODE_TAIL.replace("AUTO_EJECT HEIGHT=15.50 ; clear the bed\n", "")
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
@pytest.mark.parametrize("name", ["app.js", "demo.js", "model.js", "moonraker.js", "lang/en.js", "lang/ar.js"])
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
             "AUTO_EJECT_CLEAR", "AUTO_EJECT_CONTINUE", "RESPOND"}
    assert sent <= known, sent - known
    macros = Printer().macros
    for name in known - {"RESPOND"}:
        assert name in macros, name
