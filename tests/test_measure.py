"""Measuring the blade with a nozzle probe (AUTO_EJECT_CALIBRATE)."""

import pytest

from klipper_sim import Printer, rect

from test_setup_wizard import buttons, dialog_title

Z_OFFSET = -0.33


class Rig:
    """A block on the bed and a blade on the toolhead.

    A nozzle probe triggers on whatever touches first: the nozzle tip, or
    the blade's lower edge, which sits ``lift`` mm above the tip and spans
    ``thickness`` mm along the push axis starting ``offset`` mm ahead of the
    nozzle, ``width`` mm across it.
    """

    def __init__(self, p, direction="front", offset=25.0, lift=1.5, width=80.0,
                 thickness=3.0, block=(215.0, 215.0, 235.0, 235.0), height=20.0):
        self.p, self.direction = p, direction
        self.offset, self.lift, self.width, self.thickness = offset, lift, width, thickness
        self.block, self.height = block, height
        p.under_probe = self.surface

    def blade_box(self, x, y):
        o, t, h = self.offset, self.thickness, self.width / 2.0
        return {"front": (x - h, y - o, x + h, y - o + t),
                "back": (x - h, y + o - t, x + h, y + o),
                "left": (x - o, y - h, x - o + t, y + h),
                "right": (x + o - t, y - h, x + o, y + h)}[self.direction]

    def surface(self, x, y):
        bx0, by0, bx1, by1 = self.block
        nozzle = self.height if bx0 <= x <= bx1 and by0 <= y <= by1 else 0.0
        f = self.blade_box(x, y)
        on = f[0] < bx1 and f[2] > bx0 and f[1] < by1 and f[3] > by0
        blade = (self.height if on else 0.0) - self.lift
        return max(nozzle, blade)


def make(position=(226.5, 223.8, 50.0), probe_offset=(0.0, 0.0), **settings):
    p = Printer(extra_settings=settings)
    p.set_machine(axis_min=(0, 0, -5), axis_max=(450, 450, 400), position=position,
                  save_variables={}, exclude_object_section=True,
                  probe={"x_offset": probe_offset[0], "y_offset": probe_offset[1],
                         "z_offset": Z_OFFSET})
    return p


def measure(p, direction="front", offset=20.0):
    p.execute("_AUTO_EJECT_MEASURE", DIRECTION=direction, OFFSET=offset)
    return p.status["gcode_macro _AUTO_EJECT_CAL"]


@pytest.mark.parametrize("offset", [12.0, 25.0, 45.0, 90.0])
def test_measures_offset_and_lift(offset):
    p = make()
    Rig(p, offset=offset, lift=1.5)
    cal = measure(p)
    assert cal["error"] == ""
    assert cal["offset"] == pytest.approx(offset, abs=0.7)
    assert cal["lift"] == pytest.approx(1.5, abs=0.01)
    assert cal["push_z"] == pytest.approx(0.5)          # push_z_min wins
    assert cal["probes"] <= 40


@pytest.mark.parametrize("direction", ["front", "back", "left", "right"])
def test_every_drop_edge(direction):
    p = make()
    Rig(p, direction=direction, offset=30.0, lift=0.4)
    cal = measure(p, direction=direction)
    assert cal["error"] == ""
    assert cal["offset"] == pytest.approx(30.0, abs=0.7)
    assert cal["lift"] == pytest.approx(0.4, abs=0.01)
    assert cal["push_z"] == pytest.approx(0.6)          # blade 1.0 mm above the bed


def test_block_off_centre_and_any_size():
    p = make(position=(221.0, 228.0, 50.0))
    Rig(p, block=(210.0, 218.0, 240.0, 236.0), height=12.0, offset=22.0, lift=1.0)
    cal = measure(p)
    assert cal["error"] == ""
    assert cal["offset"] == pytest.approx(22.0, abs=0.7)


def test_blade_level_with_the_nozzle_is_refused():
    p = make()
    Rig(p, lift=0.0)
    assert "blade lower edge" in measure(p)["error"]


def test_blade_below_the_nozzle_is_refused():
    p = make()
    Rig(p, lift=-1.0)
    assert "blade lower edge" in measure(p)["error"]


def test_no_block_under_the_nozzle():
    p = make(position=(100.0, 100.0, 50.0))
    Rig(p)
    assert "no block found" in measure(p)["error"]


def test_blade_that_never_touches():
    p = make()
    Rig(p, lift=30.0)
    assert "never came down" in measure(p)["error"]


def test_block_too_close_to_the_edge():
    p = make(position=(225.0, 12.0, 50.0))
    Rig(p, block=(215.0, 2.0, 235.0, 22.0))
    assert "too close to the edge" in measure(p)["error"]


def test_offset_probe_is_refused():
    p = make(probe_offset=(-40.0, 0.0))
    Rig(p)
    cal = measure(p)
    assert "touches with the nozzle" in cal["error"]
    assert "PROBE" not in p.executed


def test_error_stops_all_later_probing():
    p = make(position=(100.0, 100.0, 50.0))
    Rig(p)
    measure(p)
    assert [l for l in p.executed if l.startswith("PROBE")] == ["PROBE"]


# ------------------------------------------------------------------ wizard
def click(p, *labels):
    for label in labels:
        b = buttons(p.executed)
        assert label in b, (label, list(b))
        p.run_gcode(b[label])


def test_setup_measures_the_blade_automatically():
    p = make(position=(225.0, 225.0, 5.0))
    p.run_gcode("AUTO_EJECT_SETUP")
    click(p, "Start", "Front", "It slides off", "Bed is clear - move")
    assert "4 of 8 - blade height and position" in dialog_title(p)
    assert p.status["toolhead"]["position"].z == pytest.approx(50.0)
    Rig(p, offset=33.0, lift=0.8)
    click(p, "Measure automatically", "Block is in place - measure")
    assert "measure the blade" in dialog_title(p)
    click(p, "Use these values")
    assert "6 of 8" in dialog_title(p)
    w = p.status["gcode_macro _AUTO_EJECT_WIZARD"]
    assert w["blade_offset"] == pytest.approx(33.0, abs=0.7)
    assert w["blade_lift"] == pytest.approx(0.8, abs=0.01)
    assert w["push_z"] == pytest.approx(0.5)
    click(p, "Save width", "Bed is clear - move", "Yes, it is past the edge", "Next", "Save")
    saved = p.status["save_variables"]["variables"]
    assert saved["auto_eject_blade_lift"] == pytest.approx(0.8, abs=0.01)


def test_failed_measurement_offers_the_manual_way():
    p = make(position=(225.0, 225.0, 5.0))
    p.run_gcode("AUTO_EJECT_SETUP")
    click(p, "Start", "Front", "It slides off", "Bed is clear - move", "Measure automatically")
    Rig(p, lift=-1.0)
    click(p, "Block is in place - measure")
    b = buttons(p.executed)
    assert "Try again" in b and "Measure by hand" in b
    click(p, "Measure by hand")
    assert "4 of 8 - blade height" in dialog_title(p)
    assert p.status["toolhead"]["position"].z == pytest.approx(5.0)


def test_calibrate_command_saves_only_the_blade():
    p = make(position=(225.0, 225.0, 5.0))
    p.run_gcode("AUTO_EJECT_CALIBRATE")
    click(p, "Bed is clear - move")
    Rig(p, offset=40.0, lift=1.2)
    click(p, "Block is in place - measure", "Use these values")
    data = p.status["gcode_macro _AUTO_EJECT_OVERRIDES"]["data"]
    assert set(data) == {"push_z", "blade_offset", "blade_lift"}
    assert data["blade_offset"] == pytest.approx(40.0, abs=0.7)
    assert p.status["save_variables"]["variables"]["auto_eject_blade_lift"] == \
        pytest.approx(1.2, abs=0.01)
    assert "Remove the block" in " ".join(p.executed)


def test_calibrate_without_nozzle_probe_explains():
    p = make(position=(225.0, 225.0, 5.0), probe_offset=(-40.0, 0.0))
    p.run_gcode("AUTO_EJECT_CALIBRATE")
    assert "needs a probe that touches with the nozzle" in " ".join(p.executed)
    assert list(buttons(p.executed)) == ["Close"]


# ----------------------------------------------------------------- retries
def test_retry_keeps_a_low_hanging_blade_off_the_bed():
    p = make(position=(200.0, 200.0, 18.0), retries=2, push_z=1.4, push_z_min=0.5,
             blade_lift=-0.8)
    p.set_objects([("part", rect(100, 150, 160, 220))])
    p.under_probe = lambda x, y: 17.0          # never moves
    with pytest.raises(Exception, match="STILL ON THE BED"):
        p.execute("AUTO_EJECT", COOL=0)
    zs = [float(l.split("Z")[1].split()[0]) for l in p.executed
          if l.startswith("G1 Z") and float(l.split("Z")[1].split()[0]) < 5]
    assert min(zs) == pytest.approx(1.0)       # blade edge 0.2 mm above the bed


def test_no_expression_starts_with_a_minus():
    # Klipper's "{" delimiter makes "{-" whitespace control, so "{-x}" prints x
    import re
    from klipper_sim import CONFIG_DIR
    for f in CONFIG_DIR.glob("*.cfg"):
        text = f.read_text(encoding="utf-8")
        assert not re.search(r"(?<![%{])\{-(?!%)", text), f.name
