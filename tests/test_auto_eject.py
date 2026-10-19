import pytest

from klipper_sim import MacroError, Printer, rect, words


def pushes(lines, axis="Y"):
    """Return (start_point, end_value) for every lowered push in the output."""
    found = []
    last_xy = None
    lowered = False
    for line in lines:
        if not line.startswith("G1"):
            continue
        w = words(line)
        if "X" in w and "Y" in w:
            last_xy = (w["X"], w["Y"])
        elif "Z" in w and len(w) == 2:
            lowered = w["Z"] < 5
        elif axis in w and lowered and last_xy is not None:
            found.append((last_xy, w[axis]))
    return found


@pytest.fixture
def printer():
    p = Printer()
    p.set_objects([
        ("front_part", rect(100, 80, 160, 140)),
        ("rear_part", rect(110, 250, 170, 310)),
    ])
    return p


# --------------------------------------------------------------------- basics
def test_refuses_when_not_homed(printer):
    printer.set_machine(homed="xy")
    with pytest.raises(MacroError, match="not homed"):
        printer.render("AUTO_EJECT")


def test_unknown_strategy_is_rejected(printer):
    with pytest.raises(MacroError, match="unknown STRATEGY"):
        printer.render("AUTO_EJECT", STRATEGY="spiral")


def test_no_objects_skip_by_default():
    p = Printer()
    lines = p.render("AUTO_EJECT")
    assert not [l for l in lines if l.startswith("G1")]
    assert any("nothing to do" in m for m in p.messages)


def test_no_objects_error_option():
    p = Printer(extra_settings={"no_objects_action": "error"})
    with pytest.raises(MacroError, match="no labelled objects"):
        p.render("AUTO_EJECT")


# ------------------------------------------------------------------- columns
def test_columns_start_behind_rearmost_part_and_end_at_edge(printer):
    lines = printer.render("AUTO_EJECT")
    p = pushes(lines)
    assert p, lines
    s = printer.status["gcode_macro _AUTO_EJECT_SETTINGS"]
    for (x, y), end in p:
        assert end == 0.0
        # rear part ends at Y=310, plus clearance and blade offset
        assert y == pytest.approx(310 + s["rear_clearance"] + s["blade_offset"])
    # lanes cover the parts' X span (100..170)
    xs = [pt[0][0] for pt in p]
    half = s["blade_width"] / 2
    assert min(xs) - half <= 100 and max(xs) + half >= 170


def test_columns_cool_down_and_current_handling(printer):
    lines = printer.render("AUTO_EJECT")
    text = "\n".join(lines)
    assert "TEMPERATURE_WAIT SENSOR=heater_bed MAXIMUM=28" in text
    assert "M140 S0" in text and "M104 S0" in text
    assert "SET_TMC_CURRENT STEPPER=stepper_x CURRENT=0.5" in text
    assert "SET_TMC_CURRENT STEPPER=stepper_y CURRENT=0.8" in text
    # current restored after the pushes, accel restored to the old value
    assert text.index("CURRENT=0.5") < text.index("CURRENT=0.8")
    assert "SET_VELOCITY_LIMIT ACCEL=3000" in text
    assert lines.index("RESTORE_GCODE_STATE NAME=_auto_eject") > 0


def test_columns_lane_only_where_parts_are():
    p = Printer()
    p.set_objects([("left", rect(20, 100, 60, 150)),
                   ("right", rect(380, 100, 420, 150))])
    lanes = pushes(p.render("AUTO_EJECT"))
    # an empty middle of the bed is not swept
    assert all(not (150 < pt[0][0] < 300) for pt in lanes)


def test_dry_run_never_lowers_or_changes_current(printer):
    lines = printer.render("AUTO_EJECT", DRY=1)
    text = "\n".join(lines)
    assert "SET_TMC_CURRENT" not in text
    assert "TEMPERATURE_WAIT" not in text
    assert "PROBE" not in text
    zs = [words(l)["Z"] for l in lines if l.startswith("G1") and "Z" in words(l)]
    assert min(zs) >= 20.0


def test_part_at_far_edge_is_refused():
    p = Printer()
    p.set_objects([("edge", rect(100, 400, 150, 445))])
    with pytest.raises(MacroError, match="too close to the far edge"):
        p.render("AUTO_EJECT")


# ------------------------------------------------------------------- objects
def test_objects_strategy_pushes_nearest_first():
    p = Printer()
    p.set_objects([("rear", rect(100, 300, 150, 340)),
                   ("front", rect(300, 60, 350, 100))])
    lanes = pushes(p.render("AUTO_EJECT", STRATEGY="objects"))
    assert [round(pt[0][0]) for pt in lanes] == [325, 125]


def test_objects_strategy_detects_blocked_landing_zone():
    p = Printer()
    p.set_objects([("front", rect(100, 80, 160, 140)),
                   ("behind", rect(100, 150, 160, 200))])
    with pytest.raises(MacroError, match="sits where the blade must come down"):
        p.render("AUTO_EJECT", STRATEGY="objects")


# ---------------------------------------------------------------- full width
def test_full_width_covers_whole_bed_without_labels():
    p = Printer(extra_settings={"no_objects_action": "full_width"})
    lanes = pushes(p.render("AUTO_EJECT"))
    xs = [pt[0][0] for pt in lanes]
    assert min(xs) <= 40 and max(xs) >= 410
    assert all(pt[0][1] == 450 for pt in lanes)


# ---------------------------------------------------------------- directions
def test_direction_right_pushes_along_x():
    p = Printer(extra_settings={"direction": "right"})
    p.set_objects([("part", rect(100, 100, 150, 160))])
    lanes = pushes(p.render("AUTO_EJECT"), axis="X")
    assert lanes
    s = p.status["gcode_macro _AUTO_EJECT_SETTINGS"]
    for (x, y), end in lanes:
        assert end == 450.0
        assert x == pytest.approx(100 - s["rear_clearance"] - s["blade_offset"])


def test_push_end_override():
    p = Printer(extra_settings={"push_end": 12.5})
    p.set_objects([("part", rect(100, 100, 150, 160))])
    assert all(end == 12.5 for _, end in pushes(p.render("AUTO_EJECT")))


# ------------------------------------------------------------- verification
def test_verify_outline_probes_three_points_per_part(printer):
    printer.set_machine(probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3})
    lines = printer.render("_AUTO_EJECT_VERIFY")
    assert lines.count("PROBE") == 6
    assert sum(l.startswith("_AUTO_EJECT_CHECK") for l in lines) == 6


def test_verify_applies_probe_offset(printer):
    printer.set_machine(probe={"x_offset": 30.0, "y_offset": 0.0, "z_offset": 2.0})
    printer.status["gcode_macro _AUTO_EJECT_SETTINGS"]["verify_points"] = "center"
    lines = printer.render("_AUTO_EJECT_VERIFY")
    moves = [words(l) for l in lines if l.startswith("G1") and "X" in words(l)]
    assert moves[0]["X"] == pytest.approx(130 - 30)


def test_verify_skipped_without_probe(printer):
    lines = printer.render("_AUTO_EJECT_VERIFY")
    assert "PROBE" not in lines
    assert any("bed check skipped" in m for m in printer.messages)


def test_check_raises_when_part_left(printer):
    printer.set_machine(probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3})
    printer.status["probe"]["last_z_result"] = 14.0
    with pytest.raises(MacroError, match="STILL ON THE BED"):
        printer.render("_AUTO_EJECT_CHECK", NAME="front_part")


def test_check_passes_on_empty_bed(printer):
    printer.set_machine(probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": 2.5})
    printer.status["probe"]["last_z_result"] = 2.6
    printer.render("_AUTO_EJECT_CHECK", NAME="front_part")


# -------------------------------------------------------------------- purge
def test_purge_lands_in_front_of_parts(printer):
    lines = printer.render("EJECT_PURGE")
    xy = [words(l) for l in lines if l.startswith("G1") and "X" in words(l)][0]
    assert xy["X"] == pytest.approx(135)          # centre of the parts' X span
    assert xy["Y"] == pytest.approx(80 - 15)      # nearest part minus purge_gap
    assert any(l.startswith("G1 E30") for l in lines)


def test_purge_refuses_low_cross_section(printer):
    printer.set_machine(max_extrude_cross_section=0.64)
    with pytest.raises(MacroError, match="max_extrude_cross_section"):
        printer.render("EJECT_PURGE")


def test_purge_respects_edge_margin():
    p = Printer()
    p.set_objects([("near_edge", rect(100, 40, 150, 90))])
    xy = [words(l) for l in p.render("EJECT_PURGE")
          if l.startswith("G1") and "X" in words(l)][0]
    assert xy["Y"] == pytest.approx(50.0)
