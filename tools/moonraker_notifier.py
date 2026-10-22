#!/usr/bin/env python3
"""Moonraker [notifier] sections that send auto-eject's messages to ntfy,
Telegram or Discord.

Used by install.sh --notify.

    moonraker_notifier.py topic   <moonraker.conf>   the ntfy topic set up already
    moonraker_notifier.py kind    <moonraker.conf>   ntfy, telegram, discord, other, or nothing
    moonraker_notifier.py url     <moonraker.conf>   the address set up already
    moonraker_notifier.py add     <moonraker.conf> <to> <click-url> <job events>
    moonraker_notifier.py remove  <moonraker.conf>
    moonraker_notifier.py discord <webhook link>     the address for a Discord webhook
    moonraker_notifier.py bot     <bot token>        the Telegram bot's name, if the token works
    moonraker_notifier.py chat    <bot token>        "<chat id><tab><name>" of the last message
                                                     sent to the bot

<to> is an ntfy topic, or an Apprise address (Moonraker sends with Apprise):
tgram://<bot token>/<chat id> for Telegram, discord://<id>/<token> for a
Discord webhook.

Two sections:
  [notifier auto_eject]       events: gcode   the macros' own messages
                                              (a part still on the bed, ...)
  [notifier auto_eject_jobs]  events: <job events>, e.g. "complete, error,
                                              cancelled"; left out if empty

Both go to the same place. An ntfy topic can be read by anyone who knows
its name, so it is random; a Telegram token or a Discord webhook lets
anyone post, so keep moonraker.conf to yourself. "topic" and "url" print
what is set up already, so running the installer again keeps it.
"""

import json
import re
import sys
import urllib.request

NAMES = ("auto_eject", "auto_eject_jobs")
MARK = "# klipper-auto-eject: notifications on your phone (docs/notifications.md)"
TOKEN = re.compile(r"^\d{5,}:[A-Za-z0-9_-]{30,}$")
WEBHOOK = re.compile(r"^https?://(?:(?:ptb|canary)\.)?discord(?:app)?\.com/api/webhooks/(\d+)/([A-Za-z0-9_-]+)/?$")


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


def url(lines):
    """The url of [notifier auto_eject], or ""."""
    inside = False
    for line in lines:
        head = re.match(r"^\[\s*notifier\s+(\S+)\s*\]", line)
        if head or re.match(r"^\[", line):
            inside = bool(head) and head.group(1) == "auto_eject"
            continue
        m = re.match(r"^url\s*[:=]\s*(\S+)", line) if inside else None
        if m:
            return m.group(1)
    return ""


def topic(lines):
    m = re.match(r"^ntfys?://(?:[^/@?]*@)?(?:[^/?]*/)?([A-Za-z0-9_-]+)", url(lines))
    return m.group(1) if m else ""


def kind(lines):
    scheme = url(lines).split("://", 1)[0].lower()
    if not scheme:
        return ""
    return {"ntfy": "ntfy", "ntfys": "ntfy", "tgram": "telegram", "discord": "discord"}.get(scheme, "other")


def add(lines, to, click, job_events):
    if "://" in to:          # Telegram, Discord or any Apprise address: as it is
        first = second = to
    else:                    # an ntfy topic: high priority, and a tap opens the page
        query = "?click=%s" % click if click else ""
        sep = "&" if query else "?"
        first = "ntfys://%s%s%spriority=high&tags=warning" % (to, query, sep)
        second = "ntfys://%s%s%stags=printer" % (to, query, sep)
    out = _strip(lines)
    out += ["\n", MARK + "\n",
            "[notifier auto_eject]\n",
            "url: %s\n" % first,
            "events: gcode\n",
            "title: Auto-eject\n",
            "body: {event_message}\n"]
    if job_events.strip():
        out += ["\n",
                "[notifier auto_eject_jobs]\n",
                "url: %s\n" % second,
                "events: %s\n" % job_events.strip(),
                "title: Print {event_name}\n",
                "body: {event_args[1].filename}{(': ' ~ event_args[1].message) if event_args[1].message else ''}\n"]
    return out


def discord(link):
    """discord://<id>/<token> for a webhook link copied from Discord, or ""."""
    link = link.strip()
    m = WEBHOOK.match(link)
    if m:
        return "discord://%s/%s" % m.groups()
    return link if re.match(r"^discord://\d+/[A-Za-z0-9_-]+$", link) else ""


def _telegram(token, method, opener):
    if not TOKEN.match(token.strip()):
        return None
    try:
        with opener("https://api.telegram.org/bot%s/%s" % (token.strip(), method), timeout=15) as r:
            answer = json.load(r)
    except Exception:
        return None
    return answer.get("result") if answer.get("ok") else None


def bot(token, opener=urllib.request.urlopen):
    """The bot's @name when Telegram knows the token, else ""."""
    me = _telegram(token, "getMe", opener)
    return str(me.get("username") or "") if isinstance(me, dict) else ""


def chat(token, opener=urllib.request.urlopen):
    """(chat id, name) of the last message sent to the bot, or None."""
    updates = _telegram(token, "getUpdates", opener)
    for u in reversed(updates or []):
        msg = u.get("message") or u.get("channel_post") or (u.get("my_chat_member") or {})
        c = msg.get("chat") if isinstance(msg, dict) else None
        if c and "id" in c:
            name = c.get("title") or " ".join(x for x in (c.get("first_name"), c.get("last_name")) if x) or c.get("username") or ""
            return str(c["id"]), name
    return None


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd in ("discord", "bot", "chat") and len(argv) == 3:
        if cmd == "discord":
            print(discord(argv[2]))
        elif cmd == "bot":
            print(bot(argv[2]))
        else:
            found = chat(argv[2])
            print("%s\t%s" % found if found else "")
        return
    if len(argv) < 3 or cmd not in ("topic", "kind", "url", "add", "remove") or (cmd == "add" and len(argv) != 6):
        sys.exit(__doc__)
    path = argv[2]
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"
    if cmd in ("topic", "kind", "url"):
        print({"topic": topic, "kind": kind, "url": url}[cmd](lines))
        return
    new = add(lines, argv[3], argv[4], argv[5]) if cmd == "add" else _strip(lines)
    if cmd == "remove" and new:
        new[-1] = new[-1] if new[-1].endswith("\n") else new[-1] + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(new)
    print("added" if cmd == "add" else ("removed" if new != lines else "absent"))


if __name__ == "__main__":
    main(sys.argv)
