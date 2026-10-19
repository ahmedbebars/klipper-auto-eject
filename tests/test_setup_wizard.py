import ast
import re
import shlex

import pytest

from klipper_sim import MacroError, Printer

DIALOG_STEPS = ["start", "direction", "surface", "surface_no", "prepare",
                "height", "offset_intro", "offset_blade", "offset_nozzle",
                "width", "edge", "edge_check", "edge_no", "summary", "done"]


def params_of(line):
    """Split 'CMD A=1 B="x y"' the way Klipper does (shlex)."""
    return dict(a.split("=", 1) for a in shlex.split(line.split(None, 1)[1]))


def buttons(lines):
    """{label: gcode} for every prompt button in the output."""
    out = {}
    for line in lines:
        if not line.startswith("RESPOND"):
            continue
        msg = params_of(line).get("MSG", "")
        for kind in ("action:prompt_button ", "action:prompt_footer_button "):
            if msg.startswith(kind):
                label, gcode, _color = msg[len(kind):].split("|")
                out[label] = gcode
    return out


def klipper_value(line):
    """VARIABLE and VALUE parsed exactly like Klipper (shlex + literal_eval)."""
    p = params_of(line)
    return p["VARIABLE"], ast.literal_eval(p["VALUE"])


def apply(printer, lines, macro="_AUTO_EJECT_WIZARD"):
    for line in lines:
        if line.startswith("SET_GCODE_VARIABLE MACRO=%s " % macro):
            var, val = klipper_value(line)
            printer.status["gcode_macro " + macro][var] = val


@pytest.fixture
def p():
    pr = Printer()
    pr.set_machine(save_variables={})
    return pr


def test_dialog_text_is_safe_for_klipper(p):
    # '#' and ';' start comments in Klipper commands, extra quotes break MSG
    for step in DIALOG_STEPS:
        for line in p.render("AUTO_EJECT_SETUP", STEP=step):
            if line.startswith("RESPOND"):
                shlex.split(line)
                assert "#" not in line and ";" not in line, line
                assert line.count('"') == 2, line


def test_needs_respond_section(p):
    del p.status["configfile"]["settings"]["respond"]
    del p.status["configfile"]["config"]["respond"]
    with pytest.raises(MacroError, match=r"\[respond\]"):
        p.render("AUTO_EJECT_SETUP")


def test_empty_exclude_object_section_is_detected(p):
    # regression: [exclude_object] has no options, so it is only in .config
    p.set_machine(save_variables={}, exclude_object_section=True)
    text = " | ".join(p.render("AUTO_EJECT_SETUP"))
    assert "OK - exclude_object is enabled" in text
    assert "MISSING" not in text


def test_start_reports_checks(p):
    lines = p.render("AUTO_EJECT_SETUP")
    text = "\n".join(lines)
    assert "action:prompt_show" in text
    assert "MISSING - add [exclude_object]" in text
    assert "settings will be saved permanently" in text
    assert buttons(lines)["Start"] == "AUTO_EJECT_SETUP STEP=direction"


def test_every_button_targets_a_known_step(p):
    known = set(re.findall(r'step == "([a-z_]+)"', p.macros["AUTO_EJECT_SETUP"]))
    for step in DIALOG_STEPS:
        for label, gcode in buttons(p.render("AUTO_EJECT_SETUP", STEP=step)).items():
            if gcode.startswith("AUTO_EJECT_SETUP"):
                target = dict(a.split("=", 1) for a in gcode.split()[1:])["STEP"]
                assert target in known, (step, label, gcode)


def test_direction_sets_steppers_for_corexy(p):
    apply(p, p.render("AUTO_EJECT_SETUP", STEP="set_direction", VALUE="left"))
    w = p.status["gcode_macro _AUTO_EJECT_WIZARD"]
    assert w["direction"] == "left"
    assert w["steppers"] == "stepper_x,stepper_y"


def test_direction_sets_steppers_for_cartesian_dual_y():
    p = Printer()
    p.set_machine(kinematics="cartesian", driver="tmc2209",
                  steppers=("stepper_x", "stepper_y", "stepper_y1"))
    p.status["configfile"]["settings"]["stepper_y1"] = {}
    apply(p, p.render("AUTO_EJECT_SETUP", STEP="set_direction", VALUE="front"))
    assert p.status["gcode_macro _AUTO_EJECT_WIZARD"]["steppers"] == "stepper_y,stepper_y1"


def test_bad_direction_rejected(p):
    with pytest.raises(MacroError):
        p.render("AUTO_EJECT_SETUP", STEP="set_direction", VALUE="up")


def test_height_shows_position_and_jog_buttons(p):
    p.set_machine(position=(225, 225, 3.4), save_variables={})
    lines = p.render("AUTO_EJECT_SETUP", STEP="height")
    assert any("Current Z: 3.40 mm" in l for l in lines)
    assert buttons(lines)["Z -0.1"] == "_AUTO_EJECT_JOG AXIS=Z DIST=-0.1 NEXT=height"


def test_offset_jog_buttons_move_toward_the_edge(p):
    p.status["gcode_macro _AUTO_EJECT_WIZARD"]["direction"] = "front"
    b = buttons(p.render("AUTO_EJECT_SETUP", STEP="offset_blade"))
    assert b["Toward edge 10"] == "_AUTO_EJECT_JOG AXIS=Y DIST=-10.0 NEXT=offset_blade"
    assert b["Away 10"] == "_AUTO_EJECT_JOG AXIS=Y DIST=10.0 NEXT=offset_blade"


def test_jog_clamps_z_and_returns_to_step(p):
    p.set_machine(position=(225, 225, 0.8), save_variables={})
    lines = p.render("_AUTO_EJECT_JOG", AXIS="Z", DIST="-1", NEXT="height")
    assert "G1 Z0.500 F600" in lines
    assert lines[-1] == "AUTO_EJECT_SETUP STEP=height"


def test_jog_refuses_unhomed(p):
    p.set_machine(homed="", save_variables={})
    with pytest.raises(MacroError, match="not homed"):
        p.render("_AUTO_EJECT_JOG", AXIS="X", DIST="1", NEXT="height")


@pytest.mark.parametrize("direction,blade_pos,nozzle_pos,expected", [
    ("front", 120.0, 95.0, 25.0),
    ("back", 120.0, 142.0, 22.0),
    ("right", 200.0, 218.5, 18.5),
])
def test_blade_offset_measurement(p, direction, blade_pos, nozzle_pos, expected):
    w = p.status["gcode_macro _AUTO_EJECT_WIZARD"]
    w["direction"] = direction
    w["a_blade"] = blade_pos
    pos = [225, 225, 40]
    pos[0 if direction == "right" else 1] = nozzle_pos
    p.set_machine(position=tuple(pos), save_variables={})
    lines = p.render("AUTO_EJECT_SETUP", STEP="save_nozzle")
    apply(p, lines)
    assert w["blade_offset"] == pytest.approx(expected)
    assert lines[-1] == "AUTO_EJECT_SETUP STEP=width"


def test_blade_offset_nonsense_is_rejected(p):
    w = p.status["gcode_macro _AUTO_EJECT_WIZARD"]
    w["direction"] = "front"
    w["a_blade"] = 100.0
    p.set_machine(position=(225, 130, 40), save_variables={})
    assert "Measure again" in buttons(p.render("AUTO_EJECT_SETUP", STEP="save_nozzle"))


def test_current_step_suggests_sixty_percent(p):
    lines = p.render("AUTO_EJECT_SETUP", STEP="current")
    apply(p, lines)
    assert p.status["gcode_macro _AUTO_EJECT_WIZARD"]["push_current"] == pytest.approx(0.48)
    assert lines[-1] == "AUTO_EJECT_SETUP STEP=current VALUE=shown"


def test_save_writes_values_klipper_can_parse(p):
    w = p.status["gcode_macro _AUTO_EJECT_WIZARD"]
    w.update(direction="left", push_z=2.3, blade_offset=24.5, blade_width=90.0)
    lines = p.render("AUTO_EJECT_SETUP", STEP="save")
    saved = dict(klipper_value(l) for l in lines if l.startswith("SAVE_VARIABLE"))
    assert saved["auto_eject_direction"] == "left"
    assert saved["auto_eject_push_z"] == 2.3
    assert saved["auto_eject_blade_width"] == 90.0
    apply(p, lines, "_AUTO_EJECT_SETTINGS")
    assert p.status["gcode_macro _AUTO_EJECT_SETTINGS"]["direction"] == "left"


def test_save_without_save_variables_prints_lines():
    p = Printer()
    lines = p.render("AUTO_EJECT_SETUP", STEP="save")
    assert not [l for l in lines if l.startswith("SAVE_VARIABLE")]
    assert any("variable_blade_offset" in l for l in lines)


def test_saved_values_are_loaded_at_startup(p):
    p.set_machine(save_variables={"auto_eject_direction": "right",
                                  "auto_eject_push_z": 1.8,
                                  "auto_eject_unknown": 5,
                                  "auto_eject_blade_width": None,
                                  "other_macro_var": 3})
    lines = p.render("_AUTO_EJECT_APPLY_SAVED")
    apply(p, lines, "_AUTO_EJECT_SETTINGS")
    s = p.status["gcode_macro _AUTO_EJECT_SETTINGS"]
    assert s["direction"] == "right" and s["push_z"] == 1.8
    assert len(lines) == 2


def test_reset_clears_saved_values(p):
    p.set_machine(save_variables={"auto_eject_push_z": 1.8, "other": 1})
    lines = p.render("AUTO_EJECT_SETUP", STEP="reset")
    assert lines == ["SAVE_VARIABLE VARIABLE=auto_eject_push_z VALUE=None"]
