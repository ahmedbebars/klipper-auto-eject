<h1 align="center">klipper-auto-eject</h1>

<p align="center">
  <b>Your 3D printer clears its own bed between prints.</b><br>
  A printed blade on the toolhead pushes the finished parts into a box, the probe checks the bed is empty,<br>
  and the next print starts by itself. For any printer running Klipper.
</p>

<p align="center">
  <a href="https://github.com/ahmedbebars/klipper-auto-eject/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ahmedbebars/klipper-auto-eject/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/ahmedbebars/klipper-auto-eject/releases"><img alt="Release" src="https://img.shields.io/github/v/release/ahmedbebars/klipper-auto-eject?include_prereleases&sort=semver"></a>
  <a href="LICENSE"><img alt="License: GPL v3" src="https://img.shields.io/badge/license-GPLv3-blue.svg"></a>
  <a href="https://www.klipper3d.org/"><img alt="Klipper" src="https://img.shields.io/badge/Klipper-v0.12%2B-B12F36"></a>
  <a href="https://moonraker.readthedocs.io/"><img alt="Moonraker update manager" src="https://img.shields.io/badge/Moonraker-update__manager-2E7D32"></a>
  <img alt="Status: beta" src="https://img.shields.io/badge/status-beta-orange">
  <a href="CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg"></a>
</p>

<p align="center">
  <a href="docs/getting-started.md"><b>Getting started</b></a> ·
  <a href="#everything-it-does">Everything it does</a> ·
  <a href="docs/faq.md">FAQ</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/troubleshooting.md">Troubleshooting</a> ·
  <a href="https://github.com/ahmedbebars/klipper-auto-eject/discussions">Discussions</a> ·
  <a href="docs/uninstall.md">Removing it</a> ·
  <a href="docs/ar/README.md"><b>العربية</b></a>
</p>

<p align="center">
  <a href="https://www.klipper3d.org/" title="Klipper"><img src="docs/images/logos/klipper.png" alt="Klipper" height="44"></a>&emsp;
  <a href="https://docs.mainsail.xyz/" title="Mainsail"><img src="docs/images/logos/mainsail.svg" alt="Mainsail" height="44"></a>&emsp;
  <a href="https://docs.fluidd.xyz/" title="Fluidd"><img src="docs/images/logos/fluidd.svg" alt="Fluidd" height="44"></a>&emsp;
  <a href="https://github.com/SoftFever/OrcaSlicer" title="OrcaSlicer"><img src="docs/images/logos/orcaslicer.svg" alt="OrcaSlicer" height="44"></a>&emsp;
  <a href="https://github.com/prusa3d/PrusaSlicer" title="PrusaSlicer"><img src="docs/images/logos/prusaslicer.svg" alt="PrusaSlicer" height="44"></a>&emsp;
  <a href="https://github.com/Donkie/Spoolman" title="Spoolman"><img src="docs/images/logos/spoolman.svg" alt="Spoolman" height="44"></a>&emsp;
  <a href="https://github.com/3DPrintDemon/Demon_Klipper_Essentials_Unified" title="DEMON Klipper Essentials"><img src="docs/images/logos/demon.png" alt="DEMON Klipper Essentials" height="44"></a>
</p>
<p align="center"><sub>Works with Klipper and Moonraker, Mainsail or Fluidd, and OrcaSlicer, PrusaSlicer, SuperSlicer or Cura.
Phone access through Tailscale; the spool checked with Spoolman; DEMON and other macro sets. (<a href="docs/images/logos/README.md">about these logos</a>)</sub></p>

---

> [!WARNING]
> **Beta software that moves your printer on its own.** Watch several test runs before you leave
> a printer alone, and read [docs/safety.md](docs/safety.md) first.

## How it works

When a print finishes, the printer:

1. **Cools the bed** with the fan circling over the parts, until they let go of the sheet.
2. **Pushes the parts off** the edge with a blade fixed to the toolhead: slowly, and with less
   motor force than usual, so a stuck part makes the motor skip instead of breaking something.
3. **Checks the bed** by touching the probe where each part was. A part still there is pushed
   again, lower and harder.
4. **Starts the next print** from Moonraker's queue, or **stops the queue** if a part is still on
   the bed, so nothing is ever printed on top of it.

<p align="center"><img src="docs/images/how-it-works.svg" alt="One AUTO_EJECT run: cool down, plan, push, re-home, probe, retry or stop" width="900"></p>

The printer knows where every part is because the slicer writes the outlines into the G-code
(the *Label objects* option). Nothing has to be measured by hand.

## Everything it does

Each line is a shortcut to its page.

**Clearing the bed**

| | In short |
|---|---|
| [Cool, push, check](docs/getting-started.md) | After each print the bed cools, the blade pushes the parts off and the probe checks the bed is empty. Cooling never waits forever: in a warm room the parts are pushed after a time limit |
| [Gentle on the machine](docs/safety.md) | Lower motor current while pushing, set by itself for TMC drivers, so a stuck part makes the motor skip instead of breaking something. A part that stays is pushed again, lower and harder, then the queue stops |
| [Three ways to push](docs/strategies.md) | Side-by-side lanes for any layout, one part at a time, or the whole bed; to the front, back, left or right |
| [Thin parts](docs/configuration.md#thin-parts) | Flat prints such as stencils, which the blade cannot catch, stay on the bed and the queue waits for you |
| [Restarts and power cuts](docs/recovery.md) | The printer remembers where the parts are, homes without touching them and never prints on top of them |
| [The parts box](docs/configuration.md#the-parts-box) | Counts the parts in the box under the drop edge, warns at 80 % and holds the next print when it is full |
| [Probes](docs/probes.md) | Contact, offset and eddy-current probes, and printers without a probe |
| [`EJECT_PURGE`](docs/integration.md#eject_purge-instead-of-a-purge-line) | A purge blob the blade pushes off, instead of a purge line that builds up |

**Setting it up**

| | In short |
|---|---|
| [One-line install](docs/installation.md) | Asks what you want in plain words, adds what `printer.cfg` needs, and updates from Mainsail or Fluidd |
| [The blade](docs/hardware.md) | Three printed parts that fit most toolheads; 60, 80 or 100 mm wide, or any size from the OpenSCAD source |
| [Guided setup](docs/setup-wizard.md) | Five dialogs in Mainsail or Fluidd, no config editing and no ruler. With Voron Tap the blade measures itself |
| [Slicer setup](docs/slicer-setup.md) | *Label objects* and one end G-code line, for OrcaSlicer, PrusaSlicer, SuperSlicer and Cura |
| [Your macros](docs/integration.md) | Stock macros, DEMON Klipper Essentials, Klippain, RatOS and others |
| [Print in a row](docs/integration.md#moonraker-job-queue) | Moonraker's job queue: the next print starts once the bed is clear |
| [Settings](docs/configuration.md) | Every setting explained, in your own file that updates never touch |
| [Removing it](docs/uninstall.md) | One line takes it all back off |

**The web page**

| | In short |
|---|---|
| [Overview](docs/web-page.md#what-is-on-it) | A live map of the bed with the parts and the push lanes, and buttons to eject or test |
| [Print queue](docs/web-page.md#what-is-on-it) | Add files by their pictures, set copies, start or pause the queue |
| [Check a file](docs/web-page.md#what-is-on-it) | Before printing: are the parts labelled, can the blade reach them, the plan on the bed map |
| [Blade and setup](docs/web-page.md#what-is-on-it) | The measured blade, the setup, the test parts, and what to paste in your slicer |
| [Settings](docs/web-page.md#settings) | Every setting with a switch or a box, and **Only my changes** |
| [Hardware](docs/web-page.md#hardware) | Boards, motors, heaters, fans, the computer and the camera, live, and what is wrong |
| [Updates](docs/web-page.md#updates) | What changed in Klipper since your version, and whether the boards need a reflash |
| [Report a problem](docs/web-page.md#report-a-problem) | What a GitHub issue asks for, in one text, without your addresses |
| [Pictures of the prints](docs/web-page.md#pictures-of-the-prints) | Every file with its picture, time, filament and material |
| [English and Arabic](docs/web-page.md#translating) | Light or dark, right to left, on a phone; more languages welcome |
| [Try the demo](docs/web-page.md#trying-it-on-a-computer) | The whole page with a pretend printer, no printer needed |

**Away from the printer**

| | In short |
|---|---|
| [From anywhere](docs/remote-access.md) | Tailscale, a free private network between your devices: nothing is opened to the internet |
| [As an app](docs/web-page.md#on-your-phone-as-an-app) | Installs with its own icon, shortcuts, and a number on the icon for the printers that need you |
| [Notifications](docs/notifications.md) | When the printer needs you, with the page closed: in the app, ntfy, Telegram or Discord |
| [Spoolman](docs/spoolman.md) | The queue stops before a job the spool on the printer cannot finish |

**Many printers**

| | In short |
|---|---|
| [Printer farm](docs/farm.md) | Every Klipper printer on the network on one page, the ones that need you first; the others need nothing installed |
| [Its buttons](docs/farm.md#the-buttons) | Print, send a file, pause, cancel, start the queue, emergency stop, turn on or off |
| [Switch off by itself](docs/farm.md#switching-printers-off-by-themselves) | A printer with a power switch turns off when it has nothing to do |
| [Maintenance and a daily report](docs/farm.md#maintenance-reminders-and-the-daily-report) | A reminder every so many hours of printing, and the day's summary on the phones |
| [One printer or a hundred](docs/farm.md#a-big-farm) | Filters, a search, a list, and groups by shelf or room |
| [Several at once](docs/farm.md#one-command-for-several-printers) | One command, or one file to print, for the printers you tick |
| [Production](docs/farm.md#production) | What each printer made today, in 7 or 30 days, with a CSV, and each one's spool |
| [Update the whole farm](docs/farm.md#updating-the-whole-farm) | Every printer's versions, and the free ones updated from one place |

The macros are tested automatically on every change, against the Jinja2 versions Klipper uses.

## Is it for me?

| You need | Why | How to check |
|---|---|---|
| A printer running **Klipper**, with Mainsail or Fluidd | It is made of Klipper macros | You open the printer in a browser |
| A bed sheet that **lets go of parts when cool** | The blade pushes, it cannot pry | A cooled part slides off with a finger push |
| A slicer that can **label objects** | That is how the printer knows where the parts are | OrcaSlicer, PrusaSlicer, SuperSlicer, Cura with the Klipper plugin |
| Room to **print a blade** in PETG, ABS or ASA | It is mounted on the toolhead | Three small parts, about 3 hours |
| Recommended: a **probe** | To check the bed is empty before the next print | Voron Tap, BLTouch, Klicky, inductive… |

Not for delta printers, or for printers on Marlin, Bambu Lab or stock Prusa firmware.

## Getting started

<p align="center"><img src="docs/images/getting-started.svg" alt="Eight steps: check your bed, print the blade, mount it, install, guided setup, watch a test, slicer, print in a row" width="900"></p>

**[The beginner's guide](docs/getting-started.md)** walks you through every step and says how
to check that it worked. In short:

1. **Check your bed:** a cooled part must slide off with a finger push.
2. **Print the blade** from [`hardware/stl/`](hardware/stl/): a blade, an arm and a mount.
3. **Mount it** on the toolhead and set its height with the printed gauge ([hardware.md](docs/hardware.md)).
4. **Install** over SSH, with one line:
   ```bash
   cd ~ && git clone https://github.com/ahmedbebars/klipper-auto-eject.git && ./klipper-auto-eject/install.sh
   ```
   It asks a few yes/no questions (the web page? your phone? notifications? more than one
   printer?), adds what `printer.cfg` needs, and restarts Klipper for you if it is not printing
   ([installation.md](docs/installation.md)). To take it back off later, it is one line too
   ([removing it](docs/uninstall.md)).
5. **Run the guided setup:** type `AUTO_EJECT_SETUP` in the console and press the buttons.
   With Voron Tap the printer measures the blade by itself ([with pictures](docs/setup-wizard.md)).
6. **Watch a test:** print two or three test cubes, leave them on the bed, and run `AUTO_EJECT`.
7. **Slicer:** turn on *Label objects* and add `AUTO_EJECT HEIGHT=[max_layer_z] HOME=1` to the
   end G-code, below your end macro ([slicer-setup.md](docs/slicer-setup.md)).
8. **Print in a row:** turn on Moonraker's job queue and queue as many prints as you like.

### Removing it

One line takes it all back off, and your printer works as before
([what it removes and what it leaves](docs/uninstall.md)):

```bash
~/klipper-auto-eject/install.sh --uninstall
```

Then restart Klipper with `FIRMWARE_RESTART`, never while printing.

## The web page

<p align="center"><img src="docs/images/web-page.png" alt="The Auto-eject page in Mainsail while the printer clears the bed" width="900"></p>

An optional **Auto-eject** page in the Mainsail sidebar: a live map of the bed with the parts
and the push lanes, buttons to eject or test, the print queue, a check that tells you *before*
printing whether a file can be cleared automatically, the blade setup, every setting, and the
machine's hardware. In English or Arabic, light or dark, and on a phone.

```bash
~/klipper-auto-eject/install.sh --web
```

It needs your password once, for the web server. Details: [docs/web-page.md](docs/web-page.md).
You can also [try a demo](docs/web-page.md#trying-it-on-a-computer) without a printer.

### On your phone, as an app

<p align="center"><img src="docs/images/phone-app.png" alt="The auto-eject app on a phone: clearing the bed, the printer farm in Arabic, the blade" width="820"></p>

**From anywhere:** `install.sh --remote` sets up Tailscale, a free private network between your
devices, so the printer opens from your phone wherever you are, without opening it to the
internet ([docs/remote-access.md](docs/remote-access.md)). Over HTTPS the page installs as an app
with its own icon, and `install.sh --push` sends a notification to it when the printer needs you,
even while it is closed ([docs/notifications.md](docs/notifications.md)).

### A printer farm

<p align="center"><img src="docs/images/farm.png" alt="The printer farm: printers that need you first, then the ones printing, free and offline" width="900"></p>

`install.sh --farm` on one printer puts every Klipper printer of your network on one page, the
ones that need you first. **Search the network** finds them and adds them; the other printers
need nothing installed ([docs/farm.md](docs/farm.md)). It is made for one printer or a hundred:
filters, a search, a list with a line for each printer, groups by shelf or room, and the whole
farm updated from one place, only the printers that do nothing.

### The machine's hardware

<p align="center"><img src="docs/images/hardware.png" alt="The Hardware tab: the boards and their links, the motors with their StallGuard line, the heaters" width="900"></p>

A **Hardware** tab shows everything Klipper and Moonraker tell about the machine, live: each board
and how clean its link is (USB or CAN), every motor and its driver's warnings, the heaters, the fans,
the computer, the sensors and the camera, with one line that says whether all is normal. With
`install.sh --push` the serious ones reach your phone with the page closed: a fan that stopped, a
hot motor, a cable starting to fail ([docs/web-page.md](docs/web-page.md#hardware)).

## The blade

<p align="center">
  <img src="hardware/images/voron-stealthburner-front.jpg" width="32%" alt="Blade fitted to a Voron Stealthburner, front view">
  <img src="hardware/images/voron-stealthburner-closeup.jpg" width="32%" alt="Mount, arm and blade on the Stealthburner front cover">
  <img src="hardware/images/voron-stealthburner-side.jpg" width="32%" alt="Side view: the blade reaches ahead of the toolhead">
</p>
<p align="center"><sub>Fitted to a Voron Trident 450 with a Stealthburner toolhead, 100 mm blade.</sub></p>

Three printed parts held with M3 screws. Every joint has slots, so it fits most toolheads: the
mount takes toolhead screws 28–50 mm apart (or a strap), and height and reach adjust in the
slots. Blades come 60, 80 and 100 mm wide, and the OpenSCAD source makes any other size.
See [docs/hardware.md](docs/hardware.md).

**It measures itself.** With Voron Tap or any probe that touches with the nozzle, you print a
small block and leave it on the bed. The printer touches it with the nozzle, then with the blade,
and works out how high the blade sits and how far ahead of the nozzle, in 2–3 minutes.

<p align="center"><img src="docs/images/blade-measurement.svg" alt="How the blade is measured with Voron Tap" width="900"></p>

## Compatibility

| Printer type | Status | Notes |
|---|:---:|---|
| CoreXY (Voron, RatRig, VzBot, Sovol SV08…) | ✅ | Ideal: the bed stays still |
| Cartesian, fixed bed | ✅ | |
| Bed slinger (Ender 3, Prusa MK3-style) on Klipper | ✅ | Push left or right, so the moving bed doesn't shake the parts |
| Vendor Klipper (Creality K1, Qidi, Sovol) | ⚠️ | Works if you can edit the config and the firmware is close to mainline |
| Delta | ❌ | The planning assumes a rectangular bed |
| Marlin, Bambu Lab, stock Prusa firmware | ❌ | Klipper only |

> **Field testing:** the first real-hardware runs are on a Voron Trident 450 with Voron Tap.
> Reports from other machines are very welcome:
> [share yours here](https://github.com/ahmedbebars/klipper-auto-eject/discussions).

## Everyday commands

| Command | What it does |
|---|---|
| `AUTO_EJECT` | Cool, push the parts off, check the bed |
| `AUTO_EJECT DRY=1` | Trace the path above the bed without pushing |
| `AUTO_EJECT HOME=1` | After a restart: home safely around the parts, then eject |
| `AUTO_EJECT_CLEAR` | You took the parts off by hand: forget them |
| `AUTO_EJECT_SETUP` | The guided setup |
| `AUTO_EJECT_SET KEY=cool_temp VALUE=35` | Change one setting and keep it |

All commands and options: [docs/commands.md](docs/commands.md).

## Documentation

| Start here | Set it up | Every day | Fine-tune and help |
|---|---|---|---|
| [Getting started](docs/getting-started.md) | [Hardware](docs/hardware.md) | [Commands](docs/commands.md) | [Configuration](docs/configuration.md) |
| [FAQ](docs/faq.md) | [Installation](docs/installation.md) | [Integration](docs/integration.md) | [Strategies](docs/strategies.md) |
| [Glossary](docs/glossary.md) | [Guided setup](docs/setup-wizard.md) | [Recovery](docs/recovery.md) | [Probes](docs/probes.md) |
| [Safety](docs/safety.md) | [Slicer setup](docs/slicer-setup.md) | [Web page](docs/web-page.md) | [Troubleshooting](docs/troubleshooting.md) |
| [العربية](docs/ar/README.md) | [Removing it](docs/uninstall.md) | | |
| | | [Remote access](docs/remote-access.md) | |
| | | [Notifications](docs/notifications.md) | |
| | | [Printer farm](docs/farm.md) | |

## Contributing

Bug reports, notes about your printer and pull requests are welcome; see
[CONTRIBUTING.md](CONTRIBUTING.md). If you run it on your machine, please share your blade and
settings in the [discussions](https://github.com/ahmedbebars/klipper-auto-eject/discussions) so
others can start from them. Translations of the web page are welcome too
([how](docs/web-page.md#translating)).

## License

[GNU GPLv3](LICENSE), the same license as Klipper. © 2026 Ahmed Bebars.
