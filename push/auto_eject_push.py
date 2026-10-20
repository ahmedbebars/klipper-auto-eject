#!/usr/bin/env python3
"""klipper-auto-eject service: notifications (Web Push) and the farm.

Runs on the printer next to Moonraker (install.sh --push). It watches the
printer and sends a notification to every phone or computer that turned
them on in the auto-eject page, even while the page is closed:

- a part still on the bed after the eject, parts too thin to push, a print
  that ended without an eject, a print the guard did not start
- a print that stopped with an error or was cancelled, Klipper stopping
- every finished print, on the devices that want it
- AUTO_EJECT_NOTIFY_TEST

The page subscribes with the browser's push service (Google for Chrome and
Android, Apple for Safari, Mozilla for Firefox) and stores the subscription
in Moonraker's database, so this service needs no port of its own. It
reads the printer over Moonraker's HTTP API on this machine. Messages are
encrypted for each device (RFC 8291), so the push services cannot read them.

It also runs the farm (farm.py): every Klipper printer on the network in the
auto-eject page, with notifications from all of them.

Needs Python 3.9+ and the cryptography package.
"""

import argparse
import base64
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

NAMESPACE = "auto_eject_push"
CONTACT = "https://github.com/ahmedbebars/klipper-auto-eject"
log = logging.getLogger("klipper-auto-eject")


def b64u(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64u_decode(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# ------------------------------------------------------------------ Web Push
class Vapid:
    """The service's own key pair, which identifies it to the push services
    (RFC 8292). The private key stays in a file only this user can read."""

    def __init__(self, path):
        self.path = path
        if os.path.exists(path):
            with open(path, "rb") as f:
                self.key = serialization.load_pem_private_key(f.read(), password=None)
        else:
            self.key = ec.generate_private_key(ec.SECP256R1())
            os.makedirs(os.path.dirname(path), exist_ok=True)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(self.key.private_bytes(serialization.Encoding.PEM,
                                               serialization.PrivateFormat.PKCS8,
                                               serialization.NoEncryption()))
        self.public = b64u(self.key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))

    def authorization(self, endpoint, now=None):
        url = urllib.parse.urlsplit(endpoint)
        claims = {"aud": "%s://%s" % (url.scheme, url.netloc),
                  "exp": int((now or time.time()) + 12 * 3600), "sub": CONTACT}
        head = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
        body = b64u(json.dumps(claims, separators=(",", ":")).encode())
        r, s = decode_dss_signature(self.key.sign(("%s.%s" % (head, body)).encode(), ec.ECDSA(hashes.SHA256())))
        token = "%s.%s.%s" % (head, body, b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big")))
        return "vapid t=%s, k=%s" % (token, self.public)


def _hkdf(salt, info, length, key):
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(key)


def encrypt(payload, p256dh, auth, sender=None, salt=None):
    """Encrypt a message for one subscription (RFC 8291, aes128gcm)."""
    receiver_public = b64u_decode(p256dh)
    receiver = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), receiver_public)
    sender = sender or ec.generate_private_key(ec.SECP256R1())
    sender_public = sender.public_key().public_bytes(serialization.Encoding.X962,
                                                     serialization.PublicFormat.UncompressedPoint)
    secret = sender.exchange(ec.ECDH(), receiver)
    ikm = _hkdf(b64u_decode(auth), b"WebPush: info\x00" + receiver_public + sender_public, 32, secret)
    salt = salt or os.urandom(16)
    cek = _hkdf(salt, b"Content-Encoding: aes128gcm\x00", 16, ikm)
    nonce = _hkdf(salt, b"Content-Encoding: nonce\x00", 12, ikm)
    record = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    return salt + (4096).to_bytes(4, "big") + bytes([len(sender_public)]) + sender_public + record


def send(subscription, message, vapid, urgency="normal", opener=urllib.request.urlopen):
    """Post one notification. Returns the push service's HTTP status."""
    body = encrypt(json.dumps(message).encode(), subscription["keys"]["p256dh"], subscription["keys"]["auth"])
    request = urllib.request.Request(subscription["endpoint"], data=body, method="POST", headers={
        "Content-Type": "application/octet-stream", "Content-Encoding": "aes128gcm",
        "TTL": "86400", "Urgency": urgency, "Authorization": vapid.authorization(subscription["endpoint"])})
    try:
        with opener(request, timeout=15) as response:
            return response.status
    except urllib.error.HTTPError as e:
        return e.code


# ---------------------------------------------------- what deserves a message
# the same rules as noticeFor() in web/model.js
NOTICES = [
    (re.compile(r"STILL ON THE BED"), "stuck"),
    (re.compile(r"^AUTO_EJECT_GUARD: .*(still on the bed|may still be on the bed)"), "guard"),
    (re.compile(r"too thin to push"), "thin"),
    (re.compile(r"the print ended and \d+ part\(s\) are still on the bed"), "left"),
    (re.compile(r"^AUTO_EJECT: test notification"), "test"),
]
PROBLEMS = {"stuck", "guard", "thin", "left", "error", "shutdown"}
TITLES = {
    "en": {"stuck": "A part is still on the bed", "guard": "The print did not start",
           "thin": "Parts left on the bed", "left": "Take the parts off", "complete": "Print finished",
           "error": "Print stopped with an error", "cancelled": "Print cancelled", "shutdown": "Klipper stopped",
           "test": "Auto-eject"},
    "ar": {"stuck": "قطعة ما زالت على السرير", "guard": "لم تبدأ الطباعة", "thin": "قطع متروكة على السرير",
           "left": "أزل القطع", "complete": "انتهت الطباعة", "error": "توقفت الطباعة بخطأ",
           "cancelled": "أُلغيت الطباعة", "shutdown": "توقف Klipper", "test": "الإزالة التلقائية"},
}
TEST_BODY = {"en": "Notifications from your printer work.", "ar": "إشعارات طابعتك تعمل."}


def notice_for(line):
    text = re.sub(r"^(//|!!)\s*", "", str(line)).strip()
    for pattern, kind in NOTICES:
        if pattern.search(text):
            return kind, text
    return None


class Watcher:
    """Turns what the printer reports into events: (kind, text)."""

    JOBS = {"completed": "complete", "cancelled": "cancelled", "error": "error"}

    def __init__(self):
        self.job = None           # (job_id, status) of the newest job last time
        self.klippy = None        # webhooks.state last time
        self.seen = None          # time of the newest console line already handled
        self.problem_at = 0.0     # when the last problem was reported

    def klipper(self, webhooks):
        state = webhooks.get("state")
        events = []
        if state in ("shutdown", "error") and self.klippy == "ready":
            events.append(("shutdown", webhooks.get("state_message", "")))
        if state:
            self.klippy = state
        return events

    def history(self, job, message="", now=None):
        """The newest job in Moonraker's history. A job that ended between two
        looks is still found there, unlike in print_stats."""
        if not job:
            return []
        key = (job.get("job_id"), job.get("status"))
        if self.job is None or key == self.job:
            self.job = key
            return []
        self.job = key
        kind = self.JOBS.get(job.get("status"))
        # an error right after an auto-eject message says the same again
        if not kind or (kind == "error" and (now or time.time()) - self.problem_at < 120):
            return []
        return [(kind, ": ".join(x for x in (job.get("filename"), message if kind == "error" else "") if x))]

    def console(self, store, now=None):
        if self.seen is None:      # at start: only what comes from now on
            self.seen = max([g.get("time", 0) for g in store] + [0])
            return []
        events = []
        for g in store:
            if g.get("time", 0) <= self.seen:
                continue
            self.seen = g["time"]
            hit = notice_for(g.get("message", ""))
            if hit:
                events.append(hit)
                if hit[0] in PROBLEMS:
                    self.problem_at = now or time.time()
        return events


def message_for(kind, text, sub, printer=None):
    lang = sub.get("lang") if sub.get("lang") in TITLES else "en"
    body = TEST_BODY[lang] if kind == "test" else text
    title = TITLES[lang].get(kind, "Auto-eject")
    url = sub.get("url") or ""
    if printer:                    # another printer of the farm
        title = "%s · %s" % (printer, title)
        url = url.split("#")[0] + "#/farm" if url else ""
    return {"title": title, "body": body, "tag": "auto-eject-%s-%s" % (printer or "here", kind), "url": url}


# ----------------------------------------------------------------- Moonraker
class Moonraker:
    def __init__(self, url):
        self.url = url.rstrip("/")

    def _call(self, path, data=None, method=None):
        request = urllib.request.Request(self.url + path, method=method or ("POST" if data is not None else "GET"),
                                         data=None if data is None else json.dumps(data).encode(),
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)["result"]

    def printer(self):
        r = self._call("/printer/objects/query?print_stats=message&webhooks=state,state_message")
        return r["status"].get("print_stats", {}), r["status"].get("webhooks", {})

    def newest_job(self):
        jobs = self._call("/server/history/list?limit=1&order=desc").get("jobs") or []
        return jobs[0] if jobs else None

    def console(self, count=50):
        return self._call("/server/gcode_store?count=%d" % count)["gcode_store"]

    def get(self, key, namespace=NAMESPACE):
        try:
            return self._call("/server/database/item?namespace=%s&key=%s" % (namespace, key))["value"]
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise

    def put(self, key, value, namespace=NAMESPACE):
        self._call("/server/database/item", {"namespace": namespace, "key": key, "value": value})

    def delete(self, key, namespace=NAMESPACE):
        self._call("/server/database/item?namespace=%s&key=%s" % (namespace, key), method="DELETE")


def deliver(events, moonraker, vapid, sender=send, printer=None):
    subs = moonraker.get("subs") or {}
    for kind, text in events:
        for sid, sub in list(subs.items()):
            if kind == "complete" and not sub.get("jobs", True):
                continue
            status = sender(sub, message_for(kind, text, sub, printer), vapid,
                            "high" if kind in PROBLEMS else "normal")
            log.info("%s -> %s: %s", kind, sub.get("name", sid), status)
            if status in (404, 410):          # the device turned them off or went away
                moonraker.delete("subs." + sid)
                subs.pop(sid)


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--moonraker", default="http://127.0.0.1:7125")
    p.add_argument("--key", default=os.path.expanduser("~/.config/klipper-auto-eject/vapid.pem"))
    p.add_argument("--interval", type=float, default=2.0)
    p.add_argument("--api-port", type=int, default=7128, help="the farm API on 127.0.0.1; 0 = no farm")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    vapid = Vapid(args.key)
    moonraker = Moonraker(args.moonraker)
    watcher = Watcher()
    published = False
    if args.api_port:
        import farm as farm_mod
        port = urllib.parse.urlsplit(args.moonraker).port or 7125

        def farm_events(name, events):
            try:
                deliver(events, moonraker, vapid, printer=name)
            except Exception as e:
                log.info("farm notification failed: %s", e)

        farm = farm_mod.Farm(moonraker, on_events=farm_events, local_port=port)
        farm_mod.serve(farm, args.api_port)

        def farm_loop():
            while True:
                try:
                    farm.poll(watcher_factory=Watcher)
                except Exception as e:
                    log.debug("farm: %s", e)
                time.sleep(3)
        threading.Thread(target=farm_loop, daemon=True).start()
        log.info("farm API on 127.0.0.1:%d", args.api_port)
    while True:
        try:
            if not published:
                moonraker.put("vapid", vapid.public)   # the page subscribes with it
                published = True
                log.info("ready, public key %s", vapid.public)
            events = watcher.console(moonraker.console())
            message = ""
            try:
                print_stats, webhooks = moonraker.printer()
                message = print_stats.get("message", "")
                events += watcher.klipper(webhooks)
            except Exception:     # Klipper restarting: the console still counts
                pass
            events += watcher.history(moonraker.newest_job(), message)
            if events:
                deliver(events, moonraker, vapid)
        except Exception as e:  # Moonraker restarting, network down: try again
            log.debug("waiting: %s", e)
            time.sleep(5)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
