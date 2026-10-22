"""web/qr.js: the QR codes on the farm's printer labels.

A phone must read every label, so the codes are checked module by module
against a reference encoder, and their parts against the standard
(ISO/IEC 18004).
"""

import hashlib
import re
import subprocess

import pytest

from test_web import js, needs_node


def filler(n):
    """A link n bytes long, the same every time."""
    s = "https://printer.example/auto-eject/?q="
    alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    i = 0
    while len(s) < n:
        s += alphabet[i % len(alphabet)]
        i += 1
    return s[:n]


def digest(qr):
    rows = ["".join(str(b) for b in row) for row in qr["modules"]]
    return hashlib.sha256("\n".join(rows).encode()).hexdigest()[:24]


# Made with segno 1.6.6 (with its extra zero byte after a byte-aligned end
# taken out, which the standard does not ask for), the same version and mask
# forced. Every version, level and mask matched it when this was written.
REFERENCE = [
    ("hello", "H", 1, 0, "d78181186abf3556cf551056"),
    ("https://printer.local/auto-eject/", "M", 3, 2, "5f33ab5449472dda3dd4fa99"),
    (filler(58), "Q", 5, 5, "2f794632b877b11577f47295"),          # two block sizes
    (filler(154), "L", 7, 6, "8ded4a62150f4803524264fe"),         # version information from 7
    (filler(213), "M", 10, 1, "397a4f0b8671ee52bad9650d"),        # 16-bit length from 10
    (filler(194), "H", 14, 7, "c1865b80aa2d72b368b70f47"),
    (filler(1370), "M", 32, 4, "325a9d83ede2bb776b76fc60"),       # the odd alignment step
    (filler(2953), "L", 40, 3, "8cd91cf2a45b30c4490c8424"),       # the biggest, full
    ("http://طابعة-١.local/auto-eject/", "M", 3, 3, "56297e7bde16f1eb83b65a26"),  # UTF-8
]


@needs_node
@pytest.mark.parametrize("text,level,version,mask,want", REFERENCE, ids=[r[1] + str(r[2]) for r in REFERENCE])
def test_codes_match_a_reference_encoder(text, level, version, mask, want):
    qr = js("qrEncode", text, {"level": level, "version": version, "mask": mask})
    assert qr["version"] == version
    assert qr["size"] == version * 4 + 17 == len(qr["modules"])
    assert digest(qr) == want


@needs_node
@pytest.mark.parametrize("level,fits", [("L", 17), ("M", 14), ("Q", 11), ("H", 7)])
def test_the_smallest_version_that_holds_the_link(level, fits):
    # the standard's byte capacity of version 1
    assert js("qrEncode", "x" * fits, {"level": level})["version"] == 1
    assert js("qrEncode", "x" * (fits + 1), {"level": level})["version"] == 2


@needs_node
def test_too_long_for_any_version_is_refused():
    assert js("qrEncode", "x" * 2953, {"level": "L", "mask": 0})["version"] == 40
    with pytest.raises(subprocess.CalledProcessError):
        js("qrEncode", "x" * 2954, {"level": "L", "mask": 0})


def format_bits(m, second=False):
    n = len(m)
    if not second:
        cells = [(8, y) for y in range(6)] + [(8, 7), (8, 8), (7, 8)] + [(14 - i, 8) for i in range(9, 15)]
    else:
        cells = [(n - 1 - i, 8) for i in range(8)] + [(8, n - 15 + i) for i in range(8, 15)]
    return sum(m[y][x] << i for i, (x, y) in enumerate(cells))


@needs_node
@pytest.mark.parametrize("level,code", [("L", 1), ("M", 0), ("Q", 3), ("H", 2)])
def test_the_format_bits_name_the_level_and_the_mask(level, code):
    for mask in (0, 5):
        m = js("qrEncode", "https://printer.local/", {"level": level, "mask": mask})["modules"]
        bits = format_bits(m)
        assert bits == format_bits(m, second=True)               # both copies the same
        value = bits ^ 0x5412
        assert value >> 10 == (code << 3) | mask
        rem = value >> 10
        for _ in range(10):
            rem = (rem << 1) ^ ((rem >> 9) * 0x537)
        assert value & 0x3FF == rem & 0x3FF                     # its error correction


@needs_node
def test_finders_timing_and_the_dark_module():
    m = js("qrEncode", "https://printer.local/", {})["modules"]
    n = len(m)
    finder = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"]
    for x0, y0 in ((0, 0), (n - 7, 0), (0, n - 7)):
        assert ["".join(str(m[y0 + y][x0 + x]) for x in range(7)) for y in range(7)] == finder
    assert [m[6][x] for x in range(8, n - 8)] == [1 - i % 2 for i in range(n - 16)]
    assert [m[y][6] for y in range(8, n - 8)] == [1 - i % 2 for i in range(n - 16)]
    assert m[n - 8][8] == 1


@needs_node
def test_the_mask_picked_has_the_lowest_penalty():
    link = "https://voron-01.example.ts.net/auto-eject/"
    picked = js("qrEncode", link, {})
    scores = [js("qrPenalty", js("qrEncode", link, {"mask": k})["modules"]) for k in range(8)]
    assert picked["mask"] == scores.index(min(scores))


@needs_node
def test_the_drawing_covers_every_dark_module_and_the_quiet_zone():
    qr = js("qrEncode", "https://printer.local/auto-eject/", {})
    path = js("qrPath", qr, 4)
    assert path["size"] == qr["size"] + 8
    drawn = set()
    for x, y, w in re.findall(r"M(\d+) (\d+)h(\d+)v1h-\3z", path["d"]):
        drawn.update((int(x) + i - 4, int(y) - 4) for i in range(int(w)))
    dark = {(x, y) for y, row in enumerate(qr["modules"]) for x, v in enumerate(row) if v}
    assert drawn == dark
