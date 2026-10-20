[klipper-auto-eject](../README.md) › [Documentation](README.md) › Printer farm

# Printer farm

Every Klipper printer on your network on one page, with the ones that need you first: a print
to take off, a part that stayed on the bed, an error, a paused queue. You install it on **one
printer only**. It searches the network, finds the other printers and adds them; **the other
printers need nothing installed**.

| A card shows | |
|---|---|
| **Needs you** | A finished print to take off, a part that stayed on the bed, parts too thin to push, an error, a cancelled print, or a job queue that waits for you. It says which. |
| **Printing** | The file, how far it is, the time left and the layer |
| **Clearing the bed** | auto-eject is cooling the bed and pushing the parts off |
| **Paused**, **Stopped** | A paused print; Klipper stopped, with its message |
| **Free** | Ready for the next print, and how many jobs wait in its queue |
| **Offline** | Not answering |

<p align="center"><img src="images/farm.png" alt="The printer farm: printers that need you first, then the ones printing, free and offline" width="900"></p>

Each card also shows the bed temperature and, if the printer has a camera in Moonraker, its
picture. At the top: how many need you, print, are free or offline. The **Printer farm** tab in
the menu shows the number that need you too.

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
| **Start the queue** | Starts that printer's Moonraker job queue: the next job prints | Yes |
| **Emergency stop** | Stops that printer at once. It then needs a firmware restart | Yes |
| **Open** | That printer's own page: its auto-eject page if it has one, otherwise Mainsail or Fluidd | |
| ✎ | Rename the printer here, or remove it from the farm. Nothing changes on the printer itself | |

## From your phone, anywhere

Set up [remote access](remote-access.md) on the farm printer only:

```bash
~/klipper-auto-eject/install.sh --remote
```

The farm printer reads the others for you, so from your phone you see every printer, its camera
included, through that one printer. The other printers need no Tailscale. Only **Open** goes
straight to the other printer, so it works when you are on the same network, or when that
printer has Tailscale too.

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
| `POST /auto-eject/api/farm/<id>/clear`, `…/continue`, `…/estop` | The buttons |
| `GET /auto-eject/api/farm/<id>/snapshot` | That printer's camera picture |

Its log: `journalctl -u klipper-auto-eject`. Try it without printers in the
[demo](web-page.md#trying-it-on-a-computer): `?demo#/farm`.

**Not included:** printers without Klipper and Moonraker (Bambu Lab, Prusa Connect, OctoPrint).

## Removing it

`install.sh --uninstall` on the farm printer removes the service and the page. The other
printers were never changed.
