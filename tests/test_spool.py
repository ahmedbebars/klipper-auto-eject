"""push/spool.py and the page: the queue against the spool, with Spoolman.

The service stops the queue with the page closed; the page shows the same
plan. Both must agree, so the plans are also compared with web/model.js.
"""

import json
import pathlib
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "push"))

import spool  # noqa: E402

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="Node.js is not installed")
PLA = {"density": 1.24, "diameter": 1.75}


def js(fn, *args):
    out = subprocess.run([NODE, str(ROOT / "tests" / "web_runner.js")],
                         input=json.dumps({"fn": fn, "args": list(args)}),
                         capture_output=True, text=True, check=True, encoding="utf-8")
    return json.loads(out.stdout)


def http_error(code):
    return urllib.error.HTTPError("http://x", code, "error", {}, None)


class FakeMoonraker:
    """A printer with Spoolman: spool 12 on it, a queue, and a print."""

    def __init__(self, left=500.0, jobs=(("next.gcode", 120.0),), printing=None, spoolman=True, settings=None):
        self.spoolman = spoolman
        self.connected = True
        self.spool_id = 12
        self.pending = []
        self.spool = {"id": 12, "remaining_weight": left, "initial_weight": 1000,
                      "filament": dict(PLA, name="PLA+ Black", material="PLA", vendor={"name": "eSUN"})}
        self.queue_state = "ready"
        self.jobs = [{"filename": f, "job_id": "%04d" % i} for i, (f, _g) in enumerate(jobs)]
        self.metas = {f: {"filament_weight_total": g, "filament_total": g / 2.98 * 1000} for f, g in jobs}
        self.printing = printing          # (file, grams, fraction done) or None
        if printing:
            self.metas[printing[0]] = {"filament_weight_total": printing[1], "filament_total": printing[1] / 2.98 * 1000}
        self.settings = settings or {}
        self.posts = []
        self.calls = []

    def call(self, path):
        self.calls.append(path)
        if path == "/server/spoolman/status":
            if not self.spoolman:
                raise http_error(404)
            return {"spoolman_connected": self.connected, "spool_id": self.spool_id, "pending_reports": self.pending}
        if path.startswith("/printer/objects/query?"):
            ps = {"state": "standby", "filename": "", "filament_used": 0.0}
            vsd = {"progress": 0.0}
            if self.printing:
                f, g, done = self.printing
                ps = {"state": "printing", "filename": f, "filament_used": self.metas[f]["filament_total"] * done}
                vsd = {"progress": done}
            return {"status": {"print_stats": ps, "virtual_sdcard": vsd,
                               "gcode_macro _AUTO_EJECT_DEFAULTS": {"spool_low_action": "stop", "spool_reserve": 10.0},
                               "gcode_macro _AUTO_EJECT_SETTINGS": {"spool_low_action": "stop", "spool_reserve": 10.0},
                               "gcode_macro _AUTO_EJECT_OVERRIDES": {"data": dict(self.settings)}}}
        if path == "/server/job_queue/status":
            return {"queued_jobs": self.jobs, "queue_state": self.queue_state}
        if path.startswith("/server/files/metadata?filename="):
            name = urllib.parse.unquote(path.split("=", 1)[1])
            if name not in self.metas:
                raise http_error(404)
            return self.metas[name]
        raise AssertionError(path)

    def post(self, path, data=None):
        self.posts.append((path, data))
        if path == "/server/spoolman/proxy":
            assert data == {"request_method": "GET", "path": "/v1/spool/%d" % self.spool_id, "use_v2_response": True}
            return {"response": self.spool, "error": None}
        if path == "/server/job_queue/pause":
            self.queue_state = "paused"
            return {}
        raise AssertionError(path)


def paused(mr):
    return ("/server/job_queue/pause", {}) in mr.posts


# ------------------------------------------------------------------ the rules
def test_grams_from_the_slicer_or_from_the_length():
    assert spool.file_grams({"filament_weight_total": 42.5}, PLA) == 42.5
    # no weight: 1000 mm of 1.75 mm PLA is about 2.98 g
    assert round(spool.file_grams({"filament_total": 1000.0}, PLA), 2) == 2.98
    assert spool.file_grams({"filament_total": 1000.0}, {}) is None          # no density: cannot tell
    assert spool.file_grams({}, PLA) is None
    # more than one filament: one spool cannot be checked
    assert spool.file_grams({"filament_weight_total": 50, "filament_weights": [30, 20]}, PLA) is None
    assert spool.file_grams({"filament_weight_total": 50, "filament_weights": [50, 0]}, PLA) == 50
    assert spool.file_grams({"filament_weight_total": 50, "filament_change_count": 2}, PLA) is None


def test_the_print_running_needs_only_what_is_left_of_it():
    m = {"filament_weight_total": 100.0, "filament_total": 33557.0}
    assert round(spool.grams_left(m, 33557.0 / 4, 0.9, PLA)) == 75       # by filament used, not progress
    assert round(spool.grams_left({"filament_weight_total": 100.0}, 0, 0.4, PLA)) == 60   # no length: progress
    assert spool.grams_left(m, 99999.0, 0, PLA) == 0


def test_the_plan():
    p = spool.plan(100.0, 20.0, [30.0, 30.0, 30.0], 10)
    assert [j["fit"] for j in p["jobs"]] == ["ok", "ok", "short"]
    assert p["stopAt"] == 2 and p["fit"] == 2 and p["after"] == 80.0 and not p["nowShort"]
    assert [j["left"] for j in p["jobs"]] == [50.0, 20.0, -10.0]
    # a job that cannot be told: nothing after it can
    p = spool.plan(100.0, 0, [30.0, None, 30.0], 10)
    assert [j["fit"] for j in p["jobs"]] == ["ok", "unknown", "unknown"] and p["stopAt"] == -1
    # the print running cannot finish
    p = spool.plan(30.0, 25.0, [5.0], 10)
    assert p["nowShort"] and p["stopAt"] == 0
    # what the print running needs is unknown: so is the rest
    p = spool.plan(500.0, None, [30.0], 10)
    assert p["jobs"][0]["fit"] == "unknown" and not p["nowShort"]
    assert spool.plan(None, 0, [30.0], 10) is None


@needs_node
@pytest.mark.parametrize("case", [
    (100.0, 20.0, [30.0, 30.0, 30.0], 10),
    (100.0, 0, [30.0, None, 30.0], 10),
    (30.0, 25.0, [5.0], 10),
    (500.0, None, [30.0], 10),
    (12.0, 0, [2.0, 0.5], 0),
    (40.0, 0, [30.0], 10),
])
def test_the_page_plans_like_the_service(case):
    assert js("spoolPlan", *case) == spool.plan(*case)


@needs_node
def test_the_page_counts_grams_like_the_service():
    for m in ({"filament_weight_total": 42.5}, {"filament_total": 1000.0}, {"filament_weight_total": 50, "filament_weights": [30, 20]},
              {"filament_weight_total": 50, "filament_change_count": 1}, {}):
        assert js("fileGrams", m, PLA) == spool.file_grams(m, PLA)
    m = {"filament_weight_total": 100.0, "filament_total": 33557.0}
    assert js("gramsLeft", m, 33557.0 / 4, 0.9, PLA) == spool.grams_left(m, 33557.0 / 4, 0.9, PLA)
    assert js("spoolName", {"id": 12, "filament": {"name": "PLA+ Black", "vendor": {"name": "eSUN"}}}) == "eSUN PLA+ Black"


# ------------------------------------------------------------------ the service
def test_a_queue_that_fits_is_left_alone():
    mr = FakeMoonraker(left=500.0)
    assert spool.SpoolWatcher().check(mr, now=0) == []
    assert not paused(mr)


def test_the_queue_stops_before_a_job_the_spool_cannot_finish():
    mr = FakeMoonraker(left=100.0, printing=("now.gcode", 40.0, 0.5))   # 20 g still to print, 80 g left for the next job
    w = spool.SpoolWatcher()
    events = w.check(mr, now=0)
    assert paused(mr)
    assert [k for k, _t in events] == ["spool"]
    en = events[0][1]["en"]
    assert "next.gcode" in en and "about 120 g" in en and "about 80 g left after this print" in en and "10 g kept in reserve" in en
    assert "eSUN PLA+ Black (#12)" in en and "start the queue" in en
    assert "next.gcode" in events[0][1]["ar"]


def test_started_again_on_purpose_it_is_not_stopped_again():
    mr = FakeMoonraker(left=100.0)
    w = spool.SpoolWatcher()
    assert w.check(mr, now=0)
    mr.posts.clear()
    mr.queue_state = "ready"           # someone started it anyway
    assert w.check(mr, now=20) == [] and not paused(mr)
    # another spool that is also too short: stopped again
    mr.spool_id = 13
    mr.spool = dict(mr.spool, id=13, remaining_weight=50.0)
    assert w.check(mr, now=40) and paused(mr)


def test_the_reserve_counts():
    # 125 g for a 120 g job: fits only with less than 5 g kept back
    mr = FakeMoonraker(left=125.0)
    assert spool.SpoolWatcher().check(mr, now=0) and paused(mr)
    mr = FakeMoonraker(left=125.0, settings={"spool_reserve": 2.0})
    assert spool.SpoolWatcher().check(mr, now=0) == [] and not paused(mr)


def test_notify_only_tells_and_off_does_nothing():
    mr = FakeMoonraker(left=50.0, settings={"spool_low_action": "notify"})
    events = spool.SpoolWatcher().check(mr, now=0)
    assert events and not paused(mr) and "Change the spool before it starts" in events[0][1]["en"]
    mr = FakeMoonraker(left=50.0, settings={"spool_low_action": "off"})
    assert spool.SpoolWatcher().check(mr, now=0) == [] and not mr.posts


def test_the_print_running_may_run_out():
    mr = FakeMoonraker(left=30.0, jobs=(), printing=("now.gcode", 100.0, 0.5))   # 50 g still to print
    w = spool.SpoolWatcher()
    events = w.check(mr, now=0)
    assert [k for k, _t in events] == ["spool"] and "may run out during this print" in events[0][1]["en"]
    assert not paused(mr)              # the print goes on: a runout sensor is for that
    assert w.check(mr, now=20) == []   # told once


def test_a_paused_queue_is_not_touched():
    mr = FakeMoonraker(left=50.0)
    mr.queue_state = "paused"
    assert spool.SpoolWatcher().check(mr, now=0) == [] and not paused(mr)


def test_nothing_without_spoolman_a_spool_or_a_weight():
    w, mr = spool.SpoolWatcher(), FakeMoonraker(left=50.0, spoolman=False)
    assert w.check(mr, now=0) == []
    assert w.check(mr, now=60) == [] and mr.calls.count("/server/spoolman/status") == 1   # asked again only later
    mr = FakeMoonraker(left=50.0)
    mr.connected = False
    assert spool.SpoolWatcher().check(mr, now=0) == [] and not mr.posts
    mr = FakeMoonraker(left=50.0)
    mr.spool_id = None
    assert spool.SpoolWatcher().check(mr, now=0) == [] and not mr.posts
    mr = FakeMoonraker(left=None)      # a filament without a weight in Spoolman
    assert spool.SpoolWatcher().check(mr, now=0) == [] and not paused(mr)
    mr = FakeMoonraker(left=50.0, jobs=(("multi.gcode", 120.0),))
    mr.metas["multi.gcode"]["filament_weights"] = [60.0, 60.0]
    assert spool.SpoolWatcher().check(mr, now=0) == [] and not paused(mr)


def test_what_moonraker_has_not_reported_yet_counts():
    mr = FakeMoonraker(left=135.0)     # 15 g over the 120 g job and the 10 g reserve...
    mr.pending = [{"spool_id": 12, "filament_used": 3357.0}, {"spool_id": 4, "filament_used": 99999.0}]   # ...but 10 g not counted yet
    assert spool.SpoolWatcher().check(mr, now=0) and paused(mr)


def test_it_looks_every_few_seconds_only():
    w, mr = spool.SpoolWatcher(), FakeMoonraker(left=500.0)
    w.check(mr, now=0)
    n = len(mr.calls)
    w.check(mr, now=3)
    assert len(mr.calls) == n
    w.check(mr, now=spool.EVERY)
    assert len(mr.calls) > n


def test_the_service_has_a_title_for_it():
    pytest.importorskip("cryptography")
    import auto_eject_push as push
    assert "spool" in push.PROBLEMS and push.TITLES["en"]["spool"] and push.TITLES["ar"]["spool"]
    msg = push.message_for("spool", {"en": "E", "ar": "ع"}, {"lang": "ar", "url": "https://p/auto-eject/"})
    assert msg["title"] == push.TITLES["ar"]["spool"] and msg["body"] == "ع"
