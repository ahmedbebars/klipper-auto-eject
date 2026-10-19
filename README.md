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

```
   1. print finishes         2. bed cools             3. blade sweeps            4. bed is probed
   ┌────────────────┐        ┌────────────────┐       ┌────────────────┐         ┌────────────────┐
   │   ▲   ▲   ▲    │        │   ▲   ▲   ▲    │       │  ║ ║  →→ drop   │         │   ✓   ✓   ✓    │
   │   ▲   ▲   ▲    │   →    │   (28 °C)      │   →   │  ║ ║  →→ edge   │    →    │  empty → next  │
   └────────────────┘        └────────────────┘       └────────────────┘         └────────────────┘
```

`AUTO_EJECT` reads where every part sits from Klipper's `[exclude_object]` data, which the
slicer writes into the G-code. From that it plans the sweep: the blade drops in **behind** the
parts and pushes them over the edge at low speed and with reduced motor current, so a part
that refuses to move makes the motor skip instead of breaking something. Afterwards it touches
the old part locations with the probe and **stops the job queue** if anything is still there,
so the next print never lands on top of a leftover part.

## Features

- **Guided setup in Mainsail/Fluidd:** `AUTO_EJECT_SETUP` opens step-by-step dialogs. Jog the
  toolhead with buttons, and the blade height and offset are measured and saved for you. No config
  editing and no ruler. See [docs/setup-wizard.md](docs/setup-wizard.md).
- **Three path strategies:** `columns` (works with any layout), `objects` (one part at a time),
  and `full_width` (no slicer labels needed). See [docs/strategies.md](docs/strategies.md).
- **Any drop edge:** front, back, left or right.
- **Three cooling modes:** wait for a bed temperature, wait a fixed time, or don't wait.
- **Reduced motor current while pushing,** detected automatically for TMC2130/2208/2209/2240/2660/5160/5262.
- **Probe verification** with Tap, BLTouch or any `[probe]`, including hollow parts such as
  cookie cutters (`outline` mode).
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
| Hardware | A rigid blade on the toolhead carriage ([docs/hardware.md](docs/hardware.md)) and a bed surface parts release from when cool (PEI, CryoGrip, textured sheets) |
| Optional | A `[probe]` / `[bltouch]` for verification, `[respond]` + `[save_variables]` for the guided setup, and the Moonraker job queue for back-to-back prints |

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
4. Hook it into your print end ([docs/integration.md](docs/integration.md)).

Prefer editing files? Every setting is also in `auto_eject_settings.cfg`
([docs/configuration.md](docs/configuration.md)).

## Commands

| Command | What it does |
|---|---|
| `AUTO_EJECT_SETUP` | Guided setup in Mainsail/Fluidd dialogs |
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
| [Configuration](docs/configuration.md) | Every setting explained |
| [Strategies](docs/strategies.md) | How each path strategy calculates the sweep |
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
