[klipper-auto-eject](../README.md) › [Documentation](README.md) › Printer farm

# Printer farm

Every Klipper printer on your network on one page, with the ones that need you first: a print
to take off, a part that stayed on the bed, an error, a paused queue. You install it on **one
printer only**. It searches the network, finds the other printers and adds them; **the other
printers need nothing installed**.

| A card shows | |
|---|---|
| **Needs you** | A finished print to take off, a part that stayed on the bed, parts too thin to push, an error, a cancelled print, or a job queue that waits for you. It says which. |
| **Printing** | The file with its picture, how far it is, the time left and the layer |
| **Clearing the bed** | auto-eject is cooling the bed and pushing the parts off |
| **Paused**, **Stopped** | A paused print; Klipper stopped, with its message |
| **Free** | Ready for the next print, and how many jobs wait in its queue |
| **Offline** | Not answering |

<p align="center"><img src="images/farm.png" alt="The printer farm: printers that need you first, then the ones printing, free and offline" width="900"></p>

Each card also shows the bed temperature and, if the printer has a camera in Moonraker, its
picture. At the top: how many need you, print, are free or offline. The **Printer farm** tab in
the menu shows the number that need you too.

From each printer's print history in Moonraker, a card also shows the hours it has printed, how
many of its last 50 prints ended well, and today's count. The top line adds up the whole farm:
*Today: 16 ended well, 2 stopped · 4571 h printed in all*. A print stopped means it ended with an
error or was cancelled.

Printers with klipper-auto-eject show their parts, the eject and its problems; any other Klipper
printer shows its print. A finished print on a printer without auto-eject counts as **Needs you**
until you press **Bed is clear**.

## Set it up (5 minutes)

1. **Pick one printer** for the page: any Klipper printer with Moonraker and Mainsail or Fluidd,
   preferably one that stays on. It does not need a blade.
2. **On that printer**, over SSH:
   ```bash
   cd ~ && git clone https://github.com/ahmedbebars/klipper-auto-eject.git
   ~/klipper-auto-eject/install.sh --farm
   ```
   This installs the web page and the `klipper-auto-eject` service, which runs the farm. It
   asks for your password once. If this printer has no blade, add `--no-include`: the farm
   does not need the auto-eject macros.
3. **Open** `http://<that printer>/auto-eject/`, tab **Printer farm**, and press **Search the
   network**. After about 10 seconds it lists the printers it found. Untick any you do not want and
   press **Add**.

<p align="center"><img src="images/farm-search.png" alt="Search the network: the printers found, ticked, ready to add" width="600"></p>

The list is kept on that printer. Press **Search the network** again whenever you add a printer.
The printers you left out are remembered: the next search lists them last, unticked, as "left
out last time", so you can still add one later.

### A printer that is not found

The search asks every address of the printer's own network (the 254 addresses around its own,
such as `192.168.1.1` to `192.168.1.254`) and every Linux device on your Tailscale network. On each
one it looks for Moonraker on port 7125 and port 80. A printer it finds both ways is listed once,
with its local address: it knows it is the same machine by its network card.

- **On another network or VLAN:** type its address under **Add by address**, such as
  `10.0.5.20`.
- **Several Klipper instances on one computer:** add each one by address with its Moonraker port,
  such as `192.168.1.50:7126`.
- **Found but Offline:** its Moonraker does not let the farm printer in. Most installs (KIAUH,
  MainsailOS) let in every address of the local network; if yours does not, add the farm printer's
  address to `trusted_clients` in that printer's `moonraker.conf`. A Moonraker that asks for a
  login or an API key cannot be read.

## The buttons

| Button | What it does | Asks first |
|---|---|---|
| **Bed is clear** | You took the print off. With auto-eject: forgets the stored parts (`AUTO_EJECT_CLEAR`). Without: forgets the finished job (`SDCARD_RESET_FILE`) so the printer shows as free. Nothing moves. | No |
| **Print** | A free printer: pick one of its G-code files (each with its picture, print time and filament), or send it one from your phone or computer (**Send it**, or **Send it and print**). Refused while it prints or while auto-eject knows parts are on its bed | Yes |
| **Pause**, **Resume**, **Cancel the print** | The print running on that printer | Cancel asks |
| **Start the queue** | Starts that printer's Moonraker job queue: the next job prints | Yes |
| **Emergency stop** | Stops that printer at once. It then needs a firmware restart | Yes |
| **Open** | That printer's own page: its auto-eject page if it has one, otherwise Mainsail or Fluidd. Away from its network it opens through Tailscale if that printer has Tailscale; otherwise it shows **Open (on its network)** and does nothing | |
| **I emptied the box** | The printer's parts box is full: you emptied it, it counts from zero again (`AUTO_EJECT_BIN_EMPTY`) | No |
| **Turn on** / **Turn off** | For printers with a power switch in Moonraker (`[power]` in `moonraker.conf`, a smart plug, a relay). Off never happens while it prints or while the nozzle is above 50 °C, because the hotend fan stops with it | Off asks |
| ✎ | Rename the printer here, or remove it from the farm. Nothing changes on the printer itself. With a power switch: **Turn off by itself when it has nothing to do** | |

### Switching printers off by themselves

For a printer with a power switch, ✎ offers **Turn off by itself when it has nothing to do**:
never, or after 15 minutes to 4 hours. Nothing to do means not printing, nothing in its queue and
the nozzle below 50 °C. The farm then switches it off and sends a notification. Use it only for
a switch that powers the printer, not the computer that runs Moonraker, or nothing can switch it
on again. A printer switched off shows **Switched off**, with **Turn on**.

A printer with auto-eject also shows its parts box (**Box: 32 / 40**) once
[`bin_capacity`](configuration.md#the-parts-box) is set; a full box makes it **Needs you**.

### Maintenance reminders and the daily report

- **Maintenance reminder:** in a printer's ✎, choose **Every 100 to 1000 hours of printing**. The
  card shows **Maintenance: 450 / 1000 h** (red once due) and the phones get one notification when
  it comes due. After the maintenance, press **Maintenance done** in ✎: it counts from zero again.
  The hours come from that printer's print history in Moonraker.
- **Daily report:** at the foot of the farm, **Daily report to the phones**: every day at the time
  you choose, a notification sums up the farm: *Today 23 ended well, 2 stopped. Now 2 printing, 4
  need you (…). 5226 h printed in all. Maintenance due: voron-01.* Tapping it opens the farm. It
  goes to the phones that turned notifications on in the app ([notifications.md](notifications.md)).

Both are off until you choose them.

## From your phone, anywhere

Set up [remote access](remote-access.md) on the farm printer only:

```bash
~/klipper-auto-eject/install.sh --remote
```

The farm printer reads the others for you, so from your phone you see every printer, its camera
included, through that one printer. **Print**, **Pause**, **Cancel the print** and the other
buttons go through it too, and so do the files you send, so they work from anywhere. The other
printers need no Tailscale. Only **Open** goes
straight to the other printer: on the same network it opens its local address; away from it,
through Tailscale, it opens the printer's Tailscale address when that printer has Tailscale too
(the farm finds it by its network card).

## Notifications from every printer

A phone that turned notifications on in the app ([notifications.md](notifications.md)) gets them
from every printer of the farm too:

| Every printer | Printers with auto-eject, also |
|---|---|
| A print finished (if that phone wants every finished print) | A part is still on the bed after the eject |
| A print stopped with an error, or was cancelled | Parts too thin to push were left on the bed |
| Klipper stopped | A print ended without an eject; the guard did not start a print |

The title starts with the printer's name, and tapping it opens the farm. A printer whose own
klipper-auto-eject service has notifications on sends its own as well, so a phone that turned
them on in both places gets those twice.

## Who can use it

The farm answers only devices on a private network: your local network and Tailscale, like
Moonraker by default. Anyone who can open the page can press its buttons, as in Mainsail.

## How it works

The farm is part of the `klipper-auto-eject` service (`push/farm.py`). Every 3 seconds it asks each
printer's Moonraker for its state, the way Mainsail does. That is a few small requests, which
the printers do not notice. The list of printers is kept in the farm printer's Moonraker
database (namespace `auto_eject_farm`). The service answers the page on `127.0.0.1:7128`, and
nginx publishes that at `/auto-eject/api/`:

| Request | Answer |
|---|---|
| `GET /auto-eject/api/farm` | Every printer's card, and the last search |
| `POST /auto-eject/api/farm/scan` | Starts a search of the network |
| `POST /auto-eject/api/farm/printers` | `{"add": [{"host": …, "port": …}]}`, `{"remove": id}`, `{"rename": id, "name": …}` |
| `POST /auto-eject/api/farm/<id>/clear`, `…/continue`, `…/estop`, `…/bin_empty` | The buttons |
| `POST /auto-eject/api/farm/<id>/power` | `{"device": …, "action": "on"}` or `"off"` |
| `POST /auto-eject/api/farm/<id>/pause`, `…/resume`, `…/cancel` | The print on that printer |
| `GET /auto-eject/api/farm/<id>/files` | Its G-code files, newest first |
| `POST /auto-eject/api/farm/<id>/print` | `{"filename": …}`: starts it, only on a free printer |
| `POST /auto-eject/api/farm/<id>/upload?name=…&print=1` | The file as the request body; the farm printer passes it on to that printer's Moonraker |
| `POST /auto-eject/api/farm/printers` | also `{"id": …, "auto_off": minutes, "device": …}` |
| `GET /auto-eject/api/farm/<id>/snapshot` | That printer's camera picture |

Its log: `journalctl -u klipper-auto-eject`. Try it without printers in the
[demo](web-page.md#trying-it-on-a-computer): `?demo#/farm`.

**Not included:** printers without Klipper and Moonraker (Bambu Lab, Prusa Connect, OctoPrint).

## Removing it

`install.sh --uninstall` on the farm printer removes the service and the page. The other
printers were never changed.
