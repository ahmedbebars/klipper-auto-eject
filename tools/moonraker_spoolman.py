#!/usr/bin/env python3
"""Link Moonraker to Spoolman: the [spoolman] section of moonraker.conf.

Used by install.sh --spoolman, so the queue is checked against what is left
on the printer's spool (docs/spoolman.md).

    moonraker_spoolman.py server <moonraker.conf>        the address it is linked to, if any
    moonraker_spoolman.py url    <address>               the address as Moonraker wants it
    moonraker_spoolman.py check  <url>                   Spoolman's version, if it answers there
    moonraker_spoolman.py add    <moonraker.conf> <url>  added, present or changed

An address the user types, such as 192.168.1.50, 192.168.1.50:7912 or a
link copied from Spoolman's page, becomes http://192.168.1.50:7912: the
port is Spoolman's own (7912) when none is given, and the page's path is
dropped. url prints nothing for something that is not an address.
"""

import json
import re
import sys
import urllib.parse
import urllib.request

PORT = 7912            # Spoolman's port when it is installed
MARK = "# klipper-auto-eject: Spoolman (docs/spoolman.md)"
HOST = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.-]{0,252}[A-Za-z0-9])?$")


def url(address):
    text = str(address or "").strip()
    if not text or re.search(r"\s", text):
        return ""
    typed_scheme = "://" in text
    parts = urllib.parse.urlsplit(text if typed_scheme else "http://" + text)
    try:
        port = parts.port
    except ValueError:
        return ""
    host = parts.hostname or ""
    if parts.scheme not in ("http", "https") or not HOST.match(host):
        return ""
    if port is None and not typed_scheme:
        port = PORT
    return "%s://%s%s" % (parts.scheme, host, ":%d" % port if port else "")


def _section(lines, name):
    """(header, end) line indexes of a section, or None."""
    start = None
    for i, line in enumerate(lines):
        if re.match(r"^\[\s*%s\s*\]\s*$" % re.escape(name), line):
            start = i
        elif start is not None and re.match(r"^\[", line):
            return start, i
    return (start, len(lines)) if start is not None else None


def server(lines):
    sec = _section(lines, "spoolman")
    if sec is None:
        return ""
    for line in lines[sec[0] + 1:sec[1]]:
        m = re.match(r"^server\s*[:=]\s*(\S+)", line)
        if m:
            return m.group(1)
    return ""


def add(lines, address):
    sec = _section(lines, "spoolman")
    if sec is None:
        head = [] if not lines or lines[-1].strip() == "" else ["\n"]
        return lines + head + [MARK + "\n", "[spoolman]\n", "server: %s\n" % address], "added"
    for i in range(sec[0] + 1, sec[1]):
        if re.match(r"^server\s*[:=]", lines[i]):
            if lines[i].split(":", 1)[-1].split("=", 1)[-1].strip() == address:
                return lines, "present"
            return lines[:i] + ["server: %s\n" % address] + lines[i + 1:], "changed"
    at = sec[0] + 1
    return lines[:at] + ["server: %s\n" % address] + lines[at:], "changed"


def check(address, opener=urllib.request.urlopen):
    """Spoolman's version when it answers at the address, else ""."""
    try:
        with opener(address.rstrip("/") + "/api/v1/info", timeout=5) as r:
            info = json.load(r)
    except Exception:
        return ""
    return str(info.get("version") or "?") if isinstance(info, dict) else ""


def main(argv):
    if len(argv) < 3 or argv[1] not in ("server", "url", "check", "add") or (argv[1] == "add") != (len(argv) == 4):
        sys.exit(__doc__)
    cmd = argv[1]
    if cmd == "url":
        print(url(argv[2]))
        return
    if cmd == "check":
        print(check(argv[2]))
        return
    with open(argv[2], encoding="utf-8") as f:
        lines = f.readlines()
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"
    if cmd == "server":
        print(server(lines))
        return
    lines, result = add(lines, argv[3])
    if result != "present":
        with open(argv[2], "w", encoding="utf-8", newline="\n") as f:
            f.writelines(lines)
    print(result)


if __name__ == "__main__":
    main(sys.argv)
