#!/usr/bin/env python3
"""Moonraker [notifier] sections that send auto-eject's messages to ntfy.

Used by install.sh --notify.

    moonraker_notifier.py topic  <moonraker.conf>
    moonraker_notifier.py add    <moonraker.conf> <topic> <click-url> <job events>
    moonraker_notifier.py remove <moonraker.conf>

Two sections:
  [notifier auto_eject]       events: gcode   the macros' own messages
                                              (a part still on the bed, ...)
  [notifier auto_eject_jobs]  events: <job events>, e.g. "complete, error,
                                              cancelled"; left out if empty

Both post to the same ntfy topic on ntfy.sh. Anyone who knows a topic name
can read it, so it is random. "topic" prints the topic already set up, so
running the installer again keeps the phone's subscription.
"""

import re
import sys

NAMES = ("auto_eject", "auto_eject_jobs")
MARK = "# klipper-auto-eject: notifications on your phone (docs/notifications.md)"


def _strip(lines):
    """lines without our sections and their marker comment."""
    out, skip = [], False
    for line in lines:
        head = re.match(r"^\[\s*notifier\s+(\S+)\s*\]", line)
        if head:
            skip = head.group(1) in NAMES
        elif re.match(r"^\[", line):
            skip = False
        if not skip and line.strip() != MARK:
            out.append(line)
    while out and out[-1].strip() == "":
        out.pop()
    return out


def topic(lines):
    inside = False
    for line in lines:
        head = re.match(r"^\[\s*notifier\s+(\S+)\s*\]", line)
        if head or re.match(r"^\[", line):
            inside = bool(head) and head.group(1) == "auto_eject"
            continue
        m = re.match(r"^url\s*[:=]\s*ntfys?://(?:[^/@?]*@)?(?:[^/?]*/)?([A-Za-z0-9_-]+)", line) if inside else None
        if m:
            return m.group(1)
    return ""


def add(lines, topic_name, click, job_events):
    query = "?click=%s" % click if click else ""
    sep = "&" if query else "?"
    out = _strip(lines)
    out += ["\n", MARK + "\n",
            "[notifier auto_eject]\n",
            "url: ntfys://%s%s%spriority=high&tags=warning\n" % (topic_name, query, sep),
            "events: gcode\n",
            "title: Auto-eject\n",
            "body: {event_message}\n"]
    if job_events.strip():
        out += ["\n",
                "[notifier auto_eject_jobs]\n",
                "url: ntfys://%s%s%stags=printer\n" % (topic_name, query, sep),
                "events: %s\n" % job_events.strip(),
                "title: Print {event_name}\n",
                "body: {event_args[1].filename}{(': ' ~ event_args[1].message) if event_args[1].message else ''}\n"]
    return out


def main(argv):
    if len(argv) < 3 or argv[1] not in ("topic", "add", "remove") or (argv[1] == "add" and len(argv) != 6):
        sys.exit(__doc__)
    path = argv[2]
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"
    if argv[1] == "topic":
        print(topic(lines))
        return
    new = add(lines, argv[3], argv[4], argv[5]) if argv[1] == "add" else _strip(lines)
    if argv[1] == "remove" and new:
        new[-1] = new[-1] if new[-1].endswith("\n") else new[-1] + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(new)
    print("added" if argv[1] == "add" else ("removed" if new != lines else "absent"))


if __name__ == "__main__":
    main(sys.argv)
