"""Stencils and other prints too thin for the blade are left alone."""

import pytest

from klipper_sim import MacroError, Printer, rect

from test_setup_wizard import buttons

STENCIL = [("stencil", rect(160, 160, 290, 290))]


def make(height=0.48, **settings):
    p = Printer(extra_settings=settings)
    p.set_machine(position=(225, 225, 10), save_variables={},
                  probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3},
                  exclude_object_section=True)
    p.set_section("force_move", {"enable_force_move": True})
    p.set_section("stepper_z", {"endstop_pin": "probe:z_virtual_endstop"})
    p.set_objects(STENCIL)
    p.execute("_AUTO_EJECT_CAPTURE")
    p.status["gcode_macro _AUTO_EJECT_STATE"]["height"] = height
    p.remote_calls.clear()
    return p


def moved(lines):
    return [l for l in lines if l.split()[0] in ("G1", "G28", "PROBE", "M140", "M104",
                                                 "TEMPERATURE_WAIT", "SET_TMC_CURRENT")]


def test_thin_print_is_left_alone():
    p = make(height=0.48)
    lines = p.execute("AUTO_EJECT")
    assert moved(lines) == []                       # no cooling, no motion, no probing
    assert p.remote_calls == ["pause_job_queue"]
    assert p.status["gcode_macro _AUTO_EJECT_STATE"]["objects"] == []
    assert p.status["save_variables"]["variables"]["auto_eject_objects"] == []
    assert any("too thin to push" in m for m in p.messages)


def test_thin_print_shows_a_dialog_that_continues_the_queue():
    p = make()
    lines = p.execute("AUTO_EJECT")
    b = buttons(lines)
    assert b == {"Bed is clear - continue the queue": "AUTO_EJECT_CONTINUE"}
    p.run_gcode(b["Bed is clear - continue the queue"])
    assert p.remote_calls == ["pause_job_queue", "start_job_queue"]
    assert 'MSG="action:prompt_end"' in " ".join(p.executed)


def test_without_queue_pausing():
    p = make(thin_pause_queue=False)
    lines = p.execute("AUTO_EJECT")
    assert p.remote_calls == []
    assert list(buttons(lines)) == ["Bed is clear"]


def test_tall_print_is_ejected_as_usual():
    p = make(height=17.0)
    lines = p.execute("AUTO_EJECT", COOL=0)
    assert any(l.startswith("SET_TMC_CURRENT") for l in lines)
    assert "PROBE" in lines
    assert p.remote_calls == []


def test_unknown_height_is_ejected_as_usual():
    p = make(height=0.0)
    assert "PROBE" in p.execute("AUTO_EJECT", COOL=0)


def test_height_from_the_slicer_wins():
    p = make(height=17.0)
    assert moved(p.execute("AUTO_EJECT", HEIGHT=0.48)) == []
    p = make(height=0.48)
    assert "PROBE" in p.execute("AUTO_EJECT", COOL=0, HEIGHT=17.0)


def test_unfilled_slicer_placeholder_counts_as_unknown():
    p = make(height=0.0)
    assert "PROBE" in p.execute("AUTO_EJECT", COOL=0, HEIGHT="[max_layer_z]")


def test_eject_anyway_when_asked():
    p = make(thin_parts_action="eject")
    assert any(l.startswith("SET_TMC_CURRENT") for l in p.execute("AUTO_EJECT", COOL=0))


def test_turned_off_with_zero():
    p = make(min_part_height=0.0)
    assert "PROBE" in p.execute("AUTO_EJECT", COOL=0)


def test_dry_run_still_traces_the_path():
    p = make()
    lines = p.execute("AUTO_EJECT", DRY=1)
    assert any(l.startswith("G1") for l in lines)
    assert p.remote_calls == []


def test_guard_after_power_loss_stops_instead_of_pushing():
    p = make(guard_action="eject")
    p.status["print_stats"] = {"state": "printing", "filename": "next.gcode",
                               "total_duration": 1.0}
    with pytest.raises(MacroError, match="too thin to push"):
        p.execute("AUTO_EJECT_GUARD")
    assert len(p.status["gcode_macro _AUTO_EJECT_STATE"]["objects"]) == 1


def test_thin_part_left_after_eject_anyway_is_detected():
    # verify_threshold 1.0 would miss a 0.48 mm stencil: the limit follows the height
    p = make(thin_parts_action="eject")
    p.under_probe = 0.48
    with pytest.raises(MacroError, match="STILL ON THE BED"):
        p.execute("AUTO_EJECT", COOL=0)


# ----------------------------------------------------------------- tracker
def start(p, z, info=None):
    p.status["print_stats"] = {"state": "printing", "filename": "stencil.gcode",
                               "total_duration": 60.0, "info": info or {}}
    pos = p.status["toolhead"]["position"]
    p.status["toolhead"]["position"] = pos._replace(z=z)
    p.execute("_AUTO_EJECT_TRACK_STEP")


def test_tracker_ignores_start_gcode_moves():
    p = Printer()
    p.set_machine(save_variables={})
    p.set_objects(STENCIL)
    start(p, 10.0, {"total_layer": 2, "current_layer": None})   # capture
    start(p, 10.0, {"total_layer": 2, "current_layer": None})   # mesh at Z10
    assert p.status["gcode_macro _AUTO_EJECT_STATE"]["height"] == 0.0
    start(p, 0.24, {"total_layer": 2, "current_layer": 1})
    start(p, 0.48, {"total_layer": 2, "current_layer": 2})
    assert p.status["gcode_macro _AUTO_EJECT_STATE"]["height"] == 0.48
    assert p.status["save_variables"]["variables"]["auto_eject_height"] == 0.24


def test_tracker_without_layer_info_tracks_everything():
    p = Printer()
    p.set_machine(save_variables={})
    p.set_objects(STENCIL)
    start(p, 10.0)
    start(p, 10.0)
    assert p.status["gcode_macro _AUTO_EJECT_STATE"]["height"] == 10.0


def test_tracker_ignores_parking_after_the_last_layer():
    p = Printer()
    p.set_machine(save_variables={})
    p.set_objects(STENCIL)
    start(p, 10.0, {"total_layer": 60, "current_layer": None})
    start(p, 11.8, {"total_layer": 60, "current_layer": 59})
    start(p, 55.0, {"total_layer": 60, "current_layer": 60})   # end G-code parks
    assert p.status["gcode_macro _AUTO_EJECT_STATE"]["height"] == 11.8


def test_tracker_ignores_our_own_moves():
    p = Printer()
    p.set_machine(save_variables={})
    p.set_objects(STENCIL)
    start(p, 10.0, {"total_layer": 60, "current_layer": None})
    start(p, 12.0, {"total_layer": 60, "current_layer": 60})
    p.status["gcode_macro _AUTO_EJECT_STATE"]["busy"] = True   # cooling tour
    start(p, 20.0, {"total_layer": 60, "current_layer": 60})
    assert p.status["gcode_macro _AUTO_EJECT_STATE"]["height"] == 12.0


def test_height_from_the_slicer_sets_the_working_height():
    p = make(height=55.0, cool_temp=58)
    p.bed_cooling = 0.1
    lines = p.execute("AUTO_EJECT", HEIGHT=12.0)
    tour = [l for l in lines if l.startswith("G1 Z") and "X" not in l]
    assert "G1 Z20.00 F600" in tour                       # 12 mm + 8 mm gap
    assert p.status["gcode_macro _AUTO_EJECT_STATE"]["busy"] is False
