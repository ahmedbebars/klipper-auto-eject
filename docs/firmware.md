[klipper-auto-eject](../README.md) › [Documentation](README.md) › Board firmware

# Board firmware: every board on Klipper's version, in one line

After a Klipper update, the firmware on the printer's boards (the main board, a CAN toolhead board,
the host process on the printer's computer) is older than Klipper. Often Klipper then stops with
`MCU Protocol error` until each board is rebuilt and flashed again: `make menuconfig`, `make`, and
a flash command that is different for each board. One line does it for all of them:

```bash
~/klipper-auto-eject/install.sh --firmware
```

It is optional, and nothing is written to a board before you say yes. The **Updates** tab of the
[web page](web-page.md#updates) shows when a board is behind, and has a button that does the same
([from the web page](#from-the-web-page)). The installer also says it at the end.

## What it does

1. It finds every board Klipper uses (each `[mcu]` section) and the version of its firmware. A
   board that runs Klipper's own version is left alone, and so is a probe with a board of its own
   (Beacon, Cartographer), which runs its maker's firmware.
2. It works out each board's build settings, what `make menuconfig` sets: see
   [where they come from](#where-the-build-settings-come-from).
3. It builds each firmware while Klipper still runs, each in its own folder
   (`~/.cache/klipper-auto-eject/firmware/<board>/`), so `~/klipper/out` is not touched.
4. It checks each build against what the board reports: its chip, the pins it talks on, its CAN
   speed and its baud rate. A build that would not be the same board any more is left out.
5. It shows what it will flash, in this order, and asks:

   | Order | Board | How | Password |
   |---|---|---|---|
   | 1 | CAN boards (a toolhead board) | Katapult over CAN, after it checks where Katapult starts the firmware | No |
   | 2 | USB boards (most main boards) | Klipper's own flash script, as `make flash` runs it: Katapult when the board has it, else DFU (STM32) or the boot mode (RP2040) | Katapult: no. DFU and the RP2040 boot mode: sudo asks for it |
   | 3 | A USB to CAN bridge | Katapult, after the boards behind it | No |
   | 4 | The host (`[mcu host]`, the computer's own) | sudo puts the new file in place, then the computer restarts | sudo asks for it |

6. It stops Klipper, flashes, starts Klipper again and shows each board's new version. After the
   host, the whole computer restarts instead: on some boards (BTT CB1 and CB2), a `klipper-mcu`
   service that is only restarted cannot run with real-time priority, and Klipper stays at
   *startup*.

A board written with the bootloader it came with (the BTT 32KiB one on an Octopus, for example)
keeps it: the firmware is written after it. Some STM32F4 boards do not start by themselves after
DFU: the tool waits for the board and asks you to press its RESET button when it does not come
back.

Two kinds of boards are built but not flashed, and the tool shows where the file is:

- a board on a serial port (UART), which no script can flash: write the file the way it was
  written the first time, often from an SD card;
- a CAN board with no bootloader: write it over its USB or SWD.

## Never while printing

Nothing is done while the printer prints or is paused, while Klipper runs a command, while
auto-eject pushes parts off or cools them in the background, or while a heater is on. It checks
again just before it stops Klipper. A job queue with jobs waiting is paused first: start it again
when you are ready. If a flash fails, or you press Ctrl+C, Klipper starts again.

## From the web page

With the klipper-auto-eject service on the printer (`install.sh --push` or `--farm`,
[notifications.md](notifications.md)), the **Updates** tab has an **Update the boards** button under
the boards' firmware. It says which boards it would write and asks first. Then it runs the same
update in the background, and each board shows as it is built, written, and on its new version.
Klipper is stopped meanwhile. After the host the computer restarts, and the page is back a minute
or two later. You can close the page: the update goes on, and the tab shows how it ended for a day.
The button stands out only when the board code changed since the boards' version.

No one is there to type a password, so the button writes some boards only after a setup, done
once. `install.sh --firmware` offers it the first time you run it in a terminal, and asks for your
sudo password for it:

| What | Where | For |
|---|---|---|
| A udev rule: the user Klipper runs as may write to a board in its bootloader (STM32 DFU, the RP2040 and RP2350 boot modes, the HID bootloader) | `/etc/udev/rules.d/60-klipper-auto-eject-firmware.rules` | USB boards: whether one has Katapult shows only once it is in its bootloader |
| A sudo rule for one command, with its exact arguments: the copy of the host firmware to `/usr/local/bin/klipper_mcu` | `/etc/sudoers.d/klipper-auto-eject-firmware` | The host |
| The service lets an update go on when it restarts on the way (an auto-eject update, for example) | `/etc/systemd/system/klipper-auto-eject.service.d/firmware.conf` | Every update |

The host firmware runs as root. With the sudo rule, a program running as that user could put a
program of its own in its place, so say no if other people or programs use that account. Without
the setup, the button writes the CAN boards and the bridge, leaves the others out, and shows the
line to run. A board that needs the two questions (below) is left out too, until they are answered
once over SSH. `install.sh --uninstall` takes the three files out again.

## Where the build settings come from

1. **The board itself.** Firmware built with Klipper v0.13.0-752 or newer (August 2026) carries the
   settings it was built with, and Klipper reports them. Nothing is asked.
2. **The last build.** After each flash, the settings are kept in
   `<config>/firmware/<board>.config`, next to `printer.cfg`, where Mainsail and Fluidd show them.
3. **A settings file on the printer.** `~/klipper/.config` (what `make menuconfig` left), or a
   `.config` file in the config folder, made for the same chip talking on the same pins. It asks
   before it uses one.
4. **Two questions.** The board reports its chip and the pins it talks on, so only what its maker
   knows is asked: the crystal (STM32 boards) and the bootloader. The board's guide says both, and
   so does the `make menuconfig` screen it was set up with.

So a board flashed with an older Klipper is asked once at most; from then on its settings are
known. A wrong answer gives firmware that does not start, and the board then has to be flashed by
hand: when you are not sure, look in the board's guide first.

## What it needs

- **The compiler for the boards.** When it is missing, the tool says so and nothing changes:

  ```bash
  sudo apt install gcc-arm-none-eabi binutils-arm-none-eabi libnewlib-arm-none-eabi
  ```

  It is there already if firmware was ever built on this printer.
- **Katapult on CAN boards**, the usual set-up of CAN toolhead boards. Klipper ships the flash
  tool itself (`lib/katapult`).
- **For an RP2040 board without a bootloader** (the BTT Eddy, for example), libusb, to build
  Klipper's `rp2040_flash` once: `sudo apt install libusb-1.0-0-dev pkg-config`.

## When it stops

| It says | What to do |
|---|---|
| The printer is printing (paused, heating…) | Run it again when the printer is idle |
| It would not be the same board any more | The settings do not fit this board: build it once by hand with `make menuconfig`. Next time the board reports its settings |
| Klipper does not keep these settings | An answer does not go with the others (USB with no crystal, for example), or this Klipper no longer has an option: build it once by hand |
| Its Katapult starts the firmware at another place | Nothing was written. The bootloader answer was wrong: delete `<config>/firmware/<board>.config` and run it again |
| No Katapult answered | Nothing was written. Switch the printer off and on, then flash that board by hand |
| The board has not come back yet | Press the board's RESET button, or switch the printer off and on |
| The bridge has no Katapult | It waits in DFU mode: run the `dfu-util` line it shows, or switch the printer off and on to go back to the old firmware |
| Left out: it needs a password here | From the web page only: run `install.sh --firmware` once over SSH and say yes to the web page question |

What each command printed is in `~/.cache/klipper-auto-eject/firmware/<board>/build.log`.

## More options

The installer runs `tools/firmware.py`, which you can run yourself, over SSH:

```bash
python3 ~/klipper-auto-eject/tools/firmware.py status                     # each board against Klipper
python3 ~/klipper-auto-eject/tools/firmware.py update --build-only        # build, flash nothing
python3 ~/klipper-auto-eject/tools/firmware.py update --only toolhead     # these boards only
```

`update --yes` asks nothing: a board that needs an answer is left out, and with no one at a
terminal so is a board that needs a password. `update --progress FILE` keeps the update's state in
a JSON file, which is how the web page follows it. `--moonraker URL` reaches a Moonraker on another
port.

The web page's update keeps its state in `~/.cache/klipper-auto-eject/firmware-update.json`, and
what it printed in `firmware-update.log` next to it.
