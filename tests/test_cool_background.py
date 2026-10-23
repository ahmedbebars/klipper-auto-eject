"""Cooling with the printer free (cool_background): push now, or take the parts off."""

import pytest

from klipper_sim import MacroError, Printer, rect

PARTS = [("a", rect(100, 150, 125, 175)), ("b", rect(300, 200, 325, 225))]


def make(bed=60.0, cooling=0.0, printing=True, **settings):
    settings.setdefault("cool_background", True)
    p = Printer(extra_settings=settings)
    p.set_machine(position=(225, 225, 10.2), save_variables={},
                  probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3})
    p.set_objects(PARTS)
    p.execute("_AUTO_EJECT_CAPTURE")
    p.status["gcode_macro _AUTO_EJECT_STATE"]["height"] = 10.0
    p.status["heater_bed"]["temperature"] = bed
    p.status["print_stats"] = {"state": "printing" if printing else "standby", "filename": "parts.gcode",
                               "total_duration": 3600.0}
    p.bed_cooling = cooling
    return p


def eject(p):
    """AUTO_EJECT from the print's end G-code; the print then ends, and the
    background steps go on. Returns every command run."""
    lines = p.execute("AUTO_EJECT")
    if p.status["print_stats"]["state"] == "printing":
        p.status["print_stats"]["state"] = "complete"
        lines += p.fire("_AUTO_EJECT_BG")
    return lines


def state(p):
    return p.status["gcode_macro _AUTO_EJECT_STATE"]


def pushed(lines):
    return any(l.startswith("SET_TMC_CURRENT") for l in lines)


def test_off_by_default_the_eject_waits_inside_the_print():
    p = Printer()
    assert p.status["gcode_macro _AUTO_EJECT_DEFAULTS"]["cool_background"] is False


def test_from_a_print_the_queue_waits_and_the_bed_cools_in_steps():
    p = make(cooling=0.0)                                  # the bed stays warm
    lines = eject(p)
    st = state(p)
    assert st["bg"] is True and st["cooling"] is True and st["busy"] is True
    assert p.remote_calls == ["pause_job_queue"]
    assert "M106 S255" in lines and not pushed(lines)
    # each step is one short hover, then Klipper is free until the next
    assert st["bg_i"] > 1 and any("printer free" in m for m in p.messages)


def test_push_now_pushes_at_the_next_step_and_the_queue_goes_on():
    p = make(cooling=0.0)
    eject(p)
    p.run_gcode("AUTO_EJECT_PUSH_NOW")
    assert state(p)["push_now"] is True
    lines = p.fire("_AUTO_EJECT_BG")
    assert pushed(lines) and "M107" in lines
    st = state(p)
    assert st["bg"] is False and st["busy"] is False and st["objects"] == []
    assert p.remote_calls[-1] == "start_job_queue"
    assert any("pushing now, as asked" in m for m in p.messages)


def test_the_bed_cools_by_itself_then_the_eject_goes_on():
    p = make(cooling=0.5, cool_temp=32)                    # 2.5 degrees per 5 s step
    lines = eject(p)
    assert pushed(lines)
    assert p.status["heater_bed"]["temperature"] <= 32
    st = state(p)
    assert st["bg"] is False and st["objects"] == []
    assert p.remote_calls == ["pause_job_queue", "start_job_queue"]


def test_parts_taken_off_by_hand_while_it_cools():
    p = make(cooling=0.0)
    eject(p)
    lines = p.run_gcode("AUTO_EJECT_CLEAR")
    assert "M107" in lines and not pushed(lines)
    st = state(p)
    assert st["bg"] is False and st["cooling"] is False and st["busy"] is False and st["objects"] == []
    assert p.fire("_AUTO_EJECT_BG") == []                  # nothing moves any more
    # a hand may still be in the printer: the next print waits for "continue"
    assert p.remote_calls == ["pause_job_queue"]
    assert any("job queue waits" in m for m in p.messages)
    p.run_gcode("AUTO_EJECT_CONTINUE")
    assert p.remote_calls == ["pause_job_queue", "start_job_queue"]
    assert state(p)["bg_held"] is False


def test_continue_is_refused_while_the_bed_still_cools():
    p = make(cooling=0.0)
    eject(p)
    with pytest.raises(MacroError, match="still cooling"):
        p.run_gcode("AUTO_EJECT_CONTINUE")
    assert "start_job_queue" not in p.remote_calls


def test_by_hand_from_the_console_the_queue_is_left_alone():
    p = make(cooling=0.5, printing=False)
    p.execute("AUTO_EJECT")
    assert "pause_job_queue" not in p.remote_calls and "start_job_queue" not in p.remote_calls
    assert state(p)["objects"] == []


def test_the_guard_holds_a_print_started_while_the_bed_cools():
    p = make(cooling=0.0)
    eject(p)
    with pytest.raises(MacroError, match="still on the bed, cooling"):
        p.execute("AUTO_EJECT_GUARD")


def test_a_second_eject_is_refused_while_the_bed_cools():
    p = make(cooling=0.0)
    eject(p)
    with pytest.raises(MacroError, match="already cooling"):
        p.execute("AUTO_EJECT")


def test_a_print_started_anyway_stops_the_cooling_without_moving():
    p = make(cooling=0.0)
    eject(p)
    p.status["print_stats"].update(state="printing", total_duration=5.0)    # a new print, without the guard
    lines = p.fire("_AUTO_EJECT_BG")
    assert not any(l.startswith(("G1", "G28", "M107", "SET_TMC")) for l in lines)
    assert state(p)["bg"] is False and state(p)["busy"] is False


def test_the_tracker_does_not_take_cooling_for_a_stopped_eject():
    p = make(cooling=0.0)
    eject(p)                                               # the print ended, the bed still cools
    p.execute("_AUTO_EJECT_TRACK_STEP")
    assert state(p)["busy"] is True and state(p)["bg"] is True
    assert not any("an error stopped" in m for m in p.messages)


def test_push_now_without_a_cooling_eject_says_so():
    p = make(cooling=0.0)
    with pytest.raises(MacroError, match="no eject is waiting"):
        p.execute("AUTO_EJECT_PUSH_NOW")


def test_the_print_that_started_it_may_still_run_its_last_lines():
    p = make(cooling=0.0)
    lines = p.execute("AUTO_EJECT")                        # the print has not ended yet
    assert state(p)["bg"] is True and not any(l.startswith("G1 X") for l in lines[lines.index("M106 S255"):])
    p.status["print_stats"]["state"] = "complete"
    assert any(l.startswith("G1 X") for l in p.fire("_AUTO_EJECT_BG"))    # then it hovers over the parts


def test_a_cool_bed_needs_no_background():
    p = make(bed=25.0, cool_temp=32)
    lines = p.execute("AUTO_EJECT")
    assert pushed(lines) and state(p)["bg"] is False
    assert "pause_job_queue" not in p.remote_calls
