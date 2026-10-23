"""What a printer's answers say: its card, its history, its files and its
settings. Plain functions of Moonraker's answers, without a network.

Part of the farm (farm.py).
"""

import collections
import os
import re
import time
import urllib.parse


def gcode_material(path):
    """The filament a file was sliced for, as PrusaSlicer, SuperSlicer, Orca
    and Bambu Studio write it (; filament_type = PETG), or ""."""
    try:
        with open(path, "rb") as f:
            chunks = [f.read(1 << 16)]
            size = f.seek(0, 2)
            if size > 1 << 16:
                f.seek(max(1 << 16, size - (1 << 18)))
                chunks.append(f.read())
    except OSError:
        return ""
    for chunk in reversed(chunks):           # the settings sit at the end, a few at the top
        m = re.search(rb"^;\s*filament_type\s*=\s*([^\r\n;]+)", chunk, re.M)
        if m:
            return m.group(1).decode("utf-8", "replace").strip()[:20]
    return ""


def same_material(a, b):
    """PLA and PLA+ are the same; PLA and PETG, or PLA and PLA-CF, are not.
    Either one unknown: nothing to say against it."""
    a, b = (re.sub(r"[^A-Z0-9]", "", str(x or "").upper()) for x in (a, b))
    return not a or not b or a == b


def pick_thumb(thumbs, want):
    """The slicer's picture to show want pixels wide: the smallest at least
    that wide, else the largest there is."""
    shots = sorted((t for t in thumbs or [] if isinstance(t, dict) and t.get("relative_path") and (t.get("width") or 0) > 0),
                   key=lambda t: t["width"])
    if not shots:
        return None
    return next((t for t in shots if t["width"] >= want), shots[-1])


def thumb_path(filename, thumb):
    """Its path on Moonraker: relative to the G-code file's folder."""
    if not thumb or not thumb.get("relative_path"):
        return ""
    folder = filename.rsplit("/", 1)[0] + "/" if "/" in filename else ""
    parts = [s for s in (folder + thumb["relative_path"]).split("/") if s and s != "."]
    if ".." in parts:
        return ""
    return "/server/files/gcodes/" + urllib.parse.quote("/".join(parts))


def setting_text(value):
    """A value as AUTO_EJECT_SET takes it (settingArg() in web/model.js)."""
    if value is True:
        return "true"
    if value is False:
        return "false"
    return str(value).strip()


def setting_ok(text):
    """What AUTO_EJECT_SET refuses, refused here too (validSettingText() in
    web/model.js): such a value is changed in the settings file only."""
    return text != "" and not re.search(r"['\"#;\s]", text)


def same_setting(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) < 1e-9
    return a == b


def bin_capacity(status):
    """bin_capacity as the macros see it: saved with AUTO_EJECT_SET, else the
    settings file, else the default. Old settings files lack it."""
    sources = ((status.get("gcode_macro _AUTO_EJECT_OVERRIDES") or {}).get("data") or {},
               status.get("gcode_macro _AUTO_EJECT_SETTINGS") or {},
               status.get("gcode_macro _AUTO_EJECT_DEFAULTS") or {})
    for src in sources:
        if src.get("bin_capacity") is not None:
            try:
                return max(0, int(src["bin_capacity"]))
            except (TypeError, ValueError):
                return 0
    return 0


def summarize(status, queue=None, now=None):
    """A printer's card from its Moonraker status: phase and what needs you."""
    ps = status.get("print_stats", {})
    wh = status.get("webhooks", {})
    vs = status.get("virtual_sdcard", {})
    ae = status.get("gcode_macro _AUTO_EJECT_STATE")
    if not ae or ae.get("objects") is None:    # Moonraker answers null for a macro the printer lacks
        ae = None
    queue = queue or {}
    jobs = len(queue.get("queued_jobs", []))
    progress = vs.get("progress", 0.0) or 0.0
    duration = ps.get("print_duration", 0.0) or 0.0
    parts = len(ae.get("objects", [])) if ae else 0
    leftover = list(ae.get("leftover") or []) if ae else []
    box, box_cap = (int(ae.get("bin") or 0), bin_capacity(status)) if ae else (0, 0)
    state = ps.get("state", "")
    if wh.get("state") in ("shutdown", "error"):
        phase, reason = "stopped", "shutdown"
    elif ae and ae.get("busy") and ae.get("bg"):
        # cooling with the printer free: it takes "push now" and "bed is clear"
        phase, reason = "ejecting", "cooling" if ae.get("cooling") else ""
    elif ae and ae.get("busy") and (state == "printing" or status.get("idle_timeout", {}).get("state") == "Printing"):
        # the flag alone stays set when an error stops the eject
        phase, reason = "ejecting", ""
    elif state == "printing":
        phase, reason = "printing", ""
    elif state == "paused":
        phase, reason = "paused", "paused"
    elif leftover:
        phase, reason = "needs", "leftover"
    elif state == "error":
        phase, reason = "needs", "error"
    elif parts:
        phase, reason = "needs", "parts"
    elif box_cap and box >= box_cap:
        phase, reason = "needs", "bin"
    elif not ae and state in ("complete", "cancelled"):
        # without auto-eject, the print is still on the bed until someone says so
        phase, reason = "needs", "done" if state == "complete" else "cancelled"
    elif queue.get("queue_state") == "paused" and jobs:
        phase, reason = "needs", "queue"
    else:
        phase, reason = "idle", ""
    card = {
        "phase": phase, "reason": reason, "state": state, "filename": ps.get("filename", ""),
        "message": wh.get("state_message", "") if phase == "stopped" else ps.get("message", ""),
        "progress": round(progress, 4),
        "eta": round(duration * (1 - progress) / progress) if phase == "printing" and progress > 0.01 else None,
        "layer": (ps.get("info") or {}).get("current_layer"), "layers": (ps.get("info") or {}).get("total_layer"),
        "bed": status.get("heater_bed", {}).get("temperature"), "bed_target": status.get("heater_bed", {}).get("target"),
        "nozzle": status.get("extruder", {}).get("temperature"),
        "parts": parts, "leftover": leftover, "height": ae.get("height") if ae else None,
        "auto_eject": ae is not None, "jobs": jobs, "queue": queue.get("queue_state", ""),
        "bin": box, "bin_cap": box_cap,
    }
    return card


def history_stats(totals, jobs, now=None):
    """Hours printed, and how the recent jobs and today's ended, from
    Moonraker's print history (job_totals, and the newest jobs first)."""
    now = now or time.time()
    lt = time.localtime(now)
    midnight = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))
    ended = [j for j in jobs or [] if j.get("status") not in (None, "in_progress")]
    today = [j for j in ended if (j.get("end_time") or j.get("start_time") or 0) >= midnight]
    totals = totals or {}
    return {
        "hours": round((totals.get("total_print_time") or 0) / 3600.0, 1),
        "jobs": int(totals.get("total_jobs") or 0),
        "recent": len(ended),
        "recent_ok": sum(1 for j in ended if j.get("status") == "completed"),
        "today_ok": sum(1 for j in today if j.get("status") == "completed"),
        "today_bad": sum(1 for j in today if j.get("status") != "completed"),
    }


# grams in a millimetre of 1.75 mm filament at PLA's 1.24 g/cm3, when a
# file does not say what it weighs
GRAMS_PER_MM = 3.1416 * 0.875 ** 2 * 1.24 / 1000.0
REPORT_PERIODS = {"today": None, "7": 7, "30": 30}


def report_since(period, now=None):
    """The start of a report's period: today's midnight, or so many days ago."""
    now = now or time.time()
    lt = time.localtime(now)
    midnight = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))
    days = REPORT_PERIODS[period]
    return midnight if days is None else midnight - (days - 1) * 86400


def production(jobs, since):
    """What a printer made since a time, from its print history: the prints
    that ended, how many ended well, the hours and the filament."""
    ended = [j for j in jobs or [] if j.get("status") not in (None, "in_progress")
             and (j.get("end_time") or j.get("start_time") or 0) >= since]
    ok = [j for j in ended if j.get("status") == "completed"]
    grams = 0.0
    for j in ended:
        md = j.get("metadata") or {}
        used, total, weight = j.get("filament_used") or 0.0, md.get("filament_total"), md.get("filament_weight_total")
        grams += weight * min(1.0, used / total) if weight and total else used * GRAMS_PER_MM
    files = collections.Counter(os.path.basename(j.get("filename") or "") for j in ok if j.get("filename"))
    return {"jobs": len(ended), "ok": len(ok), "stopped": len(ended) - len(ok),
            "rate": round(100.0 * len(ok) / len(ended)) if ended else None,
            "hours": round(sum(j.get("print_duration") or 0.0 for j in ended) / 3600.0, 1),
            "grams": int(round(grams)), "top": [[f, n] for f, n in files.most_common(3)]}
