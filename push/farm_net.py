"""The farm's way to the printers: Moonraker's HTTP API, and the search.

Part of the farm (farm.py). Every call to a printer goes through http_json()
or upload_file(), and the search finds the Moonraker instances on the local
networks and on Tailscale.
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
import urllib.parse
import urllib.request
import uuid

NAMESPACE = "auto_eject_farm"
PORTS = (7125, 80)
HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$")
TAILNET = ipaddress.ip_network("100.64.0.0/10")
GCODE_FILE = re.compile(r"\.(gcode|g|gco|bgcode)$", re.I)
UPLOADS = os.path.expanduser("~/.cache/klipper-auto-eject")    # on the card, not in RAM (/tmp)


def safe_name(name):
    """A G-code file name that Moonraker and a form header both take."""
    name = os.path.basename(str(name or "").replace("\\", "/")).strip()
    name = re.sub(r'[^\w .+()\-]', "_", name, flags=re.UNICODE).strip(" .")
    if not name or not GCODE_FILE.search(name):
        raise ValueError("not a G-code file: %s" % name)
    return name[:200]


def upload_file(base, name, fileobj, size, start=False, timeout=600, folder=""):
    """Send a file to a Moonraker (POST /server/files/upload), streamed from
    fileobj; start=True prints it at once; folder: under gcodes/."""
    b = "----autoeject" + uuid.uuid4().hex
    head = ""
    if start:
        head += '--%s\r\nContent-Disposition: form-data; name="print"\r\n\r\ntrue\r\n' % b
    head += '--%s\r\nContent-Disposition: form-data; name="root"\r\n\r\ngcodes\r\n' % b
    if folder:
        head += '--%s\r\nContent-Disposition: form-data; name="path"\r\n\r\n%s\r\n' % (b, folder)
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
