"""The project website (mkdocs.yml) must list every documentation page."""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent


def nav_pages():
    text = (ROOT / "mkdocs.yml").read_text(encoding="utf-8")
    nav = text[text.index("\nnav:"):]
    return set(re.findall(r":\s*([\w./-]+\.md)\s*$", nav, re.M))


def test_every_docs_page_is_in_the_site_navigation():
    pages = {p.name for p in (ROOT / "docs").glob("*.md")} - {"README.md"}
    missing = pages - nav_pages()
    assert not missing, "add these to nav: in mkdocs.yml: %s" % sorted(missing)


def test_navigation_points_to_pages_that_exist():
    generated = {"index.md", "demo.md", "changelog.md", "documentation.md", "ar/index.md"}
    for page in nav_pages() - generated:
        assert (ROOT / "docs" / page).exists(), page
    for page in ("home.md", "demo.md", "hooks.py", "overrides/home.html", "assets/site.css"):
        assert (ROOT / "website" / page).exists(), page
