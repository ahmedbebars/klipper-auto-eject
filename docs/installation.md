[klipper-auto-eject](../README.md) › [Documentation](README.md) › Installation

# Installation

There are three ways to install klipper-auto-eject. All of them end with the same two files in
your Klipper config folder:

| File | Purpose | Updated automatically? |
|---|---|---|
| `auto_eject.cfg` | The macros | Yes (it is a link into the repository) |
| `auto_eject_settings.cfg` | Your settings | **Never.** It is yours to edit |

## Option 1: install script (recommended)

Run these on the printer's computer over SSH. New to SSH? [Getting started, step 4](getting-started.md#4-install-the-macros)
shows how to connect.

```bash
cd ~
git clone https://github.com/ahmedbebars/klipper-auto-eject.git
./klipper-auto-eject/install.sh
```

The script:

1. Links `~/printer_data/config/auto_eject.cfg` to the repository copy.
2. Copies `auto_eject_settings.cfg` into the config folder. An existing copy is left alone.
3. Adds the following to `printer.cfg`, above the `SAVE_CONFIG` block:
   ```ini
   [include auto_eject.cfg]
   [include auto_eject_settings.cfg]
   ```
4. Adds an `[update_manager klipper-auto-eject]` section to `moonraker.conf`.

Every file it changes is backed up first as `<file>.bak-auto-eject-<date>`. It does not need
`sudo`, except for the optional web page (`--web`), remote access (`--remote`) and the
notification service (`--push`).

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
| `-P`, `--push` | | Also installing the notification service: the auto-eject app gets notifications even while it is closed. Needs HTTPS (`--remote`) and `sudo` once ([notifications.md](notifications.md)) |
| `-N`, `--notify` | | Also sending notifications to your phone with ntfy: a part still on the bed, a print that finished. Asks before every step ([notifications.md](notifications.md)) |
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

```bash
~/klipper-auto-eject/install.sh --uninstall
rm -rf ~/klipper-auto-eject                      # optional
rm ~/printer_data/config/auto_eject_settings.cfg # optional
```
