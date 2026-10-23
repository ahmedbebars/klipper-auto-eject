"""klipper-auto-eject farm: every Klipper printer on the network in one place.

Part of the klipper-auto-eject service (auto_eject_push.py). It finds the
printers on the local network and on Tailscale, asks each one for its state
every few seconds, and serves the farm to the auto-eject page over a small
HTTP API on 127.0.0.1, which nginx publishes at /auto-eject/api/.

The other printers need nothing installed: their Moonraker answers this
printer like it answers Mainsail on the same network. Those with
klipper-auto-eject also show their parts, cooling and eject.

The farm is in these files:
  farm.py          the farm: its printers, what they do, what is saved
  farm_printer.py  one printer
  farm_queue.py    the farm queue
  farm_card.py     what a printer's answers say
  farm_net.py      Moonraker's HTTP API, and the search for printers
  farm_api.py      the HTTP API for the page
"""

import collections
import concurrent.futures
import ipaddress
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import farm_net as net
from farm_card import (REPORT_PERIODS, pick_thumb, production, report_since, same_setting, setting_ok,
                       setting_text, thumb_path)
from farm_printer import NOZZLE_COOL, Printer
from farm_queue import FarmQueue

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
# phases in which a printer cannot start a print
BUSY = ("printing", "paused", "ejecting", "stopped", "offline", "off")
ON_THE_BED = ("leftover", "parts", "bin")
# the states in which a printer may be updated: Klipper restarts after some updates
IDLE_STATES = ("standby", "complete", "cancelled", "error")
# this printer updated its own auto-eject: Moonraker restarts this service
# meanwhile, so Klipper is restarted (for the new macros) once it is back
RESTART_FLAG = os.path.join(net.UPLOADS, "restart-klipper")
# what is updated first: the rest, then Klipper, Moonraker, and auto-eject last,
# since it restarts the service that runs the update on the farm's own printer
UPDATE_ORDER = {"klipper": 1, "moonraker": 2, "klipper-auto-eject": 3}
# what the print dialog shows of a file, from Moonraker's metadata
FILE_FACTS = ("estimated_time", "filament_weight_total", "filament_total", "object_height", "layer_height",
              "layer_count", "filament_type", "nozzle_diameter", "slicer", "slicer_version", "modified", "size")
THUMBS_KEPT = 200      # pictures the farm keeps in memory (a few KB each)
SETTING_KEY = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
SETS_MAX = 100         # saved sets of settings, one for each kind of printer


# ------------------------------------------------------------------- the farm
class Farm(FarmQueue):
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
        self.queue = {"running": True, "jobs": []}   # the farm queue: jobs in order, each with its copies sent ("runs")
        self.need_clear = set()              # printers whose farm copy ended or stopped: someone clears the bed first
        self.retry_at = {}                   # printer -> when to offer it a copy again after it refused one
        self.clock = time.time               # when a copy reached its printer (a test sets its own)
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
            records = self.moonraker.get("printers", namespace=net.NAMESPACE) or {}
            local = self.moonraker.get("local", namespace=net.NAMESPACE) or {}
            skipped = self.moonraker.get("skipped", namespace=net.NAMESPACE) or []
            settings = self.moonraker.get("settings", namespace=net.NAMESPACE) or {}
            sets = self.moonraker.get("sets", namespace=net.NAMESPACE) or {}
            queue = self.moonraker.get("queue", namespace=net.NAMESPACE) or {}
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
            self.queue = {"running": queue.get("running", True) is not False, "jobs": list(queue.get("jobs") or [])}
            self.need_clear = set(queue.get("need_clear") or [])
            for job in self.queue["jobs"]:
                for run in job.get("runs", []):
                    if run.get("state") == "sending":   # cut short by a restart: it may not have arrived
                        run.update(state="failed", error="the farm restarted while sending it")
            self.loaded = True
        return True

    def _save(self):
        if not self.loaded:
            raise RuntimeError("Moonraker is not answering yet")
        self.moonraker.put("printers", {pid: p.record() for pid, p in self.printers.items()}, namespace=net.NAMESPACE)

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
        self.track_queue(now)
        self.dispatch(now)
        report = self.report_due(now)
        if report and self.on_events:
            self.on_events(None, [("report", report)])
        if self.local_named is False and self.local.card.get("phase") != "offline":
            try:
                self.local.name = net.http_json(self.local.base + "/printer/info").get("hostname") or self.local.name
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
            events += p.watcher.console(net.http_json(p.base + "/server/gcode_store?count=40")["gcode_store"])
            events += p.watcher.klipper(p.status.get("webhooks", {}))
            jobs = net.http_json(p.base + "/server/history/list?limit=1&order=desc").get("jobs") or []
            events += p.watcher.history(jobs[0] if jobs else None, p.card.get("message", ""))
        except Exception:
            pass
        if events:
            self.on_events(p.name, events)

    def view(self):
        return {"printers": [p.public() for p in self.all()], "scan": self.scan_state,
                "settings": {"report": self.settings.get("report") or ""},
                "sets": [dict(s, name=n) for n, s in sorted(self.sets.items(), key=lambda x: x[0].lower())],
                "queue": self.queue_view()}

    def report(self, period, now=None):
        """Every printer's production over a period, from each one's history."""
        if period not in REPORT_PERIODS:
            raise ValueError("period: today, 7 or 30")
        since = report_since(period, now)

        def one(p):
            row = {"id": p.id, "name": p.name, "group": p.group}
            try:
                jobs = net.http_json(p.base + "/server/history/list?limit=1000&order=desc&since=%d" % int(since), timeout=8)["jobs"]
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
        skip = net.own_addresses() | {p.host for p in self.printers.values()}
        threading.Thread(target=self._scan, args=(skip,), daemon=True).start()
        return True

    def _scan(self, skip):
        try:
            self.local.macs = self.local.macs or net.machine_macs(self.local.host, self.local.port)
            known = [(p.port, p.macs) for p in self.all() if p.macs]
            found = net.scan(skip=skip, known=known)
            for r in found:
                r["skipped"] = any(net.same_printer(r, s) for s in self.skipped)
        except Exception:
            found = []
        with self.lock:
            self.scan_state = {"running": False, "found": found, "finished": time.time()}

    def add(self, entries, prober=None, skip=()):
        """Add printers: scan results, or an address typed in the page (then
        it is asked first whether a Moonraker answers there). skip: the
        search results left out, which the next search suggests unticked."""
        prober = prober or (lambda host, ports: net.probe(host, ports, timeout=3.0))
        if not self.load():
            raise RuntimeError("Moonraker is not answering yet")
        added = []
        mine = net.own_addresses()
        for e in entries:
            host, port = str(e.get("host", "")).strip(), e.get("port")
            if host.count(":") == 1 and port is None:
                host, _, port = host.partition(":")
            if not net.HOST.match(host) or (port is not None and not str(port).isdigit()):
                raise ValueError("not an address: %s" % e.get("host", ""))
            if not e.get("name"):
                found = prober(host, (int(port),) if port else net.PORTS)
                if not found:
                    raise LookupError("no printer answers at %s" % host)
                e = found
                host, port = found["host"], found["port"]
            p = Printer(host, port or 7125, e.get("name", ""), macs=e.get("macs"))
            with self.lock:
                twin = any(net.same_machine(p.port, p.macs, q.port, q.macs) for q in [self.local] + list(self.printers.values()))
                if p.id not in self.printers and p.host not in mine and not twin:
                    self.printers[p.id] = p
                    added.append(p.id)
        with self.lock:
            self._save()
            keep = [s for s in self.skipped if not any(net.same_printer(s, p.record()) for p in self.printers.values())]
            for e in skip:
                r = {"host": str(e.get("host", "")), "port": int(e.get("port") or 7125), "name": str(e.get("name", ""))[:40],
                     "macs": [str(m) for m in (e.get("macs") or [])][:8]}
                if net.HOST.match(r["host"]) and not any(net.same_printer(r, s) for s in keep):
                    keep.append(r)
            if keep != self.skipped:
                self.skipped = keep[-200:]
                self.moonraker.put("skipped", self.skipped, namespace=net.NAMESPACE)
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
                self.moonraker.put("local", self._local_record(name), namespace=net.NAMESPACE)
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
        peers = net.tailscale_peers() if peers is None else peers
        macs_of = macs_of or net.machine_macs
        wanted = [p for p in printers if not p.local and p.macs and ipaddress.ip_address(p.host) not in net.TAILNET]
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
            self.moonraker.put("local", self._local_record(), namespace=net.NAMESPACE)
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
        self.moonraker.put("settings", self.settings, namespace=net.NAMESPACE)
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
            self.moonraker.put("settings", self.settings, namespace=net.NAMESPACE)
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
                self.moonraker.put("local", self._local_record(), namespace=net.NAMESPACE)
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
        items = net.http_json(p.base + "/server/files/list?root=gcodes", timeout=10) or []
        items = [{"path": f["path"], "size": f.get("size", 0), "modified": f.get("modified", 0)}
                 for f in items if net.GCODE_FILE.search(f.get("path", ""))]
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
            meta = net.http_json(p.base + "/server/files/metadata?filename=" + urllib.parse.quote(filename), timeout=5) or {}
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise LookupError("%s has no file %s" % (p.name, filename)) from e
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
                raise LookupError("%s has no picture" % filename) from e
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
        st = net.http_json(p.base + "/printer/objects/query?print_stats=state&idle_timeout=state", timeout=5)["status"]
        return st["print_stats"]["state"] in IDLE_STATES and st["idle_timeout"]["state"] != "Printing"

    def _wait_for_moonraker(self, p, seconds=90):
        end = time.time() + seconds
        while time.time() < end:
            try:
                net.http_json(p.base + "/server/info", timeout=3)
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
                    os.makedirs(net.UPLOADS, exist_ok=True)
                    with open(RESTART_FLAG, "w") as f:
                        f.write(str(time.time()))
                try:
                    net.http_json(p.base + "/machine/update/upgrade", data={"name": name}, timeout=900)
                except OSError:
                    if name != "moonraker":            # Moonraker restarting may cut its own answer
                        raise
                if name == "moonraker":
                    self._wait_for_moonraker(p)
                job["done"].append(name)
            if restart and self._idle(p):
                net.http_json(p.base + "/printer/firmware_restart", data={}, timeout=15)
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
                net.http_json(self.local.base + "/printer/firmware_restart", data={}, timeout=15)
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
        return net.http_json(p.base + "/printer/print/start", data={"filename": str(filename)}, timeout=15)

    def upload(self, pid, name, fileobj, size, start=False):
        p = self.find(pid)
        if p is None:
            return None
        name = net.safe_name(name)
        if start:
            self.ready_to_print(p)
        return net.upload_file(p.base, name, fileobj, size, start)

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
            net.http_json(p.base + "/printer/gcode/script", data={"script": "\n".join(lines)}, timeout=30)
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
        self.moonraker.put("sets", self.sets, namespace=net.NAMESPACE)
        return True

    def remove_set(self, name):
        if name not in self.sets:
            return False
        del self.sets[name]
        self.moonraker.put("sets", self.sets, namespace=net.NAMESPACE)
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
        answer = net.http_json(p.base + path, data=data, method=method, timeout=10)
        if action in ("clear", "clear_plain") and p.id in self.need_clear:
            with self.lock:
                self.need_clear.discard(p.id)
            self._put_queue()
        return answer
