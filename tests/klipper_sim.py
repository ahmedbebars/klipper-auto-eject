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
import shlex
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
        # Klipper cuts every line at its first '#', even inside a template
        text = (CONFIG_DIR / f).read_text(encoding="utf-8")
        lines = [line.split("#", 1)[0] for line in text.splitlines()]
        parser.read_string("\n".join(lines), str(f))
    return parser


class Printer:
    """Holds the printer status and renders macros against it."""

    def __init__(self, extra_settings=None):
        self.cfg = load_config("auto_eject.cfg", "auto_eject_settings.cfg")
        self.env = jinja2.Environment("{%", "%}", "{", "}")
        self.macros = {}
        self.delayed = {}
        self.status = {}
        for section in self.cfg.sections():
            if section.startswith("delayed_gcode "):
                self.delayed[section.split(None, 1)[1].upper()] = self.cfg.get(section, "gcode")
                continue
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
        self.remote_calls = []
        self.frame_shift = 0.0   # machine Z frame minus real nozzle height
        self.under_probe = 0.0   # height under the probe, or f(x, y) -> height
        self.g28_drops_z = False  # homing override that un-homes Z on G28 X Y
        self.calls = []
        # Klipper works out a macro when it is called, without pausing. A
        # move queued before it is sent late if that takes long ("Timer too
        # close"), so the slow macros must be called with nothing moving.
        self.moving = False
        self.called_while_moving = []
        self.bed_cooling = 5.0   # degrees per second while dwelling (G4)
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
            "estimated_print_time": 0.0,
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
            "action_call_remote_method": self._remote,
        }
        text = tmpl.render(context)
        return [line.strip() for line in text.splitlines() if line.strip()]

    def set_section(self, name, options):
        """Add a config section (to both .settings and .config)."""
        self.status["configfile"]["settings"][name] = options
        self.status["configfile"]["config"][name] = options

    # --------------------------------------------------------------- execute
    def execute(self, macro, **params):
        """Run a macro the way Klipper does: render it, then run every line,
        rendering nested macros only when they are reached. Returns the
        non-macro commands that were run, in order."""
        self.executed = []
        self.active = set()
        self.pending = []
        self._run_macro(macro.upper(), {k.upper(): str(v) for k, v in params.items()},
                        " ".join("%s=%s" % kv for kv in params.items()))
        # delayed_gcode timers fire once the current command has finished
        for _ in range(100):
            if not self.pending:
                break
            name = self.pending.pop(0)
            self._run_template(self.delayed[name], {}, "")
        return self.executed

    def run_gcode(self, line):
        """Run one console line (e.g. a dialog button's G-code)."""
        cmd, _, raw = line.partition(" ")
        params = dict(a.split("=", 1) for a in shlex.split(raw)) if raw else {}
        return self.execute(cmd, **params)

    def _run_macro(self, name, params, raw):
        # Klipper: "Macro %s called recursively"
        if name in self.active:
            raise MacroError("Macro %s called recursively" % name)
        self.active.add(name)
        self.calls.append(name)
        if self.moving:
            self.called_while_moving.append(name)
        try:
            self._run_template(self.macros[name], params, raw)
        finally:
            self.active.discard(name)

    def _run_template(self, source, params, raw):
        tmpl = self.env.from_string(source)
        text = tmpl.render({
            "printer": self.status,
            "params": params,
            "rawparams": raw,
            "action_respond_info": self._respond,
            "action_raise_error": self._raise,
            "action_emergency_stop": self._raise,
            "action_call_remote_method": self._remote,
        })
        for line in (l.strip() for l in text.splitlines()):
            if line:
                self._run_line(line)

    def _run_line(self, line):
        cmd, _, raw = line.partition(" ")
        cmd = cmd.upper()
        if cmd in self.macros:
            params = dict(a.split("=", 1) for a in shlex.split(raw)) if raw else {}
            self._run_macro(cmd, {k.upper(): v for k, v in params.items()}, raw)
            return
        self.executed.append(line)
        th = self.status["toolhead"]
        if cmd in ("G0", "G1"):
            self.moving = True
        elif cmd in ("M400", "G4", "G28", "PROBE", "TEMPERATURE_WAIT"):
            self.moving = False      # these wait until every move is done
        if cmd == "TEMPERATURE_WAIT":
            w = dict(a.split("=", 1) for a in shlex.split(raw))
            sensor = self.status.get(w["SENSOR"], {})
            if "MAXIMUM" in w and sensor.get("temperature", 0.0) > float(w["MAXIMUM"]):
                sensor["temperature"] = float(w["MAXIMUM"])
        if cmd == "SET_GCODE_VARIABLE":
            p = dict(a.split("=", 1) for a in shlex.split(raw))
            macro = "gcode_macro " + p["MACRO"]
            self.status[macro][p["VARIABLE"]] = ast.literal_eval(p["VALUE"])
        elif cmd == "SAVE_VARIABLE":
            p = dict(a.split("=", 1) for a in shlex.split(raw))
            self.status["save_variables"]["variables"][p["VARIABLE"]] = \
                ast.literal_eval(p["VALUE"])
        elif cmd == "G1":
            w = words(line)
            pos = list(th["position"])
            for i, axis in enumerate("XYZ"):
                if axis in w:
                    pos[i] = w[axis]
            th["position"] = Coord(*pos)
        elif cmd == "G28":
            axes = [a for a in "XYZ" if a in raw.upper()] or list("XYZ")
            homed = set(th["homed_axes"]) | {a.lower() for a in axes}
            if self.g28_drops_z and "Z" not in axes:
                homed.discard("z")
            th["homed_axes"] = "".join(a for a in "xyz" if a in homed)
        elif cmd == "SET_KINEMATIC_POSITION":
            w = {k.upper(): float(v) for k, v in
                 (a.split("=", 1) for a in shlex.split(raw)) if k.upper() in "XYZ"}
            if "Z" in w:
                # the real nozzle height does not change; only the frame does
                real = th["position"][2] - self.frame_shift
                self.frame_shift = w["Z"] - real
            pos = list(th["position"])
            for i, axis in enumerate("XYZ"):
                if axis in w:
                    pos[i] = w[axis]
            th["position"] = Coord(*pos)
            th["homed_axes"] = "xyz"
        elif cmd == "PROBE":
            self.on_probe()
        elif cmd == "G4":
            seconds = words(line).get("P", 0.0) / 1000.0
            th["estimated_print_time"] = th.get("estimated_print_time", 0.0) + seconds
            if "heater_bed" in self.status:
                self.status["heater_bed"]["temperature"] -= self.bed_cooling * seconds
        elif cmd == "UPDATE_DELAYED_GCODE":
            p = dict(a.split("=", 1) for a in shlex.split(raw))
            if float(p.get("DURATION", 0)) > 0:
                self.pending.append(p["ID"].upper())

    def on_probe(self, _printer=None):
        """Probe down to whatever is under it: the bed, or a part of height
        ``self.under_probe``. Like Klipper, the toolhead stays at the trigger
        point and last_z_result is the toolhead Z there."""
        settings = self.status["configfile"]["settings"]
        probe = settings.get("probe", settings.get("bltouch", {}))
        th = self.status["toolhead"]
        height = self.under_probe
        if callable(height):
            height = height(th["position"][0] + probe.get("x_offset", 0.0),
                            th["position"][1] + probe.get("y_offset", 0.0))
        z = probe.get("z_offset", 0.0) + height + self.frame_shift
        pos = list(th["position"])
        pos[2] = z
        th["position"] = Coord(*pos)
        self.status["probe"]["last_z_result"] = z

    def _remote(self, method, **kwargs):
        self.remote_calls.append(method)
        return ""

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
