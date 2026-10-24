"""Where install.sh puts the [include] lines in printer.cfg."""
import os
import pathlib
import re
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASH = shutil.which("bash")


def bash_works():
    # Windows has a bash.exe for WSL that fails when no Linux is installed
    if BASH is None:
        return False
    try:
        return subprocess.run([BASH, "-c", "true"], capture_output=True, timeout=10).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


needs_bash = pytest.mark.skipif(not bash_works(), reason="a working bash is needed")
BLOCK = "[include auto_eject.cfg]\n[include auto_eject_settings.cfg]"


def functions():
    """The installer's two functions that write printer.cfg, as they are."""
    text = (ROOT / "install.sh").read_text(encoding="utf-8")
    out = []
    for name in ("insert_before_save_config", "insert_includes"):
        m = re.search(r"^%s\(\) \{\n.*?^\}\n" % name, text, re.S | re.M)
        assert m, name
        out.append(m.group(0))
    return "\n".join(out)


def install(tmp_path, cfg):
    path = tmp_path / "printer.cfg"
    path.write_text(cfg, encoding="utf-8")
    script = functions() + '\ninsert_includes "$BLOCK"\necho "$INCLUDE_LINE|$INCLUDE_WHERE"\n'
    env = dict(os.environ, PRINTER_CFG=path.as_posix(), BLOCK=BLOCK)
    res = subprocess.run([BASH, "-c", script], env=env, capture_output=True, text=True, check=True)
    line, where = res.stdout.strip().split("|")
    return path.read_text(encoding="utf-8").splitlines(), int(line), where


@needs_bash
def test_with_the_printers_own_includes_at_the_top(tmp_path):
    lines, at, where = install(tmp_path, (
        "# BIGTREETECH Manta M8P\n\n"
        "#[include HBB.cfg]\n[include mainsail.cfg]\n[include My_Macros.cfg]\n"
        "#[include Neopixel.cfg]\n[include ./KAMP_LiTE/*.cfg]\n\n"
        "[mcu]\nserial: /dev/x\n\n[include timelapse.cfg]\n\n"
        "#*# <---------------------- SAVE_CONFIG ---------------------->\n#*# [probe]\n"))
    assert lines[at - 1:at + 1] == ["[include auto_eject.cfg]", "[include auto_eject_settings.cfg]"]
    assert lines[at - 2] == "[include ./KAMP_LiTE/*.cfg]"       # right after the last one at the top
    assert at < lines.index("[mcu]") + 1
    assert where == "with your other [include] lines"


@needs_bash
def test_above_save_config_when_the_file_starts_with_sections(tmp_path):
    lines, at, where = install(tmp_path, (
        "[mcu]\nserial: /dev/x\n\n[include mainsail.cfg]\n\n"
        "#*# <---------------------- SAVE_CONFIG ---------------------->\n#*# [probe]\n"))
    assert lines[at - 1] == "[include auto_eject.cfg]"
    assert lines.index("#*# <---------------------- SAVE_CONFIG ---------------------->") > at
    assert where == "above the SAVE_CONFIG block"


@needs_bash
def test_at_the_end_without_includes_or_save_config(tmp_path):
    lines, at, where = install(tmp_path, "[mcu]\nserial: /dev/x\n")
    assert lines[-2:] == ["[include auto_eject.cfg]", "[include auto_eject_settings.cfg]"]
    assert lines[at - 1] == "[include auto_eject.cfg]"
