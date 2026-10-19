"""AUTO_EJECT_SET: change one setting from the console or the web page."""

import pytest

from klipper_sim import MacroError, Printer


@pytest.fixture
def p():
    pr = Printer()
    pr.set_machine(save_variables={})
    return pr


def overrides(p):
    return p.status["gcode_macro _AUTO_EJECT_OVERRIDES"]["data"]


def saved(p):
    return p.status["save_variables"]["variables"]


@pytest.mark.parametrize("key, value, expect", [
    ("cool_temp", "35", 35),               # integer setting stays an integer
    ("push_current", "0.55", 0.55),
    ("push_z", "1", 1.0),                  # float setting given a whole number
    ("verify", "off", False),
    ("cool_tour", "TRUE", True),
    ("direction", "left", "left"),
    ("blade_lift", "1.4", 1.4),            # "unknown" until measured
])
def test_values_keep_their_type(p, key, value, expect):
    p.execute("AUTO_EJECT_SET", KEY=key, VALUE=value)
    assert overrides(p)[key] == expect and type(overrides(p)[key]) is type(expect)
    assert saved(p)["auto_eject_" + key] == expect


def test_saved_values_come_back_after_a_restart(p):
    p.execute("AUTO_EJECT_SET", KEY="cool_temp", VALUE="34")
    p.execute("AUTO_EJECT_SET", KEY="verify", VALUE="false")
    p.status["gcode_macro _AUTO_EJECT_OVERRIDES"]["data"] = {}
    p.execute("_AUTO_EJECT_APPLY_SAVED")
    assert overrides(p) == {"cool_temp": 34, "verify": False}


def test_reset_goes_back_to_the_file(p):
    p.execute("AUTO_EJECT_SET", KEY="cool_temp", VALUE="34")
    p.execute("AUTO_EJECT_SET", KEY="retries", VALUE="2")
    p.execute("AUTO_EJECT_SET", KEY="cool_temp", RESET=1)
    assert overrides(p) == {"retries": 2}
    assert saved(p)["auto_eject_cool_temp"] is None


@pytest.mark.parametrize("key, value, message", [
    ("no_such_thing", "1", "unknown setting"),
    ("cool_temp", "warm", "needs a number"),
    ("verify", "maybe", "on or off"),
    ("direction", "fr'ont", "not a valid value"),
    ("direction", "", "not a valid value"),
])
def test_bad_input_is_refused(p, key, value, message):
    with pytest.raises(MacroError, match=message):
        p.execute("AUTO_EJECT_SET", KEY=key, VALUE=value)
    assert overrides(p) == {}


def test_without_save_variables_it_lasts_until_restart():
    pr = Printer()
    pr.set_machine()
    pr.execute("AUTO_EJECT_SET", KEY="cool_temp", VALUE="33")
    assert pr.status["gcode_macro _AUTO_EJECT_OVERRIDES"]["data"]["cool_temp"] == 33
    assert any("until the next restart" in m for m in pr.messages)
