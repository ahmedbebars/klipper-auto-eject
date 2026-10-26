"""push/firmware_job.py: the Updates page's button that updates the boards."""

import json
import pathlib
import sys
import urllib.error
import urllib.request

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "push"))

import farm  # noqa: E402
import farm_api  # noqa: E402
import farm_net  # noqa: E402
import firmware_job  # noqa: E402
from test_farm import FakeMoonraker  # noqa: E402

REPORT = {"klipper": "v0.13.0-816", "boards": [{"name": "toolhead", "age": "older", "method": "can"}],
          "rights": {"usb": False, "host": False}}


class FakeProc:
    def __init__(self, pid=4242):
        self.pid, self.rc = pid, None

    def poll(self):
        return self.rc


class Popen:
    """firmware.py started: it writes its state file at once."""

    def __init__(self):
        self.calls, self.proc = [], FakeProc()

    def __call__(self, cmd, **kw):
        self.calls.append((cmd, kw))
        state = cmd[cmd.index("--progress") + 1]
        pathlib.Path(state).write_text(json.dumps({"state": "running", "step": "checking", "boards": [],
                                                   "pid": self.proc.pid, "at": 1.0}))
        kw["stdout"].write("Klipper is v0.13.0-816. To build: toolhead\n")
        return self.proc


@pytest.fixture
def job(tmp_path, monkeypatch):
    monkeypatch.setattr(firmware_job.tool, "busy", lambda moon: "")
    monkeypatch.setattr(firmware_job.tool, "report", lambda moon: dict(REPORT))
    popen = Popen()
    j = firmware_job.FirmwareJob("http://127.0.0.1:7125", popen=popen, python="python3",
                                 state=str(tmp_path / "update.json"), log=str(tmp_path / "update.log"))
    j.started = popen
    return j


def write_state(j, **values):
    pathlib.Path(j.state).write_text(json.dumps(dict({"state": "running", "step": "flashing", "boards": [], "pid": 999999,
                                                      "at": 1.0}, **values)))


def test_nothing_before_the_first_update(job):
    assert job.job() is None and not job.running()
    assert job.view() == {"status": REPORT, "job": None}


def test_the_update_runs_on_its_own_and_asks_nothing(job):
    assert job.start() is True
    ((cmd, kw),) = job.started.calls
    assert cmd[0:3] == ["python3", "-u", str(pathlib.Path(firmware_job.TOOLS) / "firmware.py")]
    assert cmd[3:] == ["--moonraker", "http://127.0.0.1:7125", "update", "--yes", "--progress", job.state]
    assert kw["start_new_session"] is True and kw["stdin"] is firmware_job.subprocess.DEVNULL
    got = job.job()
    assert got["state"] == "running" and "To build: toolhead" in got["log"]
    with pytest.raises(PermissionError, match="already"):
        job.start()


def test_a_busy_printer_is_refused_at_once(job, monkeypatch):
    monkeypatch.setattr(firmware_job.tool, "busy", lambda moon: "The printer is printing.")
    with pytest.raises(PermissionError, match="printing"):
        job.start()
    assert not job.started.calls


def test_an_update_whose_process_is_gone_failed(job):
    write_state(job)
    got = job.job()
    assert got["state"] == "failed" and "stopped on the way" in got["message"]


def test_an_update_that_ended_with_the_restart_is_done(job):
    # the host firmware: firmware.py asked for the restart, and the restart ended it
    write_state(job, step="rebooting", boards=[{"name": "host", "state": "written"}])
    assert job.job()["state"] == "done"
    write_state(job, step="rebooting", boards=[{"name": "mcu", "state": "failed"}, {"name": "host", "state": "written"}])
    assert job.job()["state"] == "failed"


def test_the_boards_are_read_once_a_minute_and_not_while_flashing(job, monkeypatch):
    asked = []
    monkeypatch.setattr(firmware_job.tool, "report", lambda moon: asked.append(1) or dict(REPORT))
    job.status()
    job.status()
    assert len(asked) == 1
    job.status(fresh=True)
    assert len(asked) == 2
    job.start()
    assert job.status(fresh=True) == REPORT and len(asked) == 2     # Klipper is stopped meanwhile
    job.started.proc.rc = 0
    pathlib.Path(job.state).write_text(json.dumps({"state": "done", "step": "", "boards": [], "pid": 4242, "at": 9e9}))
    job.status()
    assert len(asked) == 3                                          # read again once it is done


def test_klipper_not_up_yet_says_so(job, monkeypatch):
    def down(moon):
        raise OSError("Connection refused")
    monkeypatch.setattr(firmware_job.tool, "report", down)
    assert job.status() == {"error": "Connection refused"}


# ------------------------------------------------------------- the API
@pytest.fixture
def api(job, monkeypatch):
    monkeypatch.setattr(farm_net, "http_json", lambda url, data=None, method=None, timeout=0: "ok")
    f = farm.Farm(FakeMoonraker())
    f.firmware = job
    server = farm_api.serve(f, 0, job)
    yield f, "http://127.0.0.1:%d" % server.server_address[1]
    server.shutdown()


def call(url, body=None, ctype="application/json"):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers={"Content-Type": ctype})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def test_api_shows_the_boards_and_starts_the_update(api):
    f, base = api
    code, body = call(base + "/firmware")
    assert code == 200 and body["status"] == REPORT and body["job"] is None
    # a form from another site sends no JSON: refused
    assert call(base + "/firmware/update", {}, ctype="text/plain")[0] == 415
    assert call(base + "/firmware/update", {}) == (200, {"started": True})
    code, body = call(base + "/firmware/update", {})
    assert code == 409 and "already" in body["error"]
    assert call(base + "/firmware")[1]["job"]["state"] == "running"


def test_api_one_update_at_a_time(api):
    f, base = api
    f.local.job = {"state": "running", "names": ["klipper"], "done": []}
    code, body = call(base + "/firmware/update", {})
    assert code == 409 and "software" in body["error"]
    f.local.job = None
    f.local.updates = {"klipper": {"version": "a", "remote": "b"}}
    call(base + "/firmware/update", {})
    with pytest.raises(PermissionError, match="boards"):
        f.update("local", "klipper")


def test_api_without_the_update(monkeypatch):
    monkeypatch.setattr(farm_net, "http_json", lambda url, data=None, method=None, timeout=0: "ok")
    server = farm_api.serve(farm.Farm(FakeMoonraker()), 0)
    try:
        assert call("http://127.0.0.1:%d/firmware" % server.server_address[1])[0] == 404
    finally:
        server.shutdown()
