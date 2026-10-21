"""Nothing may be moving while Klipper works out a slow macro.

Klipper renders a macro when it is called and does nothing else until it
is done. A move queued just before is then sent to the board too late and
Klipper stops with "Timer too close". This happened on a real printer: the
bed was already cool, so 240 cooling passes ran back to back with the
toolhead still rising.
"""

import pytest

from klipper_sim import Printer, rect

PARTS = [("a", rect(100, 150, 125, 175)), ("b", rect(300, 200, 325, 225)),
         ("c", rect(200, 100, 230, 130))]
SLOW = {"_AUTO_EJECT_RUN", "_AUTO_EJECT_VERIFY", "_AUTO_EJECT_HOME_Z", "_AUTO_EJECT_COOL_PASS"}


def make(bed=60.0, homed="xyz", **settings):
    p = Printer(extra_settings=settings)
    p.set_machine(position=(225, 225, 10.2), homed=homed, save_variables={},
                  probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3})
    p.set_section("force_move", {"enable_force_move": True})
    p.set_section("stepper_z", {"endstop_pin": "probe:z_virtual_endstop"})
    p.set_objects(PARTS)
    p.status["heater_bed"]["temperature"] = bed
    p.bed_cooling = 0.5
    p.moving = True          # called from the end G-code, the print still moving
    return p


def slow_calls_while_moving(p):
    return [c for c in p.called_while_moving if c in SLOW]


@pytest.mark.parametrize("bed", [60.0, 22.0], ids=["warm bed", "bed already cool"])
def test_eject(bed):
    p = make(bed=bed, cool_temp=28)
    p.execute("AUTO_EJECT", HEIGHT=15)
    assert "_AUTO_EJECT_RUN" in p.calls
    assert slow_calls_while_moving(p) == []


def test_bed_already_cool_runs_no_cooling_pass():
    p = make(bed=22.0, cool_temp=28)
    p.execute("AUTO_EJECT", HEIGHT=15)
    assert "_AUTO_EJECT_COOL_PASS" not in p.calls


def test_passes_after_cooling_do_nothing():
    p = make(bed=40.0, cool_temp=28)
    p.execute("AUTO_EJECT", HEIGHT=15)
    passes = p.calls.count("_AUTO_EJECT_COOL_PASS")
    assert passes == 240                      # the list is fixed: Klipper has no loops
    assert p.status["gcode_macro _AUTO_EJECT_STATE"]["cooling"] is False


def test_dry_run_and_home():
    p = make(homed="")
    p.execute("AUTO_EJECT", DRY=1, HOME=1)
    assert "_AUTO_EJECT_HOME_Z" in p.calls
    assert slow_calls_while_moving(p) == []


def test_retry():
    p = make(bed=22.0, cool_temp=28, retries=1)
    stuck = PARTS[0][1]
    # the probe finds part "a" still there on the first check only
    hits = {"n": 0}

    def under(x, y):
        inside = stuck[0][0] <= x <= stuck[1][0] and stuck[0][1] <= y <= stuck[2][1]
        if inside:
            hits["n"] += 1
        return 15.0 if inside and hits["n"] <= 3 else 0.0
    p.under_probe = under
    p.execute("AUTO_EJECT", HEIGHT=15)
    assert p.calls.count("_AUTO_EJECT_RUN") == 2
    assert slow_calls_while_moving(p) == []


@pytest.mark.parametrize("fan", [0.0, 0.6], ids=["no fan", "fan while it cools"])
def test_a_hot_nozzle_probe_cools_with_the_fan_then_homes(fan):
    # A real printer stopped here: the part fan was switched off after the
    # nozzle cooled, and the spot to home Z at was worked out before the fan
    # command went out.
    p = make(homed="", cool_fan_speed=fan)
    p.status["extruder"].update(temperature=215.0, target=0.0)
    lines = p.execute("AUTO_EJECT", HOME=1, HEIGHT=15)
    assert "TEMPERATURE_WAIT SENSOR=extruder MAXIMUM=150.0" in lines
    assert ("M107" in lines) == (fan > 0)
    assert "_AUTO_EJECT_HOME_Z" in p.calls and "_AUTO_EJECT_VERIFY" in p.calls
    assert slow_calls_while_moving(p) == []
