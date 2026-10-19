<h1 align="center">klipper-auto-eject</h1>

<p align="center">
  <b>Clear the bed automatically between prints.</b><br>
  Klipper macros that cool the bed, push finished parts off the edge with a toolhead-mounted blade,<br>
  check the bed is empty with your probe, and let Moonraker start the next job.
</p>

<p align="center">
  <!-- CI badge: <a href="https://github.com/ahmedbebars/klipper-auto-eject/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ahmedbebars/klipper-auto-eject/actions/workflows/ci.yml/badge.svg"></a> -->
  <a href="https://github.com/ahmedbebars/klipper-auto-eject/releases"><img alt="Release" src="https://img.shields.io/github/v/release/ahmedbebars/klipper-auto-eject?include_prereleases&sort=semver"></a>
  <a href="LICENSE"><img alt="License: GPL v3" src="https://img.shields.io/badge/license-GPLv3-blue.svg"></a>
  <a href="https://www.klipper3d.org/"><img alt="Klipper" src="https://img.shields.io/badge/Klipper-v0.12%2B-B12F36"></a>
  <a href="https://moonraker.readthedocs.io/"><img alt="Moonraker update manager" src="https://img.shields.io/badge/Moonraker-update__manager-2E7D32"></a>
  <img alt="Status: beta" src="https://img.shields.io/badge/status-beta-orange">
  <a href="CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg"></a>
</p>

---

> [!WARNING]
> **Beta software that moves your printer on its own.** Watch several dry runs and real ejects
> before you leave a printer unattended, and read [docs/safety.md](docs/safety.md) first.

## What it does

<p align="center"><img src="docs/images/how-it-works.svg" alt="One AUTO_EJECT run: cool down, plan, push, re-home, probe, retry or stop" width="900"></p>

`AUTO_EJECT` reads where every part sits from Klipper's `[exclude_object]` data, which the
slicer writes into the G-code. From that it plans the sweep: the blade drops in **behind** the
parts and pushes them over the edge at low speed and with reduced motor current, so a part
that refuses to move makes the motor skip instead of breaking something. Afterwards it homes X
and Y again and touches the old part locations with the probe. A part that is still there is
pushed again, lower and harder. If it still won't move, the macro **stops the job queue**, so
the next print never lands on top of a leftover part.

## Features

- **Its own page in Mainsail:** a bed map with the push lanes and the toolhead moving live,
  buttons to eject, dry-run or clear, the print queue, a check that tells you before printing
  whether a file can be cleared automatically, the blade setup and every setting, in English or
  Arabic, light or dark, on a phone too. Optional: `install.sh --web`
  ([docs/web-page.md](docs/web-page.md)).
- **Guided setup in Mainsail/Fluidd:** `AUTO_EJECT_SETUP` takes five short dialogs, and the
  blade is measured and saved for you. No config editing and no ruler. Every screen is shown with
  a picture in [docs/setup-wizard.md](docs/setup-wizard.md).
- **Measures the blade by itself with Voron Tap:** the nozzle probe touches a calibration cube with
  the nozzle, then with the blade, and works out the blade's height above the nozzle tip and its
  distance ahead of the nozzle to a fraction of a millimetre (`AUTO_EJECT_CALIBRATE`).
- **Leaves thin prints alone:** stencils and flat signs only a few layers tall are too thin to
  push, so they are left on the bed, the job queue waits, and a dialog asks you to take them off
  ([thin parts](docs/configuration.md#thin-parts)).
- **Survives restarts and power cuts:** part outlines and print height are saved while printing.
  `AUTO_EJECT HOME=1` homes Z on a free spot so a part is never mistaken for the bed, and
  `AUTO_EJECT_GUARD` stops a new print from landing on old parts. See [docs/recovery.md](docs/recovery.md).
- **Three path strategies:** `columns` (works with any layout), `objects` (one part at a time),
  and `full_width` (no slicer labels needed). See [docs/strategies.md](docs/strategies.md).
- **Any drop edge:** front, back, left or right.
- **Three cooling modes:** wait for a bed temperature, wait a fixed time, or don't wait. While it
  waits, the toolhead circles over the parts with the fan on, so they cool and let go sooner.
- **Reduced motor current while pushing,** detected automatically for TMC2130/2208/2209/2240/2660/5160/5262.
- **Probe verification** with Tap, BLTouch or any `[probe]`, including hollow parts such as
  cookie cutters (`outline` mode). Offset probes never lower the nozzle onto a part, and eddy-current
  probes are detected and handled ([docs/probes.md](docs/probes.md)).
- **Retries a stuck part:** after the sweep X and Y are homed again (skipped steps no longer
  matter), and a part the probe still finds is pushed again, lower and with more current.
- **`EJECT_PURGE`:** a tall purge pellet placed where the sweep removes it, instead of a thin
  purge line that builds up on the bed.
- **Dry-run mode** (`AUTO_EJECT DRY=1`) traces the whole path at a safe height.
- **Three ways to install:** the install script, by hand, or updates through Moonraker's update manager.
- **Settings in their own file,** so updates never overwrite your configuration.
- Macros are covered by automated tests on every commit, against the Jinja2 versions Klipper ships.

## Requirements

| | |
|---|---|
| Firmware | Klipper v0.12 or newer, with `[exclude_object]` enabled |
| Slicer | "Label objects" / "Exclude objects" turned on (OrcaSlicer, PrusaSlicer, SuperSlicer, Cura with the Klipper plugin) |
| Hardware | The printable [universal blade](docs/hardware.md#universal-blade-recommended) (fits most toolheads) and a bed surface parts release from when cool (PEI, CryoGrip, textured sheets) |
| Optional | A `[probe]` / `[bltouch]` for verification, `[respond]` + `[save_variables]` for the guided setup, and the Moonraker job queue for back-to-back prints |

## The blade

<p align="center"><img src="hardware/images/assembly_front.png" width="420" alt="Universal blade"></p>

A three-part printable blade with slotted joints that fits most toolheads. Height and reach adjust
with the slots, and `AUTO_EJECT_SETUP` measures the rest. STL files and the parametric OpenSCAD
source are in [`hardware/`](hardware/), and the guide is [docs/hardware.md](docs/hardware.md).

<p align="center">
  <img src="hardware/images/voron-stealthburner-front.jpg" width="32%" alt="Blade fitted to a Voron Stealthburner, front view">
  <img src="hardware/images/voron-stealthburner-closeup.jpg" width="32%" alt="Mount, arm and blade on the Stealthburner front cover">
  <img src="hardware/images/voron-stealthburner-side.jpg" width="32%" alt="Side view: the blade reaches ahead of the toolhead">
</p>
<p align="center"><sub>Fitted to a Voron Trident 450 with a Stealthburner toolhead, 100 mm blade.</sub></p>

### It measures itself

With Voron Tap or any probe that touches with the nozzle, you do not measure the blade at all.
Put a calibration cube under the nozzle and run `AUTO_EJECT_CALIBRATE`: the printer touches the
cube with the nozzle, then with the blade, and works out how high the blade sits and how far
ahead of the nozzle, in about 2–3 minutes.

<p align="center"><img src="docs/images/blade-measurement.svg" alt="How the blade is measured with Voron Tap" width="900"></p>

## Compatibility

| Printer type | Status | Notes |
|---|:---:|---|
| CoreXY (Voron, RatRig, VzBot, Sovol SV08…) | ✅ | Ideal: fixed bed, full XY reach |
| Cartesian, fixed bed | ✅ | |
| Bed slinger (Ender 3, Prusa MK3-style) on Klipper | ✅ | Prefer `direction: "left"` or `"right"` so the bed doesn't shake the parts |
| Vendor Klipper (Creality K1, Qidi, Sovol) | ⚠️ | Works if you can edit the config and the firmware is close to mainline |
| Delta | ❌ | Path planning assumes a rectangular bed |
| Marlin, Bambu Lab, stock Prusa firmware | ❌ | Klipper only |

> **Field testing:** the macros are covered by automated tests and load cleanly on Klipper v0.13.
> The first real-hardware runs are underway on a Voron Trident. Reports from other machines are
> very welcome; [share yours here](https://github.com/ahmedbebars/klipper-auto-eject/discussions).

## Quick start

```bash
cd ~
git clone https://github.com/ahmedbebars/klipper-auto-eject.git
./klipper-auto-eject/install.sh
```

The script links the macros into your config folder, creates `auto_eject_settings.cfg`, adds the
`[include]` lines to `printer.cfg` and registers the project with Moonraker's update manager. It
backs up every file before it changes it. Manual installation and the options for multiple
instances are covered in [docs/installation.md](docs/installation.md).

Then:

1. Mount the blade ([docs/hardware.md](docs/hardware.md)).
2. `FIRMWARE_RESTART`, then run **`AUTO_EJECT_SETUP`** and follow the dialogs. They cover direction,
   blade height and offset, width, current, cooling, saving and a dry test.
3. After your next print, run `AUTO_EJECT` with the parts on the bed while you stand next to the printer.
4. Add `AUTO_EJECT` to your slicer's end G-code ([docs/slicer-setup.md](docs/slicer-setup.md)).

Prefer editing files? Every setting is also in `auto_eject_settings.cfg`
([docs/configuration.md](docs/configuration.md)).

### The web page

<p align="center"><img src="docs/images/web-page.png" alt="The Auto-eject page in Mainsail while the printer clears the bed" width="900"></p>

```bash
~/klipper-auto-eject/install.sh --web
```

Adds an **Auto-eject** page at `http://<printer>/auto-eject/` and a link to it in the Mainsail
sidebar. It needs `sudo` once, for nginx. See [docs/web-page.md](docs/web-page.md), or try the
demo first: `web/index.html?demo` from any local web server.

## Commands

| Command | What it does |
|---|---|
| `AUTO_EJECT_SETUP` | Guided setup in Mainsail/Fluidd dialogs |
| `AUTO_EJECT_CALIBRATE` | Measure the blade again with a nozzle probe (Voron Tap), e.g. after moving it |
| `AUTO_EJECT HOME=1` | After a restart: home safely around the parts, then eject |
| `AUTO_EJECT_GUARD` | First line of the start G-code: never print on top of old parts |
| `AUTO_EJECT_CLEAR` | Parts removed by hand: forget them |
| `AUTO_EJECT_CONTINUE` | Thin parts removed by hand: start the job queue again |
| `AUTO_EJECT_SET KEY=cool_temp VALUE=35` | Change one setting and keep it after a restart (`RESET=1` goes back to the file) |
| `AUTO_EJECT_SETUP STEP=reset` | Forget the values saved by the setup |
| `AUTO_EJECT` | Cool, sweep, verify |
| `AUTO_EJECT DRY=1` | Trace the path at a safe height, with no cooling, current changes or probing |
| `AUTO_EJECT STRATEGY=objects` | Override the strategy for one run (`columns`, `objects`, `full_width`) |
| `AUTO_EJECT COOL=0` | Skip the cool-down wait |
| `AUTO_EJECT VERIFY=0` | Skip the probe check |
| `EJECT_PURGE [X=] [Y=]` | Purge a pellet in front of the parts (call it in your print start) |

## Using it with a print queue

```ini
# moonraker.conf
[job_queue]
load_on_startup: False
automatic_transition: True
job_transition_delay: 5
```

Call `AUTO_EJECT` at the end of every print, and queue your jobs in Mainsail/Fluidd or from the
slicer. When `AUTO_EJECT` raises an error (part left on the bed, printer not homed), the print
ends in an error state and Moonraker **does not** start the next job. Details for generic
`PRINT_END` macros, DEMON Klipper Essentials and Klippain are in
[docs/integration.md](docs/integration.md).

## Documentation

| | |
|---|---|
| [Installation](docs/installation.md) | Script, manual and Moonraker installs, updates, uninstalling |
| [Guided setup](docs/setup-wizard.md) | The `AUTO_EJECT_SETUP` dialogs, step by step |
| [Web page](docs/web-page.md) | The Auto-eject page in Mainsail: installing it, what it shows, translating it |
| [Configuration](docs/configuration.md) | Every setting explained |
| [Strategies](docs/strategies.md) | How each path strategy calculates the sweep |
| [Probes](docs/probes.md) | Offset probes (BLTouch …) and eddy-current probes (Eddy, Beacon, Cartographer) |
| [Recovery](docs/recovery.md) | Restarts, power loss, smart homing and the start guard |
| [Slicer setup](docs/slicer-setup.md) | Start/end G-code for OrcaSlicer, PrusaSlicer, SuperSlicer and Cura |
| [Integration](docs/integration.md) | Print end hooks, job queue, purge pellet, slicer settings |
| [Hardware](docs/hardware.md) | Designing, printing and measuring the blade |
| [Safety](docs/safety.md) | What can go wrong and what the macros do about it |
| [Troubleshooting](docs/troubleshooting.md) | Common errors and fixes |

## Contributing

Bug reports, printer-specific notes and pull requests are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md). If you run it on your machine, please share your blade
design and settings in the discussions so others can start from them.

## License

[GNU GPLv3](LICENSE), the same license as Klipper. © 2026 Ahmed Bebars.
