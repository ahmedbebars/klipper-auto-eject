#!/usr/bin/env python3
"""Run AUTO_EJECT_GUARD from DEMON Klipper Essentials' first print-start hook.

DEMON stops the printer when its DEMON_START has not come a few seconds into
a print, so the guard cannot run first in the slicer's start G-code. Its
_CUSTOM_PRE_START hook runs inside DEMON_START, before heating and homing:
the guard goes there. Used by install.sh.

    demon_hook.py add    <demon_custom_expansion.cfg>
    demon_hook.py remove <demon_custom_expansion.cfg>
    demon_hook.py status <demon_custom_expansion.cfg>

Prints one word: added, present, removed, absent, or not-demon (the file has
no _CUSTOM_PRE_START or no _CUSTOM_EXPANSION_ACTIVE_LIST). add turns on
variable_ceal_master_enable and variable_pre_start and puts
"AUTO_EJECT_GUARD FROM=DEMON" first in _CUSTOM_PRE_START, keeping what is
there. remove takes the line out and leaves the switches: an empty hook does
nothing.
"""

import re
import sys

LINE = "  AUTO_EJECT_GUARD FROM=DEMON"
SWITCHES = ("variable_ceal_master_enable", "variable_pre_start")
GUARD = re.compile(r"^\s+AUTO_EJECT_GUARD\b(?P<rest>.*)$", re.I)


def _section(lines, macro):
    """(start, end) line indexes of a gcode_macro section's body, or None. A
    comment may follow the header, as DEMON writes them."""
    start = None
    for i, line in enumerate(lines):
        if re.match(r"^\[\s*gcode_macro\s+%s\s*\]" % re.escape(macro), line, re.I):
            start = i + 1
        elif start is not None and re.match(r"^\[", line):
            return start, i
    return (start, len(lines)) if start is not None else None


def _gcode(lines, sec):
    """(the gcode: line, the end of its body) in a section."""
    for i in range(*sec):
        if re.match(r"^gcode\s*[:=]", lines[i], re.I):
            end = i + 1
            while end < sec[1] and (lines[end][:1].isspace() or lines[end].strip() == "" or lines[end].lstrip().startswith("#")):
                end += 1
            return i, end
    return None


def _on(lines, sec, key):
    for i in range(*sec):
        m = re.match(r"^(%s\s*[:=]\s*)(\S+)(.*)$" % key, lines[i], re.I | re.S)
        if m:
            return m.group(2).lower() == "true", i, m
    return False, None, None


def status(lines):
    sw, hook = _section(lines, "_CUSTOM_EXPANSION_ACTIVE_LIST"), _section(lines, "_CUSTOM_PRE_START")
    if sw is None or hook is None:
        return "not-demon"
    g = _gcode(lines, hook)
    ours = g is not None and any(_ours(lines[j]) for j in range(g[0] + 1, g[1]))
    return "present" if ours and all(_on(lines, sw, k)[0] for k in SWITCHES) else "absent"


def _ours(line):
    m = GUARD.match(line)
    return bool(m and re.search(r"\bFROM\s*=\s*DEMON\b", m.group("rest"), re.I))


def add(lines, nl="\n"):
    state = status(lines)
    if state != "absent":
        return lines, state
    lines = list(lines)
    sw = _section(lines, "_CUSTOM_EXPANSION_ACTIVE_LIST")
    for key in SWITCHES:
        on, i, m = _on(lines, sw, key)
        if i is not None and not on:
            lines[i] = m.group(1) + "True" + m.group(3)
        elif i is None:
            lines.insert(sw[0], "%s: True%s" % (key, nl))
            sw = (sw[0], sw[1] + 1)
    hook = _section(lines, "_CUSTOM_PRE_START")
    g = _gcode(lines, hook)
    if g is None:
        lines[hook[0]:hook[0]] = ["gcode:" + nl, LINE + nl]
        return lines, "added"
    # a plain guard put there by hand becomes ours
    lines[g[0] + 1:g[1]] = [l for l in lines[g[0] + 1:g[1]] if not GUARD.match(l)]
    inline = re.sub(r"^gcode\s*[:=]", "", lines[g[0]], flags=re.I).strip()
    if inline and not inline.startswith("#"):
        # "gcode: X": the guard must come before X
        lines[g[0]:g[0] + 1] = ["gcode:" + nl, LINE + nl, "  " + inline + nl]
    else:
        lines.insert(g[0] + 1, LINE + nl)
    return lines, "added"


def remove(lines):
    hook = _section(lines, "_CUSTOM_PRE_START")
    if hook is None:
        return lines, "not-demon"
    out = [l for i, l in enumerate(lines) if not (hook[0] <= i < hook[1] and GUARD.match(l))]
    return out, "removed" if len(out) != len(lines) else "absent"


def main(argv):
    if len(argv) != 3 or argv[1] not in ("add", "remove", "status"):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    path = argv[2]
    try:
        with open(path, encoding="utf-8", newline="") as f:      # its own line ends, kept
            lines = f.readlines()
    except OSError:
        print("not-demon")
        return 0
    nl = "\r\n" if lines and lines[0].endswith("\r\n") else "\n"
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += nl
    if argv[1] == "status":
        print(status(lines))
        return 0
    new, result = add(lines, nl) if argv[1] == "add" else remove(lines)
    if result in ("added", "removed"):
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.writelines(new)
    print(result)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
