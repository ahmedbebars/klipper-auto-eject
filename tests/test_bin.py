"""The parts box: count what goes in, say when it is full, hold the next print."""

import pytest

from klipper_sim import MacroError, Printer, rect

CUBES = [("cube_1", rect(100, 150, 125, 175)), ("cube_2", rect(200, 150, 225, 175))]


def make(**settings):
    p = Printer(extra_settings=dict({"blade_lift": 2.3, "retries": 0}, **settings))
    p.set_machine(position=(225, 225, 10), save_variables={},
                  probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3})
    p.set_section("force_move", {"enable_force_move": True})
    p.set_section("stepper_z", {"endstop_pin": "probe:z_virtual_endstop"})
    return p


def eject(p, parts=CUBES):
    p.set_objects(parts)
    p.execute("_AUTO_EJECT_CAPTURE")
    p.status["gcode_macro _AUTO_EJECT_STATE"]["height"] = 10.0
    p.execute("AUTO_EJECT", COOL=0)


def saved(p):
    return p.status["save_variables"]["variables"]


def box(p):
    return p.status["gcode_macro _AUTO_EJECT_STATE"]["bin"]


def notes(p):
    return [kw["message"] for method, kw in p.remote_args if method == "notify"]


def test_every_part_pushed_off_is_counted_and_kept():
    p = make()
    eject(p)
    eject(p)
    assert box(p) == 4
    assert saved(p)["auto_eject_bin"] == 4
    assert not [m for m in p.messages if "parts box" in m]          # no capacity: no message


def test_a_dry_run_or_a_failed_eject_counts_nothing():
    p = make()
    p.set_objects(CUBES)
    p.execute("_AUTO_EJECT_CAPTURE")
    p.status["gcode_macro _AUTO_EJECT_STATE"]["height"] = 10.0
    p.execute("AUTO_EJECT", DRY=1, COOL=0)
    assert box(p) == 0
    p.under_probe = 10.0                                             # a cube is still there
    with pytest.raises(MacroError, match="STILL ON THE BED"):
        p.execute("AUTO_EJECT", COOL=0)
    assert box(p) == 0


def test_almost_full_once_then_full():
    p = make(bin_capacity=5, notify="auto_eject")
    eject(p)                                                         # 2
    eject(p)                                                         # 4: 80 %
    assert [m for m in p.messages if "parts box" in m] == ["AUTO_EJECT: the parts box is almost full (4 of 5 parts)."]
    eject(p, CUBES[:1])                                              # 5: full
    full = [m for m in p.messages if "is full" in m]
    assert full == ["AUTO_EJECT: the parts box is full (5 of 5 parts). Empty it, then run AUTO_EJECT_BIN_EMPTY; "
                    "the next print waits until then."]
    assert notes(p)[-1].startswith("Auto-eject: the parts box is full (5 of 5 parts)")
    assert len([m for m in p.messages if "almost full" in m]) == 1   # said once


def test_a_full_box_holds_the_next_print_until_emptied():
    p = make(bin_capacity=4)
    eject(p)
    eject(p)
    with pytest.raises(MacroError, match="parts box is full"):
        p.execute("AUTO_EJECT_GUARD")
    p.execute("AUTO_EJECT_BIN_EMPTY")
    assert box(p) == 0 and saved(p)["auto_eject_bin"] == 0
    p.execute("AUTO_EJECT_GUARD")                                    # the print starts


def test_notify_only_lets_the_print_start():
    p = make(bin_capacity=2, bin_full_action="notify")
    eject(p)
    assert any("is full (2 of 2 parts). Empty it, then run AUTO_EJECT_BIN_EMPTY." in m for m in p.messages)
    p.execute("AUTO_EJECT_GUARD")


def test_the_count_survives_a_restart():
    p = make(bin_capacity=10)
    eject(p)
    kept = dict(saved(p))
    q = make(bin_capacity=10)
    q.set_machine(save_variables=kept)
    q.execute("_AUTO_EJECT_APPLY_SAVED")
    assert box(q) == 2
