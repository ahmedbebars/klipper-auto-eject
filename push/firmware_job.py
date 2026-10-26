"""The Updates page's "Update the boards" button: the firmware of this
printer's boards brought to Klipper's version by tools/firmware.py.

Part of the klipper-auto-eject service (auto_eject_push.py). The update runs
as a process of its own, with no one at a terminal, and keeps its state in a
file the page reads: also after the computer restarted for the host firmware,
and after this service restarted (install.sh --firmware lets the update go
on then). install.sh --firmware also sets up, when asked, what flashes the
USB boards in their bootloader and the host with no password; without it
those are left out (docs/firmware.md).
"""

import json
import os
import subprocess
import sys
import threading
import time

TOOLS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools")
sys.path.insert(0, TOOLS)

import firmware as tool  # noqa: E402

STATE = str(tool.WORK.parent / "firmware-update.json")
LOG = str(tool.WORK.parent / "firmware-update.log")
STATUS_FOR = 60          # seconds the boards' state is kept before it is read again
LOG_LINES = 80


class FirmwareJob:
    def __init__(self, moonraker, popen=subprocess.Popen, python=sys.executable, state=STATE, log=LOG):
        self.moonraker = moonraker           # this printer's Moonraker address
        self.popen, self.python, self.state, self.log = popen, python, state, log
        self.lock = threading.Lock()
        self.proc = None
        self.cache = (0.0, None)             # (when, firmware.py's report)

    def _alive(self, pid):
        if self.proc is not None and self.proc.pid == pid:
            return self.proc.poll() is None
        try:                                 # started before this service restarted
            with open("/proc/%d/cmdline" % int(pid), "rb") as f:
                return b"firmware.py" in f.read()
        except (OSError, TypeError, ValueError):
            return False

    def _tail(self):
        try:
            with open(self.log, encoding="utf-8", errors="replace") as f:
                return "".join(f.readlines()[-LOG_LINES:])
        except OSError:
            return ""

    def job(self):
        """The last update, as its state file says, with the end of its log;
        None before the first."""
        try:
            with open(self.state, encoding="utf-8") as f:
                job = json.load(f)
        except (OSError, ValueError):
            return None
        if job.get("state") == "running" and not self._alive(job.get("pid")):
            if job.get("step") == "rebooting":     # it ended with the computer, as it should
                job["state"] = "failed" if any(b.get("state") == "failed" for b in job.get("boards", [])) else "done"
            else:
                job.update(state="failed", message=job.get("message") or "The update stopped on the way: see its log.")
        job["log"] = self._tail()
        return job

    def running(self):
        job = self.job()
        return bool(job and job.get("state") == "running")

    def status(self, fresh=False):
        """Each board against Klipper (firmware.py's report), read at most once
        a minute, and never while an update runs: Klipper is stopped then."""
        at, data = self.cache
        job = self.job()
        if job and job.get("state") == "running":
            return data
        if data is not None and not fresh and time.time() - at < STATUS_FOR and not (job and job.get("at", 0) > at):
            return data
        try:
            data = tool.report(tool.Moonraker(self.moonraker, timeout=5))
        except Exception as e:               # Klipper not up yet: say so, and ask again next time
            return {"error": str(e)}
        self.cache = (time.time(), data)
        return data

    def view(self, fresh=False):
        return {"status": self.status(fresh), "job": self.job()}

    def start(self):
        """firmware.py update --yes, in the background. It checks the printer
        again itself; asked here first so the page can say at once why not."""
        with self.lock:
            if self.running():
                raise PermissionError("The boards are being updated already.")
            why = tool.busy(tool.Moonraker(self.moonraker, timeout=5))
            if why:
                raise PermissionError(why)
            os.makedirs(os.path.dirname(self.state), exist_ok=True)
            try:
                os.remove(self.state)
            except OSError:
                pass
            with open(self.log, "w", encoding="utf-8") as log:
                self.proc = self.popen([self.python, "-u", os.path.join(TOOLS, "firmware.py"), "--moonraker", self.moonraker,
                                        "update", "--yes", "--progress", self.state],
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                       cwd=os.path.expanduser("~"), start_new_session=True)
            # the page shows the update as soon as it answers: the state file comes at once
            end = time.time() + 5
            while time.time() < end and not os.path.exists(self.state) and self.proc.poll() is None:
                time.sleep(0.1)
            return True
