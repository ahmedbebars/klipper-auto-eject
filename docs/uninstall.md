# Removing it

One line takes klipper-auto-eject back off a printer. Your printer works as before it was installed,
and you can install it again at any time.

## 1. Before you start

- **Not while printing.** Let the print end, or cancel it. Klipper restarts at the end.
- **The slicer:** take out the lines you added, so that new files do not call the macros:
  `AUTO_EJECT HEIGHT=[max_layer_z] HOME=1` in the end G-code, and `AUTO_EJECT_GUARD` and
  `EJECT_PURGE` in the start G-code ([slicer-setup.md](slicer-setup.md)). Files you sliced before
  still print: Klipper answers *Unknown command* to these lines and goes on.

## 2. Remove it

Over SSH, on the printer:

```bash
~/klipper-auto-eject/install.sh --uninstall
```

It takes out everything the installer put in, and keeps a copy of `printer.cfg` and
`moonraker.conf` before changing them (`printer.cfg.bak-…`, `moonraker.conf.bak-…`):

| What | Where |
|---|---|
| The link to the macros, and the two `[include auto_eject…]` lines | `printer.cfg` |
| The update manager section, the notifications and the Tailscale range in `trusted_clients` | `moonraker.conf` |
| The Auto-eject page and its menu entry | Mainsail or Fluidd, and nginx |
| The notification and farm service | `klipper-auto-eject` |

## 3. Restart

Type `FIRMWARE_RESTART` in the console (never while printing). If the script says so, restart
Moonraker too, from the power menu of Mainsail or Fluidd.

## 4. If you want, the rest

The script leaves these, in case you come back:

```bash
rm -rf ~/klipper-auto-eject                      # the project folder
rm ~/printer_data/config/auto_eject_settings.cfg # your settings
```

- Values saved from the web page are in the file of `[save_variables]`, on lines that start with
  `auto_eject_`. They do nothing without the macros; delete them if you like.
- Tailscale stays installed, as other things may use it ([remote-access.md](remote-access.md)).
- **The blade:** unscrew the arm from the toolhead mount ([hardware.md](hardware.md)).

## A printer farm

On the farm printer, the service and the page go. The other printers had nothing installed for
the farm, so nothing changes on them ([farm.md](farm.md)).
