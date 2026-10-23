"""The farm's HTTP API for the auto-eject page, on 127.0.0.1; nginx
publishes it at /auto-eject/api/.

Part of the farm (farm.py).
"""

import ipaddress
import json
import os
import tempfile
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import farm_net as net

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
            os.makedirs(net.UPLOADS, exist_ok=True)
            # answer only once the copy is gone
            with tempfile.TemporaryFile(dir=net.UPLOADS) as tmp:
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

        def _queue_upload(self, query):
            """A file for the farm queue, as the request body."""
            length = int(self.headers.get("Content-Length") or 0)
            os.makedirs(net.UPLOADS, exist_ok=True)
            with tempfile.TemporaryFile(dir=net.UPLOADS) as tmp:
                left = length
                while left > 0:
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    tmp.write(chunk)
                    left -= len(chunk)
                if left:
                    return self._send(400, {"error": "the upload was cut short"})
                try:
                    job = farm.queue_add(query.get("name", [""])[0], tmp, length, query.get("copies", ["1"])[0],
                                         [x for x in query.get("printers", [""])[0].split(",") if x])
                except ValueError as e:
                    return self._send(400, {"error": str(e)})
            return self._send(200, {"added": job})

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
            if method == "POST" and parts == ["farm", "queue", "upload"]:
                if not trusted(self._client()):
                    return self._send(403, {"error": "not allowed from this network"})
                try:
                    return self._queue_upload(urllib.parse.parse_qs(url.query))
                except Exception as e:
                    return self._send(502, {"error": str(e)})
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
                if parts == ["farm", "queue"] and method == "POST":
                    try:
                        return self._send(200, {"saved": farm.queue_change(body)})
                    except LookupError as e:
                        return self._send(404, {"error": str(e)})
                    except PermissionError as e:
                        return self._send(409, {"error": str(e)})
                    except (TypeError, ValueError) as e:
                        return self._send(400, {"error": str(e)})
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
