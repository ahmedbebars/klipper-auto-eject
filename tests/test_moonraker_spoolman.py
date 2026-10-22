"""install.sh --spoolman: linking Moonraker to Spoolman in moonraker.conf."""

import configparser
import io
import json
import pathlib
import subprocess
import sys

import pytest

TOOLS = pathlib.Path(__file__).resolve().parent.parent / "tools"
sys.path.insert(0, str(TOOLS))

import moonraker_spoolman as ms  # noqa: E402

CONF = """[server]
host: 0.0.0.0
port: 7125

[authorization]
trusted_clients:
    192.168.0.0/16
"""


def lines(text):
    return text.splitlines(keepends=True)


def spoolman_server(text):
    # Moonraker reads its file with Python's configparser
    p = configparser.ConfigParser(interpolation=None)
    p.read_string(text)
    return p["spoolman"]["server"]


@pytest.mark.parametrize("typed, want", [
    ("192.168.1.50", "http://192.168.1.50:7912"),
    ("192.168.1.50:7912", "http://192.168.1.50:7912"),
    ("  192.168.1.50:8123  ", "http://192.168.1.50:8123"),             # a Home Assistant add-on's own port
    ("http://192.168.1.50:7912/spool/show/3", "http://192.168.1.50:7912"),   # copied from Spoolman's page
    ("http://spoolman.local:7912/", "http://spoolman.local:7912"),
    ("spoolman.local", "http://spoolman.local:7912"),
    ("https://spools.example.net", "https://spools.example.net"),     # a scheme typed: the port as given
    ("", ""),
    ("not an address", ""),
    ("ftp://192.168.1.50", ""),
    ("192.168.1.50:99999", ""),
    ("http://", ""),
])
def test_what_the_user_types_becomes_an_address(typed, want):
    assert ms.url(typed) == want


def test_adds_the_section():
    text, result = ms.add(lines(CONF), "http://192.168.1.50:7912")
    assert result == "added"
    text = "".join(text)
    assert spoolman_server(text) == "http://192.168.1.50:7912"
    assert ms.MARK in text and text.startswith(CONF)   # the rest stays as it was


def test_an_existing_link_is_kept_or_changed():
    have = CONF + "\n[spoolman]\nserver: http://192.168.1.50:7912\nsync_rate: 5\n"
    text, result = ms.add(lines(have), "http://192.168.1.50:7912")
    assert result == "present" and "".join(text) == have
    text, result = ms.add(lines(have), "http://192.168.1.60:7912")
    assert result == "changed"
    text = "".join(text)
    assert spoolman_server(text) == "http://192.168.1.60:7912" and "sync_rate: 5" in text
    assert text.count("[spoolman]") == 1


def test_a_section_without_a_server_gets_one():
    text, result = ms.add(lines(CONF + "\n[spoolman]\nsync_rate: 5\n"), "http://10.0.0.2:7912")
    assert result == "changed" and spoolman_server("".join(text)) == "http://10.0.0.2:7912"


def test_reads_the_server_it_is_linked_to():
    assert ms.server(lines(CONF)) == ""
    assert ms.server(lines(CONF + "\n[spoolman]\nserver = http://10.0.0.2:7912\n")) == "http://10.0.0.2:7912"


def test_checks_that_spoolman_answers():
    asked = []

    def answering(address, timeout):
        asked.append(address)
        return io.BytesIO(json.dumps({"version": "0.22.1", "debug_mode": False}).encode())

    def silent(address, timeout):
        raise OSError("connection refused")

    assert ms.check("http://192.168.1.50:7912", opener=answering) == "0.22.1"
    assert asked == ["http://192.168.1.50:7912/api/v1/info"]
    assert ms.check("http://192.168.1.50:7912", opener=silent) == ""


def test_the_command_line(tmp_path):
    conf = tmp_path / "moonraker.conf"
    conf.write_text(CONF, encoding="utf-8")
    run = lambda *a: subprocess.run([sys.executable, str(TOOLS / "moonraker_spoolman.py")] + list(a),
                                    capture_output=True, text=True, check=True).stdout.strip()
    assert run("url", "192.168.1.50") == "http://192.168.1.50:7912"
    assert run("server", str(conf)) == ""
    assert run("add", str(conf), "http://192.168.1.50:7912") == "added"
    assert run("add", str(conf), "http://192.168.1.50:7912") == "present"
    assert run("server", str(conf)) == "http://192.168.1.50:7912"
