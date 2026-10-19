"""Minimal stand-in for Klipper's gcode_macro template engine.

Loads the .cfg files the same way Klipper does (configparser with inline
comments, ``variable_*`` options parsed with ``ast.literal_eval``) and renders
a macro body with Klipper's Jinja2 delimiters, so the macros can be tested
without a printer.
"""

import ast
import configparser
import pathlib
import re
from collections import namedtuple

import jinja2

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"

Coord = namedtuple("Coord", ("x", "y", "z", "e"))


class MacroError(Exception):
    """Raised by action_raise_error()."""


def load_config(*files):
    parser = configparser.RawConfigParser(
        strict=False, inline_comment_prefixes=(";", "#"))
    for f in files:
        parser.read(CONFIG_DIR / f, encoding="utf-8")
    return parser


class Printer:
    """Holds the printer status and renders macros against it."""

    def __init__(self, extra_settings=None):
        self.cfg = load_config("auto_eject.cfg", "auto_eject_settings.cfg")
        self.env = jinja2.Environment("{%", "%}", "{", "}")
        self.macros = {}
        self.status = {}
        for section in self.cfg.sections():
            if not section.startswith("gcode_macro "):
                continue
            name = section.split(None, 1)[1]
            variables = {}
            for opt, value in self.cfg.items(section):
                if opt.startswith("variable_"):
                    variables[opt[len("variable_"):]] = ast.literal_eval(value)
            self.macros[name.upper()] = self.cfg.get(section, "gcode")
            self.status["gcode_macro " + name] = variables
        if extra_settings:
            self.status["gcode_macro _AUTO_EJECT_SETTINGS"].update(extra_settings)
        self.messages = []
        self.set_machine()

    # ----------------------------------------------------------------- setup
    def set_machine(self, axis_min=(0, 0, -5), axis_max=(450, 450, 400),
                    position=(200, 200, 30), homed="xyz", accel=3000,
                    probe=None, steppers=("stepper_x", "stepper_y"),
                    driver="tmc5160", run_current=0.8, bed=True,
                    max_extrude_cross_section=50.0, kinematics="corexy",
                    save_variables=None, exclude_object_section=False):
        self.status["toolhead"] = {
            "axis_minimum": Coord(axis_min[0], axis_min[1], axis_min[2], 0.0),
            "axis_maximum": Coord(axis_max[0], axis_max[1], axis_max[2], 0.0),
            "position": Coord(position[0], position[1], position[2], 0.0),
            "homed_axes": homed,
            "max_accel": accel,
        }
        settings = {
            "printer": {"kinematics": kinematics},
            "respond": {},
            "extruder": {"min_extrude_temp": 170.0,
                         "max_extrude_cross_section": max_extrude_cross_section},
        }
        for st in steppers:
            settings["%s %s" % (driver, st)] = {"run_current": run_current}
        if probe is not None:
            settings["probe"] = probe
        # Klipper's .config holds every section, .settings only sections
        # with options, so empty ones like [exclude_object] are missing there.
        raw = {name: {} for name in settings}
        if exclude_object_section:
            raw["exclude_object"] = {}
        self.status["configfile"] = {"settings": settings, "config": raw}
        self.status["extruder"] = {"temperature": 220.0}
        if bed:
            self.status["heater_bed"] = {"temperature": 60.0}
        else:
            self.status.pop("heater_bed", None)
        self.status["probe"] = {"last_z_result": 0.0}
        if save_variables is not None:
            self.status["save_variables"] = {"variables": save_variables}
        else:
            self.status.pop("save_variables", None)
        self.status.setdefault("exclude_object", {"objects": []})

    def set_objects(self, objects):
        """objects: list of (name, polygon) with polygon as [[x, y], ...]."""
        out = []
        for name, poly in objects:
            xs = [p[0] for p in poly]
            ys = [p[1] for p in poly]
            center = [(min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0]
            out.append({"name": name, "polygon": poly, "center": center})
        self.status["exclude_object"] = {"objects": out}

    # ---------------------------------------------------------------- render
    def render(self, macro, **params):
        tmpl = self.env.from_string(self.macros[macro.upper()])
        context = {
            "printer": self.status,
            "params": {k.upper(): str(v) for k, v in params.items()},
            "rawparams": " ".join("%s=%s" % kv for kv in params.items()),
            "action_respond_info": self._respond,
            "action_raise_error": self._raise,
            "action_emergency_stop": self._raise,
            "action_call_remote_method": lambda *a, **k: "",
        }
        text = tmpl.render(context)
        return [line.strip() for line in text.splitlines() if line.strip()]

    def _respond(self, msg):
        self.messages.append(msg)
        return ""

    @staticmethod
    def _raise(msg):
        raise MacroError(msg)


def rect(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


_WORD = re.compile(r"([A-Z])(-?[0-9.]+)")


def words(line):
    """'G1 X10 Y20.5 F600' -> {'X': 10.0, 'Y': 20.5, 'F': 600.0}"""
    return {k: float(v) for k, v in _WORD.findall(line.split(None, 1)[1])} \
        if " " in line else {}
