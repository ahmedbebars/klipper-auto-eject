"""install.sh --remote: trusting a Tailscale network in moonraker.conf."""

import configparser
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))

import moonraker_trust as mt  # noqa: E402

CONF = """[server]
host: 0.0.0.0
port: 7125

[authorization]
trusted_clients:
    10.0.0.0/8
    127.0.0.0/8
    192.168.0.0/16
cors_domains:
    *.lan
    *.local

[octoprint_compat]
"""
NET = "100.64.0.0/10"


def lines(text):
    return text.splitlines(keepends=True)


def trusted(text):
    # Moonraker reads its file with Python's configparser
    p = configparser.ConfigParser(interpolation=None)
    p.read_string(text)
    return [v for v in p["authorization"]["trusted_clients"].split("\n") if v.strip()]


def test_adds_the_network_to_the_list():
    out, result = mt.add(lines(CONF), NET)
    assert result == "added"
    text = "".join(out)
    assert trusted(text) == ["10.0.0.0/8", "127.0.0.0/8", "192.168.0.0/16", NET]
    assert "cors_domains:\n    *.lan" in text                 # the next option is untouched


def test_adding_twice_changes_nothing():
    once, _ = mt.add(lines(CONF), NET)
    twice, result = mt.add(once, NET)
    assert result == "present" and twice == once


def test_a_network_the_user_added_is_kept_on_remove():
    conf = CONF.replace("    192.168.0.0/16\n", "    192.168.0.0/16\n    100.64.0.0/10\n")
    out, result = mt.add(lines(conf), NET)
    assert result == "present"
    assert mt.remove(out, NET)[1] == "absent"


def test_remove_takes_out_only_its_own_line():
    added, _ = mt.add(lines(CONF), NET)
    out, result = mt.remove(added, NET)
    assert result == "removed" and "".join(out) == CONF


def test_section_without_trusted_clients():
    conf = CONF.replace("trusted_clients:\n    10.0.0.0/8\n    127.0.0.0/8\n    192.168.0.0/16\n", "")
    out, result = mt.add(lines(conf), NET)
    assert result == "added" and trusted("".join(out)) == [NET]


def test_no_authorization_section_means_everyone_is_trusted_already():
    conf = "[server]\nport: 7125\n"
    out, result = mt.add(lines(conf), NET)
    assert result == "no-authorization" and "".join(out) == conf


def test_command_line(tmp_path, capsys):
    path = tmp_path / "moonraker.conf"
    path.write_text(CONF, encoding="utf-8")
    mt.main(["moonraker_trust.py", "add", str(path), NET])
    assert capsys.readouterr().out.strip() == "added"
    assert NET in trusted(path.read_text(encoding="utf-8"))
    mt.main(["moonraker_trust.py", "remove", str(path), NET])
    assert path.read_text(encoding="utf-8") == CONF
