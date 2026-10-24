"""tools/demon_hook.py and install.sh --demon: with DEMON Klipper Essentials,
AUTO_EJECT_GUARD runs in DEMON's first print-start hook."""
import os
import pathlib
import shutil
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import demon_hook  # noqa: E402

# the parts of DEMON's demon_custom_expansion file the hook touches, as DEMON writes them
EXPANSION = """[gcode_macro _CUSTOM_EXPANSION_ACTIVE_LIST]

## MASTER ENABLE SWITCH ##

variable_ceal_master_enable: False

## Set each variable to True to activate the custom macro, or False to deactivate it!

variable_pre_start: False
variable_pre_heating: False
variable_pre_print: True

gcode: # DO NOT EDIT OR ADD ANYTHING IN THIS SECTION!!

[gcode_macro _CUSTOM_PRE_START] # Very first action after you hit print!
gcode:



[gcode_macro _CUSTOM_PRE_PRINT] # Just before your print starts
gcode:
  EJECT_PURGE

"""


def run(action, text):
    new, result = (demon_hook.add if action == "add" else demon_hook.remove)(text.splitlines(True))
    return "".join(new), result


def test_the_guard_goes_first_in_demons_first_hook():
    out, result = run("add", EXPANSION)
    assert result == "added"
    assert "variable_ceal_master_enable: True\n" in out and "variable_pre_start: True\n" in out
    assert "variable_pre_heating: False\n" in out                     # the other hooks stay as they were
    assert "# Very first action after you hit print!\ngcode:\n  AUTO_EJECT_GUARD FROM=DEMON\n" in out
    assert "  EJECT_PURGE\n" in out
    assert demon_hook.status(out.splitlines(True)) == "present"
    assert run("add", out) == (out, "present")                         # once only


def test_what_is_there_already_stays_after_the_guard():
    text = EXPANSION.replace("[gcode_macro _CUSTOM_PRE_START] # Very first action after you hit print!\ngcode:\n",
                             "[gcode_macro _CUSTOM_PRE_START]\ngcode: M117 Starting\n  AUTO_EJECT_GUARD\n")
    out, result = run("add", text)
    # a plain guard put there by hand becomes ours, and comes before the rest
    assert "[gcode_macro _CUSTOM_PRE_START]\ngcode:\n  AUTO_EJECT_GUARD FROM=DEMON\n  M117 Starting\n" in out
    assert out.count("AUTO_EJECT_GUARD") == 1


def test_a_missing_switch_is_added():
    text = EXPANSION.replace("variable_pre_start: False\n", "")
    out, _ = run("add", text)
    assert "variable_pre_start: True\n" in out


def test_taking_it_out_leaves_the_rest():
    out, _ = run("add", EXPANSION)
    back, result = run("remove", out)
    assert result == "removed" and "AUTO_EJECT_GUARD" not in back
    assert "variable_pre_start: True" in back                          # an empty hook does nothing
    assert run("remove", back)[1] == "absent"


def test_not_a_demon_file():
    assert demon_hook.status(["[gcode_macro PRINT_START]\n", "gcode:\n"]) == "not-demon"
    assert run("add", "[printer]\nkinematics: corexy\n")[1] == "not-demon"


def test_the_file_keeps_its_line_ends(tmp_path):
    f = tmp_path / "demon_custom_expansion_v2.0.0.cfg"
    f.write_bytes(EXPANSION.replace("\n", "\r\n").encode())
    res = subprocess.run([sys.executable, str(ROOT / "tools" / "demon_hook.py"), "add", str(f)], capture_output=True, text=True, check=True)
    data = f.read_bytes()
    assert res.stdout.strip() == "added"
    assert b"gcode:\r\n  AUTO_EJECT_GUARD FROM=DEMON\r\n" in data and b"\n" not in data.replace(b"\r\n", b"")


BASH = shutil.which("bash")


def python3_works():
    if BASH is None:
        return False
    try:
        return subprocess.run([BASH, "-c", "python3 -c 'print(1)'"], capture_output=True, timeout=10).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


@pytest.mark.skipif(not python3_works(), reason="bash with python3 is needed")
def test_install_demon_sets_it_up_on_an_installed_printer(tmp_path):
    user = tmp_path / "Demon_User_Files"
    user.mkdir()
    (user / "demon_custom_expansion_v2.0.0.cfg").write_text(EXPANSION, encoding="utf-8")
    env = dict(os.environ, HOME=str(tmp_path))
    res = subprocess.run([BASH, str(ROOT / "install.sh"), "--demon", "--config-dir", str(tmp_path)],
                         capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL)
    assert res.returncode == 0, res.stderr
    assert "AUTO_EJECT_GUARD FROM=DEMON" in (user / "demon_custom_expansion_v2.0.0.cfg").read_text(encoding="utf-8")
    assert list(user.glob("*.bak-auto-eject-*"))                      # the file as it was
    # without DEMON: nothing to do
    other = tmp_path / "other"
    other.mkdir()
    res = subprocess.run([BASH, str(ROOT / "install.sh"), "--demon", "--config-dir", str(other)],
                         capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL)
    assert res.returncode == 0 and "nothing to do" in res.stdout
