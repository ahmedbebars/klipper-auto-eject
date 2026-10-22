"""The web page as an installed app: its manifest, pictures and offline files."""
import json
import pathlib
import re
import struct

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
MANIFEST = json.loads((WEB / "manifest.json").read_text(encoding="utf-8"))


def png_size(path):
    data = path.read_bytes()[:24]
    assert data[:8] == b"\x89PNG\r\n\x1a\n", path
    return struct.unpack(">II", data[16:24])


def test_the_manifest_names_the_app_and_opens_in_its_own_window():
    for key in ("name", "short_name", "description", "id", "start_url", "scope", "display", "background_color", "theme_color"):
        assert MANIFEST.get(key), key
    assert MANIFEST["display"] == "standalone"
    assert MANIFEST["launch_handler"]["client_mode"][0] == "focus-existing"   # a shortcut reuses the open app


@pytest.mark.parametrize("entry", MANIFEST["icons"] + MANIFEST["screenshots"]
                         + [i for s in MANIFEST["shortcuts"] for i in s["icons"]], ids=lambda e: e["src"])
def test_every_picture_exists_at_the_size_it_says(entry):
    path = WEB / entry["src"]
    assert path.is_file(), entry["src"]
    if entry.get("type") == "image/png":
        assert "%dx%d" % png_size(path) == entry["sizes"]


def test_icons_for_every_purpose():
    purposes = {i.get("purpose", "any") for i in MANIFEST["icons"]}
    assert {"any", "maskable", "monochrome"} <= purposes
    sizes = {i["sizes"] for i in MANIFEST["icons"] if i.get("purpose", "any") == "any"}
    assert {"192x192", "512x512"} <= sizes


def test_screenshots_for_the_install_dialog_on_phones_and_computers():
    forms = [s.get("form_factor") for s in MANIFEST["screenshots"]]
    assert "wide" in forms and "narrow" in forms
    for s in MANIFEST["screenshots"]:
        w, h = map(int, s["sizes"].split("x"))
        assert max(w, h) / min(w, h) <= 2.3 and min(w, h) >= 320 and s.get("label")


def test_shortcuts_open_sections_that_exist():
    views = set(re.findall(r'\{ id: "(\w+)", icon: "', (WEB / "app.js").read_text(encoding="utf-8")))
    assert MANIFEST["shortcuts"]
    for s in MANIFEST["shortcuts"]:
        m = re.fullmatch(r"\./#/(\w+)", s["url"])
        assert m and m.group(1) in views, s["url"]


def test_the_notification_badge_is_white_on_clear():
    Image = pytest.importorskip("PIL.Image")
    im = Image.open(WEB / "icons" / "badge-96.png").convert("RGBA")
    px = im.tobytes()
    seen = [px[i:i + 4] for i in range(0, len(px), 4) if px[i + 3] > 128]
    assert seen and all(min(p[:3]) > 230 for p in seen)       # Android draws it from its alpha


def test_every_ios_splash_screen_exists_at_the_screens_size():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    links = re.findall(r'<link rel="apple-touch-startup-image" href="([^"]+)" media="\(device-width: (\d+)px\) and '
                       r'\(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d+)\)', html)
    assert len(links) >= 10
    for href, w, h, dpr in links:
        assert png_size(WEB / href) == (int(w) * int(dpr), int(h) * int(dpr)), href


def test_the_offline_copy_lists_files_that_exist():
    sw = (WEB / "sw.js").read_text(encoding="utf-8")
    shell = re.search(r"const SHELL = \[(.*?)\];", sw, re.S).group(1)
    files = re.findall(r'"([^"]+)"', shell)
    assert "index.html" in files and "manifest.json" in files
    for f in files:
        if f != "./":
            assert (WEB / f).is_file(), f
