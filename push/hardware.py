"""Hardware warnings for the phones: what the Hardware tab shows, watched all
the time by the notification service, so a fan that stops or a cable that
starts to fail is told even with the page closed.

Only what is certain: driver warnings, a hot motor (with its own sensor), a
board link resending data, an unhealthy CAN bus, a heater that cannot hold
its target, a fan with a speed sensor that stopped, the computer too hot or
short of voltage, memory or storage. Not StallGuard and not "coil open?":
both show while all is well. A condition must last before it is told, is
told once, and is told again only after it has cleared.
"""

import re
import time
import urllib.parse

# the same levels as driverFlags() in web/model.js; open load is no alarm
DRIVER_FLAGS = {"ot": "bad", "s2ga": "bad", "s2gb": "bad", "s2vsa": "bad", "s2vsb": "bad", "t150": "bad",
                "t157": "bad", "uv_cp": "bad", "otpw": "warn", "t120": "warn", "t143": "warn"}
FLAG_TEXT = {
    "ot": ("the driver overheated", "سخن المشغّل أكثر من اللازم"),
    "otpw": ("the driver is getting hot", "المشغّل يسخن"),
    "s2ga": ("coil A is shorted to ground", "قِصر بين الملف A والأرضي"),
    "s2gb": ("coil B is shorted to ground", "قِصر بين الملف B والأرضي"),
    "s2vsa": ("coil A is shorted to the supply", "قِصر بين الملف A والتغذية"),
    "s2vsb": ("coil B is shorted to the supply", "قِصر بين الملف B والتغذية"),
    "t120": ("the driver is above 120 °C", "حرارة المشغّل فوق 120 °م"),
    "t143": ("the driver is above 143 °C", "حرارة المشغّل فوق 143 °م"),
    "t150": ("the driver is above 150 °C", "حرارة المشغّل فوق 150 °م"),
    "t157": ("the driver is above 157 °C", "حرارة المشغّل فوق 157 °م"),
    "uv_cp": ("the driver's supply dropped", "انخفض جهد تغذية المشغّل"),
}
TMC = re.compile(r"^(tmc\d{4})\s+(\S+)$")
FANS = ("fan", "heater_fan", "controller_fan", "fan_generic", "temperature_fan")
WINDOW = 600            # seconds for counting resent bytes and CAN errors
RESENT = 200            # bytes resent to a board within WINDOW that are worth telling
INVALID = 20            # corrupt bytes from a board within WINDOW
CAN_ERRORS = 20         # new CAN errors within WINDOW
MOTOR_HOT = (70, 80)    # a motor's own sensor: warn, bad (°C)
CPU_HOT = 80            # the computer's processor (°C)


def text(en, ar):
    return {"en": en, "ar": ar}


def motor_title(stepper):
    m = re.match(r"^stepper_([a-z])(\d*)$", stepper)
    if m:
        return m.group(1).upper() + m.group(2)
    m = re.match(r"^extruder(\d*)$", stepper)
    if m:
        return ("extruder " + m.group(1)).strip(), ("الباثق " + m.group(1)).strip()
    return stepper


def names(stepper):
    t = motor_title(stepper)
    return (t, t) if isinstance(t, str) else t


def board_names(obj):
    if obj == "mcu":
        return "the main board", "اللوحة الرئيسية"
    name = obj.split(" ", 1)[1]
    return name, name


def heater_names(obj):
    if obj == "heater_bed":
        return "The bed", "السرير"
    m = re.match(r"^extruder(\d*)$", obj)
    if m:
        return ("The hotend " + m.group(1)).strip(), ("رأس الطباعة " + m.group(1)).strip()
    name = obj.split(" ", 1)[-1].replace("_", " ")
    return name, name


def fan_stopped(fan):
    """A fan with a tachometer that should turn and does not."""
    return bool(fan) and isinstance(fan.get("rpm"), (int, float)) and (fan.get("speed") or 0) >= 0.25 and fan["rpm"] < 1


def heater_watch(state, heater, now):
    """The same as heaterWatch() in web/model.js: a heater that reached its
    target, then cannot hold it at full power for 30 s, or runs far above it."""
    st = dict({"target": None, "reached": False, "since": None}, **(state or {}))
    target, temp, power = heater.get("target") or 0, heater.get("temperature"), heater.get("power") or 0
    if target != st["target"]:
        st.update(target=target, reached=False, since=None)
    level = reason = None
    if target > 0 and isinstance(temp, (int, float)):
        if abs(temp - target) <= 2:
            st["reached"] = True
        if st["reached"] and temp < target - 5 and power >= 0.95:
            if st["since"] is None:
                st["since"] = now
            if now - st["since"] >= 30:
                level, reason = "warn", "cant_hold"
        else:
            st["since"] = None
        if temp > target + 15:
            level, reason = "bad", "above"
    else:
        st["since"] = None
    return st, level, reason


class Counter:
    """How much a counter grew over the last WINDOW seconds. It starts again
    from 0 when Klipper restarts."""

    def __init__(self):
        self.points = []

    def add(self, value, now):
        if not isinstance(value, (int, float)):
            return 0
        if self.points and value < self.points[-1][1]:
            self.points = []
        self.points.append((now, value))
        self.points = [p for p in self.points if now - p[0] <= WINDOW] or [(now, value)]
        return value - self.points[0][1]


class HardwareWatcher:
    """Looks at the machine every few seconds and returns new warnings:
    [("hardware", {"en": ..., "ar": ...}, level)]."""

    def __init__(self):
        self.objects = None       # what Klipper has, looked up again after a restart
        self.cond = {}            # key -> {"first", "last", "sent"}
        self.heat = {}
        self.counters = {}
        self.disk = None
        self.disk_at = None       # storage is looked at every ten minutes, first at once
        self.klippy = None

    # --------------------------------------------------------- conditions
    def _seen(self, key, level, message, now, hold, out):
        c = self.cond.setdefault(key, {"first": now, "sent": False})
        c["last"] = now
        if not c["sent"] and now - c["first"] >= hold:
            c["sent"] = True
            out.append(("hardware", message, level))

    def _sweep(self, now):
        # a condition gone for two minutes has cleared: it can be told again
        for key in [k for k, c in self.cond.items() if now - c["last"] > 120]:
            del self.cond[key]

    def _count(self, key, value, now):
        return self.counters.setdefault(key, Counter()).add(value, now)

    # -------------------------------------------------------------- check
    def check(self, moonraker, now=None):
        now = time.time() if now is None else now
        out = []
        try:
            self._klipper(moonraker, now, out)
        except Exception:
            self.objects = None          # Klipper restarting: look again next time
        try:
            self._computer(moonraker, now, out)
        except Exception:
            pass
        self._sweep(now)
        return out

    def _klipper(self, moonraker, now, out):
        state = moonraker.call("/printer/info").get("state")
        if state != "ready":
            self.objects = None
            return
        if self.objects is None:
            self.objects = moonraker.call("/printer/objects/list").get("objects") or []
            self.counters = {}
        objs = self.objects
        want = {}
        tmcs = [o for o in objs if TMC.match(o)]
        for o in tmcs:
            want[o] = "drv_status"
        motor_sensors = [o for o in objs if re.match(r"^temperature_(sensor|fan)\s+(motor|stepper)_", o, re.I)]
        for o in motor_sensors:
            want[o] = "temperature"
        mcus = [o for o in objs if o == "mcu" or o.startswith("mcu ")]
        for o in mcus:
            want[o] = "last_stats"
        cans = [o for o in objs if o.startswith("canbus_stats ")]
        for o in cans:
            want[o] = ""
        heaters = [o for o in objs if re.match(r"^(extruder\d*|heater_bed|heater_generic\s+\S+)$", o)]
        for o in heaters:
            want[o] = "temperature,target,power"
        fans = [o for o in objs if o.split(" ", 1)[0] in FANS]
        for o in fans:
            want[o] = "speed,rpm"
        if not want:
            return
        query = "&".join(urllib.parse.quote(k) + ("=" + v if v else "") for k, v in want.items())
        st = moonraker.call("/printer/objects/query?" + query).get("status") or {}

        for o in tmcs:
            stepper = TMC.match(o).group(2)
            en, ar = names(stepper)
            for flag, on in ((st.get(o) or {}).get("drv_status") or {}).items():
                if on and flag in DRIVER_FLAGS:
                    fen, far = FLAG_TEXT[flag]
                    self._seen("drv %s %s" % (o, flag), DRIVER_FLAGS[flag], text("Motor %s: %s" % (en, fen), "المحرك %s: %s" % (ar, far)), now, 5, out)
        for o in motor_sensors:
            t = (st.get(o) or {}).get("temperature")
            if isinstance(t, (int, float)) and t >= MOTOR_HOT[0]:
                name = o.split(" ", 1)[1].replace("_", " ")
                level = "bad" if t >= MOTOR_HOT[1] else "warn"
                self._seen("motor_hot %s %s" % (o, level), level, text("%s is at %.0f °C" % (name, t), "%s حرارته %.0f °م" % (name, t)), now, 60, out)
        for o in mcus:
            ls = (st.get(o) or {}).get("last_stats") or {}
            en, ar = board_names(o)
            resent = self._count(o + " resent", ls.get("bytes_retransmit"), now)
            if resent >= RESENT:
                self._seen("resent " + o, "warn", text(
                    "The link to %s is resending data (%d bytes in 10 minutes): check its cable and connectors." % (en, resent),
                    "الاتصال بـ%s يعيد إرسال البيانات (%d بايت في 10 دقائق): افحص الكابل والموصلات." % (ar, resent)), now, 0, out)
            invalid = self._count(o + " invalid", ls.get("bytes_invalid"), now)
            if invalid >= INVALID:
                self._seen("invalid " + o, "warn", text(
                    "Corrupt data from %s (%d bytes in 10 minutes): check its cable." % (en, invalid),
                    "بيانات تالفة من %s (%d بايت في 10 دقائق): افحص الكابل." % (ar, invalid)), now, 0, out)
        for o in cans:
            cs = st.get(o) or {}
            name = o.split(" ", 1)[1]
            bus = cs.get("bus_state")
            if bus and bus != "active":
                level = "warn" if bus == "warn" else "bad"
                en = {"warn": "warning level", "passive": "error passive", "off": "bus off"}.get(bus, bus)
                ar = {"warn": "مستوى تحذير", "passive": "أخطاء كثيرة", "off": "منفصل عن الناقل"}.get(bus, bus)
                self._seen("canstate %s %s" % (o, bus), level, text("CAN bus to %s: %s" % (name, en), "ناقل CAN إلى %s: %s" % (name, ar)), now, 10, out)
            errors = self._count(o + " errors", (cs.get("rx_error") or 0) + (cs.get("tx_error") or 0) + (cs.get("tx_retries") or 0), now)
            if errors >= CAN_ERRORS:
                self._seen("canerr " + o, "warn", text("%d CAN errors to %s in 10 minutes: check the CAN cable and its 120 Ω ends." % (errors, name),
                                                       "%d خطأ CAN إلى %s في 10 دقائق: افحص كابل CAN ومقاومتي 120 أوم في طرفيه." % (errors, name)), now, 0, out)
        for o in heaters:
            hs = st.get(o) or {}
            self.heat[o], level, reason = heater_watch(self.heat.get(o), hs, now)
            if level:
                en, ar = heater_names(o)
                msg = text("%s cannot hold %.0f °C at full power." % (en, hs.get("target") or 0),
                           "%s لا يستطيع الحفاظ على %.0f °م بأقصى قدرة." % (ar, hs.get("target") or 0)) if reason == "cant_hold" else \
                    text("%s is far above its target (%.0f °C)." % (en, hs.get("temperature") or 0),
                         "%s أسخن بكثير من المطلوب (%.0f °م)." % (ar, hs.get("temperature") or 0))
                self._seen("heater %s %s" % (o, reason), level, msg, now, 0, out)
        for o in fans:
            if fan_stopped(st.get(o)):
                if o == "fan":
                    msg = text("The part cooling fan is not turning.", "مروحة تبريد القطعة لا تدور.")
                else:
                    name = o.split(" ", 1)[1].replace("_", " ")
                    msg = text("The fan %s is not turning." % name, "المروحة %s لا تدور." % name)
                self._seen("fan " + o, "bad", msg, now, 10, out)

    def _computer(self, moonraker, now, out):
        p = moonraker.call("/machine/proc_stats")
        t = p.get("cpu_temp")
        if isinstance(t, (int, float)) and t >= CPU_HOT:
            self._seen("cpu_hot", "warn", text("The printer's computer is at %.0f °C." % t, "حرارة كمبيوتر الطابعة %.0f °م." % t), now, 60, out)
        flags = ((p.get("throttled_state") or {}).get("flags")) or []
        if any(f in ("Under-Voltage Detected", "Currently Throttled") for f in flags):
            self._seen("undervolt", "bad", text("The printer's computer has too little supply voltage: use a stronger power supply.",
                                                "جهد تغذية كمبيوتر الطابعة منخفض: استخدم مصدر كهرباء أقوى."), now, 5, out)
        mem = p.get("system_memory") or {}
        if mem.get("total") and mem.get("available", mem["total"]) / mem["total"] < 0.08:
            self._seen("memory", "warn", text("The printer's computer is running out of memory.", "ذاكرة كمبيوتر الطابعة على وشك النفاد."), now, 120, out)
        if self.disk_at is None or now - self.disk_at >= 600:
            self.disk_at = now
            try:
                self.disk = moonraker.call("/server/files/directory?path=gcodes&extended=false").get("disk_usage")
            except Exception:
                pass
        d = self.disk or {}
        if d.get("total") and d.get("free", d["total"]) < min(1e9, d["total"] * 0.05):
            self._seen("disk", "warn", text("Storage is nearly full: %.1f GB free." % (d["free"] / 1e9),
                                            "التخزين يكاد يمتلئ: %.1f GB فارغة." % (d["free"] / 1e9)), now, 0, out)
