# Contributing

Thanks for helping. Reports from real printers are the most valuable contribution, because
every machine, toolhead and bed surface is a little different.

## Reporting a bug

Open an issue using the bug report template and include:

- your printer, toolhead and bed surface
- your `auto_eject_settings.cfg`
- the console output of `AUTO_EJECT DRY=1`
- `klippy.log` from the failing run

## Sharing a setup

Got it working on your machine? Open a discussion or a pull request adding your blade (STL or
OpenSCAD remix in `hardware/`) and your settings. Others with the same toolhead can then start from them.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep macros compatible with the Jinja2 version Klipper ships (2.11.x). Avoid `{% do %}` and
   other extensions Klipper does not load.
3. Add or update tests in `tests/` for any change to the macros. Run them locally:
   ```bash
   python -m pip install -r tests/requirements.txt
   python -m pytest -q tests
   ```
4. Run `shellcheck install.sh` if you changed the installer.
5. Update the docs and add a line to `CHANGELOG.md` under *Unreleased*.
6. New settings go into `config/auto_eject_settings.cfg` with a comment, and into
   `docs/configuration.md`.

Test any change on a real printer with `DRY=1` before opening the pull request, and say in the
description which machine you tested on.

## Code style

- Two-space indentation inside macro bodies.
- Settings names in `snake_case`. Text values in double quotes.
- Comments explain *why*, not what the next line does.
- User-facing messages start with the macro name (`AUTO_EJECT: ...`).
- In `web/style.css`, use the design tokens at the top of the file, never a colour or a text size
  of your own ([how they are laid out](docs/web-page.md#design-tokens)).

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
