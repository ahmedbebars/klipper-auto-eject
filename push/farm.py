"""klipper-auto-eject farm: every Klipper printer on the network in one place.

Part of the klipper-auto-eject service (auto_eject_push.py). It finds the
printers on the local network and on Tailscale, asks each one for its state
every few seconds, and serves the farm to the auto-eject page over a small
HTTP API on 127.0.0.1, which nginx publishes at /auto-eject/api/.

The other printers need nothing installed: their Moonraker answers this
printer like it answers Mainsail on the same network. Those with
klipper-auto-eject also show their parts, cooling and eject.
"""

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
         "&gcode_macro%20_AUTO_EJECT_STATE=objects,busy,swept,leftover,height,bin"
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
    return data.get("result")


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
    elif ae and ae.get("busy"):
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


class Printer:
    def __init__(self, host, port, name="", local=False, pid=None, macs=None, auto_off=0, auto_off_device=""):
        self.host, self.port, self.name, self.local = host, int(port), name or host, local
        self.macs = list(macs or [])
        self.power = None             # Moonraker [power] devices, or None without any
        self.auto_off = int(auto_off or 0)              # minutes with nothing to do, then off; 0 = never
        self.auto_off_device = auto_off_device or ""
        self.idle_since = None
        self.ts_host = None           # the same printer's Tailscale address, for Open from away
        self.id = pid or ("local" if local else printer_id(host, port))
        self.card = {"phase": "offline"}
        self.status = {}
        self.stats = None
        self.webcam = None
        self.page = None
        self.updated = 0.0
        self.watcher = None       # notifications for printers other than this one
        self._slow = 0.0

    @property
    def base(self):
        return "http://%s:%d" % (self.host, self.port)

    def record(self):
        out = {"host": self.host, "port": self.port, "name": self.name}
        if self.macs:
            out["macs"] = self.macs
        if self.auto_off:
            out["auto_off"], out["auto_off_device"] = self.auto_off, self.auto_off_device
        return out

    def poll(self, now=None):
        now = now or time.time()
        try:
            status = http_json(self.base + QUERY)["status"]
            queue = None
            try:
                queue = http_json(self.base + "/server/job_queue/status")
            except Exception:
                pass
            if now - self._slow > 60:          # things that rarely change
                self._slow = now
                self.webcam = self._webcam()
                self.page = self._page()
                self.macs = self.macs or machine_macs(self.host, self.port)
                self.stats = self._stats(now)
                self.power = self._power()
            self.status = status
            self.card = summarize(status, queue, now)
        except Exception:
            self.status = {}
            self.card = {"phase": "offline"}
        if self.card["phase"] in ("offline", "stopped"):
            # Moonraker may still answer while the printer's board is switched off
            power = self._power()
            if power is not None:
                self.power = power
            if self.power and any(d["status"] == "off" for d in self.power):
                self.card = {"phase": "off"}
        self.updated = now
        return self.card

    def _stats(self, now):
        try:
            totals = http_json(self.base + "/server/history/totals")["job_totals"]
            jobs = http_json(self.base + "/server/history/list?limit=50&order=desc")["jobs"]
        except Exception:
            return self.stats
        return history_stats(totals, jobs, now)

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
        return dict(self.card, page_remote=None if self.local else self.remote_page(), id=self.id, name=self.name, host=self.host, local=self.local,
                    page=None if self.local else self.page, camera=bool(self.webcam), stats=self.stats,
                    power=self.power, auto_off=self.auto_off, auto_off_device=self.auto_off_device,
                    updated=self.updated)


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
        except Exception:
            return False
        with self.lock:
            for pid, r in records.items():
                self.printers.setdefault(pid, Printer(r["host"], r.get("port", 7125), r.get("name", ""), pid=pid, macs=r.get("macs"),
                                                      auto_off=r.get("auto_off", 0), auto_off_device=r.get("auto_off_device", "")))
            if local.get("name"):
                self.local.name, self.local_named = local["name"], True
            self.local.auto_off = int(local.get("auto_off") or 0)
            self.local.auto_off_device = local.get("auto_off_device") or ""
            self.skipped = list(skipped)
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
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(16, len(printers))) as pool:
            list(pool.map(lambda p: self._poll_one(p, now, watcher_factory), printers))
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
        return {"printers": [p.public() for p in self.all()], "scan": self.scan_state}

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
        if self.local.auto_off:
            out["auto_off"], out["auto_off_device"] = self.local.auto_off, self.local.auto_off_device
        return out

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

    def act(self, pid, action):
        p = self.find(pid)
        if p is None or action not in ("continue", "clear", "estop", "bin_empty", "pause", "resume", "cancel"):
            return None
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

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
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
                    if "auto_off" in body:
                        return self._send(200, {"saved": farm.set_auto_off(body.get("id"), body["auto_off"], body.get("device", ""))})
                if len(parts) == 3 and parts[0] == "farm" and parts[2] == "files" and method == "GET":
                    files = farm.files(parts[1])
                    return self._send(200 if files is not None else 404, {"files": files})
                if len(parts) == 3 and parts[0] == "farm" and parts[2] == "print" and method == "POST":
                    try:
                        result = farm.print_file(parts[1], body.get("filename", ""))
                    except PermissionError as e:
                        return self._send(409, {"error": str(e)})
                    return self._send(200 if result is not None else 404, {"result": result})
                if len(parts) == 3 and parts[0] == "farm" and parts[2] == "power" and method == "POST":
                    p = farm.find(parts[1])
                    if p is None:
                        return self._send(404, {"error": "not found"})
                    try:
                        return self._send(200, {"result": p.set_power(body.get("device"), body.get("action"))})
                    except (LookupError, PermissionError) as e:
                        return self._send(409, {"error": str(e)})
                if len(parts) == 3 and parts[0] == "farm" and method == "POST":
                    result = farm.act(parts[1], parts[2])
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
