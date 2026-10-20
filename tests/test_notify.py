"""Messages to a Moonraker [notifier] (notify setting), for the phone."""

import pytest

from klipper_sim import MacroError, Printer, rect

STENCIL = [("stencil", rect(160, 160, 290, 290))]
CUBE = [("cube", rect(100, 150, 125, 175))]


def make(parts, height, **settings):
    p = Printer(extra_settings=settings)
    p.set_machine(position=(225, 225, 10), save_variables={},
                  probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3})
    p.set_section("force_move", {"enable_force_move": True})
    p.set_section("stepper_z", {"endstop_pin": "probe:z_virtual_endstop"})
    p.set_objects(parts)
    p.execute("_AUTO_EJECT_CAPTURE")
    p.status["gcode_macro _AUTO_EJECT_STATE"]["height"] = height
    return p


def notes(p):
    return [kw for method, kw in p.remote_args if method == "notify"]


def test_the_test_command():
    p = Printer()
    p.execute("AUTO_EJECT_NOTIFY_TEST")              # the app's service sees the console line
    assert notes(p) == [] and p.messages == ["AUTO_EJECT: test notification sent"]
    p = Printer(extra_settings={"notify": "auto_eject"})
    p.execute("AUTO_EJECT_NOTIFY_TEST")
    assert notes(p) == [{"name": "auto_eject", "message": "Auto-eject: notifications from your printer work."}]


def test_nothing_is_sent_without_a_notifier():
    p = make(STENCIL, 0.48)
    p.execute("AUTO_EJECT")
    assert notes(p) == []


def test_thin_parts_left_on_the_bed():
    p = make(STENCIL, 0.48, notify="auto_eject")
    p.execute("AUTO_EJECT")
    [n] = notes(p)
    assert n["name"] == "auto_eject"
    assert "0.5 mm tall, too thin for the blade" in n["message"] and "continue the queue" in n["message"]


def test_a_part_still_there_after_the_eject():
    p = make(CUBE, 10.0, notify="auto_eject", retries=0, blade_lift=2.3)
    p.under_probe = 10.0
    with pytest.raises(MacroError, match="STILL ON THE BED"):
        p.execute("AUTO_EJECT", COOL=0)
    [n] = notes(p)
    assert n["message"].startswith("Auto-eject: cube still on the bed after the eject")


def test_the_guard_stopped_a_print():
    p = make(STENCIL, 0.4, notify="auto_eject")
    p.status["toolhead"]["homed_axes"] = ""
    (x0, y0), _, (x1, y1), _ = STENCIL[0][1]
    p.under_probe = lambda x, y: 0.4 if x0 <= x <= x1 and y0 <= y <= y1 else 0.0
    with pytest.raises(MacroError, match="stencil still on the bed"):
        p.execute("AUTO_EJECT_GUARD")
    assert "the print did not start, stencil is still on the bed" in notes(p)[0]["message"]


def test_a_print_that_ended_without_an_eject():
    p = Printer(extra_settings={"notify": "auto_eject"})
    p.set_machine(save_variables={})
    p.set_objects(STENCIL)
    p.status["print_stats"] = {"state": "printing", "filename": "stencil.gcode",
                               "total_duration": 10.0, "info": {"current_layer": 1, "total_layer": 2}}
    p.execute("_AUTO_EJECT_TRACK_STEP")
    p.status["print_stats"] = {"state": "complete", "filename": "stencil.gcode", "total_duration": 20.0}
    p.execute("_AUTO_EJECT_TRACK_STEP")
    assert notes(p) == [{"name": "auto_eject",
                         "message": "Auto-eject: the print ended without an eject, 1 part(s) still on the bed. Take them off."}]
