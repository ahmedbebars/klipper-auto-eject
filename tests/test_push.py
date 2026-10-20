"""push/auto_eject_push.py: notifications to the installed web page."""

import json
import pathlib
import sys

import pytest

pytest.importorskip("cryptography")

from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature  # noqa: E402

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "push"))

import auto_eject_push as ap  # noqa: E402


def key_from(private_b64):
    value = int.from_bytes(ap.b64u_decode(private_b64), "big")
    return ec.derive_private_key(value, ec.SECP256R1())


# ------------------------------------------------------------ encryption
def test_encryption_matches_the_example_in_rfc_8291():
    body = ap.encrypt(
        ap.b64u_decode("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        "BTBZMqHH6r4Tts7J_aSIgg",
        sender=key_from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
        salt=ap.b64u_decode("DGv6ra1nlYgDCS1FRnbzlw"))
    assert ap.b64u(body) == (
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml"
        "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT"
        "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")


def test_vapid_token_is_signed_with_the_published_key(tmp_path):
    vapid = ap.Vapid(str(tmp_path / "keys" / "vapid.pem"))
    header = vapid.authorization("https://fcm.googleapis.com/fcm/send/abc", now=1000)
    token = header.split("t=")[1].split(",")[0]
    assert header.endswith("k=" + vapid.public)
    head, claims, sig = token.split(".")
    assert json.loads(ap.b64u_decode(claims)) == {"aud": "https://fcm.googleapis.com", "exp": 1000 + 12 * 3600,
                                                  "sub": ap.CONTACT}
    raw = ap.b64u_decode(sig)
    public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ap.b64u_decode(vapid.public))
    public.verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
                  ("%s.%s" % (head, claims)).encode(), ec.ECDSA(hashes.SHA256()))
    # the same key after a restart, kept where only this user can read it
    assert ap.Vapid(str(tmp_path / "keys" / "vapid.pem")).public == vapid.public
    if sys.platform != "win32":
        assert (tmp_path / "keys" / "vapid.pem").stat().st_mode & 0o077 == 0


# ------------------------------------------------------------- what to send
def test_console_lines_start_counting_from_now():
    w = ap.Watcher()
    assert w.console([{"time": 10, "message": "!! AUTO_EJECT: 'cube' is STILL ON THE BED"}]) == []
    events = w.console([{"time": 10, "message": "!! AUTO_EJECT: 'cube' is STILL ON THE BED"},
                        {"time": 11, "message": "// AUTO_EJECT: re-homing X and Y"},
                        {"time": 12, "message": "// AUTO_EJECT: the parts are only 0.5 mm tall, too thin to push."}], now=500)
    assert events == [("thin", "AUTO_EJECT: the parts are only 0.5 mm tall, too thin to push.")]
    assert w.problem_at == 500


def job(job_id, status, filename="cubes.gcode"):
    return {"job_id": job_id, "status": status, "filename": filename}


def test_finished_jobs_come_from_the_history():
    w = ap.Watcher()
    assert w.history(job("01", "completed")) == []                  # the last job before start
    assert w.history(job("02", "in_progress")) == []
    assert w.history(job("02", "in_progress")) == []
    assert w.history(job("02", "completed")) == [("complete", "cubes.gcode")]
    assert w.history(job("02", "completed")) == []
    # a short job that started and ended between two looks
    assert w.history(job("03", "cancelled")) == [("cancelled", "cubes.gcode")]
    assert w.history(job("04", "error"), "Move out of range", now=1000) == [("error", "cubes.gcode: Move out of range")]


def test_an_error_right_after_an_auto_eject_message_is_not_sent_twice():
    w = ap.Watcher()
    w.history(job("01", "in_progress"))
    w.console([])
    w.console([{"time": 5, "message": "!! AUTO_EJECT: 'cube' is STILL ON THE BED"}], now=1000)
    assert w.history(job("01", "error"), "AUTO_EJECT: 'cube' is STILL ON THE BED", now=1030) == []


def test_klipper_stopping():
    w = ap.Watcher()
    assert w.klipper({"state": "startup"}) == []
    assert w.klipper({"state": "ready"}) == []
    assert w.klipper({"state": "shutdown", "state_message": "MCU 'mcu' shutdown: Timer too close"}) == \
        [("shutdown", "MCU 'mcu' shutdown: Timer too close")]


# ------------------------------------------------------------------ delivery
class FakeMoonraker:
    def __init__(self, subs):
        self.subs = subs
        self.deleted = []

    def get(self, key):
        return self.subs

    def delete(self, key):
        self.deleted.append(key)


def test_delivery_per_device():
    subs = {"a1": {"endpoint": "https://push/a", "lang": "ar", "jobs": True, "url": "https://p/auto-eject/web/", "name": "Phone"},
            "b2": {"endpoint": "https://push/b", "lang": "en", "jobs": False, "name": "Laptop"},
            "c3": {"endpoint": "https://push/gone", "lang": "en", "name": "Old tablet"}}
    sent = []

    def sender(sub, message, vapid, urgency):
        sent.append((sub["name"], message, urgency))
        return 410 if sub["endpoint"].endswith("gone") else 201

    mr = FakeMoonraker(subs)
    ap.deliver([("complete", "cubes.gcode"), ("stuck", "cube is STILL ON THE BED")], mr, vapid=None, sender=sender)
    names = [(n, m["title"], u) for n, m, u in sent]
    assert names == [("Phone", "انتهت الطباعة", "normal"),                       # Laptop wants problems only
                     ("Old tablet", "Print finished", "normal"),
                     ("Phone", "قطعة ما زالت على السرير", "high"),
                     ("Laptop", "A part is still on the bed", "high")]
    assert sent[0][1]["url"] == "https://p/auto-eject/web/"
    assert mr.deleted == ["subs.c3"]                                         # gone: not tried again


def test_test_notification_text():
    m = ap.message_for("test", "AUTO_EJECT: test notification", {"lang": "en"})
    assert m["title"] == "Auto-eject" and m["body"] == "Notifications from your printer work."


def test_the_service_and_the_page_agree_on_what_notifies():
    from test_web import NODE, js
    if NODE is None:
        pytest.skip("Node.js is not installed")
    lines = ["!! AUTO_EJECT: 'cube' is STILL ON THE BED after 2 retries.",
             "!! AUTO_EJECT_GUARD: stencil still on the bed, 0.4 mm tall, too thin for the blade.",
             "// AUTO_EJECT: the parts are only 0.5 mm tall (min_part_height 2.0), too thin to push.",
             "// AUTO_EJECT: the print ended and 3 part(s) are still on the bed. Take them off.",
             "// AUTO_EJECT: bed verified clear (15 probe points)", "// AUTO_EJECT: re-homing X and Y"]
    for line in lines:
        page = (js("noticeFor", line) or {}).get("kind")
        service = (ap.notice_for(line) or (None,))[0]
        assert page == service, line
