"""Probes that touch the bed with the nozzle wait for it to cool first."""

from klipper_sim import Printer, rect

WAIT = "TEMPERATURE_WAIT SENSOR=extruder MAXIMUM=150.0"


def make(probe=(0.0, 0.0), nozzle=215.0, target=0.0, **settings):
    p = Printer(extra_settings=settings)
    p.set_machine(position=(225, 225, 30), homed="", save_variables={},
                  probe={"x_offset": probe[0], "y_offset": probe[1], "z_offset": -0.3})
    p.set_section("force_move", {"enable_force_move": True})
    p.set_section("stepper_z", {"endstop_pin": "probe:z_virtual_endstop"})
    p.set_objects([("cube", rect(200, 200, 230, 230))])
    p.status["extruder"].update(temperature=nozzle, target=target)
    return p


def test_tap_waits_before_homing_z_after_the_end_macro():
    p = make()
    lines = p.execute("AUTO_EJECT", HOME=1, HEIGHT=10)
    first_probe = lines.index("PROBE")
    assert WAIT in lines[:first_probe]
    assert any("waiting for the nozzle to cool to 150 C" in m for m in p.messages)


def test_cool_nozzle_does_not_wait():
    p = make(nozzle=60.0)
    assert WAIT not in p.execute("AUTO_EJECT", HOME=1, HEIGHT=10)


def test_offset_probe_does_not_wait():
    p = make(probe=(-25.0, 0.0))
    assert WAIT not in p.execute("AUTO_EJECT", HOME=1, HEIGHT=10)


def test_can_be_turned_off():
    p = make(nozzle_probe_max_temp=0)
    assert WAIT not in p.execute("AUTO_EJECT", HOME=1, HEIGHT=10)


def test_nozzle_kept_hot_on_purpose_is_not_waited_for():
    p = make(target=200.0, heaters_off=False)
    lines = p.execute("AUTO_EJECT", HOME=1, HEIGHT=10, COOL=0)
    assert WAIT not in lines
    assert any("touches the bed anyway" in m for m in p.messages)


def test_eddy_touch_mode_waits_plain_eddy_does_not_touch():
    p = make(probe_type="eddy", home_z_gcode="PROBE METHOD=tap")
    assert WAIT in p.execute("AUTO_EJECT", HOME=1, HEIGHT=10)
