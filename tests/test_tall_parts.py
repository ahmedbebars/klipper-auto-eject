"""Prints taller than the gap under the gantry are left alone: pushing them,
or finding Z with them on the bed, brings the gantry down on them."""

import pytest

from klipper_sim import MacroError, Printer, rect

from test_setup_wizard import apply, buttons, klipper_value

# Four mold boxes 219.6 mm tall, as a printer with a 310 mm bed made them.
# After DEMON_END switched the motors off, HOME=1 picked X=43 Y=71 to find Z,
# 105 mm from the nearest box in X but inside its Y range: the X beam, over
# the whole width of the bed, came down on it.
MOLDS = [("mold_box_part_01_a", rect(176.7, 122.9, 242.6, 251.3)),
         ("mold_box_part_02_a", rect(110.4, 122.9, 174.7, 251.3)),
         ("mold_box_part_01_b", rect(67.4, 158.7, 108.4, 251.3)),
         ("mold_box_part_02_b", rect(147.8, 58.7, 187.1, 151.3))]
CUBE = [("cube", rect(100, 150, 125, 175))]


def make(parts=MOLDS, height=219.6, homed="xyz", **settings):
    p = Printer(extra_settings=settings)
    p.set_machine(axis_min=(0, 0, -2), axis_max=(310, 310, 270), position=(155, 155, 240), save_variables={},
                  probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.925},
                  exclude_object_section=True)
    p.set_section("force_move", {"enable_force_move": True})
    p.set_section("stepper_z", {"endstop_pin": "probe:z_virtual_endstop"})
    p.set_objects(parts)
    p.execute("_AUTO_EJECT_CAPTURE")
    p.status["gcode_macro _AUTO_EJECT_STATE"]["height"] = height
    p.status["toolhead"]["homed_axes"] = homed
    p.remote_calls.clear()
    return p


def state(p):
    return p.status["gcode_macro _AUTO_EJECT_STATE"]


def moved(lines):
    return [l for l in lines if l.split()[0] in ("G1", "G0", "G28", "PROBE", "SET_KINEMATIC_POSITION", "M140", "M104",
                                                 "TEMPERATURE_WAIT", "SET_TMC_CURRENT")]


def test_the_mold_boxes_stay_and_nothing_moves():
    # the end G-code of that print, with the motors off after DEMON_END
    p = make(homed="")
    lines = p.execute("AUTO_EJECT", HEIGHT=219.6, HOME=1)
    assert moved(lines) == []                       # no homing, no probing, no cooling, no push
    assert any("219.6 mm tall, too tall to push (max_part_height 25.0)" in m for m in p.messages)
    assert p.remote_calls == ["pause_job_queue"]
    # kept, so the next print's check knows they may still be there
    assert len(state(p)["objects"]) == 4 and state(p)["height"] == pytest.approx(219.6)
    assert len(p.status["save_variables"]["variables"]["auto_eject_objects"]) == 4


def test_the_dialog_forgets_them_and_continues_the_queue():
    p = make()
    b = buttons(p.execute("AUTO_EJECT", HEIGHT=219.6))
    assert b == {"Bed is clear - continue the queue": "_AUTO_EJECT_TALL_CLEAR"}
    p.run_gcode(b["Bed is clear - continue the queue"])
    assert state(p)["objects"] == []
    assert p.remote_calls == ["pause_job_queue", "start_job_queue"]


def test_without_queue_pausing():
    p = make(thin_pause_queue=False)
    lines = p.execute("AUTO_EJECT", HEIGHT=219.6)
    assert p.remote_calls == [] and list(buttons(lines)) == ["Bed is clear"]


def test_the_phone_is_told():
    p = make(notify="auto_eject")
    p.execute("AUTO_EJECT", HEIGHT=219.6)
    [n] = [kw for method, kw in p.remote_args if method == "notify"]
    assert n["message"].startswith("Auto-eject: the print is 219.6 mm tall, too tall for the blade")


@pytest.mark.parametrize("height", [17.0, 25.0])
def test_parts_the_gantry_passes_over_are_ejected(height):
    p = make(parts=CUBE, height=height)
    lines = p.execute("AUTO_EJECT", COOL=0)
    assert any(l.startswith("SET_TMC_CURRENT") for l in lines) and "PROBE" in lines
    assert p.remote_calls == []


def test_a_printer_with_more_room_under_its_gantry():
    p = make(parts=CUBE, height=60.0, max_part_height=80.0)
    assert any(l.startswith("SET_TMC_CURRENT") for l in p.execute("AUTO_EJECT", COOL=0))


def test_height_from_the_slicer_wins():
    p = make(parts=CUBE, height=10.0)
    assert moved(p.execute("AUTO_EJECT", HEIGHT=40.0)) == []


def test_a_dry_run_moves_above_them():
    p = make()
    lines = p.execute("AUTO_EJECT", DRY=1)
    z = [float(w[1:]) for l in lines if l.startswith("G1") for w in l.split() if w.startswith("Z")]
    assert z and min(z) > 219.6
    assert p.remote_calls == []


def test_the_next_print_does_not_start_on_them():
    for action in ("check", "eject", "error"):
        p = make(homed="", guard_action=action, notify="auto_eject")
        p.status["print_stats"] = {"state": "printing", "filename": "next.gcode", "total_duration": 1.0}
        with pytest.raises(MacroError, match="too tall to push or to check with the probe"):
            p.execute("AUTO_EJECT_GUARD")
        assert "PROBE" not in p.executed and not any(l.startswith("G28") for l in p.executed)
        assert "may still be on the bed" in [kw for m, kw in p.remote_args if m == "notify"][0]["message"]


def test_saved_tall_parts_are_not_pushed():
    p = make()
    with pytest.raises(MacroError, match="too tall to push"):
        p.execute("AUTO_EJECT", HOME=1, SOURCE="saved")


def test_homing_refuses_with_tall_parts_stored():
    p = make(homed="")
    with pytest.raises(MacroError, match="finding Z would bring the gantry down on them"):
        p.execute("_AUTO_EJECT_HOME")
    assert "PROBE" not in p.executed


def test_one_dialog_after_the_print():
    """Not also the one for a print that ended without an eject."""
    p = make()
    state(p).update(objects=[], captured=False)
    p.status["print_stats"] = {"state": "printing", "filename": "molds.gcode", "total_duration": 10.0,
                               "filament_used": 900.0, "info": {"total_layer": 1098, "current_layer": 1098}}
    p.execute("_AUTO_EJECT_TRACK_STEP")
    p.execute("AUTO_EJECT", HEIGHT=219.6)
    p.status["print_stats"].update(state="complete", total_duration=20.0)
    assert not any("prompt_begin" in l for l in p.execute("_AUTO_EJECT_TRACK_STEP"))
    assert len(state(p)["objects"]) == 4


# ------------------------------------------------------------- the setup
@pytest.fixture
def w():
    pr = Printer()
    pr.set_machine(save_variables={})
    return pr


def test_setup_asks_for_it_after_the_current(w):
    apply(w, w.render("AUTO_EJECT_SETUP", STEP="current"))
    assert w.status["gcode_macro _AUTO_EJECT_WIZARD"]["next_step"] == "tall"
    b = buttons(w.render("AUTO_EJECT_SETUP", STEP="tall"))
    assert b["30 mm"] == "AUTO_EJECT_SETUP STEP=pick_tall VALUE=30"
    assert b["+5"] == "AUTO_EJECT_SETUP STEP=set_tall VALUE=30"


def test_setup_saves_it(w):
    apply(w, w.render("AUTO_EJECT_SETUP", STEP="pick_tall", VALUE="40"))
    wiz = w.status["gcode_macro _AUTO_EJECT_WIZARD"]
    assert wiz["max_part_height"] == 40.0 and wiz["next_step"] == "summary"
    saved = dict(klipper_value(l) for l in w.render("AUTO_EJECT_SETUP", STEP="save") if l.startswith("SAVE_VARIABLE"))
    assert saved["auto_eject_max_part_height"] == 40.0


def test_setup_keeps_it_sensible(w):
    apply(w, w.render("AUTO_EJECT_SETUP", STEP="set_tall", VALUE="-5"))
    assert w.status["gcode_macro _AUTO_EJECT_WIZARD"]["max_part_height"] == 5.0
