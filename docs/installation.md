[klipper-auto-eject](../README.md) › [Documentation](README.md) › Installation

# Installation

There are three ways to install klipper-auto-eject. All of them end with the same two files in
your Klipper config folder:

| File | Purpose | Updated automatically? |
|---|---|---|
| `auto_eject.cfg` | The macros | Yes (it is a link into the repository) |
| `auto_eject_settings.cfg` | Your settings | **Never.** It is yours to edit |

The macros need only Klipper. The notifications and the printer farm run as a small service,
`klipper-auto-eject`, which needs Python 3.9 or newer (Debian 11 Bullseye and newer have it).

## Option 1: install script (recommended)

Open a terminal on the printer over SSH (on Windows: PowerShell, `ssh pi@<printer address>`, with
your printer's user name) and paste this one line:

```bash
cd ~ && git clone https://github.com/ahmedbebars/klipper-auto-eject.git && ./klipper-auto-eject/install.sh
```

It asks a few questions first. Press **Enter** to keep the suggested answer (the one in capitals):

```text
[auto-eject] Will this printer push its prints off with the blade? (No: only the web page or the farm) [Y/n]
[auto-eject] Add the auto-eject page to Mainsail (bed map, print queue, settings)? [Y/n]
[auto-eject] Watch and control the printer from your phone, from anywhere? (a free Tailscale account) [y/N]
[auto-eject] Notifications on your phone when the printer needs you? [Y/n]
[auto-eject] More than one Klipper printer? See them all on one page (printer farm)? [y/N]
```

Then it:

1. links `auto_eject.cfg` into your config folder and creates `auto_eject_settings.cfg`, the file
   with your own settings, which updates never change;
2. adds the `[include]` lines to `printer.cfg`, next to your own `[include]` lines at the top
   (or above the `SAVE_CONFIG` block if there are none there), and says on which line;
3. adds the Klipper sections auto-eject needs if your config lacks them
   ([below](#what-printercfg-needs));
4. adds the `[update_manager klipper-auto-eject]` section to `moonraker.conf`, so updates come
   from the Mainsail/Fluidd update panel;
5. sets up what you said yes to: the web page, phone access, notifications, the printer farm;
6. offers to restart Klipper, and does it only if the printer is not printing;
7. tells you what to do next: mount the blade and run the guided setup.

Every file it changes is backed up first (`printer.cfg.bak-auto-eject-<date>`). It never runs as
root; it asks for your password (`sudo`) only for the web page and the notification service. Run
it again at any time: what is already set up stays as it is.

### What printer.cfg needs

auto-eject uses three Klipper sections. Most configs already have them (Mainsail's and Fluidd's
`*.cfg` files include `[respond]`); the installer adds the missing ones:

```ini
[exclude_object]       # where every part is, from the sliced file
[respond]              # messages and dialogs in the console
[save_variables]       # remembers the parts across restarts
filename: ~/printer_data/config/variables.cfg
```

If `printer.cfg` already has a `[save_variables]` section (DEMON and other macro sets add one), keep
it as it is: auto-eject uses whatever file it names, and a second section would move the other
set's values to another file.

### Script options

| Option | Default | Use it for |
|---|---|---|
| `-c`, `--config-dir DIR` | `~/printer_data/config` | Multiple Klipper instances, or old `~/klipper_config` layouts |
| `-r`, `--repo-dir DIR` | `~/klipper-auto-eject` | Keeping the repository somewhere else |
| `-b`, `--branch NAME` | `main` | Testing a development branch |
| `--no-include` | | You manage `[include]` lines yourself |
| `--no-update-manager` | | You don't use Moonraker, or you manage `moonraker.conf` yourself |
| `-w`, `--web` | | Also setting up the web page at `http://<printer>/auto-eject/` and its Mainsail sidebar link. Needs `sudo` once, for nginx ([web-page.md](web-page.md)) |
| `-R`, `--remote` | | Also setting up remote access with Tailscale, so the printer opens from your phone anywhere. Asks before every step ([remote-access.md](remote-access.md)) |
| `-P`, `--push` | | Also installing the `klipper-auto-eject` service: the auto-eject app gets notifications even while it is closed, and the printer farm works. Notifications need HTTPS (`--remote`); `sudo` once ([notifications.md](notifications.md)) |
| `-F`, `--farm` | | All your printers on one page: the web page and the `klipper-auto-eject` service, which finds the other printers on the network. They need nothing installed ([farm.md](farm.md)) |
| `-N`, `--notify` | | Also sending notifications to your phone with the ntfy app, Telegram or Discord: a part still on the bed, a print that finished. Asks before every step ([notifications.md](notifications.md)) |
| `-S`, `--spoolman` | | Linking Moonraker to your Spoolman, so the queue stops before a job the spool cannot finish. Asks for Spoolman's address and checks that Spoolman answers there ([spoolman.md](spoolman.md)) |
| `-u`, `--uninstall` | | Removing the link, the includes, the update manager section, the web page and the Tailscale range it added to `trusted_clients` |

Example for a second printer instance:

```bash
./klipper-auto-eject/install.sh --config-dir ~/printer_2_data/config
```

## Option 2: manual

1. Copy `config/auto_eject.cfg` and `config/auto_eject_settings.cfg` into your config folder
   (for example, upload them in Mainsail or Fluidd).
2. Add to `printer.cfg`:
   ```ini
   [include auto_eject.cfg]
   [include auto_eject_settings.cfg]
   ```
3. Make sure `printer.cfg` has an `[exclude_object]` section.
4. `FIRMWARE_RESTART`.

You will need to replace `auto_eject.cfg` by hand to update.

## Option 3: Moonraker update manager only

If you cloned the repository yourself and linked `auto_eject.cfg`, add this to
`moonraker.conf` to get updates from the Mainsail/Fluidd update panel:

```ini
[update_manager klipper-auto-eject]
type: git_repo
path: ~/klipper-auto-eject
origin: https://github.com/ahmedbebars/klipper-auto-eject.git
primary_branch: main
is_system_service: False
```

Restart Moonraker afterwards.

## After installing

- Make sure `printer.cfg` has these sections, and add the ones that are missing:
  ```ini
  [exclude_object]
  [respond]
  [save_variables]
  filename: ~/printer_data/config/variables.cfg
  ```
- Turn on **Label objects** in your slicer (OrcaSlicer: *Process → Others → Label objects*;
  PrusaSlicer: *Print Settings → Output options → Label objects: Firmware-specific*).
- Configure the blade: see [hardware.md](hardware.md) and [configuration.md](configuration.md).

## Updating

- **Moonraker:** click *Update* next to `klipper-auto-eject` in the update panel.
- **Shell:** `git -C ~/klipper-auto-eject pull`

Then run `FIRMWARE_RESTART`. Updates never touch your `auto_eject_settings.cfg`. New settings
work immediately with their defaults, and [CHANGELOG.md](../CHANGELOG.md) lists them if you want
to change them.

## Uninstalling

Before and after, step by step: [uninstall.md](uninstall.md).

```bash
~/klipper-auto-eject/install.sh --uninstall
rm -rf ~/klipper-auto-eject                      # optional
rm ~/printer_data/config/auto_eject_settings.cfg # optional
```
