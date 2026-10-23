# Contributing

Thanks for helping. Reports from real printers are the most valuable contribution, because
every machine, toolhead and bed surface is a little different.

## Reporting a bug

Open an issue using the bug report template and include:

- your printer, toolhead and bed surface
- your `auto_eject_settings.cfg`
- the console output of `AUTO_EJECT DRY=1`
- `klippy.log` from the failing run

A security problem goes in a private report instead, not an issue: see [SECURITY.md](SECURITY.md).

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
4. Run `shellcheck install.sh` if you changed the installer, and the two linters CI runs on the
   Python and the web page (their settings are in `ruff.toml` and `eslint.config.mjs`):
   ```bash
   python -m pip install ruff==0.12.0 && ruff check .
   npx eslint@10.13.0 .
   ```
   If you changed the web page, run the layout sweep too. It opens every view of the demo at
   phone, tablet and desktop widths, in English and Arabic, and lists what it finds: the page
   scrolling sideways, content wider than its card, buttons on top of each other, console errors.
   It needs Node 22 or newer and Chrome, Chromium or Edge, nothing else:
   ```bash
   node tests/layout_sweep.mjs
   VIEWS=farm WIDTHS=390 LANGS=ar node tests/layout_sweep.mjs   # one view, one width, one language
   ```
5. Update the docs and add a line to `CHANGELOG.md` under *Unreleased*.
6. New settings go into `config/auto_eject_settings.cfg` with a comment, and into
   `docs/configuration.md`.

Test any change on a real printer with `DRY=1` before opening the pull request, and say in the
description which machine you tested on.

## Before a release: on a real printer

The tests run the macros against a simulated Klipper, and the page against a pretend printer.
Before a release, go through this on at least one real printer and name the printers in the
release notes. Skip what the printer does not have (a farm, DEMON), and say so.

- [ ] **Install or update.** `install.sh` on a printer without auto-eject, or an update through
      Mainsail or Fluidd on one with it. Klipper restarts without a config error.
- [ ] **Dry run.** With parts on the bed, `AUTO_EJECT DRY=1`: the toolhead follows every push
      lane above the bed and touches nothing.
- [ ] **A print with its eject.** `AUTO_EJECT HEIGHT=[max_layer_z] HOME=1` in the end G-code: the
      bed cools, the parts go off the drop edge, the probe finds the bed clear, and the job queue
      starts the next print.
- [ ] **Cooling with the printer free** (`cool_background: True`): **Push now** pushes at once;
      **Stop, I'll take them off** stops the cooling, and the queue waits for **Bed is clear,
      continue the queue**.
- [ ] **Thin parts.** A part below `min_part_height` stays on the bed and the dialog says so.
- [ ] **After a restart.** Restart Klipper with parts on the bed and start a print:
      `AUTO_EJECT_GUARD` checks the bed where they were before the print goes on.
- [ ] **A print stopped early.** Cancel a print before its first layer: no parts are kept, no
      dialog opens.
- [ ] **The page.** Every tab on a phone and a computer, in both themes and in Arabic; nothing in
      the browser's console. **Emergency stop**, at the top while the printer prints or ejects,
      stops it.
- [ ] **Notifications.** `AUTO_EJECT_NOTIFY_TEST` reaches the phone.
- [ ] **The farm.** With two printers, a copy from the farm queue prints on the other one, and the
      farm card's buttons work.
- [ ] **DEMON Klipper Essentials.** After `install.sh --demon`, a print starts without DEMON's
      emergency stop, and the bed check runs from `_CUSTOM_PRE_START`.

## Code style

- Two-space indentation inside macro bodies.
- Settings names in `snake_case`. Text values in double quotes.
- Comments explain *why*, not what the next line does.
- User-facing messages start with the macro name (`AUTO_EJECT: ...`).
- In `web/style.css`, use the design tokens at the top of the file, never a colour or a text size
  of your own ([how they are laid out](docs/web-page.md#design-tokens)).

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
