"""Cooling: the toolhead circles over the parts with the fan on."""

import pytest

from klipper_sim import Printer, rect, words

PARTS = [("a", rect(100, 150, 125, 175)), ("b", rect(300, 200, 325, 225))]
CENTRES = {(112.5, 162.5), (312.5, 212.5)}


def make(height=10.0, bed=60.0, cooling=0.5, **settings):
    p = Printer(extra_settings=settings)
    p.set_machine(position=(225, 225, 10.2), save_variables={},
                  probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3})
    p.set_objects(PARTS)
    p.execute("_AUTO_EJECT_CAPTURE")
    p.status["gcode_macro _AUTO_EJECT_STATE"]["height"] = height
    p.status["heater_bed"]["temperature"] = bed
    p.bed_cooling = cooling
    return p


def hovers(lines):
    """(x, y, z, seconds) for every dwell over a part."""
    out, z, xy = [], None, None
    for line in lines:
        w = words(line)
        if line.startswith("G1") and "Z" in w and "X" not in w:
            z = w["Z"]
        elif line.startswith("G1") and "X" in w and "Y" in w:
            xy = (w["X"], w["Y"])
        elif line.startswith("G4") and xy is not None:
            out.append((xy[0], xy[1], z, w["P"] / 1000.0))
            xy = None
    return out


def cooling_part(lines):
    return lines[:lines.index("SAVE_GCODE_STATE NAME=_auto_eject")]


def test_circles_over_every_part_until_the_bed_is_cool():
    p = make(bed=60.0, cooling=0.5, cool_temp=32)       # 2 parts x 7.5 s: 7.5 degrees a pass
    lines = cooling_part(p.execute("AUTO_EJECT"))
    assert "M106 S255" in lines
    h = hovers(lines)
    assert {(x, y) for x, y, _, _ in h} == CENTRES
    assert all(z == pytest.approx(18.0) for _, _, z, _ in h)  # 10 mm part + 8 mm
    assert len(h) == 8                                        # 4 passes x 2 parts
    assert p.status["heater_bed"]["temperature"] <= 32
    assert not any("pushing anyway" in m for m in p.messages)


def test_warm_room_pushes_anyway_after_cool_timeout():
    p = make(cooling=0.0)                               # the bed never gets to 32 C
    lines = p.execute("AUTO_EJECT")
    waited = sum(s for *_, s in hovers(cooling_part(lines)))
    assert waited == pytest.approx(1800.0)
    assert any("pushing anyway" in m for m in p.messages)
    assert any(l.startswith("SET_TMC_CURRENT") for l in lines)    # and it did push


def test_tour_can_be_turned_off():
    p = make(cool_tour=False)
    lines = cooling_part(p.execute("AUTO_EJECT"))
    assert hovers(lines) == []
    assert "G4 P15000" in lines                         # still waits, standing still


def test_time_mode_circles_for_cool_time():
    p = make(cool_mode="time", cool_time=60, cooling=0.0)
    lines = cooling_part(p.execute("AUTO_EJECT"))
    total = sum(s for *_, s in hovers(lines))
    assert total == pytest.approx(60.0)                 # 6 passes x 2 parts x 5 s
    assert not any(l.startswith("G4 P60000") for l in lines)


def test_unknown_height_keeps_the_safe_height():
    p = make(height=0.0, cooling=1.0)
    h = hovers(cooling_part(p.execute("AUTO_EJECT")))
    assert h and all(z >= 20.0 for _, _, z, _ in h)


def test_blade_hanging_below_the_nozzle_gets_more_room():
    p = make(cooling=1.0, blade_lift=-2.0)
    h = hovers(cooling_part(p.execute("AUTO_EJECT")))
    assert all(z == pytest.approx(20.0) for _, _, z, _ in h)


def test_no_tour_without_cooling():
    p = make()
    assert hovers(cooling_part(p.execute("AUTO_EJECT", COOL=0))) == []
    p.execute("AUTO_EJECT", DRY=1)
    assert "_AUTO_EJECT_COOL_PASS" not in p.calls


def test_bed_already_cool_means_no_pass():
    p = make(bed=25.0, cool_temp=28)
    assert hovers(cooling_part(p.execute("AUTO_EJECT"))) == []


# ------------------------------------------------------- cool_temps by material
def test_a_material_of_its_own_cools_to_its_temperature():
    p = make(bed=60.0, cooling=0.5, cool_temp=32, cool_temps="PETG=25,ABS=45")
    p.execute("AUTO_EJECT", MATERIAL="PETG")
    assert p.status["heater_bed"]["temperature"] <= 25
    assert any("waiting for the bed to reach 25 C for PETG" in m for m in p.messages)


def test_the_name_from_the_slicer_may_be_lower_case_or_spaced():
    p = make(bed=60.0, cooling=0.5, cool_temps="PETG = 25, abs=45")
    p.execute("AUTO_EJECT", MATERIAL="petg")
    assert p.status["heater_bed"]["temperature"] <= 25


def test_a_material_not_listed_uses_cool_temp():
    p = make(bed=60.0, cooling=0.5, cool_temp=32, cool_temps="PETG=25")
    p.execute("AUTO_EJECT", MATERIAL="ASA")
    assert 25 < p.status["heater_bed"]["temperature"] <= 32
    assert any("waiting for the bed to reach 32 C," in m for m in p.messages)


def test_pla_plus_takes_plas_unless_it_has_its_own():
    p = make(bed=60.0, cooling=0.5, cool_temps="PLA=28")
    p.execute("AUTO_EJECT", MATERIAL="PLA+")
    assert p.status["heater_bed"]["temperature"] <= 28
    p = make(bed=60.0, cooling=0.5, cool_temps="PLA=28,PLA+=26")
    p.execute("AUTO_EJECT", MATERIAL="PLA+")
    assert p.status["heater_bed"]["temperature"] <= 26


def test_a_warmer_material_pushes_sooner():
    p = make(bed=40.0, cooling=0.5, cool_temp=32, cool_temps="ABS=45")
    assert hovers(cooling_part(p.execute("AUTO_EJECT", MATERIAL="ABS"))) == []


def test_the_next_print_without_material_is_back_on_cool_temp():
    p = make(bed=60.0, cooling=0.5, cool_temp=32, cool_temps="PETG=25")
    p.execute("AUTO_EJECT", MATERIAL="PETG")
    p.set_objects(PARTS)
    p.execute("_AUTO_EJECT_CAPTURE")
    p.status["heater_bed"]["temperature"] = 60.0
    p.execute("AUTO_EJECT")
    assert 25 < p.status["heater_bed"]["temperature"] <= 32
    assert p.status["gcode_macro _AUTO_EJECT_STATE"]["cool_for"] == ""


def test_entries_that_are_not_a_temperature_are_left_out():
    p = make(bed=60.0, cooling=0.5, cool_temp=32, cool_temps="PETG=warm,=20,ABS,PETG=0")
    p.execute("AUTO_EJECT", MATERIAL="PETG")
    assert 25 < p.status["heater_bed"]["temperature"] <= 32


def test_a_warm_room_names_the_material_to_change():
    p = make(cooling=0.0, cool_temps="PETG=25")
    p.execute("AUTO_EJECT", MATERIAL="PETG")
    assert any("not 25 C: pushing anyway. If the room is warm, raise the PETG temperature in cool_temps." in m
               for m in p.messages)
