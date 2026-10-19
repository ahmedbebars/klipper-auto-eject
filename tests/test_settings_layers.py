"""Defaults, the user's settings file and saved overrides."""

import configparser

from klipper_sim import CONFIG_DIR, Printer, rect


def variables(section):
    parser = configparser.RawConfigParser(strict=False, inline_comment_prefixes=(";", "#"))
    parser.read([CONFIG_DIR / "auto_eject.cfg", CONFIG_DIR / "auto_eject_settings.cfg"],
                encoding="utf-8")
    return {k: v for k, v in parser.items("gcode_macro " + section) if k.startswith("variable_")}


def test_defaults_match_the_settings_template():
    # every documented setting has a default, with the same value
    assert variables("_AUTO_EJECT_DEFAULTS") == variables("_AUTO_EJECT_SETTINGS")


def test_old_settings_file_without_new_options_still_works():
    p = Printer()
    user = p.status["gcode_macro _AUTO_EJECT_SETTINGS"]
    for key in ["persist_state", "guard_action", "home_method", "home_clearance",
                "home_edge_margin", "cool_fan_speed", "verify_points"]:
        user.pop(key)
    p.set_machine(save_variables={},
                  probe={"x_offset": 0.0, "y_offset": 0.0, "z_offset": -0.3})
    p.set_objects([("part", rect(100, 100, 150, 160))])
    p.execute("AUTO_EJECT", COOL=0)
    assert any("bed verified clear" in m for m in p.messages)
    # persist_state comes from the defaults, so the state was saved and cleared
    assert p.status["save_variables"]["variables"]["auto_eject_objects"] == []


def test_settings_file_overrides_defaults_and_saved_values_override_both():
    p = Printer()
    p.status["gcode_macro _AUTO_EJECT_SETTINGS"]["push_z"] = 3.0
    p.set_objects([("part", rect(100, 100, 150, 160))])
    lines = p.execute("AUTO_EJECT", COOL=0, VERIFY=0)
    assert "G1 Z3.0 F600" in lines
    p.status["gcode_macro _AUTO_EJECT_OVERRIDES"]["data"] = {"push_z": 2.2}
    lines = p.execute("AUTO_EJECT", COOL=0, VERIFY=0)
    assert "G1 Z2.2 F600" in lines
