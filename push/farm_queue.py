"""The farm queue: files kept on this printer's card until their job is
removed, each copy sent to the next free printer the job may go to.

Part of the farm (farm.py): FarmQueue is a part of the Farm class, and uses
its lock, its printers and its Moonraker.
"""

import json
import os
import shutil
import threading
import time
import uuid

import farm_net as net
from farm_card import gcode_material, same_material

QUEUE_DIR = os.path.join(net.UPLOADS, "queue")
QUEUE_FOLDER = "farm"  # where a copy lands on a printer: never over one of its own files
QUEUE_RETRY = 120      # seconds before a printer that refused a copy is tried again
QUEUE_START = 120      # seconds a copy has to show up printing on its printer
COPIES_MAX = 999
RUNS_KEPT = 300        # copies remembered for each job


class FarmQueue:
    def _queue_path(self, job):
        return os.path.join(QUEUE_DIR, job["id"] + ".gcode")

    def _queue_record(self):
        return {"running": self.queue["running"], "jobs": self.queue["jobs"], "need_clear": sorted(self.need_clear)}

    def _put_queue(self, record=None):
        if record is None:
            with self.lock:
                record = json.loads(json.dumps(self._queue_record()))
        self.moonraker.put("queue", record, namespace=net.NAMESPACE)

    @staticmethod
    def _counts(job):
        runs = job.get("runs", [])
        n = {s: sum(1 for r in runs if r["state"] == s) for s in ("sending", "printing", "done", "stopped")}
        n["left"] = max(0, job["copies"] - n["done"] - n["stopped"] - n["sending"] - n["printing"])
        return n

    def queue_view(self):
        with self.lock:
            jobs = []
            for job in self.queue["jobs"]:
                n = self._counts(job)
                failed = [r for r in job.get("runs", []) if r["state"] == "failed"]
                jobs.append({"id": job["id"], "name": job["name"], "size": job["size"], "copies": job["copies"],
                             "printers": [pid for pid in job["printers"] if self.find(pid)], "material": job.get("material", ""),
                             "added": job.get("added"), "done": n["done"], "stopped": n["stopped"], "left": n["left"],
                             "now": [{"printer": r["printer"], "state": r["state"]} for r in job.get("runs", []) if r["state"] in ("sending", "printing")],
                             "error": failed[-1]["error"] if failed and failed[-1]["at"] > self.clock() - 600 else ""})
            return {"running": self.queue["running"], "jobs": jobs, "need_clear": sorted(p for p in self.need_clear if self.find(p))}

    def queue_add(self, name, fileobj, size, copies, printers):
        """A file for the farm queue: kept here, printed `copies` times on the
        printers given, each copy on the next of them that is free."""
        name = net.safe_name(name)
        copies = int(copies)
        if not 1 <= copies <= COPIES_MAX:
            raise ValueError("1 to %d copies" % COPIES_MAX)
        printers = [p for p in dict.fromkeys(printers or []) if self.find(p)]
        if not printers:
            raise ValueError("which printers may print it?")
        os.makedirs(QUEUE_DIR, exist_ok=True)
        if shutil.disk_usage(QUEUE_DIR).free < size + 200 * 1024 * 1024:
            raise ValueError("not enough room on this printer's card for the file")
        job = {"id": uuid.uuid4().hex[:12], "name": name, "size": int(size), "copies": copies, "printers": printers,
               "added": int(time.time()), "runs": []}
        path = self._queue_path(job)
        fileobj.seek(0)
        with open(path, "wb") as out:
            shutil.copyfileobj(fileobj, out, 1 << 20)
        job["material"] = gcode_material(path)
        with self.lock:
            self.queue["jobs"].append(job)
        self._put_queue()
        return job["id"]

    def queue_change(self, body):
        """Start or pause the queue, change a job's copies or printers, move it,
        remove it, or say a printer's bed is clear."""
        with self.lock:
            jobs = self.queue["jobs"]
            job = next((j for j in jobs if j["id"] == body.get("id")), None)
            if "running" in body:
                self.queue["running"] = bool(body["running"])
            elif "cleared" in body:
                self.need_clear.discard(str(body["cleared"]))
            elif job is None:
                raise LookupError("no such job")
            elif body.get("remove"):
                if any(r["state"] == "sending" for r in job["runs"]):
                    raise PermissionError("a copy of it is on its way to a printer")
                jobs.remove(job)
                try:
                    os.remove(self._queue_path(job))
                except OSError:
                    pass
            elif "copies" in body:
                n = self._counts(job)
                copies = int(body["copies"])
                if not n["done"] + n["stopped"] + n["sending"] + n["printing"] <= copies <= COPIES_MAX:
                    raise ValueError("%d copies at least: they are made or under way" % (n["done"] + n["stopped"] + n["sending"] + n["printing"]))
                job["copies"] = copies
            elif "printers" in body:
                printers = [p for p in dict.fromkeys(body["printers"] or []) if self.find(p)]
                if not printers:
                    raise ValueError("which printers may print it?")
                job["printers"] = printers
            elif "move" in body:
                i = jobs.index(job)
                to = max(0, min(len(jobs) - 1, i + int(body["move"])))
                jobs.insert(to, jobs.pop(i))
            else:
                raise ValueError("nothing to change")
            record = json.loads(json.dumps(self._queue_record()))
        self._put_queue(record)
        return True

    def _free_for_queue(self, p, job, now):
        """A printer that may take a copy now: free with an empty bed, nothing
        in its own job queue, answering, the filament the file wants."""
        c = p.card
        return (c.get("phase") == "idle" and not c.get("jobs") and now - p.updated < 30
                and p.id not in self.need_clear and self.retry_at.get(p.id, 0) <= now
                and same_material(job.get("material"), (p.spool or {}).get("material")))

    def dispatch(self, now=None):
        """The next copy of the first job with one left, to each free printer
        it may go to; the jobs higher in the list first."""
        if not self.loaded:
            return []
        now = now or time.time()
        sends = []
        with self.lock:
            if not self.queue["running"]:
                return []
            busy = {r["printer"] for j in self.queue["jobs"] for r in j["runs"] if r["state"] in ("sending", "printing")}
            for job in self.queue["jobs"]:
                left = self._counts(job)["left"]
                for pid in job["printers"]:
                    p = self.find(pid)
                    if left <= 0:
                        break
                    if p is None or pid in busy or not self._free_for_queue(p, job, now):
                        continue
                    run = {"printer": pid, "state": "sending", "at": now, "error": "", "file": QUEUE_FOLDER + "/" + job["name"]}
                    job["runs"] = job["runs"][-RUNS_KEPT:] + [run]
                    busy.add(pid)
                    left -= 1
                    sends.append((job, run, p))
            record = json.loads(json.dumps(self._queue_record())) if sends else None
        if record:
            self._put_queue(record)
        for job, run, p in sends:
            threading.Thread(target=self._send_copy, args=(job, run, p), daemon=True).start()
        return sends

    def _send_copy(self, job, run, p):
        try:
            with open(self._queue_path(job), "rb") as f:
                answer = net.upload_file(p.base, job["name"], f, job["size"], start=True, folder=QUEUE_FOLDER) or {}
            if answer.get("print_started") is False:
                raise RuntimeError("%s did not start it" % p.name)
            state, error = "printing", ""
        except Exception as e:
            state, error = "failed", str(e) or e.__class__.__name__
        with self.lock:
            run.update(state=state, error=error, at=self.clock())
            if state == "failed":
                self.retry_at[run["printer"]] = run["at"] + QUEUE_RETRY
            record = json.loads(json.dumps(self._queue_record()))
        self._put_queue(record)

    def track_queue(self, now=None):
        """Where each copy sent is now, from its printer's card: printing,
        ended well, or stopped. After either, a printer without auto-eject
        waits for its bed to be cleared, and any printer after a stop."""
        now = now or time.time()
        changed = False
        with self.lock:
            for job in self.queue["jobs"]:
                for run in job["runs"]:
                    if run["state"] != "printing":
                        continue
                    p = self.find(run["printer"])
                    if p is None:
                        run.update(state="stopped", error="no longer in the farm")
                        changed = True
                        continue
                    c = p.card
                    if c.get("phase") in ("offline", "off") or p.updated < run["at"]:
                        continue                          # it says once it answers again
                    mine, state = c.get("filename") == run["file"], c.get("state")
                    if mine and state in ("printing", "paused"):
                        if not run.get("seen"):
                            run["seen"] = True
                            changed = True
                        continue
                    end = None
                    if run.get("seen") and mine and state == "complete":
                        end = ("done", "")
                    elif run.get("seen") and mine and state in ("cancelled", "error"):
                        end = ("stopped", c.get("message") or state)
                    elif c.get("phase") == "stopped":
                        end = ("stopped", c.get("message") or "Klipper stopped")
                    elif run.get("seen") or now - run["at"] > QUEUE_START:
                        end = ("stopped", "another print, or a restart, took its place" if run.get("seen") else "it did not start")
                    if end:
                        run.update(state=end[0], error=end[1], at=now)
                        if end[0] == "stopped" or not c.get("auto_eject"):
                            self.need_clear.add(run["printer"])
                        changed = True
            record = json.loads(json.dumps(self._queue_record())) if changed else None
        if record:
            self._put_queue(record)
        return changed
