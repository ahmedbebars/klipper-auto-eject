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
import ipaddress
import json
import re
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAMESPACE = "auto_eject_farm"
PORTS = (7125, 80)
QUERY = ("/printer/objects/query?print_stats=state,filename,print_duration,info,message"
         "&virtual_sdcard=progress&heater_bed=temperature,target&extruder=temperature,target"
         "&webhooks=state,state_message&idle_timeout=state"
         "&gcode_macro%20_AUTO_EJECT_STATE=objects,busy,swept,leftover,height")
HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$")
# what the farm page can ask a printer to do
ACTIONS = {
    "continue": ("POST", "/server/job_queue/start", None),
    # the bed is clear: auto-eject forgets the parts; any other printer
    # forgets the finished job, so it shows as free again
    "clear": ("POST", "/printer/gcode/script", {"script": "AUTO_EJECT_CLEAR"}),
    "clear_plain": ("POST", "/printer/gcode/script", {"script": "SDCARD_RESET_FILE"}),
    "estop": ("POST", "/printer/emergency_stop", None),
}


def http_json(url, data=None, method=None, timeout=3.0):
    request = urllib.request.Request(url, method=method or ("POST" if data is not None else "GET"),
                                     data=None if data is None else json.dumps(data).encode(),
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response).get("result")


def printer_id(host, port):
    return hashlib.sha1(("%s:%s" % (host, port)).encode()).hexdigest()[:10]


# --------------------------------------------------------------- one printer
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
    leftover = list(ae.get("leftover", [])) if ae else []
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
    }
    return card


class Printer:
    def __init__(self, host, port, name="", local=False, pid=None):
        self.host, self.port, self.name, self.local = host, int(port), name or host, local
        self.id = pid or ("local" if local else printer_id(host, port))
        self.card = {"phase": "offline"}
        self.status = {}
        self.webcam = None
        self.page = None
        self.updated = 0.0
        self.watcher = None       # notifications for printers other than this one
        self._slow = 0.0

    @property
    def base(self):
        return "http://%s:%d" % (self.host, self.port)

    def record(self):
        return {"host": self.host, "port": self.port, "name": self.name}

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
            self.status = status
            self.card = summarize(status, queue, now)
        except Exception:
            self.status = {}
            self.card = {"phase": "offline"}
        self.updated = now
        return self.card

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

    def public(self):
        return dict(self.card, id=self.id, name=self.name, host=self.host, local=self.local,
                    page=None if self.local else self.page, camera=bool(self.webcam), updated=self.updated)


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
        if peer.get("Online") and ips:
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
        return {"host": host, "port": port, "name": name or host, "klippy": info.get("klippy_state", "")}
    return None


def scan(skip=(), networks=None, peers=None, prober=probe, workers=64):
    """Every printer on the local networks and on Tailscale, except those in skip."""
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
    return sorted(found, key=lambda r: ipaddress.ip_address(r["host"]))


# ------------------------------------------------------------------- the farm
class Farm:
    def __init__(self, moonraker, on_events=None, local_port=7125):
        self.moonraker = moonraker           # this printer's Moonraker (auto_eject_push.Moonraker)
        self.on_events = on_events           # (printer name, events) -> None: notifications
        self.lock = threading.Lock()
        self.local = Printer("127.0.0.1", local_port, local=True)
        self.local_named = False             # True: renamed in the page; None: the hostname
        self.printers = {}
        self.loaded = False
        self.scan_state = {"running": False, "found": [], "finished": None}
        self.load()

    def load(self):
        """The saved farm, once Moonraker answers. Until then nothing is saved,
        so a slow Moonraker at boot never loses the list."""
        if self.loaded:
            return True
        try:
            records = self.moonraker.get("printers", namespace=NAMESPACE) or {}
            local = self.moonraker.get("local", namespace=NAMESPACE) or {}
        except Exception:
            return False
        with self.lock:
            for pid, r in records.items():
                self.printers.setdefault(pid, Printer(r["host"], r.get("port", 7125), r.get("name", ""), pid=pid))
            if local.get("name"):
                self.local.name, self.local_named = local["name"], True
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
        printers = self.all()
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
            found = scan(skip=skip)
        except Exception:
            found = []
        with self.lock:
            self.scan_state = {"running": False, "found": found, "finished": time.time()}

    def add(self, entries, prober=None):
        """Add printers: scan results, or an address typed in the page (then
        it is asked first whether a Moonraker answers there)."""
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
            p = Printer(host, port or 7125, e.get("name", ""))
            with self.lock:
                if p.id not in self.printers and p.host not in mine:
                    self.printers[p.id] = p
                    added.append(p.id)
        with self.lock:
            self._save()
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
                self.moonraker.put("local", {"name": name}, namespace=NAMESPACE)
                if name:
                    p.name, self.local_named = name, True
                else:
                    self.local_named = False         # back to the hostname
            else:
                p.name = name or p.host
                self._save()
        return True

    def find(self, pid):
        return self.local if pid == "local" else self.printers.get(pid)

    def act(self, pid, action):
        p = self.find(pid)
        if p is None or action not in ("continue", "clear", "estop"):
            return None
        if action == "clear" and not p.card.get("auto_eject"):
            action = "clear_plain"
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

        def _route(self, method):
            if not trusted(self._client()):
                return self._send(403, {"error": "not allowed from this network"})
            path = urllib.parse.urlsplit(self.path).path.rstrip("/")
            parts = [x for x in path.split("/") if x]
            try:
                if parts == ["farm"] and method == "GET":
                    return self._send(200, farm.view())
                if parts == ["farm", "scan"] and method == "POST":
                    return self._send(200, {"started": farm.start_scan()})
                if parts == ["farm", "printers"] and method == "POST":
                    body = self._body()
                    if "add" in body:
                        try:
                            return self._send(200, {"added": farm.add(body["add"])})
                        except (ValueError, LookupError) as e:
                            return self._send(400, {"error": str(e)})
                    if "remove" in body:
                        return self._send(200, {"removed": farm.remove(body["remove"])})
                    if "rename" in body:
                        return self._send(200, {"renamed": farm.rename(body["rename"], body.get("name", ""))})
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
