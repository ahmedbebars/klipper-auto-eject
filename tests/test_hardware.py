"""push/hardware.py: hardware warnings for the phones, with the page closed."""

import pathlib
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "push"))

import hardware  # noqa: E402

OBJECTS = ["mcu", "mcu toolboard", "canbus_stats toolboard", "tmc5160 stepper_x", "tmc2209 extruder", "extruder",
           "heater_bed", "fan", "heater_fan hotend_fan", "temperature_sensor motor_a", "temperature_sensor chamber"]


class FakeMoonraker:
    def __init__(self):
        self.state = "ready"
        self.status = {
            "mcu": {"last_stats": {"bytes_retransmit": 9, "bytes_invalid": 0}},
            "mcu toolboard": {"last_stats": {"bytes_retransmit": 0, "bytes_invalid": 0}},
            "canbus_stats toolboard": {"rx_error": 0, "tx_error": 0, "tx_retries": 0, "bus_state": "active"},
            "tmc5160 stepper_x": {"drv_status": {"cs_actual": 16, "sg_result": 120}},
            "tmc2209 extruder": {"drv_status": {"cs_actual": 12}},
            "extruder": {"temperature": 25.0, "target": 0, "power": 0},
            "heater_bed": {"temperature": 25.0, "target": 0, "power": 0},
            "fan": {"speed": 0, "rpm": None},
            "heater_fan hotend_fan": {"speed": 0, "rpm": 0},
            "temperature_sensor motor_a": {"temperature": 40.0},
        }
        self.proc = {"cpu_temp": 45.0, "system_memory": {"total": 2000, "available": 1500}, "throttled_state": None}
        self.disk = {"total": 3e10, "free": 2e10}
        self.queries = []

    def call(self, path):
        if path == "/printer/info":
            return {"state": self.state}
        if path == "/printer/objects/list":
            return {"objects": OBJECTS}
        if path.startswith("/printer/objects/query?"):
            self.queries.append(path)
            asked = [urllib.parse.unquote(p.split("=")[0]) for p in path.split("?", 1)[1].split("&")]
            return {"status": {k: self.status[k] for k in asked if k in self.status}}
        if path == "/machine/proc_stats":
            return self.proc
        if path.startswith("/server/files/directory"):
            return {"disk_usage": self.disk}
        raise AssertionError(path)


def run(w, mr, seconds, start=0, step=5):
    out = []
    for t in range(start, start + seconds, step):
        out += w.check(mr, now=t)
    return out


def test_a_quiet_machine_says_nothing():
    w, mr = hardware.HardwareWatcher(), FakeMoonraker()
    assert run(w, mr, 300) == []
    # the chamber's sensor is not a motor's: never asked
    assert "chamber" not in mr.queries[-1]


def test_a_driver_warning_is_told_once_and_again_after_it_cleared():
    w, mr = hardware.HardwareWatcher(), FakeMoonraker()
    run(w, mr, 20)
    mr.status["tmc5160 stepper_x"]["drv_status"]["otpw"] = 1
    got = run(w, mr, 60, start=20)
    assert len(got) == 1
    kind, words, level = got[0]
    assert (kind, level) == ("hardware", "warn")
    assert words["en"] == "Motor X: the driver is getting hot" and words["ar"] == "المحرك X: المشغّل يسخن"
    del mr.status["tmc5160 stepper_x"]["drv_status"]["otpw"]
    assert run(w, mr, 200, start=80) == []                  # cleared for two minutes
    mr.status["tmc5160 stepper_x"]["drv_status"]["otpw"] = 1
    assert len(run(w, mr, 20, start=280)) == 1              # back: told again


def test_open_load_and_stallguard_are_no_alarm():
    w, mr = hardware.HardwareWatcher(), FakeMoonraker()
    mr.status["tmc5160 stepper_x"]["drv_status"].update(ola=1, olb=1, sg_result=0)
    assert run(w, mr, 120) == []


def test_a_hotend_fan_that_stops():
    w, mr = hardware.HardwareWatcher(), FakeMoonraker()
    mr.status["heater_fan hotend_fan"] = {"speed": 1.0, "rpm": 6800}
    assert run(w, mr, 30) == []
    mr.status["heater_fan hotend_fan"] = {"speed": 1.0, "rpm": 0}
    got = run(w, mr, 30, start=30)
    assert [(g[1]["en"], g[2]) for g in got] == [("The fan hotend fan is not turning.", "bad")]
    # a fan without a speed sensor says nothing
    mr.status["fan"] = {"speed": 1.0, "rpm": None}
    assert run(w, mr, 30, start=60) == []


def test_a_heater_that_cannot_hold_its_target():
    w, mr = hardware.HardwareWatcher(), FakeMoonraker()
    mr.status["extruder"] = {"temperature": 30.0, "target": 220, "power": 1.0}
    assert run(w, mr, 120) == []                            # warming up at full power
    mr.status["extruder"] = {"temperature": 220.5, "target": 220, "power": 0.3}
    run(w, mr, 10, start=120)
    mr.status["extruder"] = {"temperature": 210.0, "target": 220, "power": 1.0}
    got = run(w, mr, 60, start=130)
    assert [g[1]["en"] for g in got] == ["The hotend cannot hold 220 °C at full power."]


def test_a_board_link_resending_data_and_the_can_bus():
    w, mr = hardware.HardwareWatcher(), FakeMoonraker()
    run(w, mr, 20)
    mr.status["mcu"]["last_stats"]["bytes_retransmit"] = 60    # a few: normal
    assert run(w, mr, 20, start=20) == []
    mr.status["mcu"]["last_stats"]["bytes_retransmit"] = 400
    got = run(w, mr, 10, start=40)
    assert len(got) == 1 and got[0][1]["en"].startswith("The link to the main board is resending data (391 bytes")
    mr.status["canbus_stats toolboard"]["bus_state"] = "passive"
    got = run(w, mr, 20, start=50)
    assert [(g[1]["en"], g[2]) for g in got] == [("CAN bus to toolboard: error passive", "bad")]


def test_a_klipper_restart_starts_the_counters_again():
    w, mr = hardware.HardwareWatcher(), FakeMoonraker()
    mr.status["mcu"]["last_stats"]["bytes_retransmit"] = 5000
    run(w, mr, 20)
    mr.state = "startup"
    assert run(w, mr, 10, start=20) == []
    mr.state = "ready"
    mr.status["mcu"]["last_stats"]["bytes_retransmit"] = 3
    assert run(w, mr, 30, start=30) == []                   # from 5000 to 3 is a restart, not a fault


def test_a_hot_motor_and_the_computer():
    w, mr = hardware.HardwareWatcher(), FakeMoonraker()
    mr.status["temperature_sensor motor_a"]["temperature"] = 83.0
    mr.proc.update(cpu_temp=84.0, throttled_state={"bits": 1, "flags": ["Under-Voltage Detected"]})
    mr.disk = {"total": 3e10, "free": 4e8}
    got = {g[1]["en"]: g[2] for g in run(w, mr, 90)}
    assert got == {"motor a is at 83 °C": "bad", "The printer's computer is at 84 °C.": "warn",
                   "The printer's computer has too little supply voltage: use a stronger power supply.": "bad",
                   "Storage is nearly full: 0.4 GB free.": "warn"}


def test_a_moonraker_that_does_not_answer_is_no_warning():
    class Down:
        def call(self, path):
            raise OSError("down")
    assert hardware.HardwareWatcher().check(Down(), now=0) == []
