#!/usr/bin/env python3
"""Add or remove a network in Moonraker's [authorization] trusted_clients.

Used by install.sh --remote, so devices on a Tailscale network can use
Mainsail and the auto-eject page without logging in.

    moonraker_trust.py add    <moonraker.conf> <network>
    moonraker_trust.py remove <moonraker.conf> <network>

Prints one word: added, present, removed, absent or no-authorization
(Moonraker has no [authorization] section, so it trusts every client
already). The line it adds is marked with a comment so remove only takes
out what add put in.
"""

import re
import sys

MARK = "# klipper-auto-eject: remote access"


def _section(lines, name):
    """(start, end) line indexes of a section's body, or None."""
    start = None
    for i, line in enumerate(lines):
        if re.match(r"^\[\s*%s\s*\]\s*$" % re.escape(name), line):
            start = i + 1
        elif start is not None and re.match(r"^\[", line):
            return start, i
    return (start, len(lines)) if start is not None else None


def _option(lines, start, end, key):
    """(first, last) line indexes of a possibly multi-line option, or None."""
    for i in range(start, end):
        if re.match(r"^%s\s*[:=]" % re.escape(key), lines[i]):
            last = i
            for j in range(i + 1, end):
                if lines[j].strip() == "" or not lines[j][:1].isspace():
                    break
                last = j
            return i, last
    return None


def _values(lines, first, last):
    out = [lines[first].split(":", 1)[-1].split("=", 1)[-1].strip()]
    out += [l.strip() for l in lines[first + 1:last + 1]]
    return [v for v in out if v and not v.startswith("#")]


def add(lines, network):
    sec = _section(lines, "authorization")
    if sec is None:
        return lines, "no-authorization"
    opt = _option(lines, sec[0], sec[1], "trusted_clients")
    new = ["    %s\n" % MARK, "    %s\n" % network]
    if opt is None:
        at = sec[0]
        return lines[:at] + ["trusted_clients:\n"] + new + lines[at:], "added"
    if network in _values(lines, *opt):
        return lines, "present"
    at = opt[1] + 1
    return lines[:at] + new + lines[at:], "added"


def remove(lines, network):
    for i in range(len(lines) - 1):
        if lines[i].strip() == MARK and lines[i + 1].strip() == network:
            return lines[:i] + lines[i + 2:], "removed"
    return lines, "absent"


def main(argv):
    if len(argv) != 4 or argv[1] not in ("add", "remove"):
        sys.exit(__doc__)
    path, network = argv[2], argv[3]
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"
    lines, result = (add if argv[1] == "add" else remove)(lines, network)
    if result in ("added", "removed"):
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(lines)
    print(result)


if __name__ == "__main__":
    main(sys.argv)
