# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.0] - 2026-10-19

### Changed
- `AUTO_EJECT_SETUP` is down to five short screens: drop edge, measure the blade, blade width
  (60 / 80 / 100 mm buttons), edge check, save. The welcome screen only lists what is missing,
  probes that touch with the nozzle go straight to the automatic measurement, and the push current
  is set to 60 % of `run_current` without a screen of its own.

### Added
- An illustrated guide: a picture of every setup screen next to what to do at the printer
  (`docs/images/setup/`, [setup-wizard.md](docs/setup-wizard.md)).

## [0.9.1] - 2026-10-19

### Fixed
- The tracked print height picked up moves made after the last layer, such as the end G-code
  parking the toolhead (a 12 mm print was stored as 55 mm). Heights above 0.6 mm per layer
  printed so far are now ignored.
- The tracker also ignores `AUTO_EJECT`'s own moves, which during the cooling tour would have
  raised the tour a little higher every 30 seconds.
- `AUTO_EJECT HEIGHT=...` now also sets the height used for travel moves and the cooling tour.

## [0.9.0] - 2026-10-19

### Added
- Cooling tour (`cool_tour`, `cool_tour_gap`, `cool_tour_dwell`): while waiting for the bed to
  cool, the toolhead circles over the parts with the part fan on, just above the tallest part.
  It stops as soon as the bed reaches `cool_temp` (or `cool_time` has passed).

## [0.8.1] - 2026-10-19

### Added
- `hardware/test/`: a hollow test cube and a calibration block for a first run.
- Photos of the blade fitted to a Voron Trident with a Stealthburner toolhead.

### Fixed
- Smart homing (`AUTO_EJECT HOME=1`) kept the probe and the nozzle clear of the parts, but not
  the blade. With a nozzle probe such as Tap, a blade coming down on a part would have set Z
  wrong. The whole blade now stays `home_clearance` away from every part.

## [0.8.0] - 2026-10-19

### Added
- Thin prints such as stencils are left on the bed (`min_part_height`, default 2 mm,
  `thin_parts_action`): no cool-down, no movement, no probing. The Moonraker job queue is paused
  (`thin_pause_queue`) and a dialog asks to take them off. `AUTO_EJECT_CONTINUE` starts the
  queue again.
- `AUTO_EJECT HEIGHT=[max_layer_z]` passes the print height from the slicer.

### Changed
- The tracked print height ignores the start G-code (homing, probing, purge) when the slicer
  reports layers, and follows the highest Z exactly instead of in 0.5 mm steps.
- Verification looks for anything higher than half the print height (0.2 mm to
  `verify_threshold`), so thin parts left on the bed are no longer missed.

## [0.7.0] - 2026-10-19

### Added
- Automatic blade measurement for probes that touch with the nozzle, such as Voron Tap:
  `AUTO_EJECT_CALIBRATE`, and a "Measure automatically" choice in `AUTO_EJECT_SETUP`. The probe
  touches a calibration cube with the nozzle, then with the blade, and finds the blade's height
  above the nozzle tip (`blade_lift`) and its distance ahead of the nozzle (`blade_offset`).
  `push_z` follows from `blade_clearance`.
- Retries never lower a blade that hangs below the nozzle closer than 0.2 mm to the bed, when
  `blade_lift` is known.
- `docs/images/blade-measurement.svg`.

## [0.6.0] - 2026-10-19

### Added
- X and Y are homed again after the sweep (`rehome_xy`), so steps skipped while pushing a stuck
  part no longer affect verification or the next print. If the homing macro un-homes Z, Z is found
  again around the parts.
- A part still on the bed is pushed again, up to twice (`retries`), each time lower
  (`retry_z_step`, `push_z_min`) and with more current (`retry_current_step`, capped at
  `run_current`). Only the parts that were left are swept and probed again.

### Changed
- Verification collects every part still on the bed before deciding, instead of stopping at the
  first one. The error now names all of them.
- With an offset probe, finding a part skips the remaining probe points, and the parts they
  belonged to count as still there.

## [0.5.0] - 2026-10-19

### Added
- Probe detection (`probe_type`): contact probes vs eddy-current probes (`probe_eddy_current`,
  `beacon`, `cartographer`, `scanner`, `probe_eddy_ng`), shown on the setup welcome screen.
- Offset probes: smart homing keeps both the probe and the nozzle clear of parts. Verification
  never lowers the nozzle over a part that is not yet confirmed gone, and orders the checks so
  that each part is reachable (`nozzle_clearance`, `verify_unsafe_action`).
- Eddy-current probes: verification uses `verify_probe_gcode` (contact/touch mode), or is skipped
  with a warning. `home_z_gcode` for probes that home Z with their own command.
- `docs/probes.md`.

### Fixed
- The guided setup called itself to move between steps, which Klipper refuses
  (`Macro AUTO_EJECT_SETUP called recursively`), so it stopped after the first click. Steps now hand
  over through a `delayed_gcode`. The test harness now enforces Klipper's recursion rule and
  clicks through the whole setup.

## [0.4.0] - 2026-10-19

### Added
- Universal three-part blade (`hardware/universal_plow.scad`): blade, arm and mount joined with
  M3 screws, slotted for height and reach, and a mount that fits toolhead screws 28–50 mm apart
  or straps. Print-oriented STLs (60/80/100 mm blades) and preview images are included.
- `hardware/adapters/` for toolhead-specific mounts.

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

[Unreleased]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ahmedbebars/klipper-auto-eject/releases/tag/v0.1.0
