"""One printer of the farm: asks its Moonraker for its state, and keeps
what the farm page shows of it.

Part of the farm (farm.py).
"""

import re
import time
import urllib.error
import urllib.parse
import urllib.request

import farm_net as net
from farm_card import history_stats, same_setting, summarize

QUERY = ("/printer/objects/query?print_stats=state,filename,print_duration,info,message"
         "&virtual_sdcard=progress&heater_bed=temperature,target&extruder=temperature,target"
         "&webhooks=state,state_message&idle_timeout=state"
         "&gcode_macro%20_AUTO_EJECT_STATE=objects,busy,swept,leftover,height,bin,bg,cooling"
         "&gcode_macro%20_AUTO_EJECT_DEFAULTS=bin_capacity&gcode_macro%20_AUTO_EJECT_SETTINGS=bin_capacity"
         "&gcode_macro%20_AUTO_EJECT_OVERRIDES=data")
NOZZLE_COOL = 50.0     # turning the power off stops the hotend fan: never above this
UPDATES_EVERY = 300        # seconds between two looks at a printer's versions
# the auto-eject settings, merged as the macros merge them: the defaults,
# the settings file, then what was changed in the page (AUTO_EJECT_SET)
SETTING_MACROS = ("_AUTO_EJECT_DEFAULTS", "_AUTO_EJECT_SETTINGS", "_AUTO_EJECT_OVERRIDES")


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
        self.id = pid or ("local" if local else net.printer_id(host, port))
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
            status = net.http_json(self.base + QUERY, timeout=1.0 if self.down else 3.0)["status"]
            queue = None
            try:
                queue = net.http_json(self.base + "/server/job_queue/status")
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
                                   ("macs", lambda: self.macs or net.machine_macs(self.host, self.port)),
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
        info = net.http_json(self.base + "/machine/update/status", timeout=5)["version_info"]
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
        klipper = (net.http_json(self.base + "/printer/info", timeout=5) or {}).get("software_version", "")
        objects = net.http_json(self.base + "/printer/objects/list", timeout=5)["objects"]
        mcus = [o for o in objects if o == "mcu" or o.startswith("mcu ")]
        boards = []
        if mcus:
            query = "&".join(urllib.parse.quote(o) + "=mcu_version" for o in mcus)
            status = net.http_json(self.base + "/printer/objects/query?" + query, timeout=5)["status"]
            boards = [[o, str((status.get(o) or {}).get("mcu_version") or "")] for o in mcus]
        return {"klipper": str(klipper or ""), "boards": boards}

    def _stats(self, now):
        try:
            totals = net.http_json(self.base + "/server/history/totals")["job_totals"]
            jobs = net.http_json(self.base + "/server/history/list?limit=50&order=desc")["jobs"]
        except Exception:
            return self.stats
        return history_stats(totals, jobs, now)

    def _spool(self):
        """The spool on the printer, as Spoolman knows it through Moonraker's
        [spoolman]: its filament, colour and grams left. None without one."""
        try:
            status = net.http_json(self.base + "/server/spoolman/status", timeout=5) or {}
        except urllib.error.HTTPError:
            return None                                   # no [spoolman] in moonraker.conf
        sid = status.get("spool_id")
        if not status.get("spoolman_connected") or sid is None:
            return None
        answer = net.http_json(self.base + "/server/spoolman/proxy", timeout=5,
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
        status = (net.http_json(self.base + "/printer/objects/query?" + query + "&save_variables", timeout=5) or {}).get("status") or {}
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
            devices = net.http_json(self.base + "/machine/device_power/devices")["devices"]
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
        result = net.http_json(self.base + "/machine/device_power/device", data={"device": device, "action": action}, timeout=10)
        for d in self.power:
            if d["device"] == device and isinstance(result, dict) and device in result:
                d["status"] = result[device]
        return result

    def _webcam(self):
        try:
            cams = [c for c in net.http_json(self.base + "/server/webcams/list")["webcams"] if c.get("enabled", True)]
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
