"""install.sh --notify: the ntfy [notifier] sections in moonraker.conf."""

import configparser
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))

import moonraker_notifier as mn  # noqa: E402

CONF = """[server]
port: 7125

[notifier telegram]
url: tgram://bot/chat
events: error
"""
CLICK = "https://voron.example.ts.net/auto-eject/"


def lines(text):
    return text.splitlines(keepends=True)


def parse(text):
    p = configparser.ConfigParser(interpolation=None)     # how Moonraker reads it
    p.read_string(text)
    return p


def test_adds_both_sections():
    text = "".join(mn.add(lines(CONF), "auto-eject-1a2b3c", CLICK, "complete, error, cancelled"))
    p = parse(text)
    gcode, jobs = p["notifier auto_eject"], p["notifier auto_eject_jobs"]
    assert gcode["url"] == "ntfys://auto-eject-1a2b3c?click=%s&priority=high&tags=warning" % CLICK
    assert gcode["events"] == "gcode" and gcode["body"] == "{event_message}"
    assert jobs["events"] == "complete, error, cancelled"
    assert jobs["url"].startswith("ntfys://auto-eject-1a2b3c?click=")
    assert p["notifier telegram"]["url"] == "tgram://bot/chat"          # the user's own is kept


def test_without_job_events_only_the_macro_messages():
    p = parse("".join(mn.add(lines(CONF), "t", "", "")))
    assert p["notifier auto_eject"]["url"] == "ntfys://t?priority=high&tags=warning"
    assert not p.has_section("notifier auto_eject_jobs")


def test_running_again_keeps_the_topic_and_replaces_the_sections():
    once = mn.add(lines(CONF), "auto-eject-1a2b3c", CLICK, "error")
    assert mn.topic(once) == "auto-eject-1a2b3c"
    twice = mn.add(once, mn.topic(once), CLICK, "complete, error")
    p = parse("".join(twice))
    assert p["notifier auto_eject_jobs"]["events"] == "complete, error"
    assert "".join(twice).count("[notifier auto_eject]") == 1


def test_remove_restores_the_file():
    added = mn.add(lines(CONF), "t", CLICK, "error")
    assert "".join(mn._strip(added)) == CONF


def test_no_topic_yet():
    assert mn.topic(lines(CONF)) == ""


def test_command_line(tmp_path, capsys):
    path = tmp_path / "moonraker.conf"
    path.write_text(CONF, encoding="utf-8")
    mn.main(["x", "add", str(path), "auto-eject-ff", CLICK, "complete"])
    assert capsys.readouterr().out.strip() == "added"
    mn.main(["x", "topic", str(path)])
    assert capsys.readouterr().out.strip() == "auto-eject-ff"
    mn.main(["x", "remove", str(path)])
    assert capsys.readouterr().out.strip() == "removed"
    assert parse(path.read_text(encoding="utf-8")).sections() == ["server", "notifier telegram"]


# ------------------------------------------------------- Telegram and Discord
TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
HOOK = "https://discord.com/api/webhooks/1234567890/AbC-dEf_123"


def answers(**by_method):
    """A fake opener for Telegram's API: {method: result}, None for an error."""
    import io
    import json as _json
    asked = []

    def opener(address, timeout):
        asked.append(address)
        method = address.rsplit("/", 1)[1]
        result = by_method.get(method)
        if result is None:
            raise OSError("401 Unauthorized")
        return io.BytesIO(_json.dumps({"ok": True, "result": result}).encode())
    opener.asked = asked
    return opener


def test_telegram_and_discord_addresses_are_written_as_they_are():
    to = "tgram://%s/987654321" % TOKEN
    p = parse("".join(mn.add(lines(CONF), to, CLICK, "complete, error")))
    assert p["notifier auto_eject"]["url"] == to and p["notifier auto_eject_jobs"]["url"] == to
    assert p["notifier auto_eject"]["events"] == "gcode"
    p = parse("".join(mn.add(lines(CONF), "discord://1234567890/AbC-dEf_123", "", "")))
    assert p["notifier auto_eject"]["url"] == "discord://1234567890/AbC-dEf_123"


def test_which_service_and_its_address():
    assert mn.kind(lines(CONF)) == "" and mn.url(lines(CONF)) == ""     # the user's own [notifier telegram] is not ours
    assert mn.kind(mn.add(lines(CONF), "auto-eject-ff", "", "")) == "ntfy"
    tg = mn.add(lines(CONF), "tgram://%s/1" % TOKEN, "", "")
    assert mn.kind(tg) == "telegram" and mn.url(tg) == "tgram://%s/1" % TOKEN and mn.topic(tg) == ""
    assert mn.kind(mn.add(lines(CONF), "discord://1/x", "", "")) == "discord"
    assert mn.kind(mn.add(lines(CONF), "mailto://me@example.com", "", "")) == "other"


def test_a_discord_webhook_link_becomes_an_address():
    assert mn.discord(HOOK) == "discord://1234567890/AbC-dEf_123"
    assert mn.discord(" https://discordapp.com/api/webhooks/1/x/ ") == "discord://1/x"
    assert mn.discord("https://ptb.discord.com/api/webhooks/1/x") == "discord://1/x"
    assert mn.discord("discord://1/x") == "discord://1/x"
    assert mn.discord("https://example.com/api/webhooks/1/x") == ""
    assert mn.discord("hello") == ""


def test_the_telegram_bot_and_the_chat_that_wrote_to_it():
    op = answers(getMe={"username": "my_printer_bot"},
                 getUpdates=[{"update_id": 1, "message": {"chat": {"id": 111, "first_name": "Old"}}},
                             {"update_id": 2, "message": {"chat": {"id": 222, "first_name": "Ahmed", "last_name": "B"}}}])
    assert mn.bot(TOKEN, opener=op) == "my_printer_bot"
    assert mn.chat(TOKEN, opener=op) == ("222", "Ahmed B")            # the last message
    assert op.asked[0] == "https://api.telegram.org/bot%s/getMe" % TOKEN
    groups = answers(getUpdates=[{"update_id": 3, "message": {"chat": {"id": -100123, "title": "Print farm"}}}])
    assert mn.chat(TOKEN, opener=groups) == ("-100123", "Print farm")


def test_nothing_from_telegram_means_nothing():
    assert mn.chat(TOKEN, opener=answers(getUpdates=[])) is None        # no message sent yet
    assert mn.bot(TOKEN, opener=answers()) == ""                         # Telegram does not know the token
    asked = answers(getMe={"username": "x"})
    assert mn.bot("not a token", opener=asked) == "" and asked.asked == []   # not even sent
