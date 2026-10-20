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
