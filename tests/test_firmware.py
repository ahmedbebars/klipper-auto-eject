"""install.sh --firmware: bringing the boards' firmware to Klipper's version."""

import io
import json
import os
import pathlib
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))

import firmware as fwm  # noqa: E402

HOST = "v0.13.0-816-gabcdef12"
OLD = "v0.13.0-800-g1234abcd"

# the parts of Klipper's Kconfig files the tool reads, in their own syntax
MAIN = """
config LOW_LEVEL_OPTIONS
    bool "Enable extra low-level configuration options"

config CANBUS_FREQUENCY
    int "CAN bus speed" if LOW_LEVEL_OPTIONS && CANBUS
    default 1000000

config SERIAL_BAUD
    int "Baud rate for serial port" if LOW_LEVEL_OPTIONS && SERIAL
    default 250000

config MCU
    string
"""
STM32 = """
choice
    prompt "Processor model"
    config MACH_STM32F103
        bool "STM32F103"
        select MACH_STM32F1
    config MACH_STM32F446
        bool "STM32F446"
        select MACH_STM32F4
    config MACH_STM32G0B1
        bool "STM32G0B1"
        select MACH_STM32G0
        select MACH_STM32G0Bx
endchoice

config MACH_STM32F1
    bool
config MACH_STM32F4
    bool

choice
    prompt "Bootloader offset"
    config STM32_FLASH_START_2000
        bool "8KiB bootloader" if MACH_STM32F1 || MACH_STM32G0
    config STM32_FLASH_START_8000
        bool "32KiB bootloader" if MACH_STM32F1 || MACH_STM32F4
    config STM32_FLASH_START_C000
        bool "48KiB bootloader" if MACH_STM32F4
    config STM32_FLASH_START_10000
        bool "64KiB bootloader" if MACH_STM32F1 || MACH_STM32F4
    config STM32_FLASH_START_0000
        bool "No bootloader"
endchoice
config FLASH_APPLICATION_ADDRESS
    hex
    default 0x8002000 if STM32_FLASH_START_2000

choice
    prompt "Clock Reference" if LOW_LEVEL_OPTIONS
    config STM32_CLOCK_REF_8M
        bool "8 MHz crystal"
    config STM32_CLOCK_REF_12M
        bool "12 MHz crystal"
    config STM32_CLOCK_REF_25M
        bool "25 MHz crystal"
    config STM32_CLOCK_REF_INTERNAL
        bool "Internal clock"
endchoice

choice
    prompt "Communication interface"
    config STM32_USB_PA11_PA12
        bool "USB (on PA11/PA12)" if HAVE_STM32_USBFS || HAVE_STM32_USBOTG
        select USBSERIAL
    config STM32_USB_PA11_PA12_REMAP
        bool "USB (on PA9/PA10)"
        select USBSERIAL
    config STM32_SERIAL_USART1
        bool "Serial (on USART1 PA10/PA9)"
        select SERIAL
    config STM32_CANBUS_PA11_PA12
        bool "CAN bus (on PA11/PA12)"
        select CANSERIAL
    config STM32_MMENU_CANBUS_PB0_PB1
        bool "CAN bus (on PB0/PB1)"
        select CANSERIAL
    config STM32_USBCANBUS_PA11_PA12
        bool "USB to CAN bus bridge (USB on PA11/PA12)"
        select USBCANBUS
endchoice
choice
    prompt "CAN bus interface" if USBCANBUS
    config STM32_CMENU_CANBUS_PB0_PB1
        bool "CAN bus (on PB0/PB1)"
    config STM32_CMENU_CANBUS_PB5_PB6
        bool "CAN bus (on PB5/PB6)"
endchoice

config STM32_CANBUS_PB0_PB1
    bool
    default y if STM32_MMENU_CANBUS_PB0_PB1 || STM32_CMENU_CANBUS_PB0_PB1
"""
RP2040 = """
choice
    prompt "Bootloader offset"
    config RPXXXX_FLASH_START_0000
        bool "No bootloader"
        depends on MACH_RP2350
    config RPXXXX_FLASH_START_0100
        bool "No bootloader"
        depends on MACH_RP2040
        select RP2040_HAVE_STAGE2
    config RPXXXX_FLASH_START_4000
        bool "16KiB bootloader"
        select RPXXXX_HAVE_BOOTLOADER
endchoice

choice
    prompt "Flash chip" if LOW_LEVEL_OPTIONS && RP2040_HAVE_STAGE2
    config RP2040_FLASH_W25Q080
        bool "W25Q080 with CLKDIV 2"
    config RP2040_FLASH_GENERIC_03
        bool "GENERIC_03H with CLKDIV 4"
endchoice

choice
    prompt "Communication Interface"
    config RPXXXX_USB
        bool "USBSERIAL"
    config RPXXXX_CANBUS
        bool "CAN bus"
    config RPXXXX_USBCANBUS
        bool "USB to CAN bus bridge"
endchoice

config RPXXXX_CANBUS_GPIO_RX
    int "CAN RX gpio number" if CANBUS
    default 4
"""
KCONFIGS = {"stm32": STM32, "rp2040": RP2040}

G0B1_CAN = {"MCU": "stm32g0b1xx", "CLOCK_FREQ": 64000000, "CANBUS_FREQUENCY": 1000000,
            "RESERVE_PINS_CAN": "PB0,PB1", "RESERVE_PINS_crystal": "PF0,PF1"}
G0B1_KCONFIG = ("CONFIG_LOW_LEVEL_OPTIONS=y\nCONFIG_MACH_STM32=y\nCONFIG_MACH_STM32G0B1=y\nCONFIG_STM32_FLASH_START_2000=y\n"
                "CONFIG_STM32_CLOCK_REF_8M=y\nCONFIG_STM32_MMENU_CANBUS_PB0_PB1=y\n")
F446_USB = {"MCU": "stm32f446xx", "CLOCK_FREQ": 180000000, "RESERVE_PINS_USB": "PA11,PA12", "RESERVE_PINS_crystal": "PH0,PH1"}
HOST_MCU = {"MCU": "linux", "CLOCK_FREQ": 50000000}


def board(name="toolhead", version=OLD, constants=None, kconfig=None, link=None):
    constants = G0B1_CAN if constants is None else constants
    return {"name": name, "object": "mcu " + name, "version": version, "constants": constants, "kconfig": kconfig,
            "chip": str(constants.get("MCU", "")), "link": link or {"kind": "can", "uuid": "aabbccddeeff", "interface": "can0"}}


@pytest.fixture
def printer(tmp_path, monkeypatch):
    klipper = tmp_path / "klipper"
    for arch in ("stm32", "rp2040"):
        (klipper / "src" / arch).mkdir(parents=True)
    (klipper / "src" / "Kconfig").write_text(MAIN)
    (klipper / "src" / "stm32" / "Kconfig").write_text(STM32)
    (klipper / "src" / "rp2040" / "Kconfig").write_text(RP2040)
    config = tmp_path / "printer_data" / "config"
    config.mkdir(parents=True)
    monkeypatch.setattr(fwm.time, "sleep", lambda s: None)
    monkeypatch.setattr(fwm.shutil, "which", lambda name: "/usr/bin/" + name)
    return SimpleNamespace(klipper=klipper, config=config, work=tmp_path / "work", events=[])


class FakeMoon:
    """Moonraker for a printer whose boards are {object: (version, constants, kconfig, settings)}."""

    def __init__(self, printer, mcus, state="ready", print_state="standby", objects=None):
        self.printer, self.state, self.calls = printer, state, printer.events
        self.mcus = {o: {"mcu_version": v, "mcu_constants": c, "mcu_kconfig": k} for o, (v, c, k, _) in mcus.items()}
        self.settings = {o: s for o, (_, _, _, s) in mcus.items()}
        self.objects = {"print_stats": {"state": print_state}, "idle_timeout": {"state": "Idle"},
                        "heaters": {"available_heaters": ["extruder"]}, "extruder": {"target": 0}}
        self.objects.update(objects or {})
        self.queue = {"queue_state": "ready", "queued_jobs": []}

    def call(self, path, data=None):
        self.calls.append(path)
        if path == "/printer/info":
            return {"state": self.state, "state_message": "", "software_version": HOST,
                    "klipper_path": str(self.printer.klipper), "python_path": "/home/pi/klippy-env/bin/python",
                    "config_file": str(self.printer.config / "printer.cfg"), "log_file": ""}
        if path == "/printer/objects/list":
            return {"objects": list(self.objects) + list(self.mcus) + ["configfile"]}
        if path == "/machine/system_info":
            return {"system_info": {"instance_ids": {"klipper": "klipper"}}}
        if path == "/server/job_queue/status":
            return self.queue
        if path.startswith("/machine/services/start"):
            for m in self.mcus.values():
                m["mcu_version"] = HOST
        return {}

    def query(self, objects):
        every = dict(self.objects, **self.mcus)
        every["configfile"] = {"settings": self.settings}
        return {o: {k: v for k, v in every[o].items() if not f or k in f} for o, f in objects.items() if o in every}


def arg(cmd, prefix):
    return next(c[len(prefix):] for c in cmd if c.startswith(prefix))


class FakeRun:
    """make and the flash tools: make writes what Klipper's build would."""

    def __init__(self, printer, built=None, start=0x8002000, fail=None, drop=None):
        self.events, self.built, self.start, self.fail, self.drop = printer.events, built or {}, start, fail, drop
        self.cmds = []

    def __call__(self, cmd, log=None, cwd=None, show=False, check=True):
        cmd = [str(c) for c in cmd]
        self.cmds.append(cmd)
        self.events.append(" ".join(cmd))
        if self.fail:
            self.fail(cmd)
        if cmd[0] == "make" and cmd[-1] == "olddefconfig":
            cfg = pathlib.Path(arg(cmd, "KCONFIG_CONFIG="))
            text = cfg.read_text().replace(self.drop or "\0", "")
            values = fwm.read_kconfig(text)
            start = [k for k in values if k.startswith("CONFIG_STM32_FLASH_START_")]
            extra = ['CONFIG_MCU="whatever"']
            if start:
                extra.append("CONFIG_FLASH_APPLICATION_ADDRESS=0x%x" % (0x8000000 + int(start[0].rsplit("_", 1)[1], 16)))
            cfg.write_text("# Automatically generated file; DO NOT EDIT.\n" + text + "\n".join(extra) + "\n")
        elif cmd[0] == "make" and any(c.startswith("-j") for c in cmd):
            out = pathlib.Path(arg(cmd, "OUT="))
            out.mkdir(parents=True, exist_ok=True)
            values = fwm.read_kconfig(pathlib.Path(arg(cmd, "KCONFIG_CONFIG=")).read_text())
            (out / "klipper.dict").write_text(json.dumps({"config": self.built[out.parent.name], "version": HOST,
                                                          "kconfig": "CONFIG_SHORT=y\n"}))
            fwm.firmware_file(out, values).write_bytes(b"firmware")
        elif any(c.endswith("flashtool.py") for c in cmd):
            if "-s" in cmd:
                return 0, "Application Start: 0x%X\nMCU type: stm32g0b1xx\nStatus Request Complete\n" % self.start
            if "-f" in cmd:
                return 0, "Programming Complete\n"
            return 0, "Bootloader Request Complete\n"
        return 0, ""


def answers(*replies):
    replies = list(replies)
    return lambda question, default: replies.pop(0)


# ------------------------------------------------------------------ versions

def test_versions_compare_as_the_web_page_does():
    assert fwm.age(OLD, HOST) == "older"
    assert fwm.age(HOST, OLD) == "newer"
    assert fwm.age(HOST, HOST) == "same"
    assert fwm.age("v0.13.0-816-g11111111", HOST) == "unknown"     # same count, another commit
    assert fwm.age("", HOST) == "unknown"
    assert fwm.same_version(HOST + "-dirty", HOST)
    assert not fwm.same_version(OLD, HOST)


# ------------------------------------------------------------------ boards

def test_reads_a_settings_file_and_the_short_form():
    text = "# comment\nCONFIG_MCU=\"stm32g0b1xx\"\nCONFIG_STM32_FLASH_START_2000=y\n# CONFIG_USB is not set\nCONFIG_CANBUS_FREQUENCY=500000\n"
    assert fwm.read_kconfig(text) == {"CONFIG_MCU": '"stm32g0b1xx"', "CONFIG_STM32_FLASH_START_2000": "y",
                                      "CONFIG_USB": "n", "CONFIG_CANBUS_FREQUENCY": "500000"}


LOG = """Starting Klippy...
Loaded MCU 'toolhead' 120 commands (v0.12.0-100-gaaaaaaaa / gcc: (15:13.2.rel1-2) 13.2.1 20231009 binutils: (2.42-1) 2.42)
MCU 'toolhead' config: ADC_MAX=4095 CLOCK_FREQ=64000000 MCU=stm32g0b1xx RESERVE_PINS_CAN=PB0,PB1
MCU 'toolhead' kconfig: None
Starting Klippy...
Loaded MCU 'toolhead' 130 commands (v0.13.0-800-gbbbbbbbb / gcc: 13.2.1)
MCU 'toolhead' config: CLOCK_FREQ=64000000 MCU=stm32g0b1xx RESERVE_PINS_CAN=PB0,PB1 CANBUS_FREQUENCY=1000000
MCU 'toolhead' kconfig: 'CONFIG_MACH_STM32=y\\nCONFIG_MACH_STM32G0B1=y\\n'
MCU 'toolhead' spontaneous restart
"""


def test_the_log_tells_what_each_board_said_the_last_time():
    seen = fwm.from_log(LOG)["toolhead"]
    assert seen["version"] == "v0.13.0-800-gbbbbbbbb"
    assert seen["constants"]["CANBUS_FREQUENCY"] == "1000000"
    assert seen["kconfig"] == "CONFIG_MACH_STM32=y\nCONFIG_MACH_STM32G0B1=y\n"
    assert fwm.from_log(LOG.split("Starting Klippy...")[1])["toolhead"]["kconfig"] is None


@pytest.mark.parametrize("settings, constants, kind", [
    ({"serial": "/tmp/klipper_host_mcu"}, {}, "host"),
    ({"serial": "/dev/whatever"}, HOST_MCU, "host"),
    ({"canbus_uuid": "AABBCCDDEEFF"}, G0B1_CAN, "can"),
    ({"serial": "/dev/serial/by-id/usb-Klipper_stm32f446xx_1-if00"}, F446_USB, "usb"),
    ({"serial": "/dev/serial/by-id/usb-katapult_stm32f446xx_1-if00"}, {}, "usb"),
    ({"serial": "/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0"}, {"MCU": "stm32f103xe", "SERIAL_BAUD": 250000}, "serial"),
    ({"serial": "/dev/ttyAMA0"}, {}, "serial"),
    ({}, F446_USB, "unknown"),
])
def test_how_klipper_reaches_a_board(settings, constants, kind):
    got = fwm.link(settings, constants)
    assert got["kind"] == kind
    if kind == "can":
        assert got == {"kind": "can", "uuid": "aabbccddeeff", "interface": "can0"}


def test_boards_come_from_moonraker_and_the_log(printer):
    moon = FakeMoon(printer, {
        "mcu": (HOST, F446_USB, None, {"serial": "/dev/serial/by-id/usb-Klipper_stm32f446xx_1-if00"}),
        "mcu toolhead": ("", {}, None, {"canbus_uuid": "aabbccddeeff"}),   # not reached this time
    })
    got = {b["name"]: b for b in fwm.boards(moon, log_text=LOG)}
    assert got["mcu"]["chip"] == "stm32f446xx" and got["mcu"]["link"]["kind"] == "usb"
    assert got["toolhead"]["version"] == "v0.13.0-800-gbbbbbbbb"
    assert got["toolhead"]["chip"] == "stm32g0b1xx" and got["toolhead"]["link"]["kind"] == "can"
    assert got["toolhead"]["kconfig"].startswith("CONFIG_MACH_STM32=y")


# --------------------------------------------- settings a board does not report

def test_the_connection_comes_from_the_pins_the_board_keeps():
    assert fwm.comm_lines(G0B1_CAN, KCONFIGS) == ["CONFIG_STM32_MMENU_CANBUS_PB0_PB1=y", "CONFIG_CANBUS_FREQUENCY=1000000"]
    assert fwm.comm_lines(F446_USB, KCONFIGS) == ["CONFIG_STM32_USB_PA11_PA12=y"]          # not the PA9/PA10 one
    serial = {"MCU": "stm32f103xe", "SERIAL_BAUD": 115200, "RESERVE_PINS_serial": "PA10,PA9"}
    assert fwm.comm_lines(serial, KCONFIGS) == ["CONFIG_STM32_SERIAL_USART1=y", "CONFIG_SERIAL_BAUD=115200"]
    bridge = dict(G0B1_CAN, CANBUS_BRIDGE=1, RESERVE_PINS_USB="PA11,PA12", RESERVE_PINS_CAN="PB5,PB6")
    assert fwm.comm_lines(bridge, KCONFIGS) == ["CONFIG_STM32_USBCANBUS_PA11_PA12=y", "CONFIG_STM32_CMENU_CANBUS_PB5_PB6=y",
                                                "CONFIG_CANBUS_FREQUENCY=1000000"]
    rp_can = {"MCU": "rp2040", "CANBUS_FREQUENCY": 500000, "RESERVE_PINS_CAN": "gpio1,gpio0"}
    assert fwm.comm_lines(rp_can, KCONFIGS) == ["CONFIG_RPXXXX_CANBUS=y", "CONFIG_RPXXXX_CANBUS_GPIO_RX=1",
                                                "CONFIG_RPXXXX_CANBUS_GPIO_TX=0", "CONFIG_CANBUS_FREQUENCY=500000"]
    assert fwm.comm_lines({"MCU": "rp2040"}, KCONFIGS) == ["CONFIG_RPXXXX_USB=y"]
    # what cannot be known: an RP2040's UART pins, pins no option names, another chip
    assert fwm.comm_lines({"MCU": "rp2040", "SERIAL_BAUD": 250000}, KCONFIGS) is None
    assert fwm.comm_lines(dict(G0B1_CAN, RESERVE_PINS_CAN="PD0,PD1"), KCONFIGS) is None
    assert fwm.comm_lines({"MCU": "atmega2560", "SERIAL_BAUD": 250000}, KCONFIGS) is None


def labels(question):
    return [label for _, label in question[1]]


def test_an_stm32_is_asked_its_crystal_and_its_bootloader():
    crystal, boot = fwm.questions(F446_USB, KCONFIGS)
    assert labels(crystal) == ["8 MHz crystal", "12 MHz crystal", "25 MHz crystal"]
    # only what this chip can have, smallest first (the hex sizes in order)
    assert labels(boot) == ["No bootloader", "32KiB bootloader", "48KiB bootloader", "64KiB bootloader"]
    assert labels(fwm.questions(G0B1_CAN, KCONFIGS)[1]) == ["No bootloader", "8KiB bootloader"]
    assert crystal[2] is None and boot[2] is None                      # nothing is picked for the user


def test_no_crystal_pins_offers_the_internal_clock_too():
    # the F1 and old firmware do not report their crystal pins
    f103 = {"MCU": "stm32f103xe", "RESERVE_PINS_USB": "PA11,PA12"}
    assert labels(fwm.questions(f103, KCONFIGS)[0])[-1] == "Internal clock (no crystal)"


def test_an_rp2040_is_asked_its_bootloader_with_the_flash_chip():
    (boot,) = fwm.questions({"MCU": "rp2040"}, KCONFIGS)
    assert [line for line, _ in boot[1]] == [
        "CONFIG_RPXXXX_FLASH_START_0100=y\nCONFIG_RP2040_FLASH_W25Q080=y",
        "CONFIG_RPXXXX_FLASH_START_0100=y\nCONFIG_RP2040_FLASH_GENERIC_03=y",
        "CONFIG_RPXXXX_FLASH_START_4000=y"]
    assert boot[2] == 0
    (boot,) = fwm.questions({"MCU": "rp2350"}, KCONFIGS)
    assert [line for line, _ in boot[1]] == ["CONFIG_RPXXXX_FLASH_START_0000=y", "CONFIG_RPXXXX_FLASH_START_4000=y"]


def test_guided_settings_put_the_answers_together():
    text = fwm.guided(G0B1_CAN, KCONFIGS, ["CONFIG_STM32_CLOCK_REF_8M=y", "CONFIG_STM32_FLASH_START_2000=y"])
    assert text.splitlines() == ["CONFIG_LOW_LEVEL_OPTIONS=y", "CONFIG_MACH_STM32=y", "CONFIG_MACH_STM32G0B1=y",
                                 "CONFIG_STM32_MMENU_CANBUS_PB0_PB1=y", "CONFIG_CANBUS_FREQUENCY=1000000",
                                 "CONFIG_STM32_CLOCK_REF_8M=y", "CONFIG_STM32_FLASH_START_2000=y"]
    assert fwm.guided({"MCU": "atmega2560"}, KCONFIGS, []) is None


FULL_G0B1_CAN = ("CONFIG_LOW_LEVEL_OPTIONS=y\nCONFIG_MACH_STM32=y\nCONFIG_MACH_STM32G0B1=y\nCONFIG_MCU=\"stm32g0b1xx\"\n"
                 "CONFIG_STM32_FLASH_START_2000=y\nCONFIG_STM32_CLOCK_REF_8M=y\nCONFIG_STM32_MMENU_CANBUS_PB0_PB1=y\n"
                 "CONFIG_CANBUS_FREQUENCY=1000000\n")


def test_a_settings_file_matches_the_same_chip_on_the_same_pins():
    assert fwm.matches(fwm.read_kconfig(FULL_G0B1_CAN), G0B1_CAN, KCONFIGS)
    assert not fwm.matches(fwm.read_kconfig(FULL_G0B1_CAN.replace("1000000", "500000")), G0B1_CAN, KCONFIGS)
    assert not fwm.matches(fwm.read_kconfig(FULL_G0B1_CAN.replace("MMENU_CANBUS_PB0_PB1", "CANBUS_PA11_PA12")), G0B1_CAN, KCONFIGS)
    assert not fwm.matches(fwm.read_kconfig(FULL_G0B1_CAN), F446_USB, KCONFIGS)


def test_settings_files_are_found_newest_first(printer):
    old, new = printer.klipper / ".config", printer.config / "toolhead" / "toolhead.config"
    new.parent.mkdir()
    for p, when in ((old, 1000), (new, 2000)):
        p.write_text(FULL_G0B1_CAN)
        os.utime(p, (when, when))
    (printer.klipper / "config.mainboard").write_text(FULL_G0B1_CAN.replace("MMENU_CANBUS_PB0_PB1", "USB_PA11_PA12"))
    (printer.config / "firmware").mkdir()
    (printer.config / "firmware" / "toolhead.config").write_text(FULL_G0B1_CAN)     # its own, read as "saved"
    assert fwm.found_files(printer.klipper, printer.config, G0B1_CAN, KCONFIGS) == [new, old]


def test_where_the_settings_come_from(printer):
    def src(b):
        return fwm.source(b, printer.klipper, printer.config, KCONFIGS)
    assert src(board(kconfig=G0B1_KCONFIG))["from"] == "board"
    assert src(board(constants=HOST_MCU, link={"kind": "host"}))["from"] == "host"
    assert src(board())["from"] == "ask"
    (printer.klipper / ".config").write_text(FULL_G0B1_CAN)
    assert src(board())["files"] == [printer.klipper / ".config"]
    fwm.saved_file(printer.config, "toolhead").parent.mkdir()
    fwm.saved_file(printer.config, "toolhead").write_text(G0B1_KCONFIG)
    assert src(board()) == {"from": "saved", "text": G0B1_KCONFIG}
    assert src(board(name="other", constants={}))["from"] is None
    assert "atmega2560" in src(board(name="other", constants={"MCU": "atmega2560", "SERIAL_BAUD": 250000}))["why"]


def test_only_what_menuconfig_sets_counts_as_lost(printer):
    symbols = fwm.kconfig_symbols(printer.klipper)
    assert "CONFIG_STM32_FLASH_START_2000" in symbols[1] and "CONFIG_MCU" not in symbols[1]
    kept = fwm.read_kconfig(FULL_G0B1_CAN)
    assert fwm.lost_settings(FULL_G0B1_CAN, kept, symbols) == []
    # a full .config also holds what follows from the settings: another Klipper may not have it
    assert fwm.lost_settings(FULL_G0B1_CAN + "CONFIG_HAVE_OLD_THING=y\n", kept, symbols) == []
    changed = dict(kept, CONFIG_STM32_FLASH_START_2000="n")
    assert fwm.lost_settings(FULL_G0B1_CAN, changed, symbols) == ["CONFIG_STM32_FLASH_START_2000"]
    # what a board reports holds only settings: one this Klipper does not have is lost
    assert fwm.lost_settings(G0B1_KCONFIG + "CONFIG_RENAMED_OPTION=y\n", kept, symbols) == ["CONFIG_RENAMED_OPTION"]


# ------------------------------------------------------------------ flashing

def test_how_each_board_is_flashed_and_in_which_order():
    usb = {"kind": "usb", "device": "/dev/x"}
    assert fwm.method(board()) == "can"
    assert fwm.method(board(constants=dict(G0B1_CAN, CANBUS_BRIDGE=1))) == "bridge"
    assert fwm.method(board(constants=F446_USB, link=usb)) == "usb"
    assert fwm.method(board(constants={"MCU": "atmega2560"}, link=usb)) == "manual"
    assert fwm.method(board(constants=HOST_MCU, link={"kind": "host"})) == "host"
    assert fwm.method(board(link={"kind": "serial", "device": "/dev/ttyAMA0", "baud": 250000})) == "manual"
    assert sorted(fwm.ORDER, key=fwm.ORDER.get) == ["can", "usb", "bridge", "host"]


def test_a_build_that_would_change_the_board_shows_how():
    b = board()
    assert fwm.differences(b, {"config": dict(G0B1_CAN, ADC_MAX=4095)}) == []
    assert fwm.differences(b, {"config": dict(G0B1_CAN, RESERVE_PINS_CAN="PB5,PB6")}) == \
        ["RESERVE_PINS_CAN: the board PB0,PB1, the new firmware PB5,PB6"]
    # the speed counts too when the settings were not read from the board
    other = dict(G0B1_CAN, CLOCK_FREQ=72000000)
    assert fwm.differences(b, {"config": other}) == []
    assert fwm.differences(b, {"config": other}, strict=True) == ["CLOCK_FREQ: the board 64000000, the new firmware 72000000"]


def fw_file(tmp_path, start=0x8002000):
    f = tmp_path / "klipper.bin"
    f.write_bytes(b"firmware")
    return {"file": f, "start": start}


def test_can_checks_where_katapult_starts_the_firmware_before_writing(printer, tmp_path):
    run = FakeRun(printer, start=0x8008000)
    with pytest.raises(fwm.Stop, match="0x8008000.*0x8002000"):
        fwm.flash_can(board(), fw_file(tmp_path), printer.klipper, "python", run, None)
    assert not [c for c in run.cmds if "-f" in c]
    run = FakeRun(printer)
    fwm.flash_can(board(), fw_file(tmp_path), printer.klipper, "python", run, None)
    assert [c[-2:] for c in run.cmds] == [["aabbccddeeff", "-r"], ["aabbccddeeff", "-s"], ["-f", str(tmp_path / "klipper.bin")]]


def test_a_bridge_without_katapult_says_how_to_finish(printer, tmp_path):
    def run(cmd, **kw):
        return 0, "Device is not Katapult, exiting...\nBootloader Request Complete\n"
    with pytest.raises(fwm.Stop, match="dfu-util -d 0483:df11 -a 0 -s 0x8002000:leave"):
        fwm.flash_bridge(board(constants=dict(G0B1_CAN, CANBUS_BRIDGE=1)), fw_file(tmp_path), printer.klipper, "python", run, None)


def usb_board(tmp_path, chip="stm32f446xx"):
    dev = tmp_path / "usb-Klipper_stm32f446xx_1-if00"
    dev.write_text("")
    return board("mcu", constants=dict(F446_USB, MCU=chip), link={"kind": "usb", "device": str(dev)})


def test_usb_takes_dfu_utils_complaint_after_a_whole_write(printer, tmp_path):
    def run(rc, text):
        return lambda cmd, **kw: (rc, text)
    b, fw = usb_board(tmp_path), fw_file(tmp_path, 0x8008000)
    fwm.flash_usb(b, fw, printer.klipper, "python", run(74, "File downloaded successfully\n"
                                                         "dfu-util: Error during download get_status\n"), None, None)
    with pytest.raises(fwm.Stop, match="No DFU capable"):
        fwm.flash_usb(b, fw, printer.klipper, "python", run(1, "dfu-util: No DFU capable USB device available\n"), None, None)


def test_usb_passes_the_start_to_klippers_flash_script(printer, tmp_path):
    run = FakeRun(printer)
    fwm.flash_usb(usb_board(tmp_path), fw_file(tmp_path, 0x8008000), printer.klipper, "python", run, None, None)
    (cmd,) = run.cmds
    assert cmd[1:6] == ["scripts/flash_usb.py", "-t", "stm32f446xx", "-d", str(tmp_path / "usb-Klipper_stm32f446xx_1-if00")]
    assert cmd[6:8] == ["-s", "0x8008000"]


def test_usb_finishes_a_board_left_in_katapult(printer, tmp_path, monkeypatch):
    monkeypatch.setattr(fwm, "_wait_path", lambda path, seconds: True)
    b = usb_board(tmp_path)
    os.remove(b["link"]["device"])
    (tmp_path / "usb-katapult_stm32f446xx_1-if00").write_text("")
    run = FakeRun(printer)
    fwm.flash_usb(b, fw_file(tmp_path), printer.klipper, "python", run, None, None)
    assert run.cmds[0][-4:] == ["-d", str(tmp_path / "usb-katapult_stm32f446xx_1-if00"), "-f", str(tmp_path / "klipper.bin")]


def test_rp2040_without_its_flash_tool_asks_for_libusb(printer, tmp_path):
    b = usb_board(tmp_path, chip="rp2040")
    with pytest.raises(fwm.Stop, match="libusb-1.0-0-dev"):
        fwm.flash_usb(b, fw_file(tmp_path, 0x10000100), printer.klipper, "python", FakeRun(printer), None, None)


def test_the_host_file_is_replaced_in_one_step(printer, tmp_path):
    run = FakeRun(printer)
    fwm.flash_host(board(constants=HOST_MCU), fw_file(tmp_path), run, None)
    (cmd,) = run.cmds
    assert cmd[:3] == ["sudo", "sh", "-c"] and "mv -f" in cmd[3] and cmd[-2:] == [fwm.HOST_MCU, str(tmp_path / "klipper.bin")]


# ------------------------------------------------------------------ the build

def test_a_build_reads_what_klipper_made(printer):
    b = board(kconfig=G0B1_KCONFIG)
    fw = fwm.build(b, G0B1_KCONFIG, printer.klipper, FakeRun(printer, built={"toolhead": G0B1_CAN}), work=printer.work)
    assert fw["file"] == printer.work / "toolhead" / "out" / "klipper.bin"
    assert fw["start"] == 0x8002000 and fw["bootloader"] and fw["version"] == HOST
    assert fw["config"] == G0B1_CAN and fw["settings"] == "CONFIG_SHORT=y\n"


def test_a_build_stops_when_klipper_drops_a_setting(printer):
    run = FakeRun(printer, built={"toolhead": G0B1_CAN}, drop="CONFIG_STM32_MMENU_CANBUS_PB0_PB1=y\n")
    with pytest.raises(fwm.Stop, match="CONFIG_STM32_MMENU_CANBUS_PB0_PB1"):
        fwm.build(board(), G0B1_KCONFIG, printer.klipper, run, work=printer.work)
    assert not [c for c in run.cmds if any(a.startswith("-j") for a in c)]


# ------------------------------------------------------------------ the update

@pytest.mark.parametrize("objects, why", [
    ({"print_stats": {"state": "printing"}}, "printing"),
    ({"print_stats": {"state": "paused"}}, "paused"),
    ({"idle_timeout": {"state": "Printing"}}, "running a command"),
    ({"gcode_macro _AUTO_EJECT_STATE": {"busy": True, "bg": False}}, "pushing parts off"),
    ({"gcode_macro _AUTO_EJECT_STATE": {"busy": False, "bg": True}}, "cooling"),
    ({"extruder": {"target": 210.0}}, "extruder is heating"),
    ({}, ""),
])
def test_nothing_is_flashed_while_the_printer_works(printer, objects, why):
    moon = FakeMoon(printer, {}, objects=objects)
    got = fwm.busy(moon)
    assert (why in got) if why else got == ""


def test_klipper_stopped_at_an_error_is_free_and_starting_is_not(printer):
    assert fwm.busy(FakeMoon(printer, {}, state="error", print_state="printing")) == ""
    assert "starting" in fwm.busy(FakeMoon(printer, {}, state="startup"))


def three_boards(printer):
    return FakeMoon(printer, {
        "mcu": (HOST, F446_USB, None, {"serial": "/dev/serial/by-id/usb-Klipper_stm32f446xx_1-if00"}),
        "mcu toolhead": (OLD, G0B1_CAN, G0B1_KCONFIG, {"canbus_uuid": "AABBCCDDEEFF"}),
        "mcu host": (OLD, HOST_MCU, None, {"serial": "/tmp/klipper_host_mcu"}),
    })


def first(events, text):
    return next(i for i, e in enumerate(events) if text in e)


def test_the_update_builds_first_then_flashes_can_before_the_host(printer):
    moon, lines = three_boards(printer), []
    run = FakeRun(printer, built={"toolhead": G0B1_CAN, "host": HOST_MCU})
    assert fwm.update(moon, assume_yes=True, run=run, out=lines.append, work=printer.work) == 0
    ev = printer.events
    builds = [i for i, e in enumerate(ev) if e.startswith("make")]
    assert len(builds) == 4                                           # the mainboard is up to date already
    assert max(builds) < first(ev, "/machine/services/stop?service=klipper")
    assert first(ev, "/machine/services/stop") < first(ev, "flashtool.py -i can0 -u aabbccddeeff -f") < first(ev, "sudo sh")
    # the host firmware runs once the computer restarts; Klipper starts then
    assert first(ev, "sudo sh") < first(ev, "/machine/reboot")
    assert not [e for e in ev if e.startswith("/machine/services/start")]
    assert (printer.config / "firmware" / "toolhead.config").read_text() == "CONFIG_SHORT=y\n"
    assert not (printer.config / "firmware" / "host.config").exists()


def test_klipper_starts_again_and_the_versions_are_checked(printer):
    moon, lines = three_boards(printer), []
    run = FakeRun(printer, built={"toolhead": G0B1_CAN})
    assert fwm.update(moon, only=["TOOLHEAD"], assume_yes=True, run=run, out=lines.append, work=printer.work) == 0
    assert first(printer.events, " -f ") < first(printer.events, "/machine/services/start?service=klipper")
    assert "  toolhead: now %s" % HOST in lines
    assert not [e for e in printer.events if "sudo" in e]


def test_nothing_happens_while_printing(printer):
    moon = three_boards(printer)
    moon.objects["print_stats"]["state"] = "printing"
    with pytest.raises(fwm.Stop, match="printing"):
        fwm.update(moon, assume_yes=True, run=FakeRun(printer), out=lambda s: None, work=printer.work)
    assert not [e for e in printer.events if e.startswith("make") or "services" in e]


def test_a_failed_flash_starts_klipper_again(printer):
    moon, lines = three_boards(printer), []
    run = FakeRun(printer, built={"toolhead": G0B1_CAN}, start=0x8008000)
    assert fwm.update(moon, only=["toolhead"], assume_yes=True, run=run, out=lines.append, work=printer.work) == 1
    assert not [c for c in run.cmds if "-f" in c]
    assert first(printer.events, "services/stop") < first(printer.events, "services/start")
    assert any(line.startswith("Stopped at toolhead") for line in lines)
    assert not (printer.config / "firmware" / "toolhead.config").exists()


def test_ctrl_c_while_flashing_starts_klipper_again(printer):
    def fail(cmd):
        if "-f" in cmd:
            raise KeyboardInterrupt
    run = FakeRun(printer, built={"toolhead": G0B1_CAN}, fail=fail)
    with pytest.raises(KeyboardInterrupt):
        fwm.update(three_boards(printer), only=["toolhead"], assume_yes=True, run=run, out=lambda s: None, work=printer.work)
    assert first(printer.events, "services/stop") < first(printer.events, "services/start")


def test_a_build_for_another_board_is_left_out(printer):
    lines = []
    run = FakeRun(printer, built={"toolhead": dict(G0B1_CAN, RESERVE_PINS_CAN="PB5,PB6")})
    assert fwm.update(three_boards(printer), only=["toolhead"], assume_yes=True, run=run, out=lines.append, work=printer.work) == 1
    assert any("RESERVE_PINS_CAN" in line for line in lines)
    assert not [e for e in printer.events if "services" in e]


def test_yes_leaves_out_a_board_that_needs_answers(printer):
    moon, lines = FakeMoon(printer, {"mcu toolhead": (OLD, G0B1_CAN, None, {"canbus_uuid": "aabbccddeeff"})}), []
    assert fwm.update(moon, assume_yes=True, run=FakeRun(printer), out=lines.append, work=printer.work) == 1
    assert any("without --yes" in line for line in lines)
    assert not [e for e in printer.events if e.startswith("make")]


def test_the_answers_build_the_board_and_are_kept(printer):
    moon, lines = FakeMoon(printer, {"mcu toolhead": (OLD, G0B1_CAN, None, {"canbus_uuid": "aabbccddeeff"})}), []
    run = FakeRun(printer, built={"toolhead": G0B1_CAN})
    # 8 MHz crystal, the 8KiB bootloader, then yes to flashing
    assert fwm.update(moon, run=run, out=lines.append, ask=answers("1", "2", "y"), work=printer.work) == 0
    built = fwm.read_kconfig((printer.work / "toolhead" / "klipper.config").read_text())
    assert built["CONFIG_STM32_CLOCK_REF_8M"] == "y" and built["CONFIG_STM32_FLASH_START_2000"] == "y"
    assert (printer.config / "firmware" / "toolhead.config").is_file()


def test_no_to_flashing_keeps_klipper_running(printer):
    lines = []
    run = FakeRun(printer, built={"toolhead": G0B1_CAN})
    assert fwm.update(three_boards(printer), only=["toolhead"], run=run, out=lines.append, ask=answers("n"), work=printer.work) == 0
    assert not [e for e in printer.events if "services" in e]


def test_with_no_one_at_a_terminal_nothing_is_flashed(printer, monkeypatch):
    monkeypatch.setattr(fwm.sys, "stdin", io.StringIO(""))
    assert fwm.ask_line("Flash now? [Y/n]", "y") == ""
    lines = []
    run = FakeRun(printer, built={"toolhead": G0B1_CAN})
    assert fwm.update(three_boards(printer), only=["toolhead"], run=run, out=lines.append, work=printer.work) == 0
    assert "Nothing was flashed" in lines[-1]
    assert not [e for e in printer.events if "services" in e]


def test_a_waiting_job_queue_is_paused_first(printer):
    moon = three_boards(printer)
    moon.queue = {"queue_state": "ready", "queued_jobs": [{"filename": "part.gcode"}]}
    fwm.update(moon, only=["toolhead"], assume_yes=True, run=FakeRun(printer, built={"toolhead": G0B1_CAN}),
               out=lambda s: None, work=printer.work)
    assert first(printer.events, "/server/job_queue/pause") < first(printer.events, "services/stop")


def test_a_probe_with_its_own_board_is_left_alone(printer):
    # a Beacon or a Cartographer: an MCU object, but no [mcu] section and not Klipper's firmware
    moon = three_boards(printer)
    moon.mcus["mcu beacon"] = {"mcu_version": "Beacon 2.1.0", "mcu_constants": {"MCU": "stm32f072xb"}, "mcu_kconfig": None}
    moon.mcus["mcu scanner"] = {"mcu_version": OLD, "mcu_constants": {"MCU": "stm32f042x6"}, "mcu_kconfig": None}
    assert fwm.behind(moon, out=lambda s: None) == ["toolhead", "host"]
    rows = {r["name"]: r["age"] for r in fwm.status(moon, out=lambda s: None)}
    assert rows["beacon"] == rows["scanner"] == "not_klipper"


def test_status_lists_each_board(printer):
    lines = []
    rows = fwm.status(three_boards(printer), as_json=True, out=lines.append)
    assert json.loads(lines[0])["klipper"] == HOST
    got = {r["name"]: (r["age"], r["settings"], r["method"]) for r in rows}
    assert got == {"mcu": ("same", "ask", "usb"), "toolhead": ("older", "board", "can"), "host": ("older", "host", "host")}


def test_behind_names_the_older_boards_for_the_installer(printer):
    lines = []
    assert fwm.behind(three_boards(printer), out=lines.append) == ["toolhead", "host"]
    assert lines == ["toolhead host"]
    up_to_date = FakeMoon(printer, {"mcu": (HOST, F446_USB, None, {"serial": "/dev/x"})})
    lines = []
    assert fwm.behind(up_to_date, out=lines.append) == [] and lines == []


def test_moonraker_requests():
    seen = []

    def opener(req, timeout):
        seen.append((req.get_method(), req.full_url))
        return io.BytesIO(json.dumps({"result": {"status": {}}}).encode())
    m = fwm.Moonraker("http://printer:7125/", opener)
    m.query({"mcu toolhead": ["mcu_version", "mcu_kconfig"], "configfile": ["settings"]})
    m.call("/machine/reboot", {})
    assert seen == [("GET", "http://printer:7125/printer/objects/query?mcu%20toolhead=mcu_version,mcu_kconfig&configfile=settings"),
                    ("POST", "http://printer:7125/machine/reboot")]
