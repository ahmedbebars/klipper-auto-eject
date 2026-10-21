# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **A Motors tab** in the web page: every motor with a TMC driver (X, Y, every Z motor and every
  extruder), live once a second: moving, holding or off; its current; its StallGuard reading with
  the last ten minutes as a line (TMC2130, 2240, 2660 and 5160 report it); its driver's warnings
  (overheating, shorts, a dropped supply, an open coil); and the motor's own temperature from a
  thermistor named after it (`temperature_sensor motor_x`, `motor_a` on CoreXY…). A line at the top
  says whether all motors are normal, from the warnings and temperatures only: StallGuard also drops
  at low speed, so it raises no alarm. Read only; shown only when Klipper has TMC drivers.
- **Pictures of the prints**: the files in **Check a file**, the print queue, the farm cards and
  the farm's **Print** dialog show the picture the slicer put in the G-code (OrcaSlicer,
  PrusaSlicer, SuperSlicer, Cura with **Create Thumbnail**), with the print time, filament, height
  and material. **Check a file** opens with a large picture and everything the file says about the
  print; **Overview** shows the picture of the print on the bed. A black part on the dark page, or
  a white one on the light page, gets a backdrop that shows it. Lists read each file only when it
  comes into view. Other farm printers' pictures come through the farm printer, which keeps them
  in memory.
- **Maintenance reminders** in the farm: every 100 to 1000 hours of printing, per printer, from
  Moonraker's print history. The card counts them (**Maintenance: 450 / 1000 h**), a notification
  comes once when it is due, and **Maintenance done** starts again from zero.
- **A daily report** of the farm to the phones, at a time you choose: today's prints that ended
  well and stopped, the printers printing and needing you, the hours printed, and the maintenance
  due. Tapping it opens the farm.
- **Print from the farm, from anywhere**: a free printer's card has **Print**: pick one of its
  G-code files, or send it one from the phone or computer (**Send it**, **Send it and print**,
  with progress). Printing cards have **Pause**, **Resume** and **Cancel the print**. All of it goes
  through the farm printer, so it works away from the printers' network without Tailscale on the
  other printers. The farm refuses to start a print on a busy printer or on one with parts on its
  bed. Uploads are kept on the card, not in memory, while they go on (`install.sh --farm` or
  `--push` updates the nginx file for large files).

### Fixed
- In the farm, **Open** did not work from a phone away from the printers' network: it opened the
  printer's local address. When the page is opened through Tailscale, it now opens the printer's
  Tailscale address, found by its network card, if that printer has Tailscale; without it, Open
  says **Open (on its network)** instead of a link that does not open.

## [0.13.0] - 2026-10-20

### Added
- **The parts box** (`bin_capacity`, `bin_full_action`, `AUTO_EJECT_BIN_EMPTY`): auto-eject counts
  the parts it pushes into the box under the drop edge, keeps the count across restarts, and says
  when the box is almost full (80 %) and full, with a notification. With `"stop"` (the default)
  `AUTO_EJECT_GUARD` holds the next print until the box is emptied. The web page shows the count
  (**Box: 26 / 30**) with **I emptied the box**, and the farm shows it on every printer.
- **Power switches in the farm**: printers with a Moonraker `[power]` device get **Turn on** and
  **Turn off** (never while printing or with the nozzle above 50 °C, whose fan would stop), show
  **Switched off** when off, and can switch off by themselves after 15 minutes to 4 hours with
  nothing to do; a notification says so.
- **In your slicer**, a card in the web page's **Blade and setup** tab: where each setting is in
  OrcaSlicer, PrusaSlicer/SuperSlicer or Cura, and the start and end G-code to paste with a
  **Copy** button. The end G-code names the end macro the printer really uses: the one its newest
  file runs, or else the one in its config (`PRINT_END`, `END_PRINT`, `DEMON_END`…); the slicer of
  the newest file is picked by itself. **Check a file** opens it with **Show me what to paste in
  the slicer** when a file is not labelled or does not run `AUTO_EJECT` last.
- The printer farm shows what each printer has done, from Moonraker's print history: hours
  printed, how many of the last 50 prints ended well, and today's prints; the top line adds up the
  whole farm.

## [0.12.0] - 2026-10-20

### Changed
- **The installer asks what you want.** Run with no options from a terminal, `install.sh` asks a
  few yes/no questions in plain words (the blade, the web page, your phone, notifications, more
  than one printer) and sets up what you said yes to; the options still work as before. It adds
  the Klipper sections auto-eject needs (`[exclude_object]`, `[respond]`, `[save_variables]`) when
  your config lacks them, asking Klipper itself which ones it has, and offers to restart Klipper at
  the end, only when it is not printing. Install is one line:
  `cd ~ && git clone https://github.com/ahmedbebars/klipper-auto-eject.git && ./klipper-auto-eject/install.sh`.
- On phones, the language list at the top of the web page is a globe button, so the title fits.

### Added
- **Documentation in Arabic** (`docs/ar/`): the home page, getting started, installation, the web
  page, remote access, notifications, the printer farm, the FAQ and safety. On the website they
  read right to left, with commands left to right.
- New pictures: the page clearing a bed, the app on a phone (clearing the bed, the farm in Arabic,
  the blade), the printer farm, its network search and **Check a file**; and a "works with" row
  with the logos of Klipper, Mainsail, Fluidd, OrcaSlicer and PrusaSlicer
  (`docs/images/logos/README.md` says where each comes from).
- The farm's network search lists a printer found both on the local network and over Tailscale
  once (it compares their network cards), asks only Linux devices on Tailscale, and remembers the
  printers you left out: they come last and unticked the next time.

- **A printer farm** (`install.sh --farm`, `docs/farm.md`): every Klipper printer of the network on
  one page, the **Printer farm** tab, with the ones that need you first: a print to take off, a part
  that stayed on the bed, an error, a paused queue. Installed on one printer only: **Search the
  network** finds the others (its own network and Tailscale) and adds them; they need nothing
  installed, and printers without auto-eject show their prints too. Buttons per printer: **Bed is
  clear**, **Start the queue**, **Emergency stop** (both ask first), **Open** its own page, rename
  or remove; camera pictures come through the farm printer, so the whole farm works from a phone
  with remote access on that printer alone. Phones with notifications on get them from every
  printer, with its name. It runs in the `klipper-auto-eject` service (`push/farm.py`), which
  nginx publishes at `/auto-eject/api/` (`--farm` and `--push` add that to a page installed before).
- **`AUTO_EJECT_GUARD` checks the bed itself** (`guard_action: "check"`, the new default). When
  the printer remembers parts from an earlier print that was not ejected, the next print first
  homes around them and probes where they were: nothing there, the print simply starts and nobody
  has to click **Bed is clear**; a tall part, it is pushed off first; a thin part such as a
  stencil, the print stops until it is taken off. Without a probe that can touch plastic, or with
  no free spot to home Z, it stops like `"error"`.
- Thin parts are found reliably: for parts thinner than twice `verify_threshold`, the probe also
  touches the bare bed on two sides of the part and compares with the lower reading, so a bed a
  little out of flat or a purge line next to the part does not hide a 0.4 mm stencil.
- `nozzle_part_max_temp` (50 °C): a nozzle probe waits until the nozzle is this cool before it
  touches where parts are or were, so it cannot dent or stick to a part, with the part fan on to
  cool it faster. The wait before homing Z on the bare sheet uses the fan too.
- A dialog after a print that ended without an eject (no `AUTO_EJECT` in the end G-code,
  cancelled, or stopped): take the parts off and click **Bed is clear**.
- **The web page is an app on phones** (PWA). Over HTTPS it installs with its own icon (Android:
  **Install the app** on the page, iPhone: **Add to Home Screen**) and opens without the browser's
  bars; a service worker keeps a copy of its own files, so it opens and shows that the printer is
  unreachable without a connection. On phones the sections move to a tab bar at the bottom, and the
  page keeps clear of notches and the home indicator.
- **Notifications in the app, even while it is closed** (Web Push): `install.sh --push` installs
  the `klipper-auto-eject` service (`push/auto_eject_push.py`), which watches the printer through
  Moonraker and sends each notification, encrypted for that device (RFC 8291, VAPID), to the push
  service of every phone or computer that turned them on in the app. Devices subscribe through
  Moonraker's database, so the service needs no port; Moonraker restarts it after updates. Each
  device chooses whether it also wants every finished print. Android, iPhone (iOS 16.4+, from the
  Home Screen) and desktop browsers.
- **Notifications on your phone**: `install.sh --notify` sets up ntfy through Moonraker's
  `[notifier]` (a random topic, kept when run again, and an optional notification for every finished
  print); the new `notify` setting sends auto-eject's own messages: a part still on the bed, parts
  too thin to push, a print that ended without an eject, a print the guard did not start. Tapping a
  notification opens the auto-eject page. The installed app also notifies by itself while it is open
  or in the background. New guide: `docs/notifications.md`.
- **Remote access for everyone**: `install.sh --remote` sets up Tailscale so Mainsail and the
  auto-eject page open from a phone anywhere, without opening the printer to the internet. It asks
  before every step: installs Tailscale if needed, connects the printer, adds the Tailscale range to
  Moonraker's `trusted_clients` (with a backup, restarting Moonraker only when idle) and serves the
  printer over HTTPS with `tailscale serve`. `--uninstall` takes the range out again. New guide:
  `docs/remote-access.md`; the web page's **Blade and setup** tab shows how you are connected and
  what is missing.

### Fixed
- The farm API read the request only after deciding the answer; on some systems that reset the
  connection.
- `http://<printer>/auto-eject/` redirected to the page with an absolute `http://` address, so
  behind an HTTPS proxy such as `tailscale serve` the page lost HTTPS. The redirect is relative now;
  run `install.sh --web` again to update the nginx file.

## [0.11.0] - 2026-10-20

### Changed
- **`AUTO_EJECT` now goes after your end macro**, as `AUTO_EJECT HEIGHT=[max_layer_z] HOME=1`.
  End macros retract the filament (`G1 E-2`), and once `AUTO_EJECT` had let the nozzle cool,
  Klipper refused that retract ("Extrude below minimum temp"): the print ended with an error and
  the job queue stopped. After the end macro, `HOME=1` homes again around the parts if the motors
  were turned off. Your own `PRINT_END` can instead call it after its retract. See
  `docs/integration.md`; the DEMON `_CUSTOM_PRE_END` hook method is gone for the same reason.

### Added
- Probes that touch the bed with the nozzle (Voron Tap, eddy touch modes) wait for the nozzle to
  cool to `nozzle_probe_max_temp` (150 °C) before homing Z or checking the bed, so a nozzle the end
  macro has only just turned off does not mark the print sheet.
- The web page's **Check a file** warns when a file runs `AUTO_EJECT` before another macro.
- A web page for the printer's web interface, with its own entry in the Mainsail sidebar
  (`install.sh --web`, see `docs/web-page.md`). It shows the printer's state and a live map of
  the bed with the parts, the push lanes and the toolhead; ejects, dry-runs or forgets the parts
  (asking first); manages Moonraker's job queue; checks a G-code file before it is printed (labels,
  `AUTO_EJECT` in the end G-code, height, whether the blade can get behind every part); shows the
  blade setup and opens the setup dialogs in the page; and edits every setting. English and
  Arabic, light and dark, works on a phone, loads nothing from the internet. `?demo` runs it
  against a pretend printer.
- `AUTO_EJECT_SET KEY=<setting> VALUE=<value>` changes one setting, checks the value against the
  setting's type and keeps it after a restart. `RESET=1` goes back to the settings file.

### Fixed
- Klipper could stop with "MCU shutdown: Timer too close" at the start of an eject when the bed
  was already cool. The 240 cooling passes, all with nothing left to do, ran back to back while
  the toolhead was still rising, and the move reached the board too late. Now no cooling pass runs
  when the bed is already cool, the passes left after cooling return at once, and every move
  finishes (`M400`) before the macros that take Klipper a moment to work out: the push plan, the
  check with the probe and homing Z around the parts. The tests check that none of these starts
  while a move is pending.
- `AUTO_EJECT HOME=1` could find Z past the edge of the print sheet: on a Voron 450 with the middle
  of the bed full, it probed the bare plate at the front, among its holes, and every height after
  that was 0.6 mm off. With a `[bed_mesh]` the spot now stays inside the mesh area (`mesh_min` /
  `mesh_max`, or `mesh_radius` on a round bed), where the probe is known to work.
- `auto_eject.cfg` held six copies of the last lines of its defaults. Klipper ignored them (the
  values were the same), and a test now makes sure no option is given twice.

### Documentation
- A project website built from `docs/` with MkDocs Material (`mkdocs.yml`, `website/`): a home
  page, search, light and dark, and the web page running as a live demo in the browser.
  `.github/workflows/website.yml` publishes it on GitHub Pages.
- Rewritten for beginners. A new step-by-step guide (`docs/getting-started.md`) goes from checking
  the bed to printing in a row, with a check after every step. New pages: FAQ, glossary, every
  command with its options, and a documentation home (`docs/README.md`) grouped by what you want
  to do. The README now leads with how it works, who it is for and the eight steps.
- The blade measurement pages described a 20 mm cube; they now describe the 3.5 mm printed
  calibration block, and the troubleshooting page lists every reason the measurement can stop.
- Where `AUTO_EJECT` goes for every kind of end G-code (DEMON, Klippain, RatOS, stock Voron, plain
  commands, Cura), and when you need to tell the printer the bed is clear (FAQ).

## [0.10.5] - 2026-10-19

### Fixed
- In a warm room the bed may never cool to `cool_temp`, and `TEMPERATURE_WAIT` then waited
  forever. Cooling now waits in short passes that give up after `cool_timeout` (30 min) and push
  the parts anyway, with a warning. The default `cool_temp` is 32 °C instead of 28 °C.
- "sweep finished" was printed when the macro started, before anything had moved. It now
  appears once the sweep is done.

## [0.10.4] - 2026-10-19

### Fixed
- On build sheets that release cold parts (such as BIQU CryoGrip), a calibration block on a
  bed below 40 °C was not stuck well, and the edge search pushed it back. The block then ended
  up under the nozzle and the blade was reported as level with the nozzle tip. The measurement
  now runs on a warm bed (up to 55 °C) right after the block is printed, checks the block's
  front edge again at the end, and says plainly when the block moved.

## [0.10.3] - 2026-10-19

### Fixed
- Parts taken off by hand without `AUTO_EJECT_CLEAR` stayed remembered, and the next prints
  were never recorded. Old parts are still kept through the start G-code, so
  `AUTO_EJECT_GUARD` can stop a print on top of them, but once a new print reaches its first
  layer (or extrudes, if the slicer reports no layers) its parts replace them.

## [0.10.2] - 2026-10-19

### Fixed
- A printed calibration block on a warm bed, with sparse infill, sank under the probe a little at
  every touch, and Klipper stopped with `Probe samples exceed samples_tolerance`. The measurement
  now uses single touches, refuses to start while the bed is above 40 °C, and touches the block
  top again at the end: if it moved, it says so.
- When the blade never comes down on the block, the message says how high above the nozzle tip
  it must at least be, and how to lower it.

### Added
- `hardware/test/blade_gauge.stl`: a 1.5 mm strip to set the blade height.

## [0.10.1] - 2026-10-19

### Fixed
- On a Stealthburner the fan duct sits about 5 mm above the nozzle tip, so on the 12 mm
  calibration block it touched the block before the blade did, pushed a loose block around and
  was taken for the blade. The calibration block is now 3.5 mm tall and stays stuck to the bed
  where it was printed. A measurement on a tall block that sees something other than the blade
  stops with a clear message.

### Added
- The setup goes to a printed calibration block by itself, and homes around it.
- If the blade is not found on the side of the chosen drop edge, the measurement looks on the
  other side and names the edge to choose.

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

[Unreleased]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.13.0...HEAD
[0.13.0]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.10.5...v0.11.0
[0.10.5]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.10.4...v0.10.5
[0.10.4]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.10.3...v0.10.4
[0.10.3]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.10.2...v0.10.3
[0.10.2]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/ahmedbebars/klipper-auto-eject/compare/v0.10.0...v0.10.1
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
