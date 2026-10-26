#!/usr/bin/env python3
"""Bring the firmware on the printer's boards to Klipper's own version.

Used by install.sh --firmware (docs/firmware.md), on the printer's computer
as the user Klipper runs as.

    firmware.py [--moonraker URL] status [--json]
    firmware.py [--moonraker URL] update [--yes] [--only NAME,...] [--build-only] [--progress FILE]
    firmware.py [--moonraker URL] behind

status lists each board with its firmware against Klipper's, where its build
settings come from and how it is flashed. update builds the firmware of each
board that differs from Klipper and flashes it: the boards on CAN first, then
the ones on USB, a USB to CAN bridge after the boards behind it, and the
computer's own (host) last. Then Klipper starts again and the versions are
checked. Nothing is done while the printer prints, is paused, pushes parts
off, cools them in the background or heats. behind prints the names of
the boards older than Klipper, for the end of install.sh.

The build settings, what make menuconfig sets, come from:
  1. the board itself: a board flashed with Klipper v0.13.0-752 or newer
     reports the settings its firmware was built with (mcu_kconfig);
  2. <config>/firmware/<board>.config, kept from the last build;
  3. a Klipper settings file on the printer for the same chip and connection
     (~/klipper/.config, files in the config folder), after a yes;
  4. what the board reports, its chip and the pins it talks on, and the
     questions it cannot answer: its crystal and its bootloader.
Each build is checked against what the board reports (its chip, the pins
and speed it talks on) before anything is written to it.

The Updates page's button runs update --yes --progress FILE through the
klipper-auto-eject service, with no one to type a password. install.sh
--firmware can set that up once: a udev rule lets the user write to a board
in its bootloader (DFU, the RP2040 boot mode), and a sudo rule lets it run
the one command that puts the host firmware in place. Without them those
boards are left out when no one is at a terminal.
"""

import argparse
import ast
import filecmp
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

MOONRAKER = "http://127.0.0.1:7125"
# print_stats states the boards may be flashed in (never printing or paused)
FREE = ("standby", "complete", "cancelled", "error")
# what a board reports that its new firmware must report too, with the pins
# it keeps for itself (RESERVE_PINS_CAN, _USB, _serial, _crystal)
IDENTITY = ("MCU", "CANBUS_FREQUENCY", "CANBUS_BRIDGE", "SERIAL_BAUD")
WORK = pathlib.Path.home() / ".cache" / "klipper-auto-eject" / "firmware"
VERSION = re.compile(r"^(v?\d+(?:\.\d+)*)(?:-(\d+)-g([0-9a-f]{4,40}))?", re.I)
KATAPULT_TOOL = "lib/katapult/flashtool.py"     # in Klipper's own folder
HOST_MCU = "/usr/local/bin/klipper_mcu"
# what install.sh --firmware sets up, when asked, to flash with no password:
# the sudo rule names this one command, with these very arguments
SUDOERS = "/etc/sudoers.d/klipper-auto-eject-firmware"
UDEV = "/etc/udev/rules.d/60-klipper-auto-eject-firmware.rules"
INSTALL = "/usr/bin/install"
STAGED = WORK.parent / "klipper_mcu"
TOOLCHAIN = "sudo apt install gcc-arm-none-eabi binutils-arm-none-eabi libnewlib-arm-none-eabi"
NO_BOOTLOADER = ("CONFIG_STM32_FLASH_START_0000", "CONFIG_RPXXXX_FLASH_START_0100", "CONFIG_RPXXXX_FLASH_START_0000")
FROM = {"board": "the settings it reports", "saved": "its saved settings", "host": "the host's settings",
        "file": "a settings file found on the printer", "ask": "your answers"}


class Stop(Exception):
    """What stops the update, in words for the user."""


# ------------------------------------------------------------------ versions

def parse_version(v):
    m = VERSION.match(str(v or "").strip())
    if not m:
        return None
    return {"tag": [int(x) for x in m.group(1).lstrip("vV").split(".")],
            "count": int(m.group(2) or 0), "sha": (m.group(3) or "").lower() or None}


def age(board, host):
    """A board's firmware against Klipper: same, older, newer or unknown, as
    the web page says it (web/model.js firmwareAge)."""
    a, b = parse_version(board), parse_version(host)
    if not a or not b:
        return "unknown"
    n = max(len(a["tag"]), len(b["tag"]))
    ta, tb = a["tag"] + [0] * (n - len(a["tag"])), b["tag"] + [0] * (n - len(b["tag"]))
    c = (ta > tb) - (ta < tb) or (a["count"] > b["count"]) - (a["count"] < b["count"])
    if c == 0:
        return "unknown" if a["sha"] and b["sha"] and a["sha"] != b["sha"] else "same"
    return "older" if c < 0 else "newer"


def same_version(a, b):
    """Built from the same Klipper: the same tag, count and commit, whatever
    a "-dirty" source folder adds after them."""
    pa, pb = parse_version(a), parse_version(b)
    return bool(pa and pb and pa == pb)


# --------------------------------------------------------------- Moonraker

class Moonraker:
    def __init__(self, base=MOONRAKER, opener=None, timeout=15):
        self.base = base.rstrip("/")
        self.opener = opener or urllib.request.urlopen
        self.timeout = timeout

    def call(self, path, data=None):
        req = urllib.request.Request(self.base + path, method="GET" if data is None else "POST",
                                     data=None if data is None else json.dumps(data).encode(),
                                     headers={"Content-Type": "application/json"})
        with self.opener(req, timeout=self.timeout) as r:
            return json.load(r).get("result")

    def query(self, objects):
        q = "&".join(urllib.parse.quote(o) + ("=" + ",".join(f) if f else "") for o, f in objects.items())
        return (self.call("/printer/objects/query?" + q) or {}).get("status", {})


def _get(moon, path):
    try:
        return moon.call(path)
    except Exception:
        return None


# ------------------------------------------------------------------ boards

def read_kconfig(text):
    """The settings of a Klipper .config, or of the short form a board
    reports: {"CONFIG_X": "y" | "n" | the value as written}."""
    out = {}
    for line in str(text or "").splitlines():
        line = line.strip()
        m = re.match(r"^(CONFIG_\w+)=(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2)
            continue
        m = re.match(r"^# (CONFIG_\w+) is not set$", line)
        if m:
            out[m.group(1)] = "n"
    return out


def from_log(text):
    """What klippy.log says of each board the last time Klipper reached it:
    {name: {"version", "constants", "kconfig"}}. Klipper writes these lines
    each time it starts, also when it then stops at an error (a board too old
    for it, after an update)."""
    out = {}
    for line in str(text or "").splitlines():
        m = re.match(r"^Loaded MCU '([^']+)' \d+ commands \((\S*) / ", line)
        if m:
            out.setdefault(m.group(1), {})["version"] = m.group(2)
            continue
        m = re.match(r"^MCU '([^']+)' config: (.*)$", line)
        if m:
            out.setdefault(m.group(1), {})["constants"] = dict(kv.split("=", 1) for kv in m.group(2).split() if "=" in kv)
            continue
        m = re.match(r"^MCU '([^']+)' kconfig: (.*)$", line)
        if m:
            try:
                k = ast.literal_eval(m.group(2).strip())
            except (ValueError, SyntaxError):
                k = None
            out.setdefault(m.group(1), {})["kconfig"] = k if isinstance(k, str) and k.strip() else None
    return out


def _log_tail(path, size=4 << 20):
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - size))
            return f.read().decode("utf-8", "replace")
    except OSError:
        return ""


def link(settings, constants):
    """How Klipper reaches a board: host (the computer itself), can, usb,
    serial (a UART, also through a USB to serial chip), or unknown."""
    dev = str(settings.get("serial") or "")
    if str(constants.get("MCU", "")) == "linux" or dev.startswith("/tmp/klipper_host_mcu"):
        return {"kind": "host"}
    if settings.get("canbus_uuid"):
        return {"kind": "can", "uuid": str(settings["canbus_uuid"]).lower(), "interface": settings.get("canbus_interface") or "can0"}
    if not dev:
        return {"kind": "unknown"}
    klipper_usb = "usb-Klipper_" in dev or "usb-katapult_" in dev
    if "SERIAL_BAUD" in constants or (not constants and not klipper_usb):
        return {"kind": "serial", "device": dev, "baud": int(settings.get("baud") or 250000)}
    return {"kind": "usb", "device": dev}


def boards(moon, info=None, log_text=None):
    """The printer's boards as Klipper knows them: from Moonraker, and from
    klippy.log for what Klipper could not ask a board this time."""
    info = info or moon.call("/printer/info")
    objs = (moon.call("/printer/objects/list") or {}).get("objects", [])
    mcus = [o for o in objs if o == "mcu" or o.startswith("mcu ")]
    status = moon.query(dict({o: ["mcu_version", "mcu_constants", "mcu_kconfig"] for o in mcus}, configfile=["settings"]))
    settings = (status.get("configfile") or {}).get("settings") or {}
    logged = None
    out = []
    for o in mcus:
        st = status.get(o) or {}
        name = "mcu" if o == "mcu" else o[4:]
        b = {"name": name, "object": o, "version": st.get("mcu_version") or "",
             "constants": st.get("mcu_constants") or {}, "kconfig": st.get("mcu_kconfig") or None}
        if not b["constants"]:
            if logged is None:
                logged = from_log(log_text if log_text is not None else _log_tail(info.get("log_file") or ""))
            seen = logged.get(name) or {}
            b.update(version=b["version"] or seen.get("version", ""), constants=seen.get("constants") or {},
                     kconfig=b["kconfig"] or seen.get("kconfig"))
        b["link"] = link(settings.get(o.lower()) or settings.get(o) or {}, b["constants"])
        b["chip"] = str(b["constants"].get("MCU") or "")
        out.append(b)
    return out


def ours(board):
    """A board Klipper flashes: an [mcu] section running Klipper's firmware.
    A probe with a board of its own (Beacon, Cartographer...) has neither,
    and is left alone, as is a board Klipper has never reached."""
    return parse_version(board["version"]) is not None and board["link"]["kind"] != "unknown"


# --------------------------------------------- settings a board does not report

def kconfig_files(klipper):
    """Klipper's Kconfig files of the chips it can guide: {arch: text}."""
    out = {}
    for arch in ("stm32", "rp2040"):
        try:
            out[arch] = (pathlib.Path(klipper) / "src" / arch / "Kconfig").read_text(encoding="utf-8")
        except OSError:
            out[arch] = ""
    return out


def kconfig_symbols(klipper):
    """The settings Klipper's Kconfig files define, and the ones among them
    that make menuconfig shows (the others follow from those): (defined, shown)."""
    defined, shown = set(), set()
    for p in sorted(pathlib.Path(klipper, "src").glob("**/Kconfig")):
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for m in re.finditer(r"^\s*(?:menu)?config (\w+)[ \t]*\n((?:[ \t]+(?!(?:menu)?config\b)\S.*\n?)*)", text, re.M):
            defined.add("CONFIG_" + m.group(1))
            if re.search(r'^\s*(?:bool|int|hex|string|tristate|prompt)\s+"', m.group(2), re.M):
                shown.add("CONFIG_" + m.group(1))
    return defined, shown


def lost_settings(text, values, symbols):
    """The settings of text that the resolved values do not keep. A full
    .config also holds what follows from the settings, which another Klipper
    may work out differently or not have at all: those do not count."""
    defined, shown = symbols
    short = "CONFIG_MCU=" not in text          # what a board reports, or savedefconfig
    return [k for k, v in read_kconfig(text).items()
            if values.get(k, "n") != v and (k in shown or (short and k not in defined))]


def _options(text):
    """Every option of a Kconfig file that has a prompt: {name: (prompt, its "if")}."""
    return {m.group(1): (m.group(2), (m.group(3) or "").strip())
            for m in re.finditer(r'^\s*config (\w+)\s*\n\s*bool "([^"]*)"(?: if ([^\n]+))?', text, re.M)}


def _pins(text):
    return {p.upper() for p in re.findall(r"\b(P[A-K]\d+|gpio\d+)\b", text, re.I)}


def _chip(constants):
    """The Kconfig lines of the board's chip, or None."""
    mcu = str(constants.get("MCU") or "")
    if mcu == "linux":
        return ["CONFIG_MACH_LINUX=y"]
    if mcu.startswith("stm32") and len(mcu) >= 9:
        return ["CONFIG_MACH_STM32=y", "CONFIG_MACH_STM32%s=y" % mcu[5:9].upper()]
    if mcu in ("rp2040", "rp2350"):
        return ["CONFIG_MACH_RPXXXX=y", "CONFIG_MACH_%s=y" % mcu.upper()]
    return None


def comm_lines(constants, kconfigs):
    """The Kconfig lines that make a firmware talk as the board does now (USB,
    CAN or a UART on the same pins, at the same CAN speed and baud rate), from
    what the board reports. None when that is not enough to know it."""
    mcu = str(constants.get("MCU") or "")
    can = _pins(str(constants.get("RESERVE_PINS_CAN", "")))
    bridge = str(constants.get("CANBUS_BRIDGE", "")) == "1"
    if mcu.startswith("stm32"):
        opts = _options(kconfigs.get("stm32", ""))

        def pick(prefixes, pins):
            found = [n for n, (p, _) in opts.items() if n.startswith(prefixes) and _pins(p) == pins]
            return found[0] if len(found) == 1 else None
        usb = _pins(str(constants.get("RESERVE_PINS_USB1") or constants.get("RESERVE_PINS_USB") or ""))
        if bridge:
            names = [pick(("STM32_USBCANBUS_",), usb or {"PA11", "PA12"}), pick(("STM32_CMENU_CANBUS_",), can)]
        elif can:
            names = [pick(("STM32_CANBUS_", "STM32_MMENU_CANBUS_"), can)]
        elif constants.get("RESERVE_PINS_serial"):
            names = [pick(("STM32_SERIAL_",), _pins(str(constants["RESERVE_PINS_serial"])))]
        elif usb:
            names = [pick(("STM32_USB_",), usb)]
        else:
            return None
        if None in names:
            return None
        lines = ["CONFIG_%s=y" % n for n in names]
    elif mcu in ("rp2040", "rp2350"):
        if "SERIAL_BAUD" in constants:
            return None                     # an RP2040 does not report its UART pins
        if can:
            gpio = [int(p[4:]) for p in str(constants["RESERVE_PINS_CAN"]).lower().split(",") if p.startswith("gpio")]
            if len(gpio) != 2:
                return None
            lines = ["CONFIG_RPXXXX_USBCANBUS=y" if bridge else "CONFIG_RPXXXX_CANBUS=y",
                     "CONFIG_RPXXXX_CANBUS_GPIO_RX=%d" % gpio[0], "CONFIG_RPXXXX_CANBUS_GPIO_TX=%d" % gpio[1]]
        else:
            lines = ["CONFIG_RPXXXX_USB=y"]
    elif mcu == "linux":
        return []
    else:
        return None
    if can:
        lines.append("CONFIG_CANBUS_FREQUENCY=%s" % constants.get("CANBUS_FREQUENCY", 1000000))
    if "SERIAL_BAUD" in constants:
        lines.append("CONFIG_SERIAL_BAUD=%s" % constants["SERIAL_BAUD"])
    return lines


def _family(text, chip_line):
    """The chip's Kconfig name and the ones it selects (MACH_STM32G0B1 selects
    MACH_STM32G0 and MACH_STM32G0Bx), for the options shown to some only."""
    name = chip_line.split("=")[0][len("CONFIG_"):]
    m = re.search(r"^\s*config %s\s*\n((?:[ \t]+(?!config\b)\S.*\n)*)" % re.escape(name), text, re.M)
    return {name, "MACH_STM32"} | set(re.findall(r"select (\w+)", m.group(1) if m else ""))


def _shown(condition, family):
    """A Kconfig "if" made of || and && of chip names, for this chip."""
    if not condition:
        return True
    for alt in condition.replace("(", " ").replace(")", " ").split("||"):
        terms = [t.strip() for t in alt.split("&&") if t.strip()]
        if all((t[1:] not in family) if t.startswith("!") else (t in family) for t in terms):
            return True
    return False


def _start(name):
    m = re.search(r"START_([0-9A-F]+)", name)
    return int(m.group(1), 16) if m else 0


def questions(constants, kconfigs):
    """What only the board's maker knows: [(question, [(line, label)], default index or None)]."""
    mcu = str(constants.get("MCU") or "")
    if mcu.startswith("stm32"):
        text = kconfigs.get("stm32", "")
        opts, family = _options(text), _family(text, _chip(constants)[-1])
        # a board that reports its crystal pins has one; the F1, and firmware
        # older than these pins, report nothing either way
        xtal = [("CONFIG_%s=y" % n, p) for n, (p, _) in opts.items() if re.match(r"STM32_CLOCK_REF_\d+M$", n)]
        if "RESERVE_PINS_crystal" not in constants and "STM32_CLOCK_REF_INTERNAL" in opts:
            xtal.append(("CONFIG_STM32_CLOCK_REF_INTERNAL=y", opts["STM32_CLOCK_REF_INTERNAL"][0] + " (no crystal)"))
        boot = sorted(((("CONFIG_%s=y" % n), p) for n, (p, c) in opts.items() if n.startswith("STM32_FLASH_START_") and _shown(c, family)),
                      key=lambda o: _start(o[0]))
        return [("Which crystal does the board have? (\"Clock Reference\" in make menuconfig; the board's guide says it: "
                 "8 MHz on most boards, 12 MHz on the BTT Octopus, 25 MHz on most STM32H7 boards.)", xtal, None),
                ("Which bootloader is on the board? (\"Bootloader offset\" in make menuconfig. Katapult is 8KiB on "
                 "most CAN toolheads; on a mainboard it is often the size of the bootloader it came with.)", boot, None)]
    if mcu in ("rp2040", "rp2350"):
        opts = _options(kconfigs.get("rp2040", ""))
        katapult = ("CONFIG_RPXXXX_FLASH_START_4000=y", opts.get("RPXXXX_FLASH_START_4000", ("16KiB bootloader",))[0] + " (Katapult)")
        if mcu == "rp2350":
            boot = [("CONFIG_RPXXXX_FLASH_START_0000=y", opts.get("RPXXXX_FLASH_START_0000", ("No bootloader",))[0]), katapult]
        else:
            # with no bootloader the firmware starts the flash chip itself
            none = opts.get("RPXXXX_FLASH_START_0100", ("No bootloader",))[0]
            boot = [("CONFIG_RPXXXX_FLASH_START_0100=y\nCONFIG_%s=y" % n, "%s, flash chip %s" % (none, p))
                    for n, (p, _) in opts.items() if n.startswith("RP2040_FLASH_")] + [katapult]
        return [("Which bootloader is on the board? (\"Bootloader offset\" in make menuconfig; the first one, "
                 "unless the board's guide names another flash chip)", boot, 0)]
    return []


def guided(constants, kconfigs, answers):
    """The settings of a board that does not report them: its chip and its
    connection from what it reports, the rest from the answers. None when
    the board does not say enough."""
    chip = _chip(constants)
    comm = comm_lines(constants, kconfigs)
    if chip is None or comm is None:
        return None
    return "\n".join(["CONFIG_LOW_LEVEL_OPTIONS=y"] + chip + comm + list(answers)) + "\n"


def matches(values, constants, kconfigs):
    """Whether a Klipper settings file was made for this board: the same chip,
    talking on the same pins at the same speed."""
    chip, comm = _chip(constants), comm_lines(constants, kconfigs)
    if chip is None or comm is None:
        return False
    mcu = str(constants.get("MCU") or "")
    if values.get("CONFIG_MCU", '"%s"' % mcu).strip('"') != mcu:
        return False
    defaults = {"CONFIG_CANBUS_FREQUENCY": "1000000", "CONFIG_SERIAL_BAUD": "250000", "CONFIG_RPXXXX_USB": "y",
                "CONFIG_RPXXXX_CANBUS_GPIO_RX": "4", "CONFIG_RPXXXX_CANBUS_GPIO_TX": "5"}
    return all(values.get(k, defaults.get(k, "n")) == v for k, v in (line.split("=", 1) for line in chip + comm))


def found_files(klipper, config_dir, constants, kconfigs):
    """Klipper settings files on the printer made for this board, newest
    first: what make menuconfig left in Klipper's folder, and the ones kept in
    the config folder."""
    klipper, config_dir = pathlib.Path(klipper), pathlib.Path(config_dir)
    paths = [klipper / ".config", klipper / ".config.old"] + sorted(klipper.glob("config.*")) \
        + sorted(config_dir.glob("*.config")) + sorted(p for p in config_dir.glob("*/*.config") if p.parent.name != "firmware")
    seen, out = set(), []
    for p in paths:
        try:
            if not p.is_file() or p.resolve() in seen or p.stat().st_size > 200000:
                continue
            seen.add(p.resolve())
            if matches(read_kconfig(p.read_text(encoding="utf-8", errors="replace")), constants, kconfigs):
                out.append((p.stat().st_mtime, p))
        except OSError:
            continue
    return [p for _, p in sorted(out, key=lambda x: -x[0])]


def saved_file(config_dir, name):
    return pathlib.Path(config_dir) / "firmware" / (re.sub(r"[^A-Za-z0-9_.-]+", "_", name) + ".config")


def source(board, klipper, config_dir, kconfigs):
    """Where a board's build settings come from: {"from": "board" | "saved" |
    "host" | "file" | "ask" | None, "text", "files", "why"}."""
    if board["kconfig"]:
        return {"from": "board", "text": board["kconfig"]}
    if board["link"]["kind"] == "host":
        return {"from": "host", "text": "CONFIG_MACH_LINUX=y\n"}
    saved = saved_file(config_dir, board["name"])
    if saved.is_file():
        return {"from": "saved", "text": saved.read_text(encoding="utf-8", errors="replace")}
    if not board["constants"]:
        return {"from": None, "why": "Klipper has not reached it yet, so it is not known what it is"}
    files = found_files(klipper, config_dir, board["constants"], kconfigs)
    if files:
        return {"from": "file", "files": files}
    if guided(board["constants"], kconfigs, []) is not None:
        return {"from": "ask"}
    return {"from": None, "why": "it does not say enough about itself (%s) to build its firmware" % (board["chip"] or "an unknown chip")}


# ------------------------------------------------------------------ flashing

def method(board):
    """How a board is flashed: can (Katapult over CAN), bridge (a USB to CAN
    bridge, through Katapult), usb (Klipper's own flash script: Katapult, else
    DFU or the RP2040 boot mode with sudo), host, or manual."""
    kind, chip = board["link"]["kind"], board["chip"]
    if kind == "host":
        return "host"
    if kind == "can":
        return "bridge" if str(board["constants"].get("CANBUS_BRIDGE", "")) == "1" else "can"
    if kind == "usb" and chip.startswith(("stm32", "rp2")):
        return "usb"
    return "manual"


ORDER = {"can": 0, "usb": 1, "bridge": 2, "host": 3}
SAYS = {
    "can": "over CAN with Katapult, no password",
    "bridge": "the USB to CAN bridge, with Katapult, after the boards behind it",
    "usb": "over USB with Klipper's flash script (Katapult needs no password; DFU and the RP2040 boot mode ask for sudo, "
           "unless install.sh --firmware set them up)",
    "host": "the computer's own: sudo puts it in place, then the computer restarts",
    "manual": "by hand: no script here can write it (a serial port, or a link Klipper does not name); the file is kept for you",
}


# why a board is left out with no one at a terminal, before install.sh --firmware sets it up
ALONE = {
    "usb": "over USB it may need DFU or the RP2040 boot mode, which ask for a password here",
    "host": "sudo puts the host firmware in place, and asks for a password here",
}


def rights():
    """What flashes with no password, once install.sh --firmware set it up:
    {"usb": a board in DFU or the RP2040 boot mode, "host": the host firmware}."""
    return {"usb": os.path.exists(UDEV), "host": os.path.exists(SUDOERS)}


def identity(constants, strict=False):
    keys = IDENTITY + (("CLOCK_FREQ",) if strict else ())
    return {k: str(v) for k, v in (constants or {}).items() if k in keys or k.startswith("RESERVE_PINS_")}


def differences(board, built, strict=False):
    """What the new firmware would do differently from the board's: [text].
    strict, for settings not read from the board: its speed too."""
    a, b = identity(board["constants"], strict), identity(built.get("config"), strict)
    return ["%s: the board %s, the new firmware %s" % (k, a.get(k, "(none)"), b.get(k, "(none)"))
            for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)]


def firmware_file(out, values):
    out = pathlib.Path(out)
    if values.get("CONFIG_MACH_LINUX") == "y":
        return out / "klipper.elf"
    if values.get("CONFIG_MACH_RPXXXX") == "y" and values.get("CONFIG_RPXXXX_HAVE_BOOTLOADER") != "y":
        return out / "klipper.uf2"
    return out / "klipper.bin"


class Runner:
    """Runs a command with its output in a log, and on the screen too when
    asked. A sudo in it asks for the password on the terminal."""

    def __call__(self, cmd, log=None, cwd=None, show=False, check=True):
        cmd = [str(c) for c in cmd]
        with open(log or os.devnull, "a", encoding="utf-8") as f:
            f.write("$ %s\n" % " ".join(cmd))
            p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
            text = []
            for line in p.stdout:
                text.append(line)
                f.write(line)
                if show:
                    sys.stdout.write("    " + line)
                    sys.stdout.flush()
            rc = p.wait()
        out = "".join(text)
        if check and rc != 0:
            tail = "\n".join("    " + l for l in out.strip().splitlines()[-15:])
            raise Stop("%s failed:\n%s" % (os.path.basename(cmd[1] if cmd[0] == "sudo" else cmd[0]), tail))
        return rc, out


def build(board, text, klipper, run, jobs=None, work=WORK):
    """Build a board's firmware from its settings, in a folder of its own, and
    check that Klipper kept every one of them: {"file", "config", "values",
    "version", "log", "settings"}."""
    d = pathlib.Path(work) / re.sub(r"[^A-Za-z0-9_.-]+", "_", board["name"])
    out = d / "out"
    d.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(out, ignore_errors=True)
    cfg, log = d / "klipper.config", d / "build.log"
    log.write_text("")
    cfg.write_text(text if text.endswith("\n") else text + "\n")
    make = ["make", "-C", klipper, "KCONFIG_CONFIG=%s" % cfg, "OUT=%s/" % out]
    run(make + ["olddefconfig"], log=log)
    values = read_kconfig(cfg.read_text())
    lost = lost_settings(text, values, kconfig_symbols(klipper))
    if lost:
        raise Stop("Klipper does not keep these settings (%s): they do not go together, or this Klipper no longer "
                   "has them. Build it once by hand with make menuconfig" % ", ".join(lost))
    run(make + ["-j%d" % (jobs or os.cpu_count() or 1)], log=log)
    try:
        data = json.loads((out / "klipper.dict").read_text())
    except (OSError, ValueError):
        raise Stop("the build left no klipper.dict (see %s)" % log) from None
    fw = firmware_file(out, values)
    if not fw.is_file():
        raise Stop("the build left no %s (see %s)" % (fw.name, log))
    # what make menuconfig set, in short (Klipper v0.13.0-752 and newer), to keep for the next time
    short = data.get("kconfig") if isinstance(data.get("kconfig"), str) and data.get("kconfig").strip() else None
    return {"file": fw, "config": data.get("config") or {}, "values": values, "version": data.get("version", ""),
            "log": log, "settings": short or cfg.read_text(), "start": _hex(values.get("CONFIG_FLASH_APPLICATION_ADDRESS", "0")),
            "bootloader": not any(values.get(k) == "y" for k in NO_BOOTLOADER)}


def _hex(v):
    try:
        return int(str(v), 0)
    except ValueError:
        return 0


def flash_can(board, fw, klipper, python, run, log):
    """Katapult over CAN: into the bootloader, a check that it starts the
    firmware where it was built for, then the writing."""
    tool = [python, pathlib.Path(klipper) / KATAPULT_TOOL, "-i", board["link"]["interface"], "-u", board["link"]["uuid"]]
    run(tool + ["-r"], log=log, check=False)
    _, out = run(tool + ["-s"], log=log, check=False)
    start = re.search(r"Application Start: 0x\s*([0-9A-Fa-f]+)", out)
    if not start:
        raise Stop("no Katapult answered on %s, so nothing was written. Switch the printer off and on so the board "
                   "runs its old firmware again, then flash it by hand (over its USB or SWD)" % board["link"]["uuid"])
    if int(start.group(1), 16) != fw["start"]:
        raise Stop("its Katapult starts the firmware at 0x%x and the new firmware is built for 0x%x, so nothing was written"
                   % (int(start.group(1), 16), fw["start"]))
    _, out = run(tool + ["-f", fw["file"]], log=log, show=True)
    if "Programming Complete" not in out:
        raise Stop("Katapult did not finish writing (see %s)" % log)


def flash_bridge(board, fw, klipper, python, run, log):
    """A USB to CAN bridge: Katapult's tool takes it into the bootloader, where
    it shows as a USB device, and writes it there."""
    tool = [python, pathlib.Path(klipper) / KATAPULT_TOOL, "-i", board["link"]["interface"], "-u", board["link"]["uuid"]]
    _, out = run(tool + ["-f", fw["file"]], log=log, show=True, check=False)
    if "Device is not Katapult" in out:
        raise Stop("the bridge has no Katapult and waits in its DFU mode now. Write the firmware with:\n"
                   "    sudo dfu-util -d 0483:df11 -a 0 -s 0x%x:leave -D %s\n"
                   "  or switch the printer off and on to go back to the old firmware" % (fw["start"], fw["file"]))
    if "Programming Complete" not in out:
        raise Stop("Katapult did not finish writing (see %s)" % log)


def _wait_path(path, seconds):
    end = time.time() + seconds
    while time.time() < end and not os.path.exists(path):
        time.sleep(0.5)
    return os.path.exists(path)


def flash_usb(board, fw, klipper, python, run, log, ask, nosudo=False):
    """Klipper's own flash script, as make flash runs it: it asks the board for
    its bootloader and writes with Katapult when that answers, else with DFU
    (STM32) or the boot mode (RP2040), through sudo unless nosudo (the udev
    rule of install.sh --firmware lets the user write to them)."""
    dev, chip, klipper = board["link"]["device"], board["chip"], pathlib.Path(klipper)
    katapult = dev.replace("usb-Klipper_", "usb-katapult_")
    if not os.path.exists(dev) and os.path.exists(katapult):
        # left in Katapult by an update that stopped half way
        run([python, klipper / KATAPULT_TOOL, "-d", katapult, "-f", fw["file"]], log=log, show=True)
    else:
        # the tools that write without Katapult, built once as make flash does
        for tool, needed in (("lib/rp2040_flash/rp2040_flash", chip.startswith("rp2")),
                             ("lib/hidflash/hid-flash", fw["start"] == 0x8004000)):
            if needed and not (klipper / tool).exists():
                run(["make", "-C", (klipper / tool).parent], log=log, check=False)
                if not (klipper / tool).exists():
                    raise Stop("%s could not be built; it needs libusb. Install it with:\n"
                               "    sudo apt install libusb-1.0-0-dev pkg-config" % tool)
        cmd = [python, "scripts/flash_usb.py", "-t", chip, "-d", dev]
        if chip.startswith("stm32"):
            cmd += ["-s", "0x%x" % fw["start"]]
        if nosudo:
            cmd.append("--no-sudo")
        rc, out = run(cmd + [fw["file"]], log=log, cwd=klipper, show=True, check=False)
        # dfu-util often fails to read the board's state once it has left DFU
        # mode with the new firmware: what it wrote is whole by then
        if rc != 0 and "File downloaded successfully" not in out:
            tail = "\n".join("    " + l for l in out.strip().splitlines()[-15:])
            raise Stop("flash_usb.py failed:\n%s" % tail)
    if not _wait_path(dev, 15):
        ask("The board has not come back yet. Press its RESET button (or switch the printer off and on), then Enter:", "")
        if not _wait_path(dev, 90):
            raise Stop("the board did not come back on %s" % dev)


def flash_host(board, fw, run, log, alone=False):
    """The computer's own: the new file takes the old one's place, which keeps
    running until the computer restarts (install writes over a program that
    runs, where cp cannot). The command is the one install.sh --firmware's
    sudo rule names; alone, sudo must not wait for a password."""
    STAGED.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(fw["file"], STAGED)
    run(["sudo"] + (["-n"] if alone else []) + [INSTALL, "-m", "755", STAGED, HOST_MCU], log=log, show=True)
    if not filecmp.cmp(STAGED, HOST_MCU, shallow=False):
        raise Stop("%s is not the new firmware after the copy" % HOST_MCU)


# ------------------------------------------------------------------ the update

class Progress:
    """The update as it goes, in a JSON file the web page reads (--progress):
    the step it is at, each board's state and why. With no file, nothing.

    A board is waiting, building, ready, left (out), flashing, written,
    failed, done (it runs the new version) or still (it does not)."""

    def __init__(self, path=None):
        self.path = pathlib.Path(path) if path else None
        self.data = {"state": "running", "step": "checking", "klipper": "", "boards": [], "message": "",
                     "pid": os.getpid(), "started": time.time(), "at": time.time()}
        self._write()

    def _write(self):
        if not self.path:
            return
        self.data["at"] = time.time()
        tmp = self.path.with_name(self.path.name + ".tmp")
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp.write_text(json.dumps(self.data))
            os.replace(tmp, self.path)      # the page never reads half a file
        except OSError:
            pass

    def step(self, step, **values):
        self.data.update(values, step=step)
        self._write()

    def board(self, name, state, why="", code="", **values):
        b = next((x for x in self.data["boards"] if x["name"] == name), None)
        if b is None:
            b = {"name": name}
            self.data["boards"].append(b)
        b.update(values, state=state, why=why, code=code)
        self._write()

    def end(self, state, message=""):
        self.data.update(state=state, step="", message=message)
        self._write()


def busy(moon):
    """Why the boards cannot be flashed now, or "" when they can."""
    info = _get(moon, "/printer/info")
    if not info:
        return "Moonraker does not answer."
    if info.get("state") == "startup":
        return "Klipper is starting: wait a minute, then run it again."
    if info.get("state") != "ready":
        return ""                      # Klipper stopped at an error: nothing runs
    q = moon.query({"print_stats": ["state"], "idle_timeout": ["state"], "gcode_macro _AUTO_EJECT_STATE": ["busy", "bg"],
                    "heaters": ["available_heaters"]})
    ps = (q.get("print_stats") or {}).get("state")
    if ps and ps not in FREE:
        return "The printer is %s." % ps
    if (q.get("idle_timeout") or {}).get("state") == "Printing":
        return "Klipper is running a command (the printer is not idle)."
    ae = q.get("gcode_macro _AUTO_EJECT_STATE") or {}
    if ae.get("busy"):
        return "Auto-eject is pushing parts off the bed."
    if ae.get("bg"):
        return "The bed is cooling before the parts are pushed off."
    heaters = (q.get("heaters") or {}).get("available_heaters") or []
    for name, st in (moon.query({h: ["target"] for h in heaters}) if heaters else {}).items():
        if (st or {}).get("target"):
            return "%s is heating (to %s °C): turn it off first." % (name, st["target"])
    return ""


def klipper_service(moon):
    ids = ((_get(moon, "/machine/system_info") or {}).get("system_info") or {}).get("instance_ids") or {}
    return ids.get("klipper") or "klipper"


def wait_ready(moon, seconds=120, step=2):
    end = time.time() + seconds
    while time.time() < end:
        info = _get(moon, "/printer/info") or {}
        if info.get("state") in ("ready", "error", "shutdown"):
            return info
        time.sleep(step)
    return _get(moon, "/printer/info") or {}


def ask_line(question, default):
    """The answer typed, or the default on Enter. With no one at a terminal
    the answer is empty: no to every question (update --yes says yes)."""
    if not sys.stdin.isatty():
        return ""
    try:
        return input("  %s " % question).strip() or default
    except EOFError:
        return default


def yes(question, default=True, ask=ask_line):
    return ask("%s [%s]" % (question, "Y/n" if default else "y/N"), "y" if default else "n").lower().startswith("y")


def choose(question, options, default, ask=ask_line, out=print):
    """One of [(line, label)], by its number; None leaves the board out."""
    out("  " + question)
    for i, (_, label) in enumerate(options, 1):
        out("     %d) %s" % (i, label))
    while True:
        if default is None:
            a = ask("Number, or Enter to leave this board out:", "")
        else:
            a = ask("Number [%d]:" % (default + 1), str(default + 1))
        if not a:
            return None
        if a.isdigit() and 1 <= int(a) <= len(options):
            return options[int(a) - 1][0]
        out("  Type one of the numbers.")


def settings_for(board, src, kconfigs, ask=ask_line, out=print):
    """The build settings of a board, asking what has to be asked; None
    leaves the board out."""
    if src["from"] in ("board", "saved", "host"):
        return src["text"]
    for p in src.get("files", []):
        if yes("%s does not say how its firmware was built. Use %s (for %s, talking as it does now)?" % (board["name"], p, board["chip"]), ask=ask):
            return p.read_text(encoding="utf-8", errors="replace")
    if guided(board["constants"], kconfigs, []) is None:
        return None
    out("  %s (%s) does not say how its firmware was built. Its chip and its connection are known;"
        " this is what only its maker knows:" % (board["name"], board["chip"]))
    answers = []
    for q, opts, default in questions(board["constants"], kconfigs):
        pick = choose(q, opts, default, ask=ask, out=out)
        if pick is None:
            return None
        answers.append(pick)
    return guided(board["constants"], kconfigs, answers)


def _paths(info):
    home = pathlib.Path.home()
    return (info.get("klipper_path") or str(home / "klipper"), info.get("python_path") or sys.executable,
            os.path.dirname(info.get("config_file") or "") or str(home / "printer_data" / "config"))


def report(moon):
    """Each board against Klipper, where its settings come from and how it is
    flashed, and what flashes with no password: what status and the web page
    show."""
    info = moon.call("/printer/info")
    klipper, _, config_dir = _paths(info)
    kconfigs = kconfig_files(klipper)
    host = info.get("software_version", "")
    rows = []
    for b in boards(moon, info):
        src = source(b, klipper, config_dir, kconfigs)
        rows.append({"name": b["name"], "chip": b["chip"], "link": b["link"]["kind"], "version": b["version"],
                     "age": age(b["version"], host) if ours(b) else "not_klipper", "settings": src["from"],
                     "why": src.get("why", ""), "method": method(b)})
    return {"klipper": host, "boards": rows, "rights": rights()}


def status(moon, as_json=False, out=print):
    r = report(moon)
    host, rows = r["klipper"], r["boards"]
    if as_json:
        out(json.dumps(r, indent=2))
        return rows
    out("Klipper %s" % (host or "?"))
    for r in rows:
        state = {"same": "up to date", "older": "older than Klipper", "newer": "newer than Klipper",
                 "not_klipper": "left alone: not Klipper's firmware, or never reached"}.get(r["age"], "another version")
        out("  %-12s %-12s %-6s %s (%s)" % (r["name"], r["chip"] or "?", r["link"], r["version"] or "?", state))
        if r["age"] not in ("same", "not_klipper"):
            where = "nothing: " + r["why"] if r["settings"] is None else FROM[r["settings"]]
            out("    built from %s; flashed %s" % (where, SAYS[r["method"]]))
    return rows


def behind(moon, out=print):
    """The names of the boards whose firmware is older than Klipper, on one
    line, for the end of install.sh."""
    host = moon.call("/printer/info").get("software_version", "")
    names = [b["name"] for b in boards(moon) if ours(b) and age(b["version"], host) == "older"]
    if names:
        out(" ".join(names))
    return names


def update(moon, only=None, assume_yes=False, build_only=False, run=None, out=print, ask=ask_line, work=WORK,
           tty=None, progress=None):
    run = run or Runner()
    progress = progress or Progress()
    # no one at a terminal (the web page's button): sudo cannot ask for a password
    alone = not (sys.stdin.isatty() if tty is None else tty)
    can = rights()
    info = moon.call("/printer/info")
    host = info.get("software_version", "")
    klipper, python, config_dir = _paths(info)
    kconfigs = kconfig_files(klipper)
    wanted = {n.lower() for n in only or []}
    found = boards(moon, info)
    if not found:
        raise Stop("Klipper names no boards%s." % (": " + info["state_message"].strip() if info.get("state_message") else ""))
    todo = [b for b in found if ours(b) and age(b["version"], host) != "same" and (not wanted or b["name"].lower() in wanted)]
    progress.step("checking", klipper=host)
    if not todo:
        out("Every board runs Klipper %s already." % host if not wanted else "Those boards run Klipper %s already, or there are none by those names." % host)
        return 0
    for b in todo:
        progress.board(b["name"], "waiting", how=method(b), version=b["version"])
    why = busy(moon)
    if why:
        raise Stop(why + " Nothing was changed.")
    out("Klipper is %s. To build: %s" % (host, ", ".join("%s (%s)" % (b["name"], b["version"] or "?") for b in todo)))

    # the settings first, while nothing has changed yet
    plan = []
    for b in todo:
        src, how = source(b, klipper, config_dir, kconfigs), method(b)
        if src["from"] is None:
            out("  %s: left out, %s." % (b["name"], src["why"]))
            progress.board(b["name"], "left", why=src["why"], code="settings")
            continue
        if alone and how in ALONE and not can[how]:
            out("  %s: left out, %s: install.sh --firmware can set that up once." % (b["name"], ALONE[how]))
            progress.board(b["name"], "left", why=ALONE[how], code="setup")
            continue
        text = None if assume_yes and src["from"] in ("file", "ask") else settings_for(b, src, kconfigs, ask=ask, out=out)
        if text is None:
            out("  %s: left out, no settings to build it with%s." % (b["name"], " (run it without --yes to answer)" if assume_yes else ""))
            progress.board(b["name"], "left", why="no settings to build it with", code="answers" if assume_yes else "settings")
            continue
        plan.append({"board": b, "text": text, "from": src["from"], "how": how})
    if any(p["board"]["chip"].startswith(("stm32", "rp2")) for p in plan) and not shutil.which("arm-none-eabi-gcc"):
        raise Stop("the compiler for the boards is missing. Install it with:\n    %s" % TOOLCHAIN)

    # build them all while Klipper still runs
    progress.step("building")
    ready = []
    for p in plan:
        b, t = p["board"], time.time()
        out("Building %s (%s, from %s) ..." % (b["name"], b["chip"] or "host", FROM[p["from"]]))
        progress.board(b["name"], "building")
        try:
            fw = build(b, p["text"], klipper, run, work=work)
        except Stop as e:
            out("  not built: %s" % e)
            progress.board(b["name"], "left", why=str(e), code="build")
            continue
        diff = differences(b, fw, strict=p["from"] != "board")
        if diff:
            out("  built, but it would not be the same board any more, so it is left out:\n%s" % "\n".join("    " + d for d in diff))
            progress.board(b["name"], "left", why="; ".join(diff), code="differs")
            continue
        out("  done in %d s: %s" % (time.time() - t, fw["file"]))
        if not same_version(fw["version"], host):
            out("  Note: Klipper's files are %s while the Klipper running is %s; it runs %s too once it starts again."
                % (fw["version"], host, fw["version"]))
        p["fw"] = fw
        if p["how"] in ("can", "bridge") and not fw["bootloader"]:
            out("  %s has no bootloader, so it cannot be written over CAN: write %s over its USB or SWD." % (b["name"], fw["file"]))
            progress.board(b["name"], "left", why="no bootloader: write %s over its USB or SWD" % fw["file"], code="manual")
        elif p["how"] == "manual":
            out("  %s: write %s by hand, the way it was written the first time (often from an SD card)." % (b["name"], fw["file"]))
            progress.board(b["name"], "left", why="write %s by hand" % fw["file"], code="manual")
        else:
            ready.append(p)
            progress.board(b["name"], "ready")
    if build_only:
        out("Built; nothing was flashed. The files are in %s." % work)
        return 0
    if not ready:
        return 1

    ready.sort(key=lambda p: ORDER[p["how"]])
    out("")
    out("Klipper stops while these are flashed, in this order:")
    for i, p in enumerate(ready, 1):
        out("  %d. %s: %s" % (i, p["board"]["name"], SAYS[p["how"]]))
    host_too = any(p["how"] == "host" for p in ready)
    if host_too:
        out("  Then the printer's computer restarts (a minute or two).")
    if not assume_yes and not yes("Flash now?", ask=ask):
        out("Nothing was flashed. The firmware files are in %s." % work)
        return 0
    why = busy(moon)
    if why:
        raise Stop(why + " Nothing was flashed.")
    queue = _get(moon, "/server/job_queue/status") or {}
    if queue.get("queue_state") == "ready" and queue.get("queued_jobs"):
        moon.call("/server/job_queue/pause", {})
        out("The job queue is paused for the update: start it again when you are ready.")
    service = klipper_service(moon)
    progress.step("flashing", reboot=host_too)
    moon.call("/machine/services/stop?service=" + urllib.parse.quote(service), {})
    time.sleep(2)
    done, failed, current = [], None, None
    try:
        for p in ready:
            current = p
            b, fw = p["board"], p["fw"]
            out("Flashing %s ..." % b["name"])
            progress.board(b["name"], "flashing")
            if p["how"] == "can":
                flash_can(b, fw, klipper, python, run, fw["log"])
            elif p["how"] == "bridge":
                flash_bridge(b, fw, klipper, python, run, fw["log"])
            elif p["how"] == "usb":
                def reset(question, default, name=b["name"]):
                    progress.board(name, "flashing", why=question, code="reset")    # the page asks for it too
                    return ask(question, default)
                flash_usb(b, fw, klipper, python, run, fw["log"], reset, nosudo=can["usb"])
            else:
                flash_host(b, fw, run, fw["log"], alone=alone)
            done.append(p)
            if p["how"] != "host":
                keep = saved_file(config_dir, b["name"])
                try:
                    keep.parent.mkdir(exist_ok=True)
                    keep.write_text(fw["settings"])
                except OSError:
                    pass
            out("  written.")
            progress.board(b["name"], "written")
    except Stop as e:
        failed = (current["board"]["name"], str(e))
        progress.board(failed[0], "failed", why=failed[1])
    except BaseException:
        if current and current not in done:
            progress.board(current["board"]["name"], "failed", why="stopped while it was written")
        moon.call("/machine/services/start?service=" + urllib.parse.quote(service), {})   # whatever stopped it, Klipper runs again
        raise
    if failed:
        out("Stopped at %s: %s" % failed)
    if host_too and any(p["how"] == "host" for p in done):
        out("Restarting the printer's computer so the new host firmware runs. Look again in a minute or two "
            "(install.sh --firmware, or the Updates page).")
        progress.step("rebooting")
        moon.call("/machine/reboot", {})
        return 1 if failed else 0
    moon.call("/machine/services/start?service=" + urllib.parse.quote(service), {})
    out("Klipper is starting ...")
    progress.step("starting")
    info = wait_ready(moon)
    if info.get("state") != "ready":
        out("Klipper says: %s" % (info.get("state_message") or info.get("state") or "nothing").strip())
    now = {b["name"]: b["version"] for b in boards(moon)} if info else {}
    for p in done:
        v = now.get(p["board"]["name"], "")
        ok = same_version(v, p["fw"]["version"])
        out("  %s: %s" % (p["board"]["name"], "now %s" % v if ok else "still %s" % (v or "unknown")))
        progress.board(p["board"]["name"], "done" if ok else "still", now=v)
    return 1 if failed else 0


class Restarting(SystemExit):
    """The restart asked for after the host firmware stopped this process: the update is over."""


def _terminated(signum, progress=None):
    if progress and progress.data["step"] == "rebooting":
        failed = any(b["state"] == "failed" for b in progress.data["boards"])
        raise Restarting(1 if failed else 0)
    # SystemExit goes through update's clean up, so Klipper starts again
    raise SystemExit("Stopped: the update was stopped (signal %d)." % signum)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--moonraker", default=MOONRAKER, help="Moonraker's address (default %(default)s)")
    sub = ap.add_subparsers(dest="cmd")
    st = sub.add_parser("status", help="each board's firmware against Klipper's")
    st.add_argument("--json", action="store_true")
    up = sub.add_parser("update", help="build and flash the boards that differ from Klipper")
    up.add_argument("--yes", action="store_true", help="ask nothing; a board that needs an answer is left out")
    up.add_argument("--only", default="", help="only these boards, by name: mcu,toolhead")
    up.add_argument("--build-only", action="store_true", help="build the firmware files and flash nothing")
    up.add_argument("--progress", default="", help="keep the update's state in this JSON file, for the web page")
    sub.add_parser("behind", help="the names of the boards older than Klipper, or nothing")
    args = ap.parse_args(argv)
    moon = Moonraker(args.moonraker, timeout=5 if args.cmd == "behind" else 15)
    progress = Progress(args.progress or None) if args.cmd == "update" else None
    rc, said = 1, ""
    try:
        if args.cmd == "behind":
            behind(moon)
            return 0
        if args.cmd == "status":
            status(moon, args.json)
            return 0
        if args.cmd == "update":
            signal.signal(signal.SIGTERM, lambda signum, frame: _terminated(signum, progress))
            rc = update(moon, only=[n for n in args.only.split(",") if n], assume_yes=args.yes, build_only=args.build_only,
                        progress=progress)
            return rc
    except Stop as e:
        said = "Stopped: %s" % e
    except urllib.error.HTTPError as e:
        said = "Moonraker answers, but not for Klipper (%s): is Klipper running?" % e
    except (urllib.error.URLError, OSError) as e:
        said = "Moonraker does not answer at %s (%s)." % (args.moonraker, e)
    except Restarting as e:
        rc = e.code
        raise
    except SystemExit as e:
        said = str(e)
        raise
    finally:
        if progress:
            progress.end("done" if rc == 0 else "failed", said)
    if said:
        print(said, file=sys.stderr)
        return 1
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
