# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-10-19

### Fixed
- After an update, settings added in the new release were treated as unset when the user's
  `auto_eject_settings.cfg` predated them, which silently disabled state saving. Every setting
  now has a default in `_AUTO_EJECT_DEFAULTS`. Your file only overrides, and values saved by the
  guided setup live in `_AUTO_EJECT_OVERRIDES`. Found on real hardware.

## [0.3.0] - 2026-10-19

### Added
- Part outlines and print height are saved in `[save_variables]` while printing and restored
  after a restart (`persist_state`). Cleared after a successful eject.
- `AUTO_EJECT HOME=1`: home X/Y, then measure Z with the probe on the free spot furthest from
  every stored part (`home_method`, `home_clearance`, `home_edge_margin`).
- `AUTO_EJECT_GUARD` for the start G-code: stop, or eject first (`guard_action`), when parts from
  an interrupted print may still be on the bed.
- `AUTO_EJECT_CLEAR` to forget parts removed by hand. `SOURCE=saved` to eject stored parts.
- Travel height also respects the stored print height.

### Fixed
- The setup welcome check reported `[exclude_object]` as missing when it was present.

## [0.2.0] - 2026-10-19

### Added
- `AUTO_EJECT_SETUP`: a guided setup in Mainsail/Fluidd dialogs covering drop edge, bed check,
  blade height by jogging, blade offset measured against a block (no ruler), width, current,
  cooling, saving and a dry test.
- Settings saved by the setup persist through `[save_variables]` and are applied at startup.
  `AUTO_EJECT_SETUP STEP=reset` clears them.
- Wizard tests (Klipper-exact parameter parsing of every dialog and saved value).

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

[Unreleased]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ahmedbebars/klipper-auto-eject/releases/tag/v0.1.0
