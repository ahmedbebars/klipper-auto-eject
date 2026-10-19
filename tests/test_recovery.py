"""Object/height persistence, restart recovery, smart homing and the guard."""

import pytest

from klipper_sim import MacroError, Printer, rect, words

PARTS = [("left_cutter", rect(100, 150, 160, 220)),
         ("right_cutter", rect(260, 160, 330, 230))]


@pytest.fixture
def p():
    pr = Printer()
    pr.set_machine(axis_min=(0, 0, -8), axis_max=(450, 450, 400),
                   position=(200, 200, 18), save_variables={},
                   probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3})
    pr.set_section("force_move", {"enable_force_move": True})
    pr.set_section("stepper_z", {"endstop_pin": "probe:z_virtual_endstop"})
    pr.set_objects(PARTS)
    return pr


def state(p):
    return p.status["gcode_macro _AUTO_EJECT_STATE"]


def saved(p):
    return p.status["save_variables"]["variables"]


def restart(p):
    """Klipper restart: macro variables and objects reset, files survive."""
    fresh = Printer()
    for key, value in fresh.status.items():
        if key.startswith("gcode_macro _AUTO_EJECT_STATE"):
            p.status[key] = value
    p.status["exclude_object"] = {"objects": []}
    p.status["toolhead"]["homed_axes"] = ""
    p.execute("_AUTO_EJECT_APPLY_SAVED")


def start_print(p, filename="cutters.gcode", duration=5.0):
    p.status["print_stats"] = {"state": "printing", "filename": filename,
                               "total_duration": duration}


# ------------------------------------------------------------------ capture
def test_capture_stores_compact_records(p):
    p.execute("_AUTO_EJECT_CAPTURE")
    recs = state(p)["objects"]
    assert [r[0] for r in recs] == ["left_cutter", "right_cutter"]
    name, x0, x1, y0, y1, cx, cy, pts = recs[0]
    assert (x0, x1, y0, y1) == (100, 160, 150, 220)
    assert (cx, cy) == (130, 185)
    assert len(pts) == 3
    # verification points are pulled 1 mm inside the outline
    assert all(100 < x < 160 and 150 < y < 220 for x, y in pts)
    assert saved(p)["auto_eject_objects"] == recs


def test_capture_strips_quotes_from_names(p):
    p.set_objects([("santa's \"hat\"", rect(10, 10, 20, 20))])
    p.execute("_AUTO_EJECT_CAPTURE")
    assert state(p)["objects"][0][0] == "santas hat"


def test_capture_without_objects_keeps_state(p):
    p.execute("_AUTO_EJECT_CAPTURE")
    p.set_objects([])
    p.execute("_AUTO_EJECT_CAPTURE")
    assert len(state(p)["objects"]) == 2


# --------------------------------------------------------- clear on success
def test_successful_eject_clears_state(p):
    lines = p.execute("AUTO_EJECT", COOL=0)
    assert lines.count("PROBE") == 6
    assert state(p)["objects"] == []
    assert saved(p)["auto_eject_objects"] == []
    assert saved(p)["auto_eject_height"] == 0.0


def test_failed_verify_keeps_state(p):
    p.under_probe = 17.0            # a part is still there
    with pytest.raises(MacroError, match="STILL ON THE BED"):
        p.execute("AUTO_EJECT", COOL=0)
    assert len(saved(p)["auto_eject_objects"]) == 2


def test_dry_run_keeps_state(p):
    p.execute("AUTO_EJECT", DRY=1)
    assert len(state(p)["objects"]) == 2


# ----------------------------------------------------------------- restart
def test_restart_restores_objects_and_height(p):
    p.execute("_AUTO_EJECT_CAPTURE")
    saved(p)["auto_eject_height"] = 17.4
    restart(p)
    assert len(state(p)["objects"]) == 2
    assert state(p)["height"] == 17.4


def test_safe_travel_height_uses_stored_height(p):
    p.execute("_AUTO_EJECT_CAPTURE")
    state(p)["height"] = 35.0
    p.set_machine(axis_min=(0, 0, -8), axis_max=(450, 450, 400),
                  position=(200, 200, 2), save_variables=saved(p),
                  probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3})
    lines = p.execute("AUTO_EJECT", DRY=1, SOURCE="saved")
    zs = [words(l)["Z"] for l in lines if l.startswith("G1") and "Z" in words(l)]
    assert min(zs) >= 40.0          # stored 35 mm + z_hop 5 mm


# ---------------------------------------------------------------- tracking
def test_tracker_captures_new_job_and_tracks_height(p):
    start_print(p)
    p.execute("_AUTO_EJECT_TRACK_STEP")
    assert state(p)["captured"] is True
    assert len(saved(p)["auto_eject_objects"]) == 2
    for z, expect in [(5.2, 5.2), (5.4, 5.2), (9.0, 9.0)]:
        pos = p.status["toolhead"]["position"]
        p.status["toolhead"]["position"] = pos._replace(z=z)
        p.execute("_AUTO_EJECT_TRACK_STEP")
        assert saved(p)["auto_eject_height"] == expect


def test_tracker_never_overwrites_parts_that_were_not_ejected(p):
    p.execute("_AUTO_EJECT_CAPTURE")                     # old print, never ejected
    p.set_objects([("new_part", rect(10, 10, 30, 30))])  # next print starts
    start_print(p, filename="next.gcode")
    p.execute("_AUTO_EJECT_TRACK_STEP")
    assert [r[0] for r in state(p)["objects"]] == ["left_cutter", "right_cutter"]
    # once the old parts are cleared, the new print is captured
    p.execute("AUTO_EJECT_CLEAR")
    p.execute("_AUTO_EJECT_TRACK_STEP")
    assert [r[0] for r in state(p)["objects"]] == ["new_part"]


def test_tracker_idle_when_not_printing(p):
    p.status["print_stats"] = {"state": "standby", "filename": "", "total_duration": 0}
    assert p.execute("_AUTO_EJECT_TRACK_STEP") == []


# ------------------------------------------------------------------- guard
def test_guard_passes_on_clear_bed(p):
    assert p.execute("AUTO_EJECT_GUARD") == []


def test_guard_stops_print_by_default(p):
    p.execute("_AUTO_EJECT_CAPTURE")
    with pytest.raises(MacroError, match="may still be on the bed"):
        p.execute("AUTO_EJECT_GUARD")


def test_guard_eject_homes_around_parts_and_clears(p):
    p.execute("_AUTO_EJECT_CAPTURE")
    restart(p)                                           # power loss
    p.status["gcode_macro _AUTO_EJECT_SETTINGS"]["guard_action"] = "eject"
    p.set_objects([("new_part", rect(10, 10, 30, 30))])  # new file's labels
    lines = p.execute("AUTO_EJECT_GUARD")
    assert "G28 X Y" in lines
    assert any(l.startswith("SET_KINEMATIC_POSITION") for l in lines)
    assert state(p)["objects"] == []                     # old parts ejected
    assert p.status["toolhead"]["homed_axes"] == "xyz"


# ------------------------------------------------------------- smart home
def test_home_probes_far_from_parts_and_fixes_z(p):
    p.execute("_AUTO_EJECT_CAPTURE")
    restart(p)
    p.frame_shift = 123.0           # Z position is unknown after the restart
    lines = [l for l in p.execute("_AUTO_EJECT_HOME") if not l.startswith("SET_GCODE_VARIABLE")]
    assert lines[0] == "G28 X Y"
    probe_xy = [words(l) for l in lines if l.startswith("G1") and "X" in words(l)][0]
    for _name, x0, x1, y0, y1, *_ in state(p)["objects"]:
        dx = max(x0 - probe_xy["X"], 0, probe_xy["X"] - x1)
        dy = max(y0 - probe_xy["Y"], 0, probe_xy["Y"] - y1)
        assert (dx * dx + dy * dy) ** 0.5 >= 20.0
    assert p.frame_shift == pytest.approx(0.0, abs=1e-3)   # Z is true again


def test_home_without_free_spot_refuses(p):
    p.set_objects([("plate", rect(0, 0, 450, 450))])
    p.execute("_AUTO_EJECT_CAPTURE")
    restart(p)
    with pytest.raises(MacroError, match="no spot where the probe, the nozzle and the blade"):
        p.execute("_AUTO_EJECT_HOME")


def test_home_refuses_with_z_switch(p):
    p.set_section("stepper_z", {"endstop_pin": "^PG10"})
    with pytest.raises(MacroError, match="Z homes with a switch"):
        p.execute("_AUTO_EJECT_HOME")


def test_home_g28_method(p):
    p.status["gcode_macro _AUTO_EJECT_SETTINGS"]["home_method"] = "g28"
    lines = [l for l in p.execute("_AUTO_EJECT_HOME") if not l.startswith("SET_GCODE_VARIABLE")]
    assert lines == ["G28"]


def test_home_needs_force_move(p):
    p.status["configfile"]["settings"]["force_move"] = {"enable_force_move": False}
    with pytest.raises(MacroError, match="force_move"):
        p.execute("_AUTO_EJECT_HOME")


def test_unhomed_without_home_flag_refuses(p):
    p.status["toolhead"]["homed_axes"] = ""
    with pytest.raises(MacroError, match="HOME=1"):
        p.execute("AUTO_EJECT")


def test_source_saved_ignores_new_labels(p):
    p.execute("_AUTO_EJECT_CAPTURE")
    p.set_objects([("new_part", rect(10, 10, 30, 30))])
    p.execute("AUTO_EJECT", DRY=1, SOURCE="saved")
    assert [r[0] for r in state(p)["objects"]] == ["left_cutter", "right_cutter"]


def test_home_keeps_the_blade_clear_of_parts(p):
    # blade 60 mm ahead of the nozzle, a row of parts across the bed: the
    # nearest spot that suits the nozzle would put the blade on the row
    s = p.status["gcode_macro _AUTO_EJECT_SETTINGS"]
    s.update(blade_offset=60.0, blade_width=100.0, direction="front")
    p.set_objects([("row", rect(0, 165, 453, 180))])
    p.execute("_AUTO_EJECT_CAPTURE")
    restart(p)
    lines = [l for l in p.execute("_AUTO_EJECT_HOME") if not l.startswith("SET_GCODE_VARIABLE")]
    xy = [words(l) for l in lines if l.startswith("G1") and "X" in words(l)][0]
    by0, by1 = xy["Y"] - 60, xy["Y"] - 55
    dy = max(165 - by1, 0, by0 - 180)
    assert dy >= 20.0
