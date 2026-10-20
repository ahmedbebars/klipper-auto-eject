"""push/farm.py: every printer on the network in the auto-eject page."""

import json
import pathlib
import sys
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
    (status("complete", ae=tracker(3, busy=True)), None, None, "ejecting", ""),
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
    macs = {"100.79.158.35": ["48:8f:4c:16:d6:27"], "100.70.0.9": ["bb:bb:bb:bb:bb:bb"]}
    f.link_tailscale([f.local, big, other], peers=[("100.79.158.35", "tatara-big"), ("100.70.0.9", "nas")],
                     macs_of=lambda ip, port: macs.get(ip, []))
    assert big.ts_host == "100.79.158.35" and other.ts_host is None
    assert big.public()["page_remote"] == "http://100.79.158.35/"
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
                out = json.dumps({"result": {"item": {"path": "x.gcode", "root": "gcodes"},
                                             "print_started": b'name="print"' in body}}).encode()
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
