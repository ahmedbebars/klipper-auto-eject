"""Offset probes and eddy-current probes."""

import pytest

from klipper_sim import MacroError, Printer, rect, words

ROW = [("a", rect(100, 100, 140, 140)),
       ("b", rect(150, 100, 190, 140)),
       ("c", rect(200, 100, 240, 140))]


def machine(probe_section="probe", probe=None, objects=ROW, **settings):
    p = Printer(extra_settings=settings or None)
    p.set_machine(axis_min=(0, 0, -8), axis_max=(350, 350, 300),
                  position=(175, 175, 30), save_variables={})
    p.set_section(probe_section, probe or {"x_offset": 0.0, "y_offset": 0.0, "z_offset": 0.0})
    p.set_section("force_move", {"enable_force_move": True})
    p.set_section("stepper_z", {"endstop_pin": "probe:z_virtual_endstop"})
    p.set_objects(objects)
    return p


def nozzle_points(lines):
    """Nozzle XY at every probe command."""
    pts, last = [], None
    for l in lines:
        if l.startswith("G1") and "X" in words(l):
            last = (words(l)["X"], words(l)["Y"])
        elif l.split()[0] == "PROBE":
            pts.append(last)
    return pts


def over_any_part(pt, objects, margin=0.0):
    x, y = pt
    for _name, poly in objects:
        xs = [q[0] for q in poly]
        ys = [q[1] for q in poly]
        if min(xs) - margin < x < max(xs) + margin and min(ys) - margin < y < max(ys) + margin:
            return True
    return False


# ------------------------------------------------------------ offset probe
def owner(pt, objects):
    for name, poly in objects:
        xs = [q[0] for q in poly]
        ys = [q[1] for q in poly]
        if min(xs) <= pt[0] <= max(xs) and min(ys) <= pt[1] <= max(ys):
            return name
    return None


def test_offset_probe_never_lowers_the_nozzle_over_a_part():
    # BLTouch 50 mm to the right: probing "b" puts the nozzle over "a"
    p = machine(probe={"x_offset": 50.0, "y_offset": 0.0, "z_offset": 2.0})
    lines = p.execute("AUTO_EJECT", COOL=0)
    pts = nozzle_points(lines)
    assert len(pts) == 9                       # three points on each of a, b, c
    cleared = set()
    for nozzle in pts:
        probed = owner((nozzle[0] + 50.0, nozzle[1]), ROW)
        # the nozzle may only pass over parts already confirmed gone
        live = [o for o in ROW if o[0] not in cleared or o[0] == probed]
        assert not over_any_part(nozzle, live, margin=4.9), (nozzle, probed, cleared)
        cleared.add(probed)


def test_offset_probe_with_no_safe_point_stops_by_default():
    # one long part under the whole probe/nozzle reach
    p = machine(probe={"x_offset": 0.0, "y_offset": 30.0, "z_offset": 2.0},
                objects=[("wide", rect(20, 20, 330, 300))])
    with pytest.raises(MacroError, match="could not probe wide"):
        p.execute("AUTO_EJECT", COOL=0)


def test_offset_probe_unsafe_skip_only_warns():
    p = machine(probe={"x_offset": 0.0, "y_offset": 30.0, "z_offset": 2.0},
                objects=[("wide", rect(20, 20, 330, 300))],
                verify_unsafe_action="skip")
    p.execute("AUTO_EJECT", COOL=0)
    assert any("NOT verified" in m for m in p.messages)


def test_smart_home_keeps_probe_and_nozzle_clear():
    p = machine(probe={"x_offset": 40.0, "y_offset": 0.0, "z_offset": 2.0})
    p.execute("_AUTO_EJECT_PROBE_INFO")
    p.execute("_AUTO_EJECT_CAPTURE")
    p.status["toolhead"]["homed_axes"] = ""
    lines = [l for l in p.execute("_AUTO_EJECT_HOME") if l.startswith(("G1", "PROBE"))]
    nozzle = nozzle_points(lines)[0]
    probe = (nozzle[0] + 40.0, nozzle[1])
    for pt in (nozzle, probe):
        assert not over_any_part(pt, ROW, margin=19.9), pt


# -------------------------------------------------------------- eddy probes
@pytest.mark.parametrize("section", ["probe_eddy_current btt_eddy", "beacon",
                                     "cartographer", "probe_eddy_ng my_eddy"])
def test_eddy_probe_is_detected(section):
    p = machine(probe_section=section, probe={"x_offset": 0.0, "y_offset": 20.0, "z_offset": 2.0})
    p.execute("_AUTO_EJECT_PROBE_INFO")
    pb = p.status["gcode_macro _AUTO_EJECT_PROBE"]
    assert (pb["kind"], pb["section"], pb["y"]) == ("eddy", section, 20.0)


def test_eddy_without_contact_command_skips_verification_with_warning():
    p = machine(probe_section="probe_eddy_current btt_eddy",
                probe={"x_offset": 0.0, "y_offset": 20.0, "z_offset": 2.0})
    lines = p.execute("AUTO_EJECT", COOL=0)
    assert "PROBE" not in lines
    assert any("cannot see plastic" in m for m in p.messages)


def test_eddy_with_contact_command_verifies_with_it():
    p = machine(probe_section="beacon", probe={"x_offset": 0.0, "y_offset": 20.0, "z_offset": 0.0},
                verify_probe_gcode="PROBE PROBE_METHOD=contact")
    lines = p.execute("AUTO_EJECT", COOL=0)
    assert lines.count("PROBE PROBE_METHOD=contact") > 0
    assert any("bed verified clear" in m for m in p.messages)


def test_eddy_warning_in_setup_welcome():
    p = machine(probe_section="cartographer", probe={"x_offset": 0.0, "y_offset": 20.0})
    text = " | ".join(p.execute("AUTO_EJECT_SETUP"))
    assert "WARNING - eddy-current probe [cartographer]" in text


def test_probe_type_override():
    p = machine(probe_section="probe", probe_type="eddy")
    p.execute("_AUTO_EJECT_PROBE_INFO")
    assert p.status["gcode_macro _AUTO_EJECT_PROBE"]["kind"] == "eddy"


def test_custom_home_z_command_is_used_as_is():
    p = machine(probe_section="beacon", probe={"x_offset": 0.0, "y_offset": 20.0},
                home_z_gcode="G28 Z")
    p.execute("_AUTO_EJECT_PROBE_INFO")
    p.execute("_AUTO_EJECT_CAPTURE")
    p.status["toolhead"]["homed_axes"] = ""
    lines = p.execute("_AUTO_EJECT_HOME")
    assert "G28 Z" in lines and "PROBE" not in lines
