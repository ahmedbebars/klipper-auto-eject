"""The on/off switch (enabled): switched off, the end of a print leaves the
parts on the bed, nothing is pushed and the bed is not checked."""

import pytest

from klipper_sim import MacroError, Printer, rect

from test_setup_wizard import buttons

CUBES = [("cube_a", rect(100, 150, 125, 175)), ("cube_b", rect(300, 200, 325, 225))]


def make(state="printing", **settings):
    p = Printer(extra_settings=dict({"enabled": False, "blade_lift": 2.3, "retries": 0}, **settings))
    p.set_machine(position=(225, 225, 10), save_variables={},
                  probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3},
                  exclude_object_section=True)
    p.set_section("force_move", {"enable_force_move": True})
    p.set_section("stepper_z", {"endstop_pin": "probe:z_virtual_endstop"})
    p.status["print_stats"] = {"state": state, "filename": "cubes.gcode", "total_duration": 600.0}
    p.set_objects(CUBES)
    p.remote_calls.clear()
    return p


def state(p):
    return p.status["gcode_macro _AUTO_EJECT_STATE"]


def moved(lines):
    return [l for l in lines if l.split()[0] in ("G1", "G0", "G28", "PROBE", "M140", "M104", "M106",
                                                 "TEMPERATURE_WAIT", "SET_TMC_CURRENT")]


def test_the_end_of_a_print_leaves_the_parts_and_nothing_moves():
    p = make()
    lines = p.execute("AUTO_EJECT", HEIGHT=10.0, HOME=1)
    assert moved(lines) == []
    assert any("auto-eject is off (enabled: False)" in m for m in p.messages)
    assert p.remote_calls == ["pause_job_queue"]
    # kept, so the next print's check knows they may still be there
    assert len(state(p)["objects"]) == 2 and state(p)["height"] == pytest.approx(10.0)
    assert len(p.status["save_variables"]["variables"]["auto_eject_objects"]) == 2
    assert state(p)["notified"] is True                 # not the "ended without an eject" dialog too


def test_the_dialog_forgets_them_and_continues_the_queue():
    p = make()
    b = buttons(p.execute("AUTO_EJECT", HEIGHT=10.0))
    assert b == {"Bed is clear - continue the queue": "_AUTO_EJECT_TALL_CLEAR"}
    p.run_gcode(b["Bed is clear - continue the queue"])
    assert state(p)["objects"] == []
    assert p.remote_calls == ["pause_job_queue", "start_job_queue"]


def test_without_queue_pausing():
    p = make(thin_pause_queue=False)
    lines = p.execute("AUTO_EJECT", HEIGHT=10.0)
    assert p.remote_calls == [] and list(buttons(lines)) == ["Bed is clear"]


def test_the_phone_is_told():
    p = make(notify="auto_eject")
    p.execute("AUTO_EJECT", HEIGHT=10.0)
    [n] = [kw for method, kw in p.remote_args if method == "notify"]
    assert n["message"].startswith("Auto-eject: the print is done. Auto-eject is off")


@pytest.mark.parametrize("params", [{}, {"HOME": 1}, {"SOURCE": "saved"}])
def test_by_hand_it_says_it_is_off(params):
    p = make(state="complete")
    p.execute("_AUTO_EJECT_CAPTURE")
    state(p)["height"] = 10.0
    with pytest.raises(MacroError, match="auto-eject is off, nothing is pushed"):
        p.execute("AUTO_EJECT", COOL=0, **params)
    assert moved(p.executed) == []
    assert len(state(p)["objects"]) == 2                # still known


def test_push_now_says_it_is_off():
    p = make(state="complete")
    state(p).update(bg=True, cooling=True)
    with pytest.raises(MacroError, match="auto-eject is off"):
        p.execute("AUTO_EJECT_PUSH_NOW")
    assert state(p)["push_now"] is False


def test_a_dry_run_still_runs():
    p = make()
    lines = p.execute("AUTO_EJECT", DRY=1, COOL=0)
    assert any(l.startswith("G1") for l in lines)
    assert p.remote_calls == []


def test_on_it_pushes_as_before():
    p = make(enabled=True)
    lines = p.execute("AUTO_EJECT", HEIGHT=10.0, COOL=0)
    assert any(l.startswith("SET_TMC_CURRENT") for l in lines)
    assert p.remote_calls == []


def test_switched_with_the_set_macro_and_kept():
    p = make(enabled=True)
    p.execute("AUTO_EJECT_SET", KEY="enabled", VALUE="off")
    assert p.status["save_variables"]["variables"]["auto_eject_enabled"] is False
    assert moved(p.execute("AUTO_EJECT", HEIGHT=10.0)) == []
    p.execute("AUTO_EJECT_SET", KEY="enabled", VALUE="on")
    assert p.status["gcode_macro _AUTO_EJECT_OVERRIDES"]["data"]["enabled"] is True


def guarded(**settings):
    """The next print starts with the last one's parts stored, switched off."""
    p = make(**settings)
    p.execute("AUTO_EJECT", HEIGHT=10.0)
    p.status["print_stats"] = {"state": "printing", "filename": "next.gcode", "total_duration": 1.0}
    p.status["toolhead"]["homed_axes"] = ""
    p.status["extruder"].update(temperature=25.0, target=0.0)
    p.set_objects([("next_print", rect(10, 10, 30, 30))])
    return p


@pytest.mark.parametrize("action", ["check", "eject", "error"])
def test_the_guard_checks_nothing(action):
    p = guarded(guard_action=action, bin_capacity=2)
    state(p)["bin"] = 2                                  # a full box does not hold it either
    lines = p.execute("AUTO_EJECT_GUARD")
    assert moved(lines) == [] and "_AUTO_EJECT_RUN" not in p.calls
    assert any("auto-eject is off, the bed is not checked" in m for m in p.messages)
    assert len(state(p)["objects"]) == 2                # checked for once it is on again


def test_switched_on_again_the_guard_checks_for_them():
    p = guarded(guard_action="check")
    p.execute("AUTO_EJECT_SET", KEY="enabled", VALUE="on")
    p.execute("AUTO_EJECT_GUARD")
    assert "PROBE" in p.executed
    assert state(p)["objects"] == [] and any("the bed is clear" in m for m in p.messages)


def test_switched_off_while_the_bed_cools_it_stops_and_leaves_them():
    p = make(enabled=True, cool_background=True)
    p.execute("_AUTO_EJECT_CAPTURE")
    state(p)["height"] = 10.0
    p.status["heater_bed"].update(temperature=60.0, target=0.0)
    p.bed_cooling = 0.0                                  # the bed stays warm
    p.execute("AUTO_EJECT")                              # from the end G-code
    assert state(p)["bg"] is True
    p.status["print_stats"]["state"] = "complete"
    p.execute("AUTO_EJECT_SET", KEY="enabled", VALUE="off")
    lines = p.fire("_AUTO_EJECT_BG")
    assert state(p)["bg"] is False and state(p)["cooling"] is False
    assert not any(l.startswith("SET_TMC_CURRENT") for l in lines) and "_AUTO_EJECT_RUN" not in p.calls
    assert any("auto-eject is off" in m for m in p.messages)
    assert len(state(p)["objects"]) == 2
