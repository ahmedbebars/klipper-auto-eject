# The project website

The website is built from the pages in [`docs/`](../docs/) with
[MkDocs Material](https://squidfunk.github.io/mkdocs-material/). The pages stay plain Markdown
that reads well on GitHub; [`hooks.py`](hooks.py) adapts their links for the site.

| File | |
|---|---|
| [`../mkdocs.yml`](../mkdocs.yml) | Site settings and the navigation |
| [`home.md`](home.md) | The home page, under the hero in [`overrides/home.html`](overrides/home.html) |
| [`demo.md`](demo.md) | The live demo page: the web page from [`../web/`](../web/) with `?demo` |
| [`overrides/main.html`](overrides/main.html) | The announcement bar |
| [`assets/`](assets/) | Logo, colours (`site.css`) and the latest-release badge (`site.js`) |
| [`hooks.py`](hooks.py) | Adds the changelog, pictures and demo files, and rewrites links |

## Try it on your computer

```bash
python3 -m pip install -r website/requirements.txt
mkdocs serve
```

Then open `http://127.0.0.1:8000`. `mkdocs build --strict` builds it into `site/` and stops on a
broken link.

## Publishing

**GitHub Pages:** in the repository's *Settings → Pages*, choose *Source: GitHub Actions*. The
[`website` workflow](../.github/workflows/website.yml) then builds and publishes the site on every
push to `main`, at `https://ahmedbebars.github.io/klipper-auto-eject/`.

**Cloudflare Pages** (or Netlify) works too: connect the repository and use

| | |
|---|---|
| Build command | `pip install -r website/requirements.txt && mkdocs build` |
| Output directory | `site` |
| Environment variable | `PYTHON_VERSION` = `3.12` |

A new page in `docs/` also needs a line in the `nav:` section of `mkdocs.yml`;
`tests/test_docs_site.py` checks that none is forgotten.
