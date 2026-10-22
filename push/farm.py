"""klipper-auto-eject farm: every Klipper printer on the network in one place.

Part of the klipper-auto-eject service (auto_eject_push.py). It finds the
printers on the local network and on Tailscale, asks each one for its state
every few seconds, and serves the farm to the auto-eject page over a small
HTTP API on 127.0.0.1, which nginx publishes at /auto-eject/api/.

The other printers need nothing installed: their Moonraker answers this
printer like it answers Mainsail on the same network. Those with
klipper-auto-eject also show their parts, cooling and eject.
"""

import collections
import concurrent.futures
import hashlib
import http.client
import ipaddress
import json
import os
import re
import socket
import subprocess
import tempfile
import threading
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAMESPACE = "auto_eject_farm"
PORTS = (7125, 80)
QUERY = ("/printer/objects/query?print_stats=state,filename,print_duration,info,message"
         "&virtual_sdcard=progress&heater_bed=temperature,target&extruder=temperature,target"
         "&webhooks=state,state_message&idle_timeout=state"
         "&gcode_macro%20_AUTO_EJECT_STATE=objects,busy,swept,leftover,height,bin,bg,cooling"
         "&gcode_macro%20_AUTO_EJECT_DEFAULTS=bin_capacity&gcode_macro%20_AUTO_EJECT_SETTINGS=bin_capacity"
         "&gcode_macro%20_AUTO_EJECT_OVERRIDES=data")
NOZZLE_COOL = 50.0     # turning the power off stops the hotend fan: never above this
HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$")
TAILNET = ipaddress.ip_network("100.64.0.0/10")
# what the farm page can ask a printer to do
ACTIONS = {
    "continue": ("POST", "/server/job_queue/start", None),
    # the bed is clear: auto-eject forgets the parts; any other printer
    # forgets the finished job, so it shows as free again
    "clear": ("POST", "/printer/gcode/script", {"script": "AUTO_EJECT_CLEAR"}),
    "clear_plain": ("POST", "/printer/gcode/script", {"script": "SDCARD_RESET_FILE"}),
    "bin_empty": ("POST", "/printer/gcode/script", {"script": "AUTO_EJECT_BIN_EMPTY"}),
    # cooling with the printer free (cool_background): push without waiting
    "push": ("POST", "/printer/gcode/script", {"script": "AUTO_EJECT_PUSH_NOW"}),
    "pause": ("POST", "/printer/print/pause", None),
    "resume": ("POST", "/printer/print/resume", None),
    "cancel": ("POST", "/printer/print/cancel", None),
    "estop": ("POST", "/printer/emergency_stop", None),
}
GCODE_FILE = re.compile(r"\.(gcode|g|gco|bgcode)$", re.I)
# phases in which a printer cannot start a print
BUSY = ("printing", "paused", "ejecting", "stopped", "offline", "off")
ON_THE_BED = ("leftover", "parts", "bin")
UPLOADS = os.path.expanduser("~/.cache/klipper-auto-eject")    # on the card, not in RAM (/tmp)
# the states in which a printer may be updated: Klipper restarts after some updates
IDLE_STATES = ("standby", "complete", "cancelled", "error")
UPDATES_EVERY = 300        # seconds between two looks at a printer's versions
# this printer updated its own auto-eject: Moonraker restarts this service
# meanwhile, so Klipper is restarted (for the new macros) once it is back
RESTART_FLAG = os.path.join(UPLOADS, "restart-klipper")
# what is updated first: the rest, then Klipper, Moonraker, and auto-eject last,
# since it restarts the service that runs the update on the farm's own printer
UPDATE_ORDER = {"klipper": 1, "moonraker": 2, "klipper-auto-eject": 3}
# what the print dialog shows of a file, from Moonraker's metadata
FILE_FACTS = ("estimated_time", "filament_weight_total", "filament_total", "object_height", "layer_height",
              "layer_count", "filament_type", "nozzle_diameter", "slicer", "slicer_version", "modified", "size")
THUMBS_KEPT = 200      # pictures the farm keeps in memory (a few KB each)
# the auto-eject settings, merged as the macros merge them: the defaults,
# the settings file, then what was changed in the page (AUTO_EJECT_SET)
SETTING_MACROS = ("_AUTO_EJECT_DEFAULTS", "_AUTO_EJECT_SETTINGS", "_AUTO_EJECT_OVERRIDES")
SETTING_KEY = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
SETS_MAX = 100         # saved sets of settings, one for each kind of printer


def safe_name(name):
    """A G-code file name that Moonraker and a form header both take."""
    name = os.path.basename(str(name or "").replace("\\", "/")).strip()
    name = re.sub(r'[^\w .+()\-]', "_", name, flags=re.UNICODE).strip(" .")
    if not name or not GCODE_FILE.search(name):
        raise ValueError("not a G-code file: %s" % name)
    return name[:200]


def upload_file(base, name, fileobj, size, start=False, timeout=600):
    """Send a file to a Moonraker (POST /server/files/upload), streamed from
    fileobj; start=True prints it at once."""
    b = "----autoeject" + uuid.uuid4().hex
    head = ""
    if start:
        head += '--%s\r\nContent-Disposition: form-data; name="print"\r\n\r\ntrue\r\n' % b
    head += '--%s\r\nContent-Disposition: form-data; name="root"\r\n\r\ngcodes\r\n' % b
    head += ('--%s\r\nContent-Disposition: form-data; name="file"; filename="%s"\r\n'
             "Content-Type: application/octet-stream\r\n\r\n" % (b, name))
    head, tail = head.encode("utf-8"), ("\r\n--%s--\r\n" % b).encode()
    u = urllib.parse.urlsplit(base)
    conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=timeout)
    try:
        conn.putrequest("POST", "/server/files/upload")
        conn.putheader("Content-Type", "multipart/form-data; boundary=" + b)
        conn.putheader("Content-Length", str(len(head) + size + len(tail)))
        conn.endheaders()
        conn.send(head)
        fileobj.seek(0)
        while True:
            chunk = fileobj.read(1 << 20)
            if not chunk:
                break
            conn.send(chunk)
        conn.send(tail)
        resp = conn.getresponse()
        data = json.loads(resp.read() or b"{}")
    finally:
        conn.close()
    if resp.status >= 300:
        raise RuntimeError((data.get("error") or {}).get("message") or "HTTP %d" % resp.status)
    # unlike its other answers, Moonraker sends the upload's without {"result": ...}
    return data.get("result", data)


def pick_thumb(thumbs, want):
    """The slicer's picture to show want pixels wide: the smallest at least
    that wide, else the largest there is."""
    shots = sorted((t for t in thumbs or [] if isinstance(t, dict) and t.get("relative_path") and (t.get("width") or 0) > 0),
                   key=lambda t: t["width"])
    if not shots:
        return None
    return next((t for t in shots if t["width"] >= want), shots[-1])


def thumb_path(filename, thumb):
    """Its path on Moonraker: relative to the G-code file's folder."""
    if not thumb or not thumb.get("relative_path"):
        return ""
    folder = filename.rsplit("/", 1)[0] + "/" if "/" in filename else ""
    parts = [s for s in (folder + thumb["relative_path"]).split("/") if s and s != "."]
    if ".." in parts:
        return ""
    return "/server/files/gcodes/" + urllib.parse.quote("/".join(parts))


def setting_text(value):
    """A value as AUTO_EJECT_SET takes it (settingArg() in web/model.js)."""
    if value is True:
        return "true"
    if value is False:
        return "false"
    return str(value).strip()


def setting_ok(text):
    """What AUTO_EJECT_SET refuses, refused here too (validSettingText() in
    web/model.js): such a value is changed in the settings file only."""
    return text != "" and not re.search(r"['\"#;\s]", text)


def same_setting(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) < 1e-9
    return a == b


def http_json(url, data=None, method=None, timeout=3.0):
    request = urllib.request.Request(url, method=method or ("POST" if data is not None else "GET"),
                                     data=None if data is None else json.dumps(data).encode(),
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response).get("result")


def printer_id(host, port):
    return hashlib.sha1(("%s:%s" % (host, port)).encode()).hexdigest()[:10]


def machine_macs(host, port, timeout=2.0):
    """The machine's network cards. The same printer reached over the local
    network and over Tailscale has the same ones; two printers with the same
    hostname (mainsailos...) do not."""
    try:
        net = http_json("http://%s:%d/machine/system_info" % (host, port), timeout=timeout)["system_info"].get("network") or {}
    except Exception:
        return []
    return sorted({str(v.get("mac_address") or "").lower() for v in net.values()} - {"", "00:00:00:00:00:00"})


def same_machine(a_port, a_macs, b_port, b_macs):
    return a_port == b_port and bool(set(a_macs) & set(b_macs))


def same_printer(a, b):
    """Two search results or records for one printer: same address, or same machine."""
    a_port, b_port = int(a.get("port") or 7125), int(b.get("port") or 7125)
    return (a.get("host") == b.get("host") and a_port == b_port) or \
        same_machine(a_port, a.get("macs") or [], b_port, b.get("macs") or [])


# --------------------------------------------------------------- one printer
def bin_capacity(status):
    """bin_capacity as the macros see it: saved with AUTO_EJECT_SET, else the
    settings file, else the default. Old settings files lack it."""
    sources = ((status.get("gcode_macro _AUTO_EJECT_OVERRIDES") or {}).get("data") or {},
               status.get("gcode_macro _AUTO_EJECT_SETTINGS") or {},
               status.get("gcode_macro _AUTO_EJECT_DEFAULTS") or {})
    for src in sources:
        if src.get("bin_capacity") is not None:
            try:
                return max(0, int(src["bin_capacity"]))
            except (TypeError, ValueError):
                return 0
    return 0


def summarize(status, queue=None, now=None):
    """A printer's card from its Moonraker status: phase and what needs you."""
    ps = status.get("print_stats", {})
    wh = status.get("webhooks", {})
    vs = status.get("virtual_sdcard", {})
    ae = status.get("gcode_macro _AUTO_EJECT_STATE")
    if not ae or ae.get("objects") is None:    # Moonraker answers null for a macro the printer lacks
        ae = None
    queue = queue or {}
    jobs = len(queue.get("queued_jobs", []))
    progress = vs.get("progress", 0.0) or 0.0
    duration = ps.get("print_duration", 0.0) or 0.0
    parts = len(ae.get("objects", [])) if ae else 0
    leftover = list(ae.get("leftover") or []) if ae else []
    box, box_cap = (int(ae.get("bin") or 0), bin_capacity(status)) if ae else (0, 0)
    state = ps.get("state", "")
    if wh.get("state") in ("shutdown", "error"):
        phase, reason = "stopped", "shutdown"
    elif ae and ae.get("busy") and ae.get("bg"):
        # cooling with the printer free: it takes "push now" and "bed is clear"
        phase, reason = "ejecting", "cooling" if ae.get("cooling") else ""
    elif ae and ae.get("busy") and (state == "printing" or status.get("idle_timeout", {}).get("state") == "Printing"):
        # the flag alone stays set when an error stops the eject
        phase, reason = "ejecting", ""
    elif state == "printing":
        phase, reason = "printing", ""
    elif state == "paused":
        phase, reason = "paused", "paused"
    elif leftover:
        phase, reason = "needs", "leftover"
    elif state == "error":
        phase, reason = "needs", "error"
    elif parts:
        phase, reason = "needs", "parts"
    elif box_cap and box >= box_cap:
        phase, reason = "needs", "bin"
    elif not ae and state in ("complete", "cancelled"):
        # without auto-eject, the print is still on the bed until someone says so
        phase, reason = "needs", "done" if state == "complete" else "cancelled"
    elif queue.get("queue_state") == "paused" and jobs:
        phase, reason = "needs", "queue"
    else:
        phase, reason = "idle", ""
    card = {
        "phase": phase, "reason": reason, "state": state, "filename": ps.get("filename", ""),
        "message": wh.get("state_message", "") if phase == "stopped" else ps.get("message", ""),
        "progress": round(progress, 4),
        "eta": round(duration * (1 - progress) / progress) if phase == "printing" and progress > 0.01 else None,
        "layer": (ps.get("info") or {}).get("current_layer"), "layers": (ps.get("info") or {}).get("total_layer"),
        "bed": status.get("heater_bed", {}).get("temperature"), "bed_target": status.get("heater_bed", {}).get("target"),
        "nozzle": status.get("extruder", {}).get("temperature"),
        "parts": parts, "leftover": leftover, "height": ae.get("height") if ae else None,
        "auto_eject": ae is not None, "jobs": jobs, "queue": queue.get("queue_state", ""),
        "bin": box, "bin_cap": box_cap,
    }
    return card


def history_stats(totals, jobs, now=None):
    """Hours printed, and how the recent jobs and today's ended, from
    Moonraker's print history (job_totals, and the newest jobs first)."""
    now = now or time.time()
    lt = time.localtime(now)
    midnight = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))
    ended = [j for j in jobs or [] if j.get("status") not in (None, "in_progress")]
    today = [j for j in ended if (j.get("end_time") or j.get("start_time") or 0) >= midnight]
    totals = totals or {}
    return {
        "hours": round((totals.get("total_print_time") or 0) / 3600.0, 1),
        "jobs": int(totals.get("total_jobs") or 0),
        "recent": len(ended),
        "recent_ok": sum(1 for j in ended if j.get("status") == "completed"),
        "today_ok": sum(1 for j in today if j.get("status") == "completed"),
        "today_bad": sum(1 for j in today if j.get("status") != "completed"),
    }


# grams in a millimetre of 1.75 mm filament at PLA's 1.24 g/cm3, when a
# file does not say what it weighs
GRAMS_PER_MM = 3.1416 * 0.875 ** 2 * 1.24 / 1000.0
REPORT_PERIODS = {"today": None, "7": 7, "30": 30}


def report_since(period, now=None):
    """The start of a report's period: today's midnight, or so many days ago."""
    now = now or time.time()
    lt = time.localtime(now)
    midnight = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))
    days = REPORT_PERIODS[period]
    return midnight if days is None else midnight - (days - 1) * 86400


def production(jobs, since):
    """What a printer made since a time, from its print history: the prints
    that ended, how many ended well, the hours and the filament."""
    ended = [j for j in jobs or [] if j.get("status") not in (None, "in_progress")
             and (j.get("end_time") or j.get("start_time") or 0) >= since]
    ok = [j for j in ended if j.get("status") == "completed"]
    grams = 0.0
    for j in ended:
        md = j.get("metadata") or {}
        used, total, weight = j.get("filament_used") or 0.0, md.get("filament_total"), md.get("filament_weight_total")
        grams += weight * min(1.0, used / total) if weight and total else used * GRAMS_PER_MM
    files = collections.Counter(os.path.basename(j.get("filename") or "") for j in ok if j.get("filename"))
    return {"jobs": len(ended), "ok": len(ok), "stopped": len(ended) - len(ok),
            "rate": round(100.0 * len(ok) / len(ended)) if ended else None,
            "hours": round(sum(j.get("print_duration") or 0.0 for j in ended) / 3600.0, 1),
            "grams": int(round(grams)), "top": [[f, n] for f, n in files.most_common(3)]}


class Printer:
    def __init__(self, host, port, name="", local=False, pid=None, macs=None, auto_off=0, auto_off_device="", group=""):
        self.host, self.port, self.name, self.local = host, int(port), name or host, local
        self.group = group or ""      # a shelf, a model...: the farm page shows a group's printers together
        self.macs = list(macs or [])
        self.power = None             # Moonraker [power] devices, or None without any
        self.auto_off = int(auto_off or 0)              # minutes with nothing to do, then off; 0 = never
        self.auto_off_device = auto_off_device or ""
        self.idle_since = None
        self.ts_host = None           # the same printer's Tailscale address, for Open from away
        self.service_every = 0        # hours of printing between two maintenances; 0 = no reminder
        self.service_at = None        # its print hours at the last maintenance
        self.service_warned = False
        self.id = pid or ("local" if local else printer_id(host, port))
        self.card = {"phase": "offline"}
        self.status = {}
        self.stats = None
        self.spool = None             # the spool on it, from Moonraker's [spoolman]
        self.webcam = None
        self.page = None
        self.updated = 0.0
        self.watcher = None       # notifications for printers other than this one
        self._slow = 0.0
        self.down = 0             # rounds in a row in which nothing answered at its address
        self.retry_at = 0.0       # when to ask it again while it is away
        self.updates = None       # {software: {"version", "remote", "behind", "type"}} from Moonraker
        self.firmware = None      # {"klipper": version, "boards": [[name, version], ...]}
        self.updates_at = 0.0
        self.job = None           # the last update asked through the farm: {"names", "done", "state", "error", "at"}

    @property
    def base(self):
        return "http://%s:%d" % (self.host, self.port)

    def record(self):
        out = {"host": self.host, "port": self.port, "name": self.name}
        if self.group:
            out["group"] = self.group
        if self.macs:
            out["macs"] = self.macs
        if self.auto_off:
            out["auto_off"], out["auto_off_device"] = self.auto_off, self.auto_off_device
        if self.service_every:
            out["service_every"], out["service_at"] = self.service_every, self.service_at
        return out

    def service_since(self):
        """Print hours since the last maintenance, or None without a reminder or history."""
        if not self.service_every or not self.stats or self.service_at is None:
            return None
        return max(0.0, round(self.stats["hours"] - self.service_at, 1))

    def poll(self, now=None):
        now = now or time.time()
        try:
            # a printer that is away gets a second, not three: one that is on answers in milliseconds
            status = http_json(self.base + QUERY, timeout=1.0 if self.down else 3.0)["status"]
            queue = None
            try:
                queue = http_json(self.base + "/server/job_queue/status")
            except Exception:
                pass
            if now - self.updates_at > UPDATES_EVERY:
                self.updates_at = now
                for attr, read in (("updates", self._updates), ("firmware", self._firmware)):
                    try:
                        setattr(self, attr, read())
                    except Exception:
                        pass
            if now - self._slow > 60:          # things that rarely change
                self._slow = now
                # extras: one that fails keeps its last value, and the card does not depend on it
                for attr, read in (("webcam", self._webcam), ("page", self._page),
                                   ("macs", lambda: self.macs or machine_macs(self.host, self.port)),
                                   ("stats", lambda: self._stats(now)), ("power", self._power), ("spool", self._spool)):
                    try:
                        setattr(self, attr, read())
                    except Exception:
                        pass
            self.status = status
            self.card = summarize(status, queue, now)
            self.down = 0
        except OSError as e:
            # HTTPError: Moonraker answered and Klipper is not there; any other
            # network error: nothing answered (switched off, or off the network)
            self.status = {}
            self.card = {"phase": "offline"}
            self.down = 0 if isinstance(e, urllib.error.HTTPError) else self.down + 1
        except Exception:                   # an answer that could not be read
            self.status = {}
            self.card = {"phase": "offline"}
            self.down = 0
        if self.card["phase"] in ("offline", "stopped") and not self.down:
            # Moonraker may still answer while the printer's board is switched off
            power = self._power()
            if power is not None:
                self.power = power
            if self.power and any(d["status"] == "off" for d in self.power):
                self.card = {"phase": "off"}
        self.updated = now
        return self.card

    def _updates(self):
        """What Moonraker's update manager knows: each software's version and how far behind."""
        info = http_json(self.base + "/machine/update/status", timeout=5)["version_info"]
        out = {}
        for name, v in info.items():
            if name == "system" or not isinstance(v, dict):
                continue
            behind = v.get("commits_behind_count")
            if behind is None:
                behind = len(v.get("commits_behind") or [])
            out[name] = {"version": str(v.get("version") or ""), "remote": str(v.get("remote_version") or ""),
                         "behind": int(behind or 0), "type": str(v.get("configured_type") or "")}
        return out

    def _firmware(self):
        """Klipper's version and each board's firmware."""
        klipper = (http_json(self.base + "/printer/info", timeout=5) or {}).get("software_version", "")
        objects = http_json(self.base + "/printer/objects/list", timeout=5)["objects"]
        mcus = [o for o in objects if o == "mcu" or o.startswith("mcu ")]
        boards = []
        if mcus:
            query = "&".join(urllib.parse.quote(o) + "=mcu_version" for o in mcus)
            status = http_json(self.base + "/printer/objects/query?" + query, timeout=5)["status"]
            boards = [[o, str((status.get(o) or {}).get("mcu_version") or "")] for o in mcus]
        return {"klipper": str(klipper or ""), "boards": boards}

    def _stats(self, now):
        try:
            totals = http_json(self.base + "/server/history/totals")["job_totals"]
            jobs = http_json(self.base + "/server/history/list?limit=50&order=desc")["jobs"]
        except Exception:
            return self.stats
        return history_stats(totals, jobs, now)

    def _spool(self):
        """The spool on the printer, as Spoolman knows it through Moonraker's
        [spoolman]: its filament, colour and grams left. None without one."""
        try:
            status = http_json(self.base + "/server/spoolman/status", timeout=5) or {}
        except urllib.error.HTTPError:
            return None                                   # no [spoolman] in moonraker.conf
        sid = status.get("spool_id")
        if not status.get("spoolman_connected") or sid is None:
            return None
        answer = http_json(self.base + "/server/spoolman/proxy", timeout=5,
                           data={"request_method": "GET", "path": "/v1/spool/%d" % int(sid), "use_v2_response": True}) or {}
        spool = answer.get("response") or {}
        fil = spool.get("filament") or {}
        left, full = spool.get("remaining_weight"), spool.get("initial_weight") or fil.get("weight")
        colour = str(fil.get("color_hex") or "").strip().lstrip("#")
        name = " ".join(x for x in ((fil.get("vendor") or {}).get("name"), fil.get("name") or fil.get("material")) if x)
        return {"id": int(sid), "name": name or "#%s" % sid, "material": fil.get("material") or "",
                "colour": "#" + colour[:6] if re.fullmatch(r"[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?", colour) else "",
                "left": round(left) if isinstance(left, (int, float)) else None,
                "full": round(full) if isinstance(full, (int, float)) else None}

    def read_settings(self):
        """Its auto-eject settings as the macros merge them, the ones changed
        from the defaults, and whether a change is kept after a restart."""
        query = "&".join(urllib.parse.quote("gcode_macro " + m) for m in SETTING_MACROS)
        status = (http_json(self.base + "/printer/objects/query?" + query + "&save_variables", timeout=5) or {}).get("status") or {}
        defaults = status.get("gcode_macro _AUTO_EJECT_DEFAULTS")
        if not defaults:
            raise LookupError("%s has no auto-eject" % self.name)
        values = dict(defaults)
        for part in (status.get("gcode_macro _AUTO_EJECT_SETTINGS") or {},
                     (status.get("gcode_macro _AUTO_EJECT_OVERRIDES") or {}).get("data") or {}):
            values.update((k, v) for k, v in part.items() if k in defaults)
        return {"values": values, "changed": sorted(k for k in defaults if not same_setting(values[k], defaults[k])),
                "kept": "save_variables" in status}

    def _power(self):
        try:
            devices = http_json(self.base + "/machine/device_power/devices")["devices"]
        except Exception:
            return None
        return [{"device": str(d.get("device", "")), "status": d.get("status", ""), "locked": bool(d.get("locked_while_printing"))}
                for d in devices]

    def set_power(self, device, action):
        """Switch a power device; never off while printing or with a hot nozzle,
        whose fan would stop with it."""
        names = [d["device"] for d in self.power or []]
        if device not in names or action not in ("on", "off"):
            raise LookupError("no power device %s" % device)
        if action == "off":
            if self.card.get("phase") in ("printing", "paused", "ejecting"):
                raise PermissionError("the printer is busy")
            if (self.card.get("nozzle") or 0) > NOZZLE_COOL:
                raise PermissionError("the nozzle is still hot (%.0f °C)" % self.card["nozzle"])
        result = http_json(self.base + "/machine/device_power/device", data={"device": device, "action": action}, timeout=10)
        for d in self.power:
            if d["device"] == device and isinstance(result, dict) and device in result:
                d["status"] = result[device]
        return result

    def _webcam(self):
        try:
            cams = [c for c in http_json(self.base + "/server/webcams/list")["webcams"] if c.get("enabled", True)]
        except Exception:
            return None
        if not cams or not cams[0].get("snapshot_url"):
            return None
        url = cams[0]["snapshot_url"]
        return url if url.startswith("http") else "http://%s%s" % (self.host, url if url.startswith("/") else "/" + url)

    def _page(self):
        """Where the farm card opens: the auto-eject page if the printer has it."""
        try:
            with urllib.request.urlopen("http://%s/auto-eject/web/index.html" % self.host, timeout=2) as r:
                if b"Auto-eject" in r.read(600):
                    return "http://%s/auto-eject/" % self.host
        except Exception:
            pass
        return "http://%s/" % self.host

    def remote_page(self):
        """The printer's page through Tailscale: Open from a phone away from home."""
        if not self.page or not self.ts_host or self.ts_host == self.host:
            return None
        return self.page.replace("//%s/" % self.host, "//%s/" % self.ts_host, 1)

    def public(self):
        return dict(self.card, page_remote=None if self.local else self.remote_page(), id=self.id, name=self.name, host=self.host, local=self.local, group=self.group,
                    page=None if self.local else self.page, camera=bool(self.webcam), stats=self.stats, spool=self.spool,
                    power=self.power, auto_off=self.auto_off, auto_off_device=self.auto_off_device,
                    service_every=self.service_every, service_since=self.service_since(),
                    updates=self.updates, firmware=self.firmware, job=self.job, updated=self.updated)


# --------------------------------------------------------------- the search
def local_networks():
    """This machine's IPv4 networks (as /24 at most), not loopback nor Tailscale."""
    nets = set()
    try:
        out = subprocess.run(["ip", "-4", "-o", "addr", "show"], capture_output=True, text=True, timeout=5).stdout
        for m in re.finditer(r"inet (\d+\.\d+\.\d+\.\d+)/(\d+)", out):
            iface = ipaddress.ip_interface("%s/%s" % m.groups())
            if iface.ip.is_loopback or iface.ip in ipaddress.ip_network("100.64.0.0/10"):
                continue
            nets.add(iface.network if iface.network.prefixlen >= 24 else ipaddress.ip_interface("%s/24" % m.group(1)).network)
    except Exception:
        pass
    if not nets:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("192.0.2.1", 9))           # no packet is sent
            nets.add(ipaddress.ip_interface("%s/24" % s.getsockname()[0]).network)
            s.close()
        except Exception:
            pass
    return sorted(nets, key=str)


def own_addresses():
    found = {"127.0.0.1"}
    try:
        out = subprocess.run(["ip", "-4", "-o", "addr", "show"], capture_output=True, text=True, timeout=5).stdout
        found |= set(re.findall(r"inet (\d+\.\d+\.\d+\.\d+)/", out))
    except Exception:
        pass
    return found


def tailscale_peers():
    try:
        data = json.loads(subprocess.run(["tailscale", "status", "--json"], capture_output=True,
                                         text=True, timeout=5).stdout)
    except Exception:
        return []
    out = []
    for peer in (data.get("Peer") or {}).values():
        ips = [ip for ip in peer.get("TailscaleIPs", []) if ":" not in ip]
        # Klipper runs on Linux; phones and computers are not asked, nor the
        # hundreds of Mullvad exit nodes a tailnet may list (they have a Location)
        if peer.get("Online") and ips and peer.get("OS") == "linux" and not peer.get("Location"):
            out.append((ips[0], peer.get("HostName") or ""))
    return out


def probe(host, ports=PORTS, timeout=0.8):
    """A Moonraker at host, or None."""
    for port in ports:
        try:
            info = http_json("http://%s:%d/server/info" % (host, port), timeout=timeout)
        except Exception:
            continue
        if not info or "klippy_state" not in info:
            continue
        name = ""
        try:
            name = http_json("http://%s:%d/printer/info" % (host, port), timeout=timeout).get("hostname", "")
        except Exception:
            pass
        return {"host": host, "port": port, "name": name or host, "klippy": info.get("klippy_state", ""),
                "macs": machine_macs(host, port, timeout=timeout + 1)}
    return None


def scan(skip=(), networks=None, peers=None, prober=probe, workers=64, known=()):
    """Every printer on the local networks and on Tailscale, except the
    addresses in skip and the machines in known ((port, macs) pairs). A
    printer found on both is listed once, with its local address."""
    hosts = {}
    for net in (local_networks() if networks is None else networks):
        for ip in ipaddress.ip_network(net).hosts():
            hosts[str(ip)] = ""
    for ip, name in (tailscale_peers() if peers is None else peers):
        hosts[ip] = name
    for h in skip:
        hosts.pop(h, None)
    found = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for result in pool.map(prober, list(hosts)):
            if result:
                if hosts.get(result["host"]) and result["name"] == result["host"]:
                    result["name"] = hosts[result["host"]]
                found.append(result)
    found.sort(key=lambda r: (ipaddress.ip_address(r["host"]) in TAILNET, ipaddress.ip_address(r["host"])))
    seen, kept = [tuple(k) for k in known], []
    for r in found:
        if any(same_machine(r["port"], r.get("macs") or [], port, macs) for port, macs in seen):
            continue
        seen.append((r["port"], r.get("macs") or []))
        kept.append(r)
    return sorted(kept, key=lambda r: ipaddress.ip_address(r["host"]))


# ------------------------------------------------------------------- the farm
class Farm:
    def __init__(self, moonraker, on_events=None, local_port=7125):
        self.moonraker = moonraker           # this printer's Moonraker (auto_eject_push.Moonraker)
        self.on_events = on_events           # (printer name, events) -> None: notifications
        self.lock = threading.Lock()
        self.local = Printer("127.0.0.1", local_port, local=True)
        self.local_named = False             # True: renamed in the page; None: the hostname
        self.printers = {}
        self.skipped = []                    # found but left out: suggested unticked next time
        self.loaded = False
        self.scan_state = {"running": False, "found": [], "finished": None}
        self.ts_checked = 0.0                # when the Tailscale twins were last looked for
        self.restarted = False               # after starting: Klipper restarted for an own update, if needed
        self.settings = {}                   # the whole farm's: {"report": "20:00", "report_sent": "2026-10-20"}
        self.sets = {}                       # saved settings, by name: {"values": {...}, "from": "voron-01", "saved": 1761000000}
        self.cache_lock = threading.Lock()
        self.metas = {}                      # (printer, file) -> (when, Moonraker's metadata)
        self.thumbs = collections.OrderedDict()   # (printer, picture, modified) -> (type, bytes)
        self.load()

    def load(self):
        """The saved farm, once Moonraker answers. Until then nothing is saved,
        so a slow Moonraker at boot never loses the list."""
        if self.loaded:
            return True
        try:
            records = self.moonraker.get("printers", namespace=NAMESPACE) or {}
            local = self.moonraker.get("local", namespace=NAMESPACE) or {}
            skipped = self.moonraker.get("skipped", namespace=NAMESPACE) or []
            settings = self.moonraker.get("settings", namespace=NAMESPACE) or {}
            sets = self.moonraker.get("sets", namespace=NAMESPACE) or {}
        except Exception:
            return False
        with self.lock:
            for pid, r in records.items():
                p = self.printers.setdefault(pid, Printer(r["host"], r.get("port", 7125), r.get("name", ""), pid=pid, macs=r.get("macs"),
                                                          auto_off=r.get("auto_off", 0), auto_off_device=r.get("auto_off_device", ""),
                                                          group=r.get("group", "")))
                p.service_every, p.service_at = int(r.get("service_every") or 0), r.get("service_at")
            if local.get("name"):
                self.local.name, self.local_named = local["name"], True
            self.local.group = local.get("group") or ""
            self.local.auto_off = int(local.get("auto_off") or 0)
            self.local.auto_off_device = local.get("auto_off_device") or ""
            self.local.service_every, self.local.service_at = int(local.get("service_every") or 0), local.get("service_at")
            self.skipped = list(skipped)
            self.settings = dict(settings)
            self.sets = dict(sets)
            self.loaded = True
        return True

    def _save(self):
        if not self.loaded:
            raise RuntimeError("Moonraker is not answering yet")
        self.moonraker.put("printers", {pid: p.record() for pid, p in self.printers.items()}, namespace=NAMESPACE)

    def all(self):
        with self.lock:
            return [self.local] + list(self.printers.values())

    def poll(self, now=None, watcher_factory=None):
        self.load()
        now = now or time.time()
        printers = self.all()
        if now - self.ts_checked > 600:
            self.ts_checked = now
            self.link_tailscale(printers)
        # A printer that does not answer costs a timeout or two each time and
        # would hold up the whole round: ask it less often the longer it is away
        # (after 10 s, 20 s ... at most a minute), and every round once it answers.
        due = [p for p in printers if p.local or not p.down or now >= p.retry_at]
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(32, len(due))) as pool:
            list(pool.map(lambda p: self._poll_one(p, now, watcher_factory), due))
        for p in due:
            if p.down:
                p.retry_at = now + min(60, 10 * p.down)
        if not self.restarted:
            self.restarted = self.restart_after_own_update(now) or not os.path.exists(RESTART_FLAG)
        report = self.report_due(now)
        if report and self.on_events:
            self.on_events(None, [("report", report)])
        if self.local_named is False and self.local.card.get("phase") != "offline":
            try:
                self.local.name = http_json(self.local.base + "/printer/info").get("hostname") or self.local.name
                self.local_named = None
            except Exception:
                pass

    def _poll_one(self, p, now, watcher_factory):
        p.poll(now)
        if self.auto_off(p, now) and self.on_events:
            self.on_events(p.name, [("off", "Switched off after %d minutes with nothing to do" % p.auto_off)])
        due = self.service_check(p)
        if due and self.on_events:
            self.on_events(None if p.local else p.name, [due])
        # this printer's own notifications come from the service itself
        if p.local or not self.on_events or watcher_factory is None or p.card.get("phase") == "offline":
            return
        if p.watcher is None:
            p.watcher = watcher_factory()
        events = []
        try:
            events += p.watcher.console(http_json(p.base + "/server/gcode_store?count=40")["gcode_store"])
            events += p.watcher.klipper(p.status.get("webhooks", {}))
            jobs = http_json(p.base + "/server/history/list?limit=1&order=desc").get("jobs") or []
            events += p.watcher.history(jobs[0] if jobs else None, p.card.get("message", ""))
        except Exception:
            pass
        if events:
            self.on_events(p.name, events)

    def view(self):
        return {"printers": [p.public() for p in self.all()], "scan": self.scan_state,
                "settings": {"report": self.settings.get("report") or ""},
                "sets": [dict(s, name=n) for n, s in sorted(self.sets.items(), key=lambda x: x[0].lower())]}

    def report(self, period, now=None):
        """Every printer's production over a period, from each one's history."""
        if period not in REPORT_PERIODS:
            raise ValueError("period: today, 7 or 30")
        since = report_since(period, now)

        def one(p):
            row = {"id": p.id, "name": p.name, "group": p.group}
            try:
                jobs = http_json(p.base + "/server/history/list?limit=1000&order=desc&since=%d" % int(since), timeout=8)["jobs"]
            except Exception:
                return dict(row, error="not answering")
            return dict(row, **production(jobs, since))
        printers = self.all()
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(16, len(printers)))) as pool:
            rows = list(pool.map(one, printers))
        good = [r for r in rows if "error" not in r]
        total = {k: sum(r[k] for r in good) for k in ("jobs", "ok", "stopped", "grams")}
        total["hours"] = round(sum(r["hours"] for r in good), 1)
        total["rate"] = round(100.0 * total["ok"] / total["jobs"]) if total["jobs"] else None
        return {"period": period, "since": since, "printers": rows, "total": total}

    def start_scan(self):
        with self.lock:
            if self.scan_state["running"]:
                return False
            self.scan_state = {"running": True, "found": [], "finished": None}
        skip = own_addresses() | {p.host for p in self.printers.values()}
        threading.Thread(target=self._scan, args=(skip,), daemon=True).start()
        return True

    def _scan(self, skip):
        try:
            self.local.macs = self.local.macs or machine_macs(self.local.host, self.local.port)
            known = [(p.port, p.macs) for p in self.all() if p.macs]
            found = scan(skip=skip, known=known)
            for r in found:
                r["skipped"] = any(same_printer(r, s) for s in self.skipped)
        except Exception:
            found = []
        with self.lock:
            self.scan_state = {"running": False, "found": found, "finished": time.time()}

    def add(self, entries, prober=None, skip=()):
        """Add printers: scan results, or an address typed in the page (then
        it is asked first whether a Moonraker answers there). skip: the
        search results left out, which the next search suggests unticked."""
        prober = prober or (lambda host, ports: probe(host, ports, timeout=3.0))
        if not self.load():
            raise RuntimeError("Moonraker is not answering yet")
        added = []
        mine = own_addresses()
        for e in entries:
            host, port = str(e.get("host", "")).strip(), e.get("port")
            if host.count(":") == 1 and port is None:
                host, _, port = host.partition(":")
            if not HOST.match(host) or (port is not None and not str(port).isdigit()):
                raise ValueError("not an address: %s" % e.get("host", ""))
            if not e.get("name"):
                found = prober(host, (int(port),) if port else PORTS)
                if not found:
                    raise LookupError("no printer answers at %s" % host)
                e = found
                host, port = found["host"], found["port"]
            p = Printer(host, port or 7125, e.get("name", ""), macs=e.get("macs"))
            with self.lock:
                twin = any(same_machine(p.port, p.macs, q.port, q.macs) for q in [self.local] + list(self.printers.values()))
                if p.id not in self.printers and p.host not in mine and not twin:
                    self.printers[p.id] = p
                    added.append(p.id)
        with self.lock:
            self._save()
            keep = [s for s in self.skipped if not any(same_printer(s, p.record()) for p in self.printers.values())]
            for e in skip:
                r = {"host": str(e.get("host", "")), "port": int(e.get("port") or 7125), "name": str(e.get("name", ""))[:40],
                     "macs": [str(m) for m in (e.get("macs") or [])][:8]}
                if HOST.match(r["host"]) and not any(same_printer(r, s) for s in keep):
                    keep.append(r)
            if keep != self.skipped:
                self.skipped = keep[-200:]
                self.moonraker.put("skipped", self.skipped, namespace=NAMESPACE)
        return added

    def remove(self, pid):
        with self.lock:
            gone = self.printers.pop(pid, None)
            self._save()
        return gone is not None

    def rename(self, pid, name):
        name = str(name).strip()[:40]
        with self.lock:
            p = self.local if pid == "local" else self.printers.get(pid)
            if p is None:
                return False
            if p.local:
                if not self.loaded:
                    raise RuntimeError("Moonraker is not answering yet")
                self.moonraker.put("local", self._local_record(name), namespace=NAMESPACE)
                if name:
                    p.name, self.local_named = name, True
                else:
                    self.local_named = False         # back to the hostname
            else:
                p.name = name or p.host
                self._save()
        return True

    def link_tailscale(self, printers, peers=None, macs_of=None):
        """Find each printer's Tailscale address: a Linux peer with the same
        network card. Open then works from a phone away from the network."""
        peers = tailscale_peers() if peers is None else peers
        macs_of = macs_of or machine_macs
        wanted = [p for p in printers if not p.local and p.macs and ipaddress.ip_address(p.host) not in TAILNET]
        if not peers or not wanted:
            return
        for ip, _ in peers:
            if any(p.host == ip for p in printers):
                continue
            for p in wanted:
                if p.ts_host is None and set(p.macs) & set(macs_of(ip, p.port)):
                    p.ts_host = ip

    def _local_record(self, name=None):
        out = {"name": (self.local.name if self.local_named else "") if name is None else name}
        if self.local.group:
            out["group"] = self.local.group
        if self.local.auto_off:
            out["auto_off"], out["auto_off_device"] = self.local.auto_off, self.local.auto_off_device
        if self.local.service_every:
            out["service_every"], out["service_at"] = self.local.service_every, self.local.service_at
        return out

    def _save_one(self, p):
        if p.local:
            self.moonraker.put("local", self._local_record(), namespace=NAMESPACE)
        else:
            self._save()

    def set_group(self, pid, group):
        """The printer's group (a shelf, a model...); "" for none."""
        with self.lock:
            p = self.find(pid)
            if p is None:
                return False
            if not self.loaded:
                raise RuntimeError("Moonraker is not answering yet")
            p.group = " ".join(str(group or "").split())[:30]
            self._save_one(p)
        return True

    def set_service(self, pid, every=None, done=False):
        """A maintenance reminder every this many print hours (0 = none), and
        done: the maintenance was just done, count from now."""
        with self.lock:
            p = self.find(pid)
            if p is None:
                return False
            if not self.loaded:
                raise RuntimeError("Moonraker is not answering yet")
            hours = (p.stats or {}).get("hours", 0.0)
            if every is not None:
                p.service_every = max(0, min(100000, int(every or 0)))
                if p.service_at is None or not p.service_every:
                    p.service_at = hours if p.service_every else None
            if done:
                p.service_at = hours
            p.service_warned = False
            self._save_one(p)
        return True

    def service_check(self, p):
        """Once, when the reminder comes due: (kind, text) or None."""
        since = p.service_since()
        if since is None or since < p.service_every:
            return None
        if p.service_warned:
            return None
        p.service_warned = True
        return ("service", "%.0f hours of printing since the last maintenance (every %d h)" % (since, p.service_every))

    def set_report(self, at):
        """The daily report at this time ("HH:MM"), or "" for none."""
        at = str(at or "").strip()
        if at and not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", at):
            raise ValueError("not a time: %s" % at)
        if not self.loaded:
            raise RuntimeError("Moonraker is not answering yet")
        self.settings["report"] = at
        self.moonraker.put("settings", self.settings, namespace=NAMESPACE)
        return True

    def report_text(self):
        cards = [p.public() for p in self.all()]
        ok = sum((c.get("stats") or {}).get("today_ok", 0) for c in cards)
        bad = sum((c.get("stats") or {}).get("today_bad", 0) for c in cards)
        hours = sum((c.get("stats") or {}).get("hours", 0) for c in cards)
        now_printing = sum(1 for c in cards if c.get("phase") in ("printing", "ejecting"))
        needs = [c["name"] for c in cards if c.get("phase") in ("needs", "stopped", "paused")]
        due = [c["name"] for c in cards if c.get("service_since") is not None and c["service_since"] >= c["service_every"]]
        text = "Today %d ended well, %d stopped. Now %d printing" % (ok, bad, now_printing)
        if needs:
            text += ", %d need you (%s)" % (len(needs), ", ".join(needs[:4]) + ("…" if len(needs) > 4 else ""))
        text += ". %d h printed in all." % round(hours)
        if due:
            text += " Maintenance due: %s." % ", ".join(due)
        return text

    def report_due(self, now):
        """The daily report's text once a day at the chosen time, else None."""
        at = self.settings.get("report") or ""
        if not at or not self.loaded:
            return None
        lt = time.localtime(now)
        today = time.strftime("%Y-%m-%d", lt)
        if self.settings.get("report_sent") == today or time.strftime("%H:%M", lt) < at:
            return None
        self.settings["report_sent"] = today
        try:
            self.moonraker.put("settings", self.settings, namespace=NAMESPACE)
        except Exception:
            pass
        return self.report_text()

    def set_auto_off(self, pid, minutes, device=""):
        """Switch the printer off after this many minutes with nothing to do; 0 = never."""
        minutes = max(0, min(24 * 60, int(minutes or 0)))
        with self.lock:
            p = self.find(pid)
            if p is None:
                return False
            if not self.loaded:
                raise RuntimeError("Moonraker is not answering yet")
            p.auto_off, p.auto_off_device, p.idle_since = minutes, str(device or ""), None
            if p.local:
                self.moonraker.put("local", self._local_record(), namespace=NAMESPACE)
            else:
                self._save()
        return True

    def auto_off(self, p, now):
        """Switch p off once it has had nothing to do for p.auto_off minutes:
        not printing, nothing in its queue, the nozzle cool. Returns True when
        it was switched off."""
        devices = p.power or []
        dev = next((d for d in devices if d["device"] == p.auto_off_device), devices[0] if devices else None)
        c = p.card
        quiet = (c.get("phase") in ("idle", "needs") and not c.get("jobs") and c.get("nozzle") is not None
                 and c["nozzle"] < NOZZLE_COOL and dev is not None and dev["status"] == "on")
        if not p.auto_off or not quiet:
            p.idle_since = None
            return False
        if p.idle_since is None:
            p.idle_since = now
            return False
        if now - p.idle_since < p.auto_off * 60:
            return False
        p.idle_since = None
        try:
            p.set_power(dev["device"], "off")
        except Exception:
            return False
        return True

    def find(self, pid):
        return self.local if pid == "local" else self.printers.get(pid)

    def files(self, pid):
        """A printer's G-code files, newest first."""
        p = self.find(pid)
        if p is None:
            return None
        items = http_json(p.base + "/server/files/list?root=gcodes", timeout=10) or []
        items = [{"path": f["path"], "size": f.get("size", 0), "modified": f.get("modified", 0)}
                 for f in items if GCODE_FILE.search(f.get("path", ""))]
        return sorted(items, key=lambda f: -f["modified"])[:500]

    def file_meta(self, pid, filename, now=None):
        """Moonraker's metadata of one of a printer's files, kept a minute."""
        p = self.find(pid)
        if p is None:
            return None
        now = time.time() if now is None else now
        key = (p.id, filename)
        with self.cache_lock:
            hit = self.metas.get(key)
        if hit and now - hit[0] < 60:
            return hit[1]
        try:
            meta = http_json(p.base + "/server/files/metadata?filename=" + urllib.parse.quote(filename), timeout=5) or {}
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise LookupError("%s has no file %s" % (p.name, filename))
            raise
        with self.cache_lock:
            if len(self.metas) > 500:
                self.metas.clear()
            self.metas[key] = (now, meta)
        return meta

    def file_card(self, pid, filename):
        """What the print dialog shows of a file: its facts, and how many pictures it has."""
        meta = self.file_meta(pid, filename)
        if meta is None:
            return None
        out = {k: meta[k] for k in FILE_FACTS if meta.get(k) not in (None, "")}
        out["thumbs"] = sum(1 for t in meta.get("thumbnails") or [] if isinstance(t, dict) and t.get("relative_path"))
        return out

    def thumbnail(self, pid, filename, want=300):
        """The slicer's picture of a file: (content type, bytes)."""
        meta = self.file_meta(pid, filename)
        if meta is None:
            return None
        path = thumb_path(filename, pick_thumb(meta.get("thumbnails"), want))
        if not path:
            raise LookupError("%s has no picture" % filename)
        key = (self.find(pid).id, path, meta.get("modified"))
        with self.cache_lock:
            if key in self.thumbs:
                self.thumbs.move_to_end(key)
                return self.thumbs[key]
        try:
            with urllib.request.urlopen(self.find(pid).base + path, timeout=5) as r:
                ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip()
                data = r.read(4 << 20)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise LookupError("%s has no picture" % filename)
            raise
        if not ctype.startswith("image/"):
            raise LookupError("%s has no picture" % filename)
        with self.cache_lock:
            self.thumbs[key] = (ctype, data)
            while len(self.thumbs) > THUMBS_KEPT:
                self.thumbs.popitem(last=False)
        return ctype, data

    def update(self, pid, names):
        """Update software of a printer through its Moonraker, in the
        background and only while the printer does nothing (Moonraker refuses
        too while it prints). names: one name or a list. Klipper restarts at
        the end when macros or other configs changed, again only while idle."""
        p = self.find(pid)
        if p is None:
            return None
        names = [names] if isinstance(names, str) else list(names or [])
        unknown = [n for n in names if n not in (p.updates or {})]
        if not names or unknown:
            raise LookupError("%s has no %s to update" % (p.name, ", ".join(unknown) or "software"))
        if p.job and p.job.get("state") == "running":
            raise PermissionError("%s is updating already" % p.name)
        if p.card.get("phase") in BUSY:
            raise PermissionError("%s cannot update now (%s)" % (p.name, p.card.get("phase")))
        order = sorted(set(names), key=lambda n: (UPDATE_ORDER.get(n, 0), n))
        p.job = {"names": order, "done": [], "state": "running", "error": "", "at": time.time()}
        threading.Thread(target=self._update, args=(p, order), daemon=True).start()
        return True

    def _idle(self, p):
        st = http_json(p.base + "/printer/objects/query?print_stats=state&idle_timeout=state", timeout=5)["status"]
        return st["print_stats"]["state"] in IDLE_STATES and st["idle_timeout"]["state"] != "Printing"

    def _wait_for_moonraker(self, p, seconds=90):
        end = time.time() + seconds
        while time.time() < end:
            try:
                http_json(p.base + "/server/info", timeout=3)
                return
            except Exception:
                time.sleep(3)

    def _update(self, p, names):
        job = p.job
        try:
            # configs and macros (auto-eject's, a macro set's...) load when Klipper restarts
            restart = any(n not in ("klipper", "moonraker") and (p.updates or {}).get(n, {}).get("type") == "git_repo" for n in names)
            for name in names:
                if not self._idle(p):                   # checked again, right before each
                    raise PermissionError("it is busy")
                if p.local and name == "klipper-auto-eject":
                    # this service restarts with it: Klipper restarts once it is back
                    os.makedirs(UPLOADS, exist_ok=True)
                    with open(RESTART_FLAG, "w") as f:
                        f.write(str(time.time()))
                try:
                    http_json(p.base + "/machine/update/upgrade", data={"name": name}, timeout=900)
                except OSError:
                    if name != "moonraker":            # Moonraker restarting may cut its own answer
                        raise
                if name == "moonraker":
                    self._wait_for_moonraker(p)
                job["done"].append(name)
            if restart and self._idle(p):
                http_json(p.base + "/printer/firmware_restart", data={}, timeout=15)
                if p.local and os.path.exists(RESTART_FLAG):
                    os.remove(RESTART_FLAG)             # this service was not restarted: done here
            job["state"] = "done"
        except Exception as e:
            job["state"], job["error"] = "failed", str(e)[:200]
        job["at"] = time.time()
        p.updates_at = 0.0                              # look at its versions again soon

    def restart_after_own_update(self, now=None):
        """This printer updated its own auto-eject and this service was
        restarted on the way: load the new macros, once, while it does nothing."""
        now = now or time.time()
        try:
            with open(RESTART_FLAG) as f:
                since = float(f.read().strip() or 0)
        except (OSError, ValueError):
            return False
        try:
            if now - since < 900 and self._idle(self.local):
                http_json(self.local.base + "/printer/firmware_restart", data={}, timeout=15)
                self.local.job = {"names": ["klipper-auto-eject"], "done": ["klipper-auto-eject"], "state": "done", "error": "", "at": now}
        except Exception:
            return False                               # Klipper not up yet: next round
        try:
            os.remove(RESTART_FLAG)
        except OSError:
            pass
        return True

    def ready_to_print(self, p):
        phase, reason = p.card.get("phase"), p.card.get("reason")
        if phase in BUSY:
            raise PermissionError("%s cannot start a print now (%s)" % (p.name, phase))
        if reason in ON_THE_BED:
            raise PermissionError("%s still has parts on the bed" % p.name)

    def print_file(self, pid, filename):
        p = self.find(pid)
        if p is None:
            return None
        self.ready_to_print(p)
        return http_json(p.base + "/printer/print/start", data={"filename": str(filename)}, timeout=15)

    def upload(self, pid, name, fileobj, size, start=False):
        p = self.find(pid)
        if p is None:
            return None
        name = safe_name(name)
        if start:
            self.ready_to_print(p)
        return upload_file(p.base, name, fileobj, size, start)

    def settings_of(self, pid):
        p = self.find(pid)
        return None if p is None else p.read_settings()

    def copy_settings(self, pid, values):
        """Settings from another printer or a saved set, onto this printer with
        AUTO_EJECT_SET: only the ones it has that differ; the rest are named."""
        p = self.find(pid)
        if p is None:
            return None
        if not isinstance(values, dict) or not values:
            raise ValueError("no settings to copy")
        phase = p.card.get("phase")
        if phase in ("ejecting", "offline", "off", "stopped"):
            raise PermissionError("%s cannot take settings now (%s)" % (p.name, phase))
        mine = p.read_settings()
        lines, changed, same, skipped = [], [], [], {}
        for key in sorted(values):
            if key not in mine["values"]:
                skipped[key] = "unknown"          # an older auto-eject
            elif same_setting(mine["values"][key], values[key]):
                same.append(key)
            elif not setting_ok(setting_text(values[key])):
                skipped[key] = "file"             # changed in its settings file only
            else:
                lines.append("AUTO_EJECT_SET KEY=%s VALUE=%s" % (key, setting_text(values[key])))
                changed.append(key)
        if lines:
            http_json(p.base + "/printer/gcode/script", data={"script": "\n".join(lines)}, timeout=30)
        return {"changed": changed, "same": same, "skipped": skipped, "kept": mine["kept"]}

    def save_set(self, name, values, source=""):
        """Settings kept under a name (a kind of printer), to copy later."""
        name = " ".join(str(name or "").split())
        if not 0 < len(name) <= 40:
            raise ValueError("a name of 1 to 40 characters")
        if not isinstance(values, dict) or not values or len(values) > 200:
            raise ValueError("no settings to save")
        for key, value in values.items():
            if not SETTING_KEY.match(str(key)) or not isinstance(value, (bool, int, float, str)) or len(str(value)) > 200:
                raise ValueError("not a setting: %s" % key)
        if not self.loaded:
            raise RuntimeError("Moonraker is not answering yet")
        if name not in self.sets and len(self.sets) >= SETS_MAX:
            raise ValueError("%d sets at most" % SETS_MAX)
        self.sets[name] = {"values": dict(values), "from": str(source or "")[:60], "saved": int(time.time())}
        self.moonraker.put("sets", self.sets, namespace=NAMESPACE)
        return True

    def remove_set(self, name):
        if name not in self.sets:
            return False
        del self.sets[name]
        self.moonraker.put("sets", self.sets, namespace=NAMESPACE)
        return True

    def act(self, pid, action):
        p = self.find(pid)
        if p is None or action not in ("continue", "clear", "estop", "bin_empty", "pause", "resume", "cancel", "push"):
            return None
        if action == "push" and not (p.card.get("phase") == "ejecting" and p.card.get("reason") == "cooling"):
            raise PermissionError("%s is not cooling before an eject" % p.name)
        if action == "clear" and not p.card.get("auto_eject"):
            action = "clear_plain"
        if action == "bin_empty" and not p.card.get("auto_eject"):
            return None
        method, path, data = ACTIONS[action]
        return http_json(p.base + path, data=data, method=method, timeout=10)


# -------------------------------------------------------------------- the API
TRUSTED = [ipaddress.ip_network(n) for n in ("127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
                                             "169.254.0.0/16", "100.64.0.0/10")]


def trusted(address):
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return any(ip in n for n in TRUSTED)


def make_handler(farm):
    class Handler(BaseHTTPRequestHandler):
        server_version = "klipper-auto-eject"

        def log_message(self, *args):
            pass

        def _client(self):
            return self.headers.get("X-Real-IP") or self.client_address[0]

        def _send(self, code, body, ctype="application/json", cache="no-store"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", cache)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _body(self):
            length = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(length) or b"{}") if length else {}

        def _upload(self, pid, query):
            """A file sent as the request body (the page streams it), kept on
            the card while it goes on to the printer."""
            length = int(self.headers.get("Content-Length") or 0)
            os.makedirs(UPLOADS, exist_ok=True)
            # answer only once the copy is gone
            with tempfile.TemporaryFile(dir=UPLOADS) as tmp:
                left = length
                while left > 0:
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    tmp.write(chunk)
                    left -= len(chunk)
                if left:
                    answer = (400, {"error": "the upload was cut short"})
                else:
                    try:
                        result = farm.upload(pid, query.get("name", [""])[0], tmp, length, query.get("print", ["0"])[0] == "1")
                        answer = (200 if result is not None else 404, {"result": result})
                    except (ValueError, PermissionError) as e:
                        answer = (409, {"error": str(e)})
            return self._send(*answer)

        def _file_info(self, pid, what, query):
            """A file's facts (meta) or its slicer picture (thumb)."""
            name = query.get("file", [""])[0]
            if not name:
                return self._send(400, {"error": "which file?"})
            try:
                if what == "meta":
                    card = farm.file_card(pid, name)
                    return self._send(200 if card is not None else 404, {"meta": card})
                want = max(16, min(1024, int(query.get("w", ["300"])[0] or 300)))
                pic = farm.thumbnail(pid, name, want)
            except ValueError:
                return self._send(400, {"error": "w: not a number"})
            except LookupError as e:
                return self._send(404, {"error": str(e)})
            if pic is None:
                return self._send(404, {"error": "not found"})
            # the page asks again with the file's date when the file changes
            return self._send(200, pic[1], pic[0], cache="private, max-age=3600")

        def _route(self, method):
            url = urllib.parse.urlsplit(self.path)
            path = url.path.rstrip("/")
            parts = [x for x in path.split("/") if x]
            if method == "POST" and len(parts) == 3 and parts[0] == "farm" and parts[2] == "upload":
                if not trusted(self._client()):
                    return self._send(403, {"error": "not allowed from this network"})
                try:
                    return self._upload(parts[1], urllib.parse.parse_qs(url.query))
                except Exception as e:
                    return self._send(502, {"error": str(e)})
            # read the whole request first: a socket closed with unread data resets the connection
            try:
                body = self._body() if method == "POST" else {}
            except ValueError:
                return self._send(400, {"error": "not JSON"})
            if not trusted(self._client()):
                return self._send(403, {"error": "not allowed from this network"})
            try:
                if parts == ["farm"] and method == "GET":
                    return self._send(200, farm.view())
                if parts == ["farm", "report"] and method == "GET":
                    period = (urllib.parse.parse_qs(url.query).get("period") or ["today"])[0]
                    try:
                        return self._send(200, farm.report(period))
                    except ValueError as e:
                        return self._send(400, {"error": str(e)})
                if parts == ["farm", "scan"] and method == "POST":
                    return self._send(200, {"started": farm.start_scan()})
                if parts == ["farm", "printers"] and method == "POST":
                    if "add" in body:
                        try:
                            return self._send(200, {"added": farm.add(body["add"], skip=body.get("skip") or [])})
                        except (ValueError, LookupError) as e:
                            return self._send(400, {"error": str(e)})
                    if "remove" in body:
                        return self._send(200, {"removed": farm.remove(body["remove"])})
                    if "rename" in body:
                        return self._send(200, {"renamed": farm.rename(body["rename"], body.get("name", ""))})
                    if "group" in body:
                        return self._send(200, {"saved": farm.set_group(body.get("id"), body["group"])})
                    if "auto_off" in body:
                        return self._send(200, {"saved": farm.set_auto_off(body.get("id"), body["auto_off"], body.get("device", ""))})
                    if "service_every" in body or "service_done" in body:
                        return self._send(200, {"saved": farm.set_service(body.get("id"), body.get("service_every"), bool(body.get("service_done")))})
                if parts == ["farm", "sets"] and method == "POST":
                    try:
                        if "remove" in body:
                            return self._send(200, {"removed": farm.remove_set(str(body["remove"]))})
                        return self._send(200, {"saved": farm.save_set(body.get("name"), body.get("values"), body.get("from", ""))})
                    except ValueError as e:
                        return self._send(400, {"error": str(e)})
                if len(parts) == 3 and parts[0] == "farm" and parts[2] == "settings":
                    try:
                        if method == "GET":
                            result = farm.settings_of(parts[1])
                            return self._send(200 if result is not None else 404, {"settings": result})
                        result = farm.copy_settings(parts[1], body.get("values"))
                    except (LookupError, PermissionError) as e:
                        return self._send(409, {"error": str(e)})
                    except ValueError as e:
                        return self._send(400, {"error": str(e)})
                    return self._send(200 if result is not None else 404, {"result": result})
                if parts == ["farm", "settings"] and method == "POST":
                    try:
                        return self._send(200, {"saved": farm.set_report(body.get("report", ""))})
                    except ValueError as e:
                        return self._send(400, {"error": str(e)})
                if len(parts) == 3 and parts[0] == "farm" and parts[2] == "files" and method == "GET":
                    files = farm.files(parts[1])
                    return self._send(200 if files is not None else 404, {"files": files})
                if len(parts) == 3 and parts[0] == "farm" and parts[2] in ("meta", "thumb") and method == "GET":
                    return self._file_info(parts[1], parts[2], urllib.parse.parse_qs(url.query))
                if len(parts) == 3 and parts[0] == "farm" and parts[2] == "print" and method == "POST":
                    try:
                        result = farm.print_file(parts[1], body.get("filename", ""))
                    except PermissionError as e:
                        return self._send(409, {"error": str(e)})
                    return self._send(200 if result is not None else 404, {"result": result})
                if len(parts) == 3 and parts[0] == "farm" and parts[2] == "update" and method == "POST":
                    try:
                        result = farm.update(parts[1], body.get("names") or str(body.get("name", "")))
                    except (LookupError, PermissionError) as e:
                        return self._send(409, {"error": str(e)})
                    return self._send(200 if result is not None else 404, {"started": result})
                if len(parts) == 3 and parts[0] == "farm" and parts[2] == "power" and method == "POST":
                    p = farm.find(parts[1])
                    if p is None:
                        return self._send(404, {"error": "not found"})
                    try:
                        return self._send(200, {"result": p.set_power(body.get("device"), body.get("action"))})
                    except (LookupError, PermissionError) as e:
                        return self._send(409, {"error": str(e)})
                if len(parts) == 3 and parts[0] == "farm" and method == "POST":
                    try:
                        result = farm.act(parts[1], parts[2])
                    except PermissionError as e:
                        return self._send(409, {"error": str(e)})
                    return self._send(200 if result is not None else 404, {"result": result})
                if len(parts) == 3 and parts[0] == "farm" and parts[2] == "snapshot" and method == "GET":
                    p = farm.find(parts[1])
                    if p is None or not p.webcam:
                        return self._send(404, {"error": "no camera"})
                    with urllib.request.urlopen(p.webcam, timeout=5) as r:
                        return self._send(200, r.read(), r.headers.get("Content-Type", "image/jpeg"))
            except Exception as e:
                return self._send(502, {"error": str(e)})
            return self._send(404, {"error": "not found"})

        def do_GET(self):
            self._route("GET")

        def do_POST(self):
            self._route("POST")

    return Handler


def serve(farm, port=7128):
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(farm))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
