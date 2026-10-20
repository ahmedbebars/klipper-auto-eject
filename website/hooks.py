"""MkDocs hooks for the klipper-auto-eject website.

The pages in docs/ are written to be read on GitHub, where they link to
files elsewhere in the repository (../README.md, ../hardware/...). This
hook adds those files to the site and rewrites the links, so the same
Markdown works in both places:

- the home page, the live demo page, the changelog and the documentation
  index are added as pages;
- pictures from hardware/images are copied into the site;
- the web page (web/) is copied to live/, laid out like the repository,
  so it runs as a demo with ?demo;
- links to other repository files point to GitHub;
- GitHub alerts (> [!WARNING]) become admonitions.
"""

import os
import posixpath
import re

from mkdocs.structure.files import File

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = "https://github.com/ahmedbebars/klipper-auto-eject"
BRANCH = "main"

# site page -> where it comes from in the repository
PAGES = {
    "index.md": "website/home.md",
    "demo.md": "website/demo.md",
    "changelog.md": "CHANGELOG.md",
    "documentation.md": "docs/README.md",
}

# repository folders copied for the live demo, under live/
DEMO = ["web", "config/auto_eject_settings.cfg", "docs/images", "hardware/test"]

ALERTS = {"NOTE": "note", "TIP": "tip", "IMPORTANT": "info", "WARNING": "warning", "CAUTION": "danger"}


def _add(files, config, src_uri, repo_path):
    old = files.get_file_from_path(src_uri)
    if old is not None:
        files.remove(old)
    files.append(File.generated(config, src_uri, abs_src_path=os.path.join(ROOT, repo_path)))


def _walk(repo_path):
    full = os.path.join(ROOT, repo_path)
    if os.path.isfile(full):
        yield repo_path
        return
    for folder, _, names in os.walk(full):
        for name in sorted(names):
            if name.endswith((".scad", ".py", ".pyc")):
                continue
            yield os.path.relpath(os.path.join(folder, name), ROOT).replace(os.sep, "/")


def on_files(files, config):
    for src_uri, repo_path in PAGES.items():
        _add(files, config, src_uri, repo_path)
    for repo_path in _walk("website/assets"):
        _add(files, config, "assets/" + os.path.basename(repo_path), repo_path)
    for repo_path in _walk("hardware/images"):
        _add(files, config, "assets/hardware/" + os.path.basename(repo_path), repo_path)
    for top in DEMO:
        for repo_path in _walk(top):
            _add(files, config, "live/" + repo_path, repo_path)
    return files


def _origin(page):
    """Folder of the page in the repository, or None for pages written for the site."""
    src = PAGES.get(page.file.src_uri, "docs/" + page.file.src_uri)
    return None if src.startswith("website/") else posixpath.dirname(src)


def _site_link(target, origin):
    if re.match(r"^([a-z]+:|#|/)", target):
        return target
    path, hash_, frag = target.partition("#")
    if not path:
        return target
    repo_path = posixpath.normpath(posixpath.join(origin, path))
    if repo_path.startswith("docs/"):
        site = repo_path[len("docs/"):]
        site = "documentation.md" if site == "README.md" else site
    elif repo_path == "README.md":
        return "index.md"                # its sections differ from the home page's
    elif repo_path == "CHANGELOG.md":
        site = "changelog.md"
    elif repo_path.startswith("hardware/images/"):
        site = "assets/hardware/" + posixpath.basename(repo_path)
    else:
        kind = "tree" if os.path.isdir(os.path.join(ROOT, repo_path)) else "blob"
        return "%s/%s/%s/%s%s%s" % (REPO, kind, BRANCH, repo_path, hash_, frag)
    return site + hash_ + frag


def _alerts(markdown):
    out, lines, i = [], markdown.split("\n"), 0
    while i < len(lines):
        m = re.match(r"^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$", lines[i])
        if not m:
            out.append(lines[i])
            i += 1
            continue
        out.append('!!! %s "%s"' % (ALERTS[m.group(1)], m.group(1).title()))
        out.append("")
        i += 1
        while i < len(lines) and lines[i].startswith(">"):
            out.append("    " + re.sub(r"^>\s?", "", lines[i]))
            i += 1
        out.append("")
    return "\n".join(out)


def on_page_markdown(markdown, page, config, files):
    src = PAGES.get(page.file.src_uri, "docs/" + page.file.src_uri)
    page.edit_url = "%s/edit/%s/%s" % (REPO, BRANCH, src)
    origin = _origin(page)
    if origin is None:
        return markdown
    # the site has its own navigation
    markdown = re.sub(r"\A\[klipper-auto-eject\]\(\.\./README\.md\)[^\n]*\n+", "", markdown)
    markdown = _alerts(markdown)
    markdown = re.sub(r"\]\(([^)\s]+)\)", lambda m: "](%s)" % _site_link(m.group(1), origin), markdown)
    # raw HTML is not touched by MkDocs: link pages by their .html name
    markdown = re.sub(r'\b(src|href)="([^"]+)"', lambda m: '%s="%s"' % (
        m.group(1), re.sub(r"\.md(?=$|#)", ".html", _site_link(m.group(2), origin))), markdown)
    return markdown
