# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-19

### Added
- `AUTO_EJECT` macro: cool down, sweep the parts off the bed with a toolhead-mounted blade,
  verify with the probe.
- Path strategies: `columns`, `objects` and `full_width`.
- Push directions: front, back, left and right.
- Cooling modes: `temperature`, `time` and `none`.
- Automatic TMC current reduction while pushing, with the previous values restored afterwards.
- Probe verification in `outline` (hollow parts) and `center` modes, with probe offsets applied.
- `EJECT_PURGE`: a tall purge pellet placed where the sweep removes it.
- `DRY=1`, `COOL=0`, `VERIFY=0` and `STRATEGY=` overrides.
- `install.sh` with `--config-dir`, `--no-include`, `--no-update-manager` and `--uninstall`.
- Moonraker update manager support.
- Parametric OpenSCAD blade (`hardware/plow.scad`).
- Macro tests against Jinja2 2.11 and 3.x, and CI.

[Unreleased]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ahmedbebars/klipper-auto-eject/releases/tag/v0.1.0
