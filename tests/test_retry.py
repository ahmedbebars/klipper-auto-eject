"""Re-homing X/Y after the sweep and pushing leftover parts again."""

import pytest

from klipper_sim import MacroError, Printer, rect, words

LEFT = (100, 150, 160, 220)      # x0, y0, x1, y1
RIGHT = (260, 160, 330, 230)


def make(probe_offset=(0.0, 0.0), z_offset=-0.3, **settings):
    p = Printer(extra_settings=settings)
    p.set_machine(axis_min=(0, 0, -8), axis_max=(450, 450, 400),
                  position=(200, 200, 18), save_variables={},
                  probe={"x_offset": probe_offset[0], "y_offset": probe_offset[1],
                         "z_offset": z_offset})
    p.set_section("force_move", {"enable_force_move": True})
    p.set_section("stepper_z", {"endstop_pin": "probe:z_virtual_endstop"})
    p.set_objects([("left_cutter", rect(*LEFT)), ("right_cutter", rect(*RIGHT))])
    return p


def inside(box, x, y, margin=0.0):
    return box[0] - margin <= x <= box[2] + margin and box[1] - margin <= y <= box[3] + margin


def stuck(p, box, sweeps_needed):
    """A part of 17 mm at ``box`` that only moves after ``sweeps_needed`` sweeps."""
    def height(x, y):
        if p.calls.count("_AUTO_EJECT_RUN") < sweeps_needed and inside(box, x, y):
            return 17.0
        return 0.0
    p.under_probe = height


def state(p):
    return p.status["gcode_macro _AUTO_EJECT_STATE"]


def push_heights(lines):
    return [words(l)["Z"] for l in lines
            if l.startswith("G1") and set(words(l)) == {"Z", "F"} and words(l)["Z"] < 5]


def currents(lines):
    return [float(l.rsplit("=", 1)[1]) for l in lines
            if l.startswith("SET_TMC_CURRENT") and "stepper_x" in l]


# ------------------------------------------------------------------ re-home
def test_rehomes_xy_between_sweep_and_verify():
    p = make()
    lines = p.execute("AUTO_EJECT", COOL=0)
    home = lines.index("G28 X Y")
    assert home > max(i for i, l in enumerate(lines) if l.startswith("SET_TMC_CURRENT"))
    assert home < lines.index("PROBE")
    assert lines.count("G28 X Y") == 1


def test_rehome_can_be_turned_off():
    p = make(rehome_xy=False)
    assert "G28 X Y" not in p.execute("AUTO_EJECT", COOL=0)


def test_dry_run_neither_rehomes_nor_probes():
    p = make()
    lines = p.execute("AUTO_EJECT", DRY=1)
    assert "G28 X Y" not in lines
    assert "PROBE" not in lines


def test_rehome_finds_z_again_when_homing_drops_it():
    p = make()
    p.g28_drops_z = True
    lines = p.execute("AUTO_EJECT", COOL=0)
    home = lines.index("G28 X Y")
    assert any(l.startswith("SET_KINEMATIC_POSITION") for l in lines[home:])
    assert p.status["toolhead"]["homed_axes"] == "xyz"
    assert state(p)["objects"] == []


# -------------------------------------------------------------------- retry
def test_clear_bed_needs_no_retry():
    p = make()
    p.execute("AUTO_EJECT", COOL=0)
    assert p.calls.count("_AUTO_EJECT_RUN") == 1
    assert not any("retry" in m for m in p.messages)


def test_stuck_part_is_pushed_again_lower_and_harder():
    p = make()
    stuck(p, LEFT, sweeps_needed=2)
    lines = p.execute("AUTO_EJECT", COOL=0)
    assert p.calls.count("_AUTO_EJECT_RUN") == 2
    assert any("retry 1 for left_cutter" in m for m in p.messages)
    heights = push_heights(lines)
    assert heights[0] == pytest.approx(1.5) and heights[-1] == pytest.approx(1.2)
    assert currents(lines) == pytest.approx([0.5, 0.8, 0.65, 0.8])
    # the retry verifies only the part that was left: 6 + 3 probes
    assert lines.count("PROBE") == 9
    assert state(p)["objects"] == []
    assert p.status["save_variables"]["variables"]["auto_eject_objects"] == []


def test_retry_only_pushes_the_leftover_part():
    p = make()
    stuck(p, RIGHT, sweeps_needed=2)
    lines = p.execute("AUTO_EJECT", COOL=0)
    start = [i for i, l in enumerate(lines) if l.startswith("SAVE_GCODE_STATE")][1]
    end = lines.index("RESTORE_GCODE_STATE NAME=_auto_eject", start)
    xs = [words(l)["X"] for l in lines[start:end] if l.startswith("G1") and "X" in words(l)]
    # two blade columns over the right part, none near the left one
    assert len(xs) == 2 and all(x > LEFT[2] + 100 for x in xs)


def test_part_that_never_moves_stops_the_queue():
    p = make()
    stuck(p, LEFT, sweeps_needed=99)
    with pytest.raises(MacroError, match="'left_cutter' is STILL ON THE BED after 1 retry"):
        p.execute("AUTO_EJECT", COOL=0)
    assert len(p.status["save_variables"]["variables"]["auto_eject_objects"]) == 2


def test_second_retry_goes_lower_again_and_caps_current():
    p = make(retries=2)
    stuck(p, LEFT, sweeps_needed=3)
    lines = p.execute("AUTO_EJECT", COOL=0)
    assert p.calls.count("_AUTO_EJECT_RUN") == 3
    assert push_heights(lines)[-1] == pytest.approx(0.9)
    assert currents(lines)[-2] == pytest.approx(0.8)      # capped at run_current
    assert state(p)["objects"] == []


def test_retries_are_limited_to_two():
    p = make(retries=5)
    stuck(p, LEFT, sweeps_needed=99)
    with pytest.raises(MacroError, match="after 2 retries"):
        p.execute("AUTO_EJECT", COOL=0)
    assert p.calls.count("_AUTO_EJECT_RUN") == 3


def test_no_retries_stops_at_once():
    p = make(retries=0)
    stuck(p, LEFT, sweeps_needed=2)
    with pytest.raises(MacroError, match=r"STILL ON THE BED\. Stopping"):
        p.execute("AUTO_EJECT", COOL=0)
    assert p.calls.count("_AUTO_EJECT_RUN") == 1


def test_retry_never_goes_below_push_z_min():
    p = make(retries=2, push_z=0.8, push_z_min=0.6)
    stuck(p, LEFT, sweeps_needed=3)
    lines = p.execute("AUTO_EJECT", COOL=0)
    assert min(push_heights(lines)) == pytest.approx(0.6)


def test_retry_never_raises_push_z():
    p = make(push_z=0.3, push_z_min=0.5)
    stuck(p, LEFT, sweeps_needed=2)
    lines = p.execute("AUTO_EJECT", COOL=0)
    assert max(push_heights(lines)) == pytest.approx(0.3)


# ------------------------------------------------------------ offset probes
def test_offset_probe_stops_checking_once_a_part_is_found():
    p = make(probe_offset=(30.0, 0.0), z_offset=2.0)
    hits = []

    def height(x, y):
        nozzle = (x - 30.0, y)
        if p.calls.count("_AUTO_EJECT_RUN") < 2:
            # the left part is still there: the nozzle must never be over it
            hits.append(inside(LEFT, *nozzle))
            if inside(LEFT, x, y):
                return 17.0
        return 0.0
    p.under_probe = height
    p.execute("AUTO_EJECT", COOL=0)
    assert not any(hits)
    assert any("'right_cutter' not checked" in m for m in p.messages)
    # both were pushed again, then both confirmed gone
    assert any("retry 1 for left_cutter, right_cutter" in m for m in p.messages)
    assert state(p)["objects"] == []


def test_eddy_probe_never_retries():
    p = make()
    p.set_section("probe_eddy_current btt_eddy", {"z_offset": 1.0})
    del p.status["configfile"]["settings"]["probe"]
    del p.status["configfile"]["config"]["probe"]
    stuck(p, LEFT, sweeps_needed=99)
    p.execute("AUTO_EJECT", COOL=0)
    assert p.calls.count("_AUTO_EJECT_RUN") == 1
    assert any("NOT verified" in m for m in p.messages)
