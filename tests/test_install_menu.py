"""install.sh asks what to set up on one screen of tick boxes (whiptail)."""
import os
import pathlib
import re
import subprocess

import pytest

from test_install_includes import BASH, needs_bash

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Stands in for whiptail: each checklist call answers with the next line of
# $ANSWERS (the ticked tags, or ESC); every call is written down.
FAKE_WHIPTAIL = r"""#!/usr/bin/env bash
for a in "$@"; do
    if [[ "$a" == --msgbox ]]; then printf '%s\n' "$*" >> "$LOG/msgs"; exit 0; fi
done
n=$(cat "$LOG/n" 2>/dev/null || echo 0)
echo $((n + 1)) > "$LOG/n"
printf '%s\n' "$*" >> "$LOG/calls"
line=$(sed -n "$((n + 1))p" "$ANSWERS")
[[ "$line" == ESC ]] && exit 255
for t in $line; do echo "$t" >&2; done
"""


def functions():
    text = (ROOT / "install.sh").read_text(encoding="utf-8")
    out = []
    for name in ("log", "pick_with_menu"):
        m = re.search(r"^%s\(\) \{.*?^\}\n" % name, text, re.S | re.M) or \
            re.search(r"^%s\(\) +\{.*\}\n" % name, text, re.M)
        assert m, name
        out.append(m.group(0))
    return "\n".join(out)


def menu(tmp_path, answers, found="", plain=0, whiptail=True):
    """Run pick_with_menu; returns (exit code, the choices, stdout, calls, messages)."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    if whiptail:
        fake = bin_dir / "whiptail"
        fake.write_text(FAKE_WHIPTAIL, encoding="utf-8", newline="\n")
        fake.chmod(0o755)
    (tmp_path / "answers").write_text("\n".join(answers) + "\n", encoding="utf-8")
    script = (functions() + "\nADD_INCLUDE=1 WEB=0 REMOTE=0 PUSH=0 FARM=0 NOTIFY=0 SPOOLMAN=0\n"
              'PLAIN=%d SPOOLMAN_FOUND="%s"\n' % (plain, found)
              + 'pick_with_menu; rc=$?\n'
              'echo "rc=$rc $ADD_INCLUDE$WEB$REMOTE$PUSH$FARM$NOTIFY$SPOOLMAN"\n')
    path = os.pathsep.join([str(bin_dir), os.environ.get("PATH", "")]) if whiptail else str(bin_dir)
    env = dict(os.environ, LOG=tmp_path.as_posix(), ANSWERS=(tmp_path / "answers").as_posix(), PATH=path)
    res = subprocess.run([BASH, "-c", script], env=env, capture_output=True, text=True)
    read = lambda name: (tmp_path / name).read_text(encoding="utf-8") if (tmp_path / name).exists() else ""
    m = re.search(r"rc=(\d+) (\d{7})", res.stdout)
    return res.returncode, (int(m.group(1)), m.group(2)) if m else None, res.stdout, read("calls"), read("msgs")


@needs_bash
def test_the_blade_and_the_page_are_ticked_first(tmp_path):
    _, (rc, picked), _, calls, _ = menu(tmp_path, ["blade web"])
    assert rc == 0
    assert "blade The blade pushes the prints off this printer ON" in calls
    assert "web The auto-eject page in Mainsail: bed, queue, settings ON" in calls
    assert "remote Your phone, from anywhere (a free Tailscale account) OFF" in calls
    assert "spoolman Spoolman: the queue stops before a spool runs out OFF" in calls
    assert picked == "1100000"


@needs_bash
def test_spoolman_found_on_the_network_is_ticked_with_its_address(tmp_path):
    _, (_, picked), _, calls, _ = menu(tmp_path, ["blade spoolman"], found="http://192.0.2.5:7912 0.22.1")
    assert "spoolman Spoolman at http://192.0.2.5:7912: stop before a spool runs out ON" in calls
    assert picked == "1000001"


@needs_bash
def test_every_choice_sets_its_part(tmp_path):
    _, (_, picked), _, _, _ = menu(tmp_path, ["web remote push notify"])
    assert picked == "0111010"           # no blade: only the page and the rest


@needs_bash
def test_the_farm_brings_its_notification_service(tmp_path):
    _, (_, picked), _, _, _ = menu(tmp_path, ["blade web farm"])
    assert picked == "1101100"


@needs_bash
def test_phone_notifications_without_phone_access_come_back_with_why(tmp_path):
    _, (_, picked), _, calls, msgs = menu(tmp_path, ["blade web push", "blade web remote push"])
    assert "need the phone access above" in msgs
    assert calls.count("--checklist") == 2
    # the second screen keeps what was ticked on the first
    assert "push Notifications on the phone (needs the line above) ON" in calls.splitlines()[1]
    assert picked == "1111000"


@needs_bash
def test_the_farm_without_the_page_comes_back_with_why(tmp_path):
    _, (_, picked), _, _, msgs = menu(tmp_path, ["farm", "web farm"])
    assert "part of the auto-eject page" in msgs
    assert picked == "0101100"


@needs_bash
def test_esc_stops_before_anything_is_changed(tmp_path):
    code, result, out, _, _ = menu(tmp_path, ["ESC"])
    assert code == 0 and result is None
    assert "Stopped: nothing was changed." in out


@pytest.mark.parametrize("kind", ["plain", "no whiptail"])
@needs_bash
def test_without_the_menu_the_questions_are_asked_one_by_one(tmp_path, kind):
    _, (rc, picked), _, calls, _ = menu(tmp_path, ["web"], plain=int(kind == "plain"), whiptail=kind == "plain")
    assert rc == 1 and calls == ""
    assert picked == "1000000"           # nothing changed: the questions come next
