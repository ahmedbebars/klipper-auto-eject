"""push/farm.py: every printer on the network in the auto-eject page."""

import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "push"))

import farm  # noqa: E402

AE = "gcode_macro _AUTO_EJECT_STATE"


def status(state="standby", ae=None, progress=0.0, duration=0.0, webhooks="ready", **extra):
    out = {
        "print_stats": {"state": state, "filename": "part.gcode", "print_duration": duration, "message": "",
                        "info": {"current_layer": 10, "total_layer": 100}},
        "virtual_sdcard": {"progress": progress},
        "heater_bed": {"temperature": 60.2, "target": 60.0},
        "extruder": {"temperature": 215.0, "target": 215.0},
        "webhooks": {"state": webhooks, "state_message": "MCU shutdown" if webhooks == "shutdown" else ""},
        "idle_timeout": {"state": "Ready"},
        # Moonraker answers null fields for a macro the printer does not have
        AE: ae if ae is not None else {"objects": None, "busy": None, "swept": None, "leftover": None, "height": None},
    }
    out.update(extra)
    return out


def tracker(objects=0, leftover=(), busy=False):
    return {"objects": [["p%d" % i, 10, 10, 20, 20] for i in range(objects)], "busy": busy, "swept": False,
            "leftover": list(leftover), "height": 12.0}


# ------------------------------------------------------------- the cards
def test_a_printer_without_auto_eject_is_not_offline():
    card = farm.summarize(status())
    assert card["phase"] == "idle" and card["auto_eject"] is False and card["parts"] == 0


def test_printing_shows_progress_and_time_left():
    card = farm.summarize(status("printing", progress=0.25, duration=600))
    assert card["phase"] == "printing"
    assert card["eta"] == 1800
    assert (card["layer"], card["layers"]) == (10, 100)


@pytest.mark.parametrize("state, reason", [("complete", "done"), ("cancelled", "cancelled")])
def test_a_finished_print_without_auto_eject_needs_someone(state, reason):
    card = farm.summarize(status(state))
    assert (card["phase"], card["reason"]) == ("needs", reason)


def test_a_finished_print_that_auto_eject_cleared_is_free():
    card = farm.summarize(status("complete", ae=tracker()))
    assert card["phase"] == "idle" and card["auto_eject"] is True


@pytest.mark.parametrize("st, ae, queue, phase, reason", [
    (status("complete", ae=tracker(3, leftover=["p1"])), None, None, "needs", "leftover"),
    (status("complete", ae=tracker(3)), None, None, "needs", "parts"),
    (status("complete", ae=tracker(3, busy=True), idle_timeout={"state": "Printing"}), None, None, "ejecting", ""),
    (status("complete", ae=tracker(3, busy=True)), None, None, "needs", "parts"),        # the flag outlived it
    (status("paused", ae=tracker()), None, None, "paused", "paused"),
    (status("printing", webhooks="shutdown"), None, None, "stopped", "shutdown"),
    (status("error"), None, None, "needs", "error"),
    (status("standby", ae=tracker()), None, {"queue_state": "paused", "queued_jobs": [{}, {}]}, "needs", "queue"),
    (status("standby", ae=tracker()), None, {"queue_state": "ready", "queued_jobs": [{}, {}]}, "idle", ""),
])
def test_what_needs_someone(st, ae, queue, phase, reason):
    card = farm.summarize(st, queue)
    assert (card["phase"], card["reason"]) == (phase, reason)


def test_a_stopped_printer_shows_why():
    assert farm.summarize(status(webhooks="shutdown"))["message"] == "MCU shutdown"


# ------------------------------------------------------------- the search
def test_search_skips_this_printer_and_names_tailscale_peers():
    answers = {
        "192.168.5.7": {"host": "192.168.5.7", "port": 7125, "name": "voron", "klippy": "ready"},
        "192.168.5.20": {"host": "192.168.5.20", "port": 80, "name": "192.168.5.20", "klippy": "ready"},
        "100.101.1.2": {"host": "100.101.1.2", "port": 7125, "name": "100.101.1.2", "klippy": "ready"},
        "192.168.5.1": {"host": "192.168.5.1", "port": 7125, "name": "me", "klippy": "ready"},
    }
    asked = []

    def prober(host):
        asked.append(host)
        return answers.get(host)

    found = farm.scan(skip={"192.168.5.1"}, networks=["192.168.5.0/24"], peers=[("100.101.1.2", "far-printer")],
                      prober=prober)
    assert [f["host"] for f in found] == ["100.101.1.2", "192.168.5.7", "192.168.5.20"]
    assert found[0]["name"] == "far-printer"
    assert "192.168.5.1" not in asked and len(asked) == 254


def test_one_printer_found_twice_is_listed_once():
    """Over the local network and over Tailscale: same network card, same port."""
    mac = ["48:8f:4c:16:d6:27"]
    answers = {
        "192.168.5.12": {"host": "192.168.5.12", "port": 7125, "name": "big", "klippy": "ready", "macs": mac},
        "100.79.1.35": {"host": "100.79.1.35", "port": 7125, "name": "big", "klippy": "ready", "macs": mac},
        # the same hostname on another machine is another printer
        "192.168.5.13": {"host": "192.168.5.13", "port": 7125, "name": "big", "klippy": "ready", "macs": ["aa:bb:cc:dd:ee:ff"]},
        # a second Klipper on the same computer is another printer too
        "192.168.5.14": {"host": "192.168.5.14", "port": 7126, "name": "two", "klippy": "ready", "macs": ["11:22:33:44:55:66"]},
        "100.79.1.36": {"host": "100.79.1.36", "port": 7125, "name": "one", "klippy": "ready", "macs": ["11:22:33:44:55:66"]},
        # already in the farm under its Tailscale address
        "192.168.5.20": {"host": "192.168.5.20", "port": 7125, "name": "old", "klippy": "ready", "macs": ["77:77:77:77:77:77"]},
    }
    found = farm.scan(networks=["192.168.5.0/24"], peers=[("100.79.1.35", "big"), ("100.79.1.36", "one")],
                      prober=answers.get, known=[(7125, ["77:77:77:77:77:77"])])
    assert [f["host"] for f in found] == ["100.79.1.36", "192.168.5.12", "192.168.5.13", "192.168.5.14"]


def test_the_same_machine_is_not_added_twice():
    f = farm.Farm(FakeMoonraker())
    mac = ["48:8f:4c:16:d6:27"]
    assert len(f.add([{"host": "192.168.1.12", "port": 7125, "name": "big", "macs": mac}])) == 1
    assert f.add([{"host": "100.79.1.35", "port": 7125, "name": "big", "macs": mac}]) == []
    assert len(f.add([{"host": "192.168.1.12", "port": 7126, "name": "big-2", "macs": mac}])) == 1
    saved = f.moonraker.db[(farm.NAMESPACE, "printers")]
    assert all(r["macs"] == mac for r in saved.values())
    assert all(p.macs == mac for p in farm.Farm(f.moonraker).printers.values())


def test_only_linux_tailscale_devices_are_asked(monkeypatch):
    status = {"Peer": {
        "a": {"Online": True, "OS": "linux", "HostName": "voron", "TailscaleIPs": ["100.64.0.5", "fd7a::5"]},
        "b": {"Online": True, "OS": "android", "HostName": "phone", "TailscaleIPs": ["100.64.0.6"]},
        "c": {"Online": False, "OS": "linux", "HostName": "off", "TailscaleIPs": ["100.64.0.7"]},
        "d": {"Online": True, "OS": "", "HostName": "se-sto-wg-001", "TailscaleIPs": ["100.64.0.8"],
              "Location": {"Country": "Sweden"}},
    }}

    class Done:
        stdout = json.dumps(status)
    monkeypatch.setattr(farm.subprocess, "run", lambda *a, **k: Done())
    assert farm.tailscale_peers() == [("100.64.0.5", "voron")]


def test_a_probe_wants_moonraker(monkeypatch):
    def fake(url, timeout=0):
        if url.startswith("http://10.0.0.5:7125/server/info"):
            return {"klippy_state": "ready"}
        if url.startswith("http://10.0.0.5:7125/printer/info"):
            return {"hostname": "ender"}
        if url.startswith("http://10.0.0.5:7125/machine/system_info"):
            return {"system_info": {"network": {"wlan0": {"mac_address": "48:8F:4C:16:D6:27"},
                                                "lo": {"mac_address": "00:00:00:00:00:00"}}}}
        if url.startswith("http://10.0.0.6:80/server/info"):
            return {"something": "else"}
        raise OSError("refused")
    monkeypatch.setattr(farm, "http_json", fake)
    assert farm.probe("10.0.0.5") == {"host": "10.0.0.5", "port": 7125, "name": "ender", "klippy": "ready",
                                      "macs": ["48:8f:4c:16:d6:27"]}
    assert farm.probe("10.0.0.6") is None
    assert farm.probe("10.0.0.7") is None


# ------------------------------------------------------------- the farm
class FakeMoonraker:
    def __init__(self, db=None, down=False):
        self.db = dict(db or {})
        self.down = down

    def get(self, key, namespace=None):
        if self.down:
            raise OSError("Moonraker is restarting")
        return self.db.get((namespace, key))

    def put(self, key, value, namespace=None):
        if self.down:
            raise OSError("Moonraker is restarting")
        self.db[(namespace, key)] = value


def prober(host, ports):
    if host == "192.168.1.30":
        return {"host": host, "port": ports[0], "name": "ender", "klippy": "ready"}
    return None


def test_adding_by_address_asks_the_printer_first():
    mr = FakeMoonraker()
    f = farm.Farm(mr)
    added = f.add([{"host": "192.168.1.30"}], prober=prober)
    assert len(added) == 1
    saved = mr.db[(farm.NAMESPACE, "printers")]
    assert list(saved.values()) == [{"host": "192.168.1.30", "port": 7125, "name": "ender"}]
    with pytest.raises(LookupError):
        f.add([{"host": "192.168.1.31"}], prober=prober)
    with pytest.raises(ValueError):
        f.add([{"host": "printer; rm -rf /"}], prober=prober)
    with pytest.raises(ValueError):
        f.add([{"host": "192.168.1.30:http"}], prober=prober)


def test_an_address_with_a_port():
    f = farm.Farm(FakeMoonraker())
    f.add([{"host": "192.168.1.30:7126"}], prober=prober)
    assert [(p.host, p.port) for p in f.printers.values()] == [("192.168.1.30", 7126)]


def test_scan_results_are_added_once_and_this_printer_never():
    f = farm.Farm(FakeMoonraker())
    entry = {"host": "192.168.1.40", "port": 7125, "name": "trident"}
    assert len(f.add([entry, dict(entry)])) == 1
    assert f.add([entry]) == []
    assert f.add([{"host": "127.0.0.1", "port": 7125, "name": "me"}]) == []


def test_the_printers_left_out_are_suggested_unticked_next_time(monkeypatch):
    mr = FakeMoonraker()
    f = farm.Farm(mr)
    mac = ["48:8f:4c:16:d6:27"]
    results = [{"host": "192.168.1.10", "port": 7125, "name": "office", "macs": ["aa:aa:aa:aa:aa:aa"]},
               {"host": "192.168.1.12", "port": 7125, "name": "big", "macs": mac},
               {"host": "192.168.1.30", "port": 7125, "name": "neighbour", "macs": []}]
    f.add([results[1]], skip=[results[0], results[2]])
    assert [s["host"] for s in mr.db[(farm.NAMESPACE, "skipped")]] == ["192.168.1.10", "192.168.1.30"]

    # the next search: the same machine, even at its Tailscale address, is marked
    monkeypatch.setattr(farm, "scan", lambda skip, known: [
        {"host": "100.70.1.10", "port": 7125, "name": "office", "macs": ["aa:aa:aa:aa:aa:aa"]},
        {"host": "192.168.1.30", "port": 7125, "name": "neighbour", "macs": []},
        {"host": "192.168.1.40", "port": 7125, "name": "new", "macs": []}])
    monkeypatch.setattr(farm, "machine_macs", lambda host, port, timeout=2.0: [])
    f._scan(set())
    assert [(r["name"], r["skipped"]) for r in f.scan_state["found"]] == [("office", True), ("neighbour", True), ("new", False)]

    # added after all: no longer left out, and a new Farm remembers the rest
    f.add([{"host": "192.168.1.30", "port": 7125, "name": "neighbour"}])
    assert [s["host"] for s in farm.Farm(mr).skipped] == ["192.168.1.10"]


def test_nothing_is_saved_before_moonraker_answers():
    mr = FakeMoonraker({(farm.NAMESPACE, "printers"): {"abc": {"host": "10.1.1.1", "port": 7125, "name": "old"}}}, down=True)
    f = farm.Farm(mr)
    assert f.printers == {}
    with pytest.raises(RuntimeError):
        f.add([{"host": "10.1.1.2", "port": 7125, "name": "new"}])
    mr.down = False
    f.add([{"host": "10.1.1.2", "port": 7125, "name": "new"}])
    names = sorted(r["name"] for r in mr.db[(farm.NAMESPACE, "printers")].values())
    assert names == ["new", "old"]      # the saved list was loaded first, not overwritten


def test_rename_and_remove():
    mr = FakeMoonraker()
    f = farm.Farm(mr)
    pid = f.add([{"host": "10.1.1.2", "port": 7125, "name": "new"}])[0]
    assert f.rename(pid, "  Ender 3 #2  ")
    assert mr.db[(farm.NAMESPACE, "printers")][pid]["name"] == "Ender 3 #2"
    assert f.rename("local", "Voron 1")
    assert mr.db[(farm.NAMESPACE, "local")] == {"name": "Voron 1"}
    assert farm.Farm(mr).local.name == "Voron 1"
    assert f.remove(pid) and mr.db[(farm.NAMESPACE, "printers")] == {}
    assert not f.remove(pid)
    assert not f.rename("nope", "x")


def test_a_group_for_each_printer():
    mr = FakeMoonraker()
    f = farm.Farm(mr)
    pid = f.add([{"host": "10.1.1.2", "port": 7125, "name": "v1"}])[0]
    assert f.set_group(pid, "  Rack   A  ")
    assert mr.db[(farm.NAMESPACE, "printers")][pid]["group"] == "Rack A"
    assert f.set_group("local", "Vorons")
    assert mr.db[(farm.NAMESPACE, "local")]["group"] == "Vorons"
    again = farm.Farm(mr)                                        # after a restart
    assert again.printers[pid].group == "Rack A" and again.local.group == "Vorons"
    assert again.printers[pid].public()["group"] == "Rack A"
    assert f.set_group(pid, "") and "group" not in mr.db[(farm.NAMESPACE, "printers")][pid]
    assert f.set_group(pid, "x" * 50) and len(f.printers[pid].group) == 30
    assert not f.set_group("nope", "A")


def test_bed_is_clear_depends_on_the_printer(monkeypatch):
    sent = []
    monkeypatch.setattr(farm, "http_json", lambda url, data=None, method=None, timeout=0: sent.append((url, data)) or "ok")
    f = farm.Farm(FakeMoonraker())
    pid = f.add([{"host": "10.1.1.2", "port": 7125, "name": "plain"}])[0]
    f.printers[pid].card = {"phase": "needs", "auto_eject": False}
    f.local.card = {"phase": "needs", "auto_eject": True}
    f.act(pid, "clear")
    f.act("local", "clear")
    f.act(pid, "continue")
    assert sent == [("http://10.1.1.2:7125/printer/gcode/script", {"script": "SDCARD_RESET_FILE"}),
                    ("http://127.0.0.1:7125/printer/gcode/script", {"script": "AUTO_EJECT_CLEAR"}),
                    ("http://10.1.1.2:7125/server/job_queue/start", None)]
    assert f.act(pid, "clear_plain") is None and f.act(pid, "home") is None and f.act("nope", "clear") is None


class FakeWatcher:
    def __init__(self):
        self.calls = 0

    def console(self, store):
        self.calls += 1
        return [("stuck", line["message"]) for line in store]

    def klipper(self, webhooks):
        return []

    def history(self, job, message=""):
        return []


def test_notifications_from_the_other_printers(monkeypatch):
    def fake(url, data=None, method=None, timeout=0):
        if "/printer/objects/query" in url:
            return {"status": status("printing", progress=0.5, duration=100)}
        if "/server/job_queue/status" in url:
            return {"queue_state": "ready", "queued_jobs": []}
        if "/server/gcode_store" in url:
            return {"gcode_store": [{"time": 1, "message": "AUTO_EJECT: a part is still on the bed"}]}
        if "/server/history/list" in url:
            return {"jobs": []}
        if "/printer/info" in url:
            return {"hostname": "hub"}
        raise OSError(url)
    monkeypatch.setattr(farm, "http_json", fake)
    monkeypatch.setattr(farm.Printer, "_page", lambda self: "http://%s/" % self.host)
    events = []
    f = farm.Farm(FakeMoonraker(), on_events=lambda name, ev: events.append((name, ev)))
    f.add([{"host": "10.1.1.2", "port": 7125, "name": "ender"}])
    f.poll(watcher_factory=FakeWatcher)
    assert events == [("ender", [("stuck", "AUTO_EJECT: a part is still on the bed")])]   # not this printer's
    view = f.view()
    assert [p["name"] for p in view["printers"]] == ["hub", "ender"]
    assert view["printers"][1]["phase"] == "printing" and view["printers"][1]["page"] == "http://10.1.1.2/"
    assert view["printers"][0]["local"] and view["printers"][0]["page"] is None


def test_an_offline_printer(monkeypatch):
    def down(*args, **kwargs):
        raise urllib.error.URLError("no route")
    monkeypatch.setattr(farm, "http_json", down)
    p = farm.Printer("10.9.9.9", 7125)
    assert p.poll()["phase"] == "offline"


def farm_of(hosts, answer):
    """A farm with printers at hosts; answer(host, url) gives Moonraker's reply or raises."""
    asked = []

    def fake(url, data=None, method=None, timeout=0):
        host = url.split("//", 1)[1].split(":", 1)[0]
        asked.append(host)
        return answer(host, url)
    farm.http_json = fake
    f = farm.Farm(FakeMoonraker())
    for h in hosts:
        f.printers[h] = farm.Printer(h, 7125, pid=h)
    return f, asked


def test_a_printer_that_does_not_answer_is_asked_less_often(monkeypatch):
    monkeypatch.setattr(farm, "http_json", farm.http_json)       # put back after the test
    away = {"10.0.0.9"}

    def answer(host, url):
        if host in away:
            raise urllib.error.URLError("timed out")
        if "/printer/objects/query" in url:
            return {"status": status()}
        return {}
    f, asked = farm_of(["10.0.0.2", "10.0.0.9"], answer)
    f.poll(now=1000)
    assert asked.count("10.0.0.9") == 1                            # once: no power devices asked for
    assert f.printers["10.0.0.9"].card["phase"] == "offline"
    asked.clear()
    f.poll(now=1003)
    assert "10.0.0.9" not in asked and "10.0.0.2" in asked        # the others go on every round
    f.poll(now=1010)
    assert "10.0.0.9" in asked                                     # tried again after 10 s
    asked.clear()
    f.poll(now=1025)
    assert "10.0.0.9" not in asked                                 # then 20 s: not before 1030
    f.poll(now=1030)
    assert "10.0.0.9" in asked
    away.clear()                                                   # switched on again
    f.poll(now=1060)
    asked.clear()
    f.poll(now=1063)
    assert "10.0.0.9" in asked and f.printers["10.0.0.9"].card["phase"] != "offline"


def test_a_printer_whose_klipper_is_stopped_is_asked_every_round(monkeypatch):
    monkeypatch.setattr(farm, "http_json", farm.http_json)

    def answer(host, url):
        if "/printer/objects/query" in url:
            raise urllib.error.HTTPError(url, 503, "Klippy Host not connected", {}, None)
        if "/machine/device_power/devices" in url:
            return {"devices": []}
        return {}
    f, asked = farm_of(["10.0.0.3"], answer)
    f.poll(now=1000)
    asked.clear()
    f.poll(now=1003)
    assert "10.0.0.3" in asked and f.printers["10.0.0.3"].down == 0


# ------------------------------------------------------------- the API
@pytest.fixture
def api(monkeypatch):
    monkeypatch.setattr(farm, "http_json", lambda url, data=None, method=None, timeout=0: "ok")
    f = farm.Farm(FakeMoonraker())
    f.add([{"host": "10.1.1.2", "port": 7125, "name": "ender"}])
    server = farm.serve(f, 0)
    yield f, "http://127.0.0.1:%d" % server.server_address[1]
    server.shutdown()


def call(url, body=None, ip=None):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", **({"X-Real-IP": ip} if ip else {})})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def test_api_farm_view(api):
    f, base = api
    code, body = call(base + "/farm")
    assert code == 200 and [p["name"] for p in body["printers"]][1:] == ["ender"]
    assert body["scan"]["running"] is False


def test_api_rejects_other_networks(api):
    f, base = api
    assert call(base + "/farm", ip="8.8.8.8")[0] == 403
    assert call(base + "/farm", ip="100.100.5.5")[0] == 200     # Tailscale
    assert call(base + "/farm", ip="192.168.1.9")[0] == 200


def test_api_add_rename_remove_act(api, monkeypatch):
    f, base = api
    monkeypatch.setattr(farm, "probe", lambda host, ports=farm.PORTS, timeout=0: None)
    code, body = call(base + "/farm/printers", {"add": [{"host": "10.1.1.3"}]})
    assert code == 400 and "no printer answers" in body["error"]
    pid = next(iter(f.printers))
    assert call(base + "/farm/printers", {"rename": pid, "name": "E3"}) == (200, {"renamed": True})
    assert call(base + "/farm/%s/estop" % pid, {}) == (200, {"result": "ok"})
    assert call(base + "/farm/%s/reboot" % pid, {})[0] == 404
    assert call(base + "/farm/printers", {"remove": pid}) == (200, {"removed": True})
    assert call(base + "/farm/nothing")[0] == 404


def test_api_snapshot_without_a_camera(api):
    f, base = api
    assert call(base + "/farm/local/snapshot")[0] == 404


# ------------------------------------------------------------- statistics
def test_history_stats_count_recent_and_today():
    import time as _time
    now = _time.mktime((2026, 10, 20, 15, 0, 0, 0, 0, -1))
    today, yesterday = now - 3600, now - 20 * 3600
    jobs = [
        {"status": "in_progress", "start_time": now - 60},       # still printing: not counted
        {"status": "completed", "end_time": today},
        {"status": "cancelled", "end_time": today + 60},
        {"status": "completed", "end_time": yesterday},
        {"status": "error", "end_time": yesterday},
        {"status": "klippy_shutdown", "start_time": yesterday},  # no end time: the start counts
    ]
    s = farm.history_stats({"total_print_time": 12 * 3600 + 1800, "total_jobs": 231.0}, jobs, now)
    assert s == {"hours": 12.5, "jobs": 231, "recent": 5, "recent_ok": 2, "today_ok": 1, "today_bad": 1}
    assert farm.history_stats(None, None, now) == {"hours": 0.0, "jobs": 0, "recent": 0, "recent_ok": 0, "today_ok": 0, "today_bad": 0}


def test_a_card_carries_its_statistics(monkeypatch):
    def fake(url, data=None, method=None, timeout=0):
        if "/printer/objects/query" in url:
            return {"status": status()}
        if "/server/history/totals" in url:
            return {"job_totals": {"total_print_time": 7200, "total_jobs": 3}}
        if "/server/history/list" in url:
            return {"jobs": [{"status": "completed", "end_time": 1}]}
        raise OSError(url)
    monkeypatch.setattr(farm, "http_json", fake)
    monkeypatch.setattr(farm.Printer, "_page", lambda self: "http://%s/" % self.host)
    monkeypatch.setattr(farm, "machine_macs", lambda host, port, timeout=2.0: [])
    p = farm.Printer("10.1.1.2", 7125)
    p.poll()
    assert p.public()["stats"]["hours"] == 2.0 and p.public()["stats"]["recent_ok"] == 1


# ------------------------------------------------------------- the parts box
def test_the_box_capacity_comes_from_where_the_macros_take_it():
    st = status("standby", ae=dict(tracker(), bin=12))
    st["gcode_macro _AUTO_EJECT_DEFAULTS"] = {"bin_capacity": 0}
    assert farm.bin_capacity(st) == 0
    st["gcode_macro _AUTO_EJECT_SETTINGS"] = {"bin_capacity": 40}
    assert farm.bin_capacity(st) == 40
    st["gcode_macro _AUTO_EJECT_OVERRIDES"] = {"data": {"bin_capacity": 12}}
    assert farm.bin_capacity(st) == 12
    card = farm.summarize(st)
    assert (card["phase"], card["reason"], card["bin"], card["bin_cap"]) == ("needs", "bin", 12, 12)
    # an older settings file without it, and a printer without auto-eject
    assert farm.bin_capacity(status()) == 0
    assert farm.summarize(status())["bin_cap"] == 0


# ------------------------------------------------------------------ power
def powered(card, devices, http=None):
    p = farm.Printer("10.1.1.2", 7125)
    p.card = dict(card)
    p.power = [dict(d) for d in devices]
    return p


PSU = [{"device": "printer", "status": "on", "locked": False}]


def test_power_off_never_while_busy_or_hot(monkeypatch):
    sent = []
    monkeypatch.setattr(farm, "http_json", lambda url, data=None, method=None, timeout=0: sent.append(data) or {"printer": data["action"]})
    with pytest.raises(PermissionError, match="busy"):
        powered({"phase": "printing", "nozzle": 30}, PSU).set_power("printer", "off")
    with pytest.raises(PermissionError, match="hot"):
        powered({"phase": "idle", "nozzle": 120}, PSU).set_power("printer", "off")
    with pytest.raises(LookupError):
        powered({"phase": "idle", "nozzle": 30}, PSU).set_power("lights", "off")
    p = powered({"phase": "idle", "nozzle": 30}, PSU)
    p.set_power("printer", "off")
    assert sent == [{"device": "printer", "action": "off"}] and p.power[0]["status"] == "off"
    p.set_power("printer", "on")                                     # on is always allowed
    assert p.power[0]["status"] == "on"


def test_a_switched_off_printer_shows_off(monkeypatch):
    def fake(url, data=None, method=None, timeout=0):
        if "/printer/objects/query" in url:
            return {"status": status(webhooks="error")}           # the board does not answer
        if "/machine/device_power/devices" in url:
            return {"devices": [{"device": "printer", "status": "off", "locked_while_printing": True, "type": "tasmota"}]}
        raise OSError(url)
    monkeypatch.setattr(farm, "http_json", fake)
    p = farm.Printer("10.1.1.2", 7125)
    assert p.poll()["phase"] == "off"
    assert p.public()["power"] == [{"device": "printer", "status": "off", "locked": True}]


def test_auto_off_after_the_chosen_minutes_with_nothing_to_do(monkeypatch):
    sent = []
    monkeypatch.setattr(farm, "http_json", lambda url, data=None, method=None, timeout=0: sent.append(data) or {"printer": "off"})
    f = farm.Farm(FakeMoonraker())
    p = powered({"phase": "idle", "nozzle": 35, "jobs": 0}, PSU)
    p.auto_off = 30
    assert not f.auto_off(p, 1000)                                   # starts counting
    assert not f.auto_off(p, 1000 + 29 * 60)
    p.card["jobs"] = 2                                               # a job was queued: start again
    assert not f.auto_off(p, 1000 + 31 * 60)
    p.card["jobs"] = 0
    assert not f.auto_off(p, 5000)
    p.card["nozzle"] = 80                                            # hot again
    assert not f.auto_off(p, 5000 + 40 * 60)
    p.card["nozzle"] = 30
    assert not f.auto_off(p, 9000)
    assert f.auto_off(p, 9000 + 30 * 60)
    assert sent == [{"device": "printer", "action": "off"}]
    q = powered({"phase": "printing", "nozzle": 215, "jobs": 0}, PSU)
    q.auto_off = 1
    assert not f.auto_off(q, 0) and not f.auto_off(q, 10 ** 6)


def test_auto_off_is_kept(monkeypatch):
    mr = FakeMoonraker()
    f = farm.Farm(mr)
    pid = f.add([{"host": "10.1.1.2", "port": 7125, "name": "ender"}])[0]
    assert f.set_auto_off(pid, 45, "printer")
    assert f.set_auto_off("local", 20)
    g = farm.Farm(mr)
    assert (g.printers[pid].auto_off, g.printers[pid].auto_off_device) == (45, "printer")
    assert g.local.auto_off == 20
    assert not f.set_auto_off("nope", 5)


def test_open_through_tailscale_when_away():
    f = farm.Farm(FakeMoonraker())
    big = farm.Printer("192.168.1.12", 7125, "big", macs=["48:8f:4c:16:d6:27"])
    other = farm.Printer("192.168.1.30", 7125, "mk3d", macs=["aa:aa:aa:aa:aa:aa"])
    big.page = "http://192.168.1.12/"
    macs = {"100.70.1.12": ["48:8f:4c:16:d6:27"], "100.70.0.9": ["bb:bb:bb:bb:bb:bb"]}
    f.link_tailscale([f.local, big, other], peers=[("100.70.1.12", "printer-2"), ("100.70.0.9", "nas")],
                     macs_of=lambda ip, port: macs.get(ip, []))
    assert big.ts_host == "100.70.1.12" and other.ts_host is None
    assert big.public()["page_remote"] == "http://100.70.1.12/"
    assert other.public()["page_remote"] is None
    assert f.local.public()["page_remote"] is None


# --------------------------------------------------- printing from the farm
class FakeMoonrakerHTTP:
    """A Moonraker that takes uploads, as a real HTTP server."""

    def __init__(self):
        import http.server
        import threading
        got = self.got = []

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                got.append((self.path, self.headers["Content-Type"], body))
                # as Moonraker answers an upload: not inside {"result": ...}
                out = json.dumps({"item": {"path": "x.gcode", "root": "gcodes"}, "action": "create_file",
                                  "print_started": b'name="print"' in body, "print_queued": False}).encode()
                self.send_response(201)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.port = self.server.server_address[1]


def test_a_file_reaches_the_printer_as_moonraker_expects():
    import io
    mr = FakeMoonrakerHTTP()
    try:
        data = b"G28\nG1 X10\n" * 50000                            # about 550 kB
        result = farm.upload_file("http://127.0.0.1:%d" % mr.port, "part (2).gcode", io.BytesIO(data), len(data), start=True)
        path, ctype, body = mr.got[0]
        boundary = ctype.split("boundary=")[1].encode()
        assert path == "/server/files/upload" and result["print_started"]
        assert body.count(b"--" + boundary) == 4                     # print, root, file, and the end
        assert b'name="root"\r\n\r\ngcodes\r\n' in body
        assert b'name="file"; filename="part (2).gcode"' in body
        start = body.index(b"\r\n\r\n", body.index(b'filename="part (2).gcode"')) + 4
        end = body.index(b"\r\n--" + boundary + b"--")
        assert body[start:end] == data
    finally:
        mr.server.shutdown()


def test_printing_only_on_a_free_printer(monkeypatch):
    sent = []
    monkeypatch.setattr(farm, "http_json", lambda url, data=None, method=None, timeout=0: sent.append((url, data)) or "ok")
    f = farm.Farm(FakeMoonraker())
    pid = f.add([{"host": "10.1.1.2", "port": 7125, "name": "ender"}])[0]
    p = f.printers[pid]
    for phase, reason in (("printing", ""), ("paused", "paused"), ("ejecting", ""), ("offline", ""), ("off", ""),
                          ("needs", "leftover"), ("needs", "bin")):
        p.card = {"phase": phase, "reason": reason}
        with pytest.raises(PermissionError):
            f.print_file(pid, "a.gcode")
    assert sent == []
    p.card = {"phase": "idle", "reason": ""}
    f.print_file(pid, "a.gcode")
    assert sent == [("http://10.1.1.2:7125/printer/print/start", {"filename": "a.gcode"})]
    assert f.print_file("nope", "a.gcode") is None


def test_api_files_print_pause_upload(monkeypatch, tmp_path):
    import io
    calls = []

    def fake(url, data=None, method=None, timeout=0):
        calls.append(url)
        if url.endswith("/server/files/list?root=gcodes"):
            return [{"path": "old.gcode", "size": 10, "modified": 1}, {"path": "new.gcode", "size": 20, "modified": 9},
                    {"path": "notes.txt", "size": 1, "modified": 5}]
        return "ok"
    monkeypatch.setattr(farm, "http_json", fake)
    uploaded = []
    monkeypatch.setattr(farm, "upload_file", lambda base, name, fobj, size, start=False: uploaded.append((base, name, (fobj.seek(0), fobj.read())[1], size, start)) or {"ok": 1})
    monkeypatch.setattr(farm, "UPLOADS", str(tmp_path))
    f = farm.Farm(FakeMoonraker())
    pid = f.add([{"host": "10.1.1.2", "port": 7125, "name": "ender"}])[0]
    f.printers[pid].card = {"phase": "idle", "reason": ""}
    server = farm.serve(f, 0)
    base = "http://127.0.0.1:%d" % server.server_address[1]
    try:
        code, body = call(base + "/farm/%s/files" % pid)
        assert code == 200 and [x["path"] for x in body["files"]] == ["new.gcode", "old.gcode"]
        assert call(base + "/farm/%s/print" % pid, {"filename": "new.gcode"})[0] == 200
        f.printers[pid].card = {"phase": "printing", "reason": ""}
        assert call(base + "/farm/%s/print" % pid, {"filename": "new.gcode"})[0] == 409
        assert call(base + "/farm/%s/pause" % pid, {}) == (200, {"result": "ok"})
        assert calls[-1] == "http://10.1.1.2:7125/printer/print/pause"
        # a file streamed as the request body
        req = urllib.request.Request(base + "/farm/%s/upload?name=part.gcode&print=0" % pid, data=b"G28\n" * 1000, method="POST")
        with urllib.request.urlopen(req, timeout=5) as r:
            assert r.status == 200
        assert uploaded == [("http://10.1.1.2:7125", "part.gcode", b"G28\n" * 1000, 4000, False)]
        bad = urllib.request.Request(base + "/farm/%s/upload?name=x.sh" % pid, data=b"rm", method="POST")
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(bad, timeout=5)
        assert e.value.code == 409
        assert list(tmp_path.iterdir()) == []                        # nothing left on the card
    finally:
        server.shutdown()


# --------------------------------------------------- pictures of the prints
THUMBS = [{"width": 300, "height": 300, "size": 9000, "relative_path": ".thumbs/part-300x300.png"},
          {"width": 32, "height": 32, "size": 900, "relative_path": ".thumbs/part-32x32.png"},
          {"width": 0, "relative_path": ".thumbs/broken.png"}, {"width": 64}]


def test_the_picture_that_fits_and_where_it_is():
    assert farm.pick_thumb(THUMBS, 96)["width"] == 300
    assert farm.pick_thumb(THUMBS, 24)["width"] == 32
    assert farm.pick_thumb(THUMBS, 600)["width"] == 300               # the largest there is
    assert farm.pick_thumb([], 96) is None and farm.pick_thumb(None, 96) is None
    assert farm.thumb_path("part.gcode", THUMBS[0]) == "/server/files/gcodes/.thumbs/part-300x300.png"
    # next to the file, in its folder
    assert farm.thumb_path("jobs/my part.gcode", {"relative_path": ".thumbs/my part-32x32.png"}) == \
        "/server/files/gcodes/jobs/.thumbs/my%20part-32x32.png"
    assert farm.thumb_path("part.gcode", {"relative_path": "../../moonraker.conf"}) == ""
    assert farm.thumb_path("part.gcode", None) == ""


class FakeMoonrakerFiles:
    """A Moonraker with one sliced file and its pictures, as a real HTTP server."""
    PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64

    def __init__(self):
        import http.server
        import threading
        hits = self.hits = []
        png = self.PNG

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                hits.append(self.path)
                if self.path == "/server/files/metadata?filename=jobs/part.gcode":
                    out, ctype = json.dumps({"result": {"filename": "jobs/part.gcode", "modified": 1700000000.5, "size": 123456,
                                                        "estimated_time": 4321, "filament_weight_total": 12.5, "object_height": 15.5,
                                                        "slicer": "OrcaSlicer", "gcode_start_byte": 9000, "thumbnails": THUMBS}}).encode(), "application/json"
                elif self.path == "/server/files/gcodes/jobs/.thumbs/part-300x300.png":
                    out, ctype = png, "image/png"
                else:
                    out, ctype = json.dumps({"error": {"code": 404, "message": "not found"}}).encode(), "application/json"
                    self.send_response(404)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Content-Length", str(len(out)))
                    self.end_headers()
                    self.wfile.write(out)
                    return
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.port = self.server.server_address[1]


def test_a_files_facts_and_picture_through_the_farm():
    mr = FakeMoonrakerFiles()
    f = farm.Farm(FakeMoonraker(), local_port=mr.port)
    server = farm.serve(f, 0)
    base = "http://127.0.0.1:%d/farm/local" % server.server_address[1]
    try:
        code, body = call(base + "/meta?file=jobs%2Fpart.gcode")
        assert code == 200
        assert body["meta"] == {"estimated_time": 4321, "filament_weight_total": 12.5, "object_height": 15.5, "slicer": "OrcaSlicer",
                                "modified": 1700000000.5, "size": 123456, "thumbs": 3}
        with urllib.request.urlopen(base + "/thumb?file=jobs%2Fpart.gcode&w=96", timeout=5) as r:
            assert r.status == 200 and r.headers["Content-Type"] == "image/png" and r.read() == mr.PNG
            assert "max-age" in r.headers["Cache-Control"] and r.headers["X-Content-Type-Options"] == "nosniff"
        with urllib.request.urlopen(base + "/thumb?file=jobs%2Fpart.gcode&w=96", timeout=5) as r:
            r.read()
        # the metadata asked once in a minute, the picture once
        assert mr.hits.count("/server/files/metadata?filename=jobs/part.gcode") == 1
        assert mr.hits.count("/server/files/gcodes/jobs/.thumbs/part-300x300.png") == 1
        # a small one: the 32 px picture is not on this Moonraker
        assert call(base + "/thumb?file=jobs%2Fpart.gcode&w=20")[0] == 404
        assert call(base + "/meta?file=other.gcode")[0] == 404
        assert call(base + "/thumb?file=jobs%2Fpart.gcode&w=big")[0] == 400
        assert call(base + "/meta")[0] == 400
        assert call(base.replace("/local", "/nobody") + "/meta?file=a.gcode")[0] == 404
    finally:
        server.shutdown()
        mr.server.shutdown()


# ------------------------------------------- maintenance and the daily report
def test_a_maintenance_reminder_comes_once_and_restarts_when_done():
    mr = FakeMoonraker()
    f = farm.Farm(mr)
    pid = f.add([{"host": "10.1.1.2", "port": 7125, "name": "ender"}])[0]
    p = f.printers[pid]
    p.stats = {"hours": 1000.0}
    assert f.set_service(pid, every=200)                             # counts from now
    assert p.service_since() == 0.0 and f.service_check(p) is None
    p.stats = {"hours": 1199.0}
    assert f.service_check(p) is None
    p.stats = {"hours": 1201.5}
    kind, text = f.service_check(p)
    assert kind == "service" and text.startswith("202 hours of printing since the last maintenance")
    assert f.service_check(p) is None                                # said once
    assert p.public()["service_since"] == 201.5
    f.set_service(pid, done=True)
    assert p.service_since() == 0.0
    g = farm.Farm(mr)                                                # kept
    assert (g.printers[pid].service_every, g.printers[pid].service_at) == (200, 1201.5)
    f.set_service(pid, every=0)
    assert p.service_since() is None and p.public()["service_every"] == 0


def test_the_daily_report_once_a_day_at_its_time():
    import time as _time
    mr = FakeMoonraker()
    f = farm.Farm(mr)
    pid = f.add([{"host": "10.1.1.2", "port": 7125, "name": "ender"}])[0]
    f.printers[pid].card = {"phase": "needs", "reason": "done"}
    f.printers[pid].stats = {"hours": 300.4, "today_ok": 4, "today_bad": 1}
    f.local.card = {"phase": "printing"}
    f.local.stats = {"hours": 100.0, "today_ok": 2, "today_bad": 0}
    with pytest.raises(ValueError):
        f.set_report("25:00")
    assert f.report_due(_time.time()) is None                       # no report chosen
    f.set_report("20:00")
    morning = _time.mktime((2026, 10, 20, 9, 0, 0, 0, 0, -1))
    evening = _time.mktime((2026, 10, 20, 20, 0, 30, 0, 0, -1))
    assert f.report_due(morning) is None
    text = f.report_due(evening)
    assert text == "Today 6 ended well, 1 stopped. Now 1 printing, 1 need you (ender). 400 h printed in all."
    assert f.report_due(evening + 600) is None                       # once a day
    assert farm.Farm(mr).report_due(evening + 900) is None          # also after a restart
    assert f.report_due(evening + 86400) is not None                 # the next day
    assert f.view()["settings"] == {"report": "20:00"}


def test_api_maintenance_and_report(api):
    f, base = api
    pid = next(iter(f.printers))
    assert call(base + "/farm/printers", {"id": pid, "service_every": 500}) == (200, {"saved": True})
    assert f.printers[pid].service_every == 500
    assert call(base + "/farm/printers", {"id": pid, "service_done": True}) == (200, {"saved": True})
    assert call(base + "/farm/settings", {"report": "21:30"}) == (200, {"saved": True})
    assert call(base + "/farm/settings", {"report": "9pm"})[0] == 400
    assert call(base + "/farm")[1]["settings"] == {"report": "21:30"}


# ------------------------------------------------------- updating the farm
VERSION_INFO = {"system": {"package_count": 3},
                "klipper": {"configured_type": "git_repo", "version": "v0.13.0-809", "remote_version": "v0.13.0-816",
                            "commits_behind": [{"sha": "a"}] * 7},
                "klipper-auto-eject": {"configured_type": "git_repo", "version": "v0.15.0-1", "remote_version": "v0.15.0-4",
                                       "commits_behind_count": 3, "commits_behind": []},
                "mainsail": {"configured_type": "web", "version": "v2.19.0", "remote_version": "v2.20.0"}}


def updater(monkeypatch, state="standby", idle="Idle"):
    """A printer whose Moonraker answers updates; every request is recorded."""
    sent = []

    def fake(url, data=None, method=None, timeout=0):
        sent.append((url.split(":7125", 1)[1], data))
        if "/machine/update/status" in url:
            return {"version_info": VERSION_INFO}
        if "print_stats=state&idle_timeout=state" in url:
            return {"status": {"print_stats": {"state": state}, "idle_timeout": {"state": idle}}}
        if "/printer/info" in url:
            return {"software_version": "v0.13.0-809-gc63b2951"}
        if "/printer/objects/list" in url:
            return {"objects": ["mcu", "mcu toolhead", "extruder"]}
        if "mcu=mcu_version" in url:
            return {"status": {"mcu": {"mcu_version": "v0.13.0-800-g9cb99754"}, "mcu toolhead": {"mcu_version": "v0.13.0-809-gc63b2951"}}}
        return "ok"
    monkeypatch.setattr(farm, "http_json", fake)
    monkeypatch.setattr(farm.threading, "Thread", lambda target, args, daemon: type("T", (), {"start": lambda self: target(*args)})())
    f = farm.Farm(FakeMoonraker())
    p = farm.Printer("10.1.1.2", 7125, pid="v1")
    f.printers["v1"] = p
    p.card = {"phase": "idle"}
    p.updates, p.firmware = p._updates(), p._firmware()
    sent.clear()
    return f, p, sent


def test_what_each_printer_runs(monkeypatch):
    f, p, sent = updater(monkeypatch)
    assert p.updates == {"klipper": {"version": "v0.13.0-809", "remote": "v0.13.0-816", "behind": 7, "type": "git_repo"},
                         "klipper-auto-eject": {"version": "v0.15.0-1", "remote": "v0.15.0-4", "behind": 3, "type": "git_repo"},
                         "mainsail": {"version": "v2.19.0", "remote": "v2.20.0", "behind": 0, "type": "web"}}
    assert p.firmware == {"klipper": "v0.13.0-809-gc63b2951",
                          "boards": [["mcu", "v0.13.0-800-g9cb99754"], ["mcu toolhead", "v0.13.0-809-gc63b2951"]]}
    assert p.public()["updates"] and p.public()["firmware"] and p.public()["job"] is None


def test_an_update_checks_again_then_restarts_klipper_for_the_macros(monkeypatch):
    f, p, sent = updater(monkeypatch)
    assert f.update("v1", "klipper-auto-eject")
    paths = [s[0] for s in sent]
    assert paths[0].startswith("/printer/objects/query?print_stats")             # idle, checked right before
    assert ("/machine/update/upgrade", {"name": "klipper-auto-eject"}) in sent
    assert paths[-1] == "/printer/firmware_restart"                             # the new macros
    assert p.job["state"] == "done" and p.updates_at == 0.0                     # versions read again soon
    sent.clear()
    assert f.update("v1", "mainsail")
    assert ("/machine/update/upgrade", {"name": "mainsail"}) in sent and "/printer/firmware_restart" not in [s[0] for s in sent]


def test_no_update_while_it_works(monkeypatch):
    f, p, sent = updater(monkeypatch, state="printing", idle="Printing")
    p.card = {"phase": "printing"}
    with pytest.raises(PermissionError):
        f.update("v1", "klipper")
    assert sent == []
    p.card = {"phase": "idle"}                       # the card says idle, but it has just started a print
    f.update("v1", "klipper")
    assert p.job["state"] == "failed" and "busy" in p.job["error"]
    assert not [s for s in sent if s[0] == "/machine/update/upgrade"]
    with pytest.raises(LookupError):
        f.update("v1", "nothing-such")
    assert f.update("nope", "klipper") is None


def test_this_printer_restarts_klipper_once_the_service_is_back(monkeypatch, tmp_path):
    f, p, sent = updater(monkeypatch)
    flag = tmp_path / "restart-klipper"
    monkeypatch.setattr(farm, "RESTART_FLAG", str(flag))
    assert not f.restart_after_own_update(now=1000)                             # nothing pending
    flag.write_text("990")
    assert f.restart_after_own_update(now=1000)
    assert sent[-1][0] == "/printer/firmware_restart" and not flag.exists()
    sent.clear()
    flag.write_text("10")                                                       # an old one: dropped, no restart
    assert f.restart_after_own_update(now=5000) and not flag.exists()
    assert "/printer/firmware_restart" not in [s[0] for s in sent]


def test_everything_at_once_in_a_safe_order(monkeypatch):
    f, p, sent = updater(monkeypatch)
    assert f.update("v1", ["klipper-auto-eject", "klipper", "mainsail"])
    upgraded = [d["name"] for path, d in sent if path == "/machine/update/upgrade"]
    assert upgraded == ["mainsail", "klipper", "klipper-auto-eject"]           # auto-eject last
    assert sent[-1][0] == "/printer/firmware_restart"
    assert p.job["done"] == upgraded and p.job["state"] == "done"
    with pytest.raises(LookupError):
        f.update("v1", [])


def test_an_eject_stopped_by_an_error_is_not_ejecting_forever():
    running = farm.summarize(status("printing", ae=tracker(objects=1, busy=True), idle_timeout={"state": "Printing"}))
    assert running["phase"] == "ejecting"                       # in the print's end G-code
    by_hand = farm.summarize(status("standby", ae=tracker(objects=1, busy=True), idle_timeout={"state": "Printing"}))
    assert by_hand["phase"] == "ejecting"                       # run from the console
    stopped = farm.summarize(status("error", ae=tracker(objects=1, busy=True), idle_timeout={"state": "Ready"}))
    assert (stopped["phase"], stopped["reason"]) == ("needs", "error")   # the flag outlived the eject


def test_a_printer_cooling_with_klipper_free_takes_push_now():
    ae = dict(tracker(objects=2, busy=True), bg=True, cooling=True)
    card = farm.summarize(status("complete", ae=ae, idle_timeout={"state": "Ready"}))
    assert (card["phase"], card["reason"]) == ("ejecting", "cooling")
    ae = dict(tracker(objects=2, busy=True), bg=True, cooling=False)       # pushing now
    assert farm.summarize(status("complete", ae=ae))["phase"] == "ejecting"


def test_the_spool_on_each_printer(monkeypatch):
    def fake(url, data=None, method=None, timeout=0):
        if url.endswith("/server/spoolman/status"):
            return {"spoolman_connected": True, "spool_id": 7, "pending_reports": []}
        if url.endswith("/server/spoolman/proxy"):
            assert data == {"request_method": "GET", "path": "/v1/spool/7", "use_v2_response": True}
            return {"response": {"id": 7, "remaining_weight": 231.6, "initial_weight": 1000,
                                 "filament": {"name": "PLA Orange", "material": "PLA", "color_hex": "F07F1E", "vendor": {"name": "Generic"}}}}
        raise OSError(url)
    monkeypatch.setattr(farm, "http_json", fake)
    p = farm.Printer("10.1.1.2", 7125)
    assert p._spool() == {"id": 7, "name": "Generic PLA Orange", "material": "PLA", "colour": "#F07F1E", "left": 232, "full": 1000}


def test_no_spool_without_spoolman(monkeypatch):
    def fake(url, data=None, method=None, timeout=0):
        if url.endswith("/server/spoolman/status"):
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        raise OSError(url)
    monkeypatch.setattr(farm, "http_json", fake)
    assert farm.Printer("10.1.1.2", 7125)._spool() is None

    def none_chosen(url, data=None, method=None, timeout=0):
        return {"spoolman_connected": True, "spool_id": None}
    monkeypatch.setattr(farm, "http_json", none_chosen)
    assert farm.Printer("10.1.1.2", 7125)._spool() is None


def test_what_a_printer_made():
    jobs = [
        {"status": "completed", "end_time": 1000, "print_duration": 3600, "filament_used": 1000.0, "filename": "sub/clips.gcode",
         "metadata": {"filament_total": 1000.0, "filament_weight_total": 12.0}},
        {"status": "completed", "end_time": 2000, "print_duration": 1800, "filament_used": 500.0, "filename": "clips.gcode", "metadata": {}},
        {"status": "cancelled", "end_time": 3000, "print_duration": 900, "filament_used": 400.0, "filename": "vase.gcode",
         "metadata": {"filament_total": 800.0, "filament_weight_total": 10.0}},     # half of the file: 5 g
        {"status": "in_progress", "start_time": 3500, "filament_used": 50.0},
        {"status": "completed", "end_time": 10, "print_duration": 99999, "filament_used": 9999.0},      # before the period
    ]
    r = farm.production(jobs, since=500)
    assert (r["jobs"], r["ok"], r["stopped"], r["rate"]) == (3, 2, 1, 67)
    assert r["hours"] == 1.8
    assert r["grams"] == round(12.0 + 500.0 * farm.GRAMS_PER_MM + 5.0)
    assert r["top"] == [["clips.gcode", 2]]
    assert farm.production([], since=0)["rate"] is None


def test_the_farm_production_report(monkeypatch):
    def fake(url, data=None, method=None, timeout=0):
        if "/server/history/list" in url:
            assert "since=" in url
            if "10.0.0.9" in url:
                raise OSError("no route")
            return {"jobs": [{"status": "completed", "end_time": time.time(), "print_duration": 7200, "filament_used": 0.0}]}
        raise OSError(url)
    monkeypatch.setattr(farm, "http_json", fake)
    f = farm.Farm(FakeMoonraker())
    f.add([{"host": "10.0.0.2", "port": 7125, "name": "a"}, {"host": "10.0.0.9", "port": 7125, "name": "away"}])
    rep = f.report("7")
    rows = {r["name"]: r for r in rep["printers"]}
    assert rows["away"]["error"] == "not answering"
    assert rows["a"]["ok"] == 1 and rows["a"]["hours"] == 2.0
    assert rep["total"]["jobs"] == sum(r.get("jobs", 0) for r in rep["printers"])
    with pytest.raises(ValueError):
        f.report("365")
    assert farm.report_since("7", now=time.mktime((2026, 10, 22, 15, 0, 0, 0, 0, -1))) == time.mktime((2026, 10, 16, 0, 0, 0, 0, 0, -1))


# ------------------------------------------------------------- settings for a kind of printer
def settings_status(file=None, saved=None, keep=True):
    out = {"gcode_macro _AUTO_EJECT_DEFAULTS": {"cool_temp": 35, "push_z": 1.0, "direction": "front", "verify": True,
                                                "notify": "", "home_z_gcode": "G28 Z"},
           "gcode_macro _AUTO_EJECT_SETTINGS": dict({"cool_temp": 35, "push_z": 1.0, "direction": "front", "verify": True,
                                                     "notify": "", "home_z_gcode": "G28 Z"}, **(file or {})),
           "gcode_macro _AUTO_EJECT_OVERRIDES": {"data": dict(saved or {})}}
    if keep:
        out["save_variables"] = {"variables": {}}
    return out


def test_a_printers_settings_as_the_macros_merge_them(monkeypatch):
    asked = []

    def fake(url, data=None, method=None, timeout=0):
        asked.append(url)
        return {"status": settings_status(file={"direction": "back"}, saved={"cool_temp": 40, "gone": 1})}
    monkeypatch.setattr(farm, "http_json", fake)
    got = farm.Printer("10.1.1.2", 7125, "voron").read_settings()
    assert got["values"] == {"cool_temp": 40, "push_z": 1.0, "direction": "back", "verify": True, "notify": "", "home_z_gcode": "G28 Z"}
    assert got["changed"] == ["cool_temp", "direction"] and got["kept"] is True
    assert "gcode_macro%20_AUTO_EJECT_OVERRIDES" in asked[0]

    monkeypatch.setattr(farm, "http_json", lambda url, data=None, method=None, timeout=0: {"status": {}})
    with pytest.raises(LookupError):
        farm.Printer("10.1.1.3", 7125, "ender").read_settings()


def test_copying_settings_sets_only_what_differs(monkeypatch):
    sent = []

    def fake(url, data=None, method=None, timeout=0):
        if "/printer/objects/query" in url:
            return {"status": settings_status(saved={"cool_temp": 40}, keep=False)}
        sent.append(data["script"])
        return "ok"
    monkeypatch.setattr(farm, "http_json", fake)
    f = farm.Farm(FakeMoonraker())
    f.add([{"host": "10.1.1.2", "port": 7125, "name": "voron-02"}])
    pid = list(f.printers)[0]
    f.printers[pid].card = {"phase": "idle"}
    got = f.copy_settings(pid, {"cool_temp": 40, "push_z": 0.8, "verify": False, "direction": "front",
                                "home_z_gcode": "G28 Z\nM84", "notify": "", "newer": 3})
    assert sent == ["AUTO_EJECT_SET KEY=push_z VALUE=0.8\nAUTO_EJECT_SET KEY=verify VALUE=false"]
    assert got["changed"] == ["push_z", "verify"] and got["same"] == ["cool_temp", "direction", "notify"]
    # a G-code line cannot go through AUTO_EJECT_SET; a newer setting it does not have
    assert got["skipped"] == {"home_z_gcode": "file", "newer": "unknown"}
    assert got["kept"] is False                      # no [save_variables]: until it restarts
    # never while it clears its bed, and nothing sent when there is nothing to set
    f.printers[pid].card = {"phase": "ejecting"}
    with pytest.raises(PermissionError):
        f.copy_settings(pid, {"push_z": 0.8})
    f.printers[pid].card = {"phase": "printing"}
    sent.clear()
    assert f.copy_settings(pid, {"cool_temp": 40.0})["same"] == ["cool_temp"] and sent == []
    with pytest.raises(ValueError):
        f.copy_settings(pid, {})


def test_saved_sets_for_a_kind_of_printer():
    mr = FakeMoonraker()
    f = farm.Farm(mr)
    assert f.save_set("  Voron 2.4   350 ", {"cool_temp": 40, "verify": False}, "voron-01") is True
    assert f.view()["sets"] == [{"name": "Voron 2.4 350", "values": {"cool_temp": 40, "verify": False}, "from": "voron-01",
                                 "saved": f.sets["Voron 2.4 350"]["saved"]}]
    assert farm.Farm(mr).sets.keys() == {"Voron 2.4 350"}          # kept in Moonraker
    for name, values in (("", {"a": 1}), ("x" * 41, {"a": 1}), ("ok", {}), ("ok", {"Bad key": 1}), ("ok", {"a": [1]})):
        with pytest.raises(ValueError):
            f.save_set(name, values)
    assert f.remove_set("Voron 2.4 350") is True and f.remove_set("Voron 2.4 350") is False
    assert f.view()["sets"] == []


def test_api_settings_and_sets(api, monkeypatch):
    f, base = api
    pid = list(f.printers)[0]
    monkeypatch.setattr(farm, "http_json", lambda url, data=None, method=None, timeout=0:
                        {"status": settings_status(saved={"cool_temp": 40})} if "/objects/query" in url else "ok")
    code, body = call(base + "/farm/%s/settings" % pid)
    assert code == 200 and body["settings"]["changed"] == ["cool_temp"]
    f.printers[pid].card = {"phase": "idle"}
    code, body = call(base + "/farm/%s/settings" % pid, {"values": {"push_z": 0.6}})
    assert code == 200 and body["result"]["changed"] == ["push_z"]
    f.printers[pid].card = {"phase": "ejecting"}
    assert call(base + "/farm/%s/settings" % pid, {"values": {"push_z": 0.6}})[0] == 409
    assert call(base + "/farm/nope/settings")[0] == 404
    assert call(base + "/farm/sets", {"name": "Ender 3", "values": {"push_z": 0.6}}) == (200, {"saved": True})
    assert call(base + "/farm/sets", {"name": "", "values": {"push_z": 0.6}})[0] == 400
    assert [s["name"] for s in call(base + "/farm")[1]["sets"]] == ["Ender 3"]
    assert call(base + "/farm/sets", {"remove": "Ender 3"}) == (200, {"removed": True})
