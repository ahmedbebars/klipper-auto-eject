"""AUTO_EJECT_GUARD checks the bed itself instead of asking, and the
"parts left on the bed" dialog after a print that was not ejected."""

import pytest

from klipper_sim import MacroError, Printer, rect

from test_setup_wizard import buttons

STENCIL = ("stencil", rect(160, 160, 290, 290))
CUBES = [("cube_a", rect(100, 150, 125, 175)), ("cube_b", rect(300, 200, 325, 225))]


def inside(part, x, y):
    (x0, y0), _, (x1, y1), _ = part[1]
    return x0 <= x <= x1 and y0 <= y <= y1


def make(parts, height, **settings):
    """The printer after a print that was not ejected, then switched off."""
    p = Printer(extra_settings=settings)
    p.set_machine(position=(225, 225, 30), homed="", save_variables={},
                  probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3})
    p.set_section("force_move", {"enable_force_move": True})
    p.set_section("stepper_z", {"endstop_pin": "probe:z_virtual_endstop"})
    p.set_section("bed_mesh", {"mesh_min": [30.0, 30.0], "mesh_max": [420.0, 420.0]})
    p.set_objects(parts)
    p.execute("_AUTO_EJECT_CAPTURE")
    p.status["gcode_macro _AUTO_EJECT_STATE"]["height"] = height
    p.status["extruder"].update(temperature=25.0, target=0.0)
    p.set_objects([("next_print", rect(10, 10, 30, 30))])      # the new file's labels
    return p


def stored(p):
    return p.status["gcode_macro _AUTO_EJECT_STATE"]["objects"]


def test_stencil_with_a_height_that_includes_the_z_hop_is_still_found():
    # 2 layers of 0.2 mm, but the tracker saw 0.7 mm: the z-hop over the top
    p = make([STENCIL], 0.7)
    p.under_probe = lambda x, y: (0.4 if inside(STENCIL, x, y) else 0.0) + 0.02 * (x - 225) / 100
    with pytest.raises(MacroError, match="stencil still on the bed"):
        p.execute("AUTO_EJECT_GUARD")


def test_parts_taken_off_the_print_just_starts():
    p = make([STENCIL], 0.4)
    lines = p.execute("AUTO_EJECT_GUARD")
    assert lines.count("PROBE") >= 4                 # Z home, the bed next to it, 3 points
    assert stored(p) == []
    assert any("the bed is clear" in m for m in p.messages)


def test_stencil_still_there_stops_the_print():
    p = make([STENCIL], 0.4)
    p.under_probe = lambda x, y: 0.4 if inside(STENCIL, x, y) else 0.0
    with pytest.raises(MacroError, match="stencil still on the bed, 0.4 mm tall, too thin"):
        p.execute("AUTO_EJECT_GUARD")
    assert len(stored(p)) == 1                       # checked again at the next start


def test_thin_part_is_compared_with_the_bed_next_to_it():
    # the bed around the stencil sits 0.25 mm higher than where Z was homed:
    # against the probe's zero it would look like a 0.25 mm part
    p = make([STENCIL], 0.4)
    p.under_probe = lambda x, y: 0.25 if 140 <= x <= 310 and 140 <= y <= 310 else 0.0
    p.execute("AUTO_EJECT_GUARD")
    assert stored(p) == []
    # and with the stencil still on that raised bed it is found
    p = make([STENCIL], 0.4)
    p.under_probe = lambda x, y: (0.65 if inside(STENCIL, x, y) else 0.25) if 140 <= x <= 310 and 140 <= y <= 310 else 0.0
    with pytest.raises(MacroError, match="stencil still on the bed"):
        p.execute("AUTO_EJECT_GUARD")


def test_a_purge_line_next_to_the_stencil_does_not_hide_it():
    # a 0.6 mm purge line right behind the stencil, where the first spot
    # next to it is probed: the second spot, on the bare bed, counts
    def bed(x, y, stencil):
        if stencil and inside(STENCIL, x, y):
            return 0.4
        return 0.6 if 140 <= x <= 310 and 292 <= y <= 298 else 0.0
    p = make([STENCIL], 0.4)
    p.under_probe = lambda x, y: bed(x, y, True)
    with pytest.raises(MacroError, match="stencil still on the bed"):
        p.execute("AUTO_EJECT_GUARD")
    p = make([STENCIL], 0.4)
    p.under_probe = lambda x, y: bed(x, y, False)
    p.execute("AUTO_EJECT_GUARD")
    assert stored(p) == []


def test_tall_parts_still_there_are_pushed_off_first():
    p = make(CUBES, 10.0, blade_lift=2.3, retries=0)
    p.under_probe = lambda x, y: 10.0 if any(inside(c, x, y) for c in CUBES) else 0.0
    with pytest.raises(MacroError, match="STILL ON THE BED"):    # the simulator never moves them
        p.execute("AUTO_EJECT_GUARD")
    assert "_AUTO_EJECT_RUN" in p.calls
    assert any("pushing it off first" in m for m in p.messages)


def test_nozzle_cools_to_50_with_the_fan_before_touching_a_part():
    p = make([STENCIL], 0.4)
    p.status["extruder"].update(temperature=120.0)
    lines = p.execute("AUTO_EJECT_GUARD")
    wait = lines.index("TEMPERATURE_WAIT SENSOR=extruder MAXIMUM=50.0")
    assert lines[wait - 1].startswith("M106 S") and lines[wait + 1] == "M107"
    probes = [i for i, l in enumerate(lines) if l == "PROBE"]
    assert probes[0] < wait < probes[1]              # Z home on the sheet may be at 150 C


def test_without_a_probe_that_can_touch_plastic_it_asks():
    p = make([STENCIL], 0.4, probe_type="eddy")
    with pytest.raises(MacroError, match="cannot check for plastic"):
        p.execute("AUTO_EJECT_GUARD")


def test_no_free_spot_to_home_it_asks():
    p = make([("plate", rect(0, 0, 450, 450))], 0.4)
    with pytest.raises(MacroError, match="no spot where the probe"):
        p.execute("AUTO_EJECT_GUARD")


def test_guard_check_never_works_out_a_check_while_moving():
    p = make([STENCIL], 0.4)
    p.moving = True
    p.execute("AUTO_EJECT_GUARD")
    assert [c for c in p.called_while_moving if c in ("_AUTO_EJECT_VERIFY", "_AUTO_EJECT_HOME_Z")] == []


# ------------------------------------------------- after a print that was not ejected
def printed(p, state):
    """Run the tracker through a print of p's labelled parts that ends in state."""
    p.status["print_stats"] = {"state": "printing", "filename": "stencil.gcode",
                               "total_duration": 10.0, "info": {"current_layer": 1, "total_layer": 2}}
    p.execute("_AUTO_EJECT_TRACK_STEP")
    p.status["print_stats"] = {"state": state, "filename": "stencil.gcode", "total_duration": 20.0}
    return p.execute("_AUTO_EJECT_TRACK_STEP")


def fresh():
    p = Printer()
    p.set_machine(save_variables={}, probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3})
    p.set_objects([STENCIL])
    return p


@pytest.mark.parametrize("state", ["complete", "cancelled", "error", "standby"])
def test_parts_left_after_a_print_open_a_dialog(state):
    p = fresh()
    lines = printed(p, state)
    assert any("prompt_begin Auto-eject - parts on the bed" in l for l in lines)
    assert buttons(lines)["Bed is clear"] == "_AUTO_EJECT_LEFT_CLEAR"
    assert p.execute("_AUTO_EJECT_TRACK_STEP") == []          # shown once
    p.execute("_AUTO_EJECT_LEFT_CLEAR")
    assert stored(p) == []


def test_no_dialog_after_an_eject():
    p = fresh()
    p.status["print_stats"] = {"state": "printing", "filename": "stencil.gcode",
                               "total_duration": 10.0, "info": {"current_layer": 1, "total_layer": 2}}
    p.execute("_AUTO_EJECT_TRACK_STEP")
    p.execute("_AUTO_EJECT_CLEAR_STATE")                        # what a successful eject does
    p.status["print_stats"] = {"state": "complete", "filename": "stencil.gcode", "total_duration": 20.0}
    assert p.execute("_AUTO_EJECT_TRACK_STEP") == []


def test_the_next_print_can_show_it_again():
    p = fresh()
    printed(p, "complete")
    p.status["print_stats"] = {"state": "printing", "filename": "other.gcode",
                               "total_duration": 1.0, "info": {"current_layer": 1, "total_layer": 2}}
    p.execute("_AUTO_EJECT_TRACK_STEP")
    assert p.status["gcode_macro _AUTO_EJECT_STATE"]["notified"] is False


# ------------------------------------------------- an eject stopped by an error
def test_an_eject_stopped_by_an_error_says_so_and_keeps_the_parts():
    p = fresh()
    p.status["print_stats"] = {"state": "printing", "filename": "stencil.gcode",
                               "total_duration": 10.0, "info": {"current_layer": 1, "total_layer": 2}}
    p.execute("_AUTO_EJECT_TRACK_STEP")
    p.status["gcode_macro _AUTO_EJECT_STATE"]["busy"] = True     # AUTO_EJECT set it
    # the eject runs in the end G-code: the tracker leaves it alone
    p.execute("_AUTO_EJECT_TRACK_STEP")
    assert not any("an error stopped" in m for m in p.messages)
    assert p.status["gcode_macro _AUTO_EJECT_STATE"]["busy"] is True
    # a probe timed out: the print ended in error with the flag still set
    p.status["print_stats"] = {"state": "error", "filename": "stencil.gcode", "total_duration": 20.0}
    lines = p.execute("_AUTO_EJECT_TRACK_STEP")
    assert any("an error stopped the eject" in m for m in p.messages)
    assert any("prompt_begin Auto-eject - parts on the bed" in l for l in lines)
    st = p.status["gcode_macro _AUTO_EJECT_STATE"]
    assert st["busy"] is False and st["cooling"] is False
    assert len(stored(p)) == 1                                  # still there for the next print's check
    assert p.execute("_AUTO_EJECT_TRACK_STEP") == []            # said once


# DEMON Klipper Essentials stops the printer when DEMON_START has not come a
# few seconds into a print: the guard, before it, must not take that long.
def with_demon(p, slicer_gcode="", hooked=False):
    """A DEMON printer a few seconds into a print; hooked: install.sh --demon
    put AUTO_EJECT_GUARD FROM=DEMON in its _CUSTOM_PRE_START."""
    p.status["gcode_macro DEMON_START"] = {}
    p.status["gcode_macro _CORE_VARS"] = {"slicer_gcode": slicer_gcode, "stage_one_end": False, "gcode_started": False}
    p.status["gcode_macro _CUSTOM_EXPANSION_ACTIVE_LIST"] = {"ceal_master_enable": hooked, "pre_start": hooked}
    if hooked:
        p.set_section("gcode_macro _custom_pre_start", {"gcode": "\nAUTO_EJECT_GUARD FROM=DEMON"})
    p.status["print_stats"] = {"state": "printing", "filename": "next.gcode", "total_duration": 2.0}
    return p


def test_before_demon_start_the_guard_stops_cleanly_instead_of_probing():
    p = with_demon(make([STENCIL], 0.4))
    with pytest.raises(MacroError, match="before DEMON_START.*_CUSTOM_PRE_START"):
        p.execute("AUTO_EJECT_GUARD")
    assert "PROBE" not in p.executed                  # nothing moved: DEMON had no time to stop the printer
    assert len(stored(p)) == 1                         # the parts are still known


def test_in_demons_hook_the_guard_checks_the_bed_as_usual():
    # inside DEMON_START (_CUSTOM_PRE_START), DEMON already knows its start line
    p = with_demon(make([STENCIL], 0.4), slicer_gcode="2.3.9", hooked=True)
    lines = p.execute("AUTO_EJECT_GUARD", FROM="DEMON")
    assert lines.count("PROBE") >= 4 and stored(p) == []
    assert not any("_CUSTOM_PRE_START" in m for m in p.messages)


def test_with_demons_hook_set_up_a_guard_left_in_the_slicer_does_nothing():
    # the first line of an old slicer profile, before DEMON_START: DEMON's hook checks right after
    p = with_demon(make([STENCIL], 0.4), hooked=True)
    assert "PROBE" not in p.execute("AUTO_EJECT_GUARD")
    assert len(stored(p)) == 1                         # checked by the hook in a moment
    assert any("not needed" in m for m in p.messages)


def test_with_demon_an_empty_bed_starts_at_once_but_says_where_the_guard_belongs():
    p = with_demon(make([STENCIL], 0.4))
    p.execute("AUTO_EJECT_CLEAR")
    p.messages.clear()
    assert "PROBE" not in p.execute("AUTO_EJECT_GUARD")
    assert any("with DEMON, run it from DEMON's _CUSTOM_PRE_START" in m for m in p.messages)
