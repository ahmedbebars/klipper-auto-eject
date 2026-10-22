"""The spool, with Spoolman: stop the job queue before a job the spool on
the printer cannot finish, and tell the phones, also with the page closed.

Moonraker's [spoolman] section links the printer to Spoolman, which knows
what is left on each spool; the slicer writes what each file needs. The
same rules as spoolPlan() in web/model.js. Nothing happens without
Spoolman, without a spool chosen for the printer, or for a file that
cannot be told (no weight, or more than one filament).
"""

import math
import time
import urllib.error
import urllib.parse

RESERVE = 10.0          # grams kept on the spool, as variable_spool_reserve
EVERY = 10              # seconds between looks
NO_SPOOLMAN_WAIT = 300  # a Moonraker without [spoolman] is asked again after this
META_KEPT = 300         # seconds a file's metadata is kept
QUERY = ("/printer/objects/query?print_stats=state,filename,filament_used&virtual_sdcard=progress"
         "&gcode_macro%20_AUTO_EJECT_DEFAULTS=spool_low_action,spool_reserve"
         "&gcode_macro%20_AUTO_EJECT_SETTINGS=spool_low_action,spool_reserve"
         "&gcode_macro%20_AUTO_EJECT_OVERRIDES=data")


def text(en, ar):
    return {"en": en, "ar": ar}


def length_grams(mm, filament):
    """Grams of filament for a length (mm) of the spool's filament."""
    f = filament or {}
    d = f.get("diameter") if isinstance(f.get("diameter"), (int, float)) and f.get("diameter") > 0 else 1.75
    rho = f.get("density")
    if not isinstance(mm, (int, float)) or mm <= 0 or not isinstance(rho, (int, float)) or rho <= 0:
        return None
    return mm * math.pi * d * d / 4 * rho / 1000


def file_grams(meta, filament):
    """Grams a file needs; None when it cannot be told, and for a file that
    prints more than one filament."""
    m = meta or {}
    if len([w for w in m.get("filament_weights") or [] if isinstance(w, (int, float)) and w > 0]) > 1 \
            or (m.get("filament_change_count") or 0) > 0:
        return None
    w = m.get("filament_weight_total")
    if isinstance(w, (int, float)) and w > 0:
        return float(w)
    return length_grams(m.get("filament_total"), filament)


def grams_left(meta, used, progress, filament):
    """What the print running now still needs: the part not printed yet."""
    all_ = file_grams(meta, filament)
    if all_ is None:
        return None
    total = (meta or {}).get("filament_total")
    if isinstance(total, (int, float)) and total > 0 and isinstance(used, (int, float)) and used >= 0:
        done = used / total
    else:
        done = progress if isinstance(progress, (int, float)) else 0
    return all_ * (1 - min(1, max(0, done)))


def plan(left, now, jobs, reserve):
    """The queue against the spool, as spoolPlan() in web/model.js."""
    if not isinstance(left, (int, float)) or not math.isfinite(left):
        return None
    keep = reserve if isinstance(reserve, (int, float)) and reserve > 0 else 0
    rest = None if now is None else left - (now or 0)
    out = {"left": left, "now": now, "reserve": keep, "after": rest, "nowShort": rest is not None and (now or 0) > 0 and rest < keep,
           "jobs": [], "stopAt": -1, "fit": 0}
    for g in jobs or []:
        if rest is None or g is None:
            rest = None
            out["jobs"].append({"grams": g, "left": None, "fit": "unknown"})
            continue
        rest -= g
        short = rest < keep
        if short and out["stopAt"] < 0:
            out["stopAt"] = len(out["jobs"])
        if not short and out["stopAt"] < 0:
            out["fit"] += 1
        out["jobs"].append({"grams": g, "left": rest, "fit": "short" if out["stopAt"] >= 0 else "ok"})
    return out


def spool_name(spool):
    f = (spool or {}).get("filament") or {}
    name = " ".join(x for x in ((f.get("vendor") or {}).get("name"), f.get("name") or f.get("material")) if x)
    sid = (spool or {}).get("id")
    return "%s (#%s)" % (name, sid) if name and sid is not None else name or "#%s" % sid


class SpoolWatcher:
    """Looks every few seconds; a stop or a warning is given once for the same
    job and spool, so a queue started again on purpose is not stopped again."""

    def __init__(self):
        self.next_at = 0.0
        self.stopped_for = None   # (job_id, spool_id) the queue was stopped for
        self.warned_for = None    # (file, spool_id) told it may run out mid-print
        self.metas = {}           # file -> (when, metadata or None)

    def _meta(self, moonraker, name, now):
        kept = self.metas.get(name)
        if kept and now - kept[0] < META_KEPT:
            return kept[1]
        try:
            m = moonraker.call("/server/files/metadata?filename=" + urllib.parse.quote(name))
        except urllib.error.HTTPError:
            m = None
        self.metas[name] = (now, m)
        return m

    def check(self, moonraker, now=None):
        now = time.time() if now is None else now
        if now < self.next_at:
            return []
        self.next_at = now + EVERY
        try:
            status = moonraker.call("/server/spoolman/status")
        except urllib.error.HTTPError as e:
            if e.code == 404:              # no [spoolman] in moonraker.conf
                self.next_at = now + NO_SPOOLMAN_WAIT
            return []
        sid = status.get("spool_id")
        if not status.get("spoolman_connected") or sid is None:
            return []
        try:
            st = moonraker.call(QUERY)["status"]
        except Exception:                  # Klipper restarting
            return []
        s = dict(st.get("gcode_macro _AUTO_EJECT_DEFAULTS") or {})
        s.update(st.get("gcode_macro _AUTO_EJECT_SETTINGS") or {})
        s.update((st.get("gcode_macro _AUTO_EJECT_OVERRIDES") or {}).get("data") or {})
        action = str(s.get("spool_low_action", "stop")).lower()
        reserve = s.get("spool_reserve", RESERVE)
        if action == "off":
            return []
        answer = moonraker.post("/server/spoolman/proxy", {"request_method": "GET", "path": "/v1/spool/%d" % sid,
                                                           "use_v2_response": True}) or {}
        spool = answer.get("response") or {}
        fil = spool.get("filament") or {}
        left = spool.get("remaining_weight")
        if not isinstance(left, (int, float)):
            return []
        # what Moonraker has not told Spoolman yet
        pending = sum(r.get("filament_used") or 0 for r in status.get("pending_reports") or [] if r.get("spool_id") == sid)
        left -= length_grams(pending, fil) or 0

        ps = st.get("print_stats") or {}
        printing = ps.get("state") in ("printing", "paused") and ps.get("filename")
        need = grams_left(self._meta(moonraker, ps["filename"], now), ps.get("filament_used"),
                          (st.get("virtual_sdcard") or {}).get("progress"), fil) if printing else 0
        try:
            queue = moonraker.call("/server/job_queue/status")
        except urllib.error.HTTPError:     # no [job_queue]
            queue = {}
        jobs = queue.get("queued_jobs") or []
        nxt = jobs[0] if jobs else None
        p = plan(left, need, [file_grams(self._meta(moonraker, nxt["filename"], now), fil)] if nxt else [], reserve)
        name = spool_name(spool)
        events = []
        keep = round(p["reserve"])
        if printing and p["nowShort"] and self.warned_for != (ps["filename"], sid):
            self.warned_for = (ps["filename"], sid)
            events.append(("spool", text(
                "The spool may run out during this print: it still needs about %d g, and %s has about %d g, "
                "with %d g kept in reserve." % (round(need), name, round(left), keep),
                "قد تنفد البكرة أثناء هذه الطباعة: ما زالت تحتاج نحو %d غ، وفي %s نحو %d غ مع ترك %d غ احتياطًا."
                % (round(need), name, round(left), keep))))
        if nxt and p["stopAt"] == 0 and queue.get("queue_state") == "ready" and self.stopped_for != (nxt.get("job_id"), sid):
            self.stopped_for = (nxt.get("job_id"), sid)
            stop = action == "stop"
            if stop:
                moonraker.post("/server/job_queue/pause", {})
            after = max(0, round(p["after"]))
            g = round(p["jobs"][0]["grams"])
            en = ("The next job, %s, needs about %d g, and %s has about %d g left%s: not enough with %d g kept in reserve. "
                  % (nxt["filename"], g, name, after, " after this print" if printing else "", keep))
            ar = ("المهمة التالية %s تحتاج نحو %d غ، وفي %s نحو %d غ%s: لا يكفي مع ترك %d غ احتياطًا. "
                  % (nxt["filename"], g, name, after, " بعد هذه الطباعة" if printing else "", keep))
            if stop:
                en += "The queue stopped before it: put on another spool and choose it in Spoolman, then start the queue."
                ar += "توقفت القائمة قبلها: ركّب بكرة أخرى واخترها في Spoolman، ثم شغّل القائمة."
            else:
                en += "Change the spool before it starts."
                ar += "غيّر البكرة قبل أن تبدأ."
            events.append(("spool", text(en, ar)))
        return events
