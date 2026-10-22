"""DEMON Klipper Essentials: its power-off after the print must not cut the
eject short.

DEMON_END switches the printer off 5 s later when PRINTER_AUTO_OFF is on,
with a delayed_gcode (_DELAY_OFF). Klipper works out a delayed_gcode's
template, and so calls Moonraker, as soon as its timer fires, even while
another macro runs: during AUTO_EJECT that is the middle of a push.
"""

import pytest

from klipper_sim import MacroError, Printer, rect

# DEMON's own, cut down to what it does
DELAY_OFF = '{action_call_remote_method("set_device_power", device="Printer Power", state="off")}'
HOLD = "UPDATE_DELAYED_GCODE ID=_DELAY_OFF DURATION=0"
LATER = "UPDATE_DELAYED_GCODE ID=_AUTO_EJECT_DEMON_OFF DURATION=120"


def demon(auto_off=True, relay=True, state="printing", **settings):
    p = Printer(extra_settings=settings)
    p.set_objects([("part", rect(100, 100, 150, 150))])
    p.set_section("delayed_gcode _DELAY_OFF", {"gcode": ""})
    p.set_section("gcode_macro _HARDWARE_VARIABLES", {})
    p.set_section("output_pin PRINTER_AUTO_OFF", {"pin": "PA0"})
    p.status["gcode_macro _HARDWARE_VARIABLES"] = {"shutdown_relay": relay}
    p.status["output_pin PRINTER_AUTO_OFF"] = {"value": 1.0 if auto_off else 0.0}
    p.status["print_stats"] = {"state": state}
    p.delayed["_DELAY_OFF"] = DELAY_OFF
    return p


def switched_off(p):
    return "set_device_power" in p.remote_calls


def test_the_power_off_waits_until_the_bed_is_clear():
    p = demon()
    lines = p.execute("AUTO_EJECT", COOL=0)
    moves = [i for i, l in enumerate(lines) if l.startswith("G1")]
    assert lines.index(HOLD) < moves[0]               # held before the first move
    assert lines.index(LATER) > moves[-1]             # and handed back after the last
    assert any("power-off waits" in m for m in p.messages)
    # the print has ended and nothing follows: DEMON switches the printer off
    p.status["print_stats"]["state"] = "complete"
    p.fire("_AUTO_EJECT_DEMON_OFF")
    assert switched_off(p)


def test_the_next_queued_print_keeps_it_on():
    p = demon()
    p.execute("AUTO_EJECT", COOL=0)     # the check fires while a print runs
    assert not switched_off(p)


def test_the_switch_turned_off_meanwhile_is_respected():
    p = demon()
    p.execute("AUTO_EJECT", COOL=0)
    p.status["output_pin PRINTER_AUTO_OFF"]["value"] = 0.0
    p.status["print_stats"]["state"] = "complete"
    p.fire("_AUTO_EJECT_DEMON_OFF")
    assert not switched_off(p)


@pytest.mark.parametrize("kw", [{"auto_off": False}, {"relay": False}, {"state": "complete"}, {"state": "standby"}])
def test_nothing_is_held_when_demon_would_not_switch_off(kw):
    # auto-off off, no relay, or an eject run by hand after the print
    p = demon(**kw)
    lines = p.execute("AUTO_EJECT", COOL=0)
    assert HOLD not in lines and LATER not in lines


def test_without_demon_nothing_changes():
    p = Printer()
    p.set_objects([("part", rect(100, 100, 150, 150))])
    p.status["print_stats"] = {"state": "printing"}
    lines = p.execute("AUTO_EJECT", COOL=0)
    assert not [l for l in lines if "DELAY" in l or "DEMON" in l]


def test_a_part_left_on_the_bed_keeps_the_printer_on():
    p = demon()
    p.set_machine(axis_min=(0, 0, -8), position=(200, 200, 18), save_variables={},
                  probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3})
    p.set_section("delayed_gcode _DELAY_OFF", {"gcode": ""})
    p.set_section("gcode_macro _HARDWARE_VARIABLES", {})
    p.set_section("output_pin PRINTER_AUTO_OFF", {"pin": "PA0"})
    p.set_section("stepper_z", {"endstop_pin": "probe:z_virtual_endstop"})
    p.set_objects([("part", rect(100, 100, 150, 150))])
    p.under_probe = lambda x, y: 17.0 if 100 <= x <= 150 and 100 <= y <= 150 else 0.0
    with pytest.raises(MacroError, match="STILL ON THE BED"):
        p.execute("AUTO_EJECT", COOL=0)
    assert HOLD in p.executed and LATER not in p.executed
