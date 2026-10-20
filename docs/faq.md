[klipper-auto-eject](../README.md) › [Documentation](README.md) › FAQ

# Frequently asked questions

**Contents:** [Before you start](#before-you-start) · [Using it](#using-it) ·
[When something goes wrong](#when-something-goes-wrong) · [Updates and removal](#updates-and-removal)

## Before you start

**Will it work on my printer?**
On almost any Klipper printer with a rectangular bed: CoreXY (Voron, RatRig, Sovol SV08…),
Cartesian and bed slingers (Ender 3 on Klipper…). Not on delta printers, and not on Marlin,
Bambu Lab or stock Prusa firmware. See [Compatibility](../README.md#compatibility).

**Do I need a probe?**
No, but it is strongly recommended. Without one the printer pushes the parts but cannot check
that the bed is empty, so a stuck part could be printed over. Contact probes (Voron Tap, BLTouch,
Klicky) can check; eddy-current probes need their touch mode ([probes.md](probes.md)).

**Which bed sheet do I need?**
One that lets go of parts when it is cool: textured PEI, smooth PEI with a release agent, or
CryoGrip-type sheets. Test it first: a cooled part should slide off with a finger push.

**Which parts work well?**
Parts at least 2 mm tall with a flat bottom: boxes, brackets, cookie cutters, figures on a base.
Very flat parts (stencils, signs) are left on the bed on purpose. Tall, narrow parts can tip over:
push lower and slower ([troubleshooting](troubleshooting.md#behaviour)).

**Can I use PLA for the blade?**
For a first try, yes. PETG, ABS or ASA last longer, because PLA softens near a warm bed.

**Will the blade scratch my bed?**
No. The blade's lower edge sits about 1.5 mm above the nozzle tip, and the nozzle stays above the
bed while pushing (`push_z`). Nothing touches the sheet except the parts.

**Do I have to edit config files?**
Only to add three short sections to `printer.cfg` once ([getting started, step 4](getting-started.md#4-install-the-macros)).
Everything else is set with the guided setup or the [web page](web-page.md).

## Using it

**How long does one eject take?**
Mostly cooling: 10–30 minutes, depending on the room and the bed. Pushing and checking take a
minute or two. A warmer `cool_temp` is faster, but parts must still let go at that temperature.

**My room is warm and the bed never gets down to `cool_temp`.**
After `cool_timeout` (30 minutes) the parts are pushed anyway, with a warning. To wait less, set
`cool_temp` a few degrees higher (for example 35 °C) if your parts still let go there.

**What happens to flat prints like stencils?**
Prints lower than 2 mm (`min_part_height`) are left on the bed, the queue pauses, and a dialog
asks you to take them off. Click **Bed is clear - continue the queue** when you have.

**Can I print some files without ejecting?**
Yes: keep a second printer profile in the slicer without the `AUTO_EJECT` line in the end G-code.

**What if the power goes out or the printer restarts?**
The outlines of the parts on the bed are saved while printing. After the restart, run
`AUTO_EJECT HOME=1`: it homes on an empty spot, never on a part, then clears the bed. With
`AUTO_EJECT_GUARD` in the start G-code, a new print never starts on top of old parts
([recovery.md](recovery.md)).

**Do I have to tell the printer the bed is clear before every print?**
No. After a normal eject the probe checks the bed, and once it is clear the printer forgets the
parts by itself. When **you** take the parts off (after cancelling a print, after a print without
`AUTO_EJECT`, or after a thin print it left for you), you don't have to tell it either: with
`AUTO_EJECT_GUARD` in the start G-code, the next print first probes where the parts were and
starts if the bed is clear ([recovery.md](recovery.md#the-guard-auto_eject_guard)). A dialog also
offers **Bed is clear** right after such a print, or click **I took the parts off** on the web
page (`AUTO_EJECT_CLEAR`). Without a probe that can touch plastic, the guard stops the print
until you do.

**Can I watch it from my phone when I'm not home?**
Yes. `install.sh --remote` sets up Tailscale, a free private network between your devices, so
Mainsail and the auto-eject page open from your phone anywhere, without opening the printer to
the internet ([remote-access.md](remote-access.md)).

**Can it tell me when something goes wrong?**
Yes. `install.sh --notify` sends a notification to your phone, through the free ntfy app, when a
part is still on the bed, a print was too thin to push, or the next print did not start; and, if
you like, when every print is done ([notifications.md](notifications.md)).

**How do I stop it?**
The **emergency stop** button in Mainsail or Fluidd stops everything at once. Afterwards, clear
the bed by hand and run `AUTO_EJECT_CLEAR`.

**Does it work with Fluidd?**
Yes, the setup dialogs work in both. The web page works too; Fluidd just has no sidebar link
for it, so bookmark `http://<printer>/auto-eject/`.

**Does it work with my print start/end macros (DEMON, Klippain, RatOS…)?**
Yes. Put `AUTO_EJECT HEIGHT=[max_layer_z] HOME=1` in the slicer's end G-code **after** your end
macro, which retracts the filament while the nozzle is still hot. Details in
[integration.md](integration.md).

## When something goes wrong

**A part was not pushed off.**
The probe finds it, the blade pushes it again, lower and harder. If it still does not move, the
print ends with an error and the queue stops. Take it off, run `AUTO_EJECT_CLEAR`, and start the
queue again.

**The parts end up on the edge of the bed instead of falling off.**
The blade does not reach past the edge of the sheet. Check it with step 4 of the guided setup
([troubleshooting](troubleshooting.md#behaviour)).

**I got an error message.**
Most errors say what to do. The full list is in [troubleshooting.md](troubleshooting.md).

**Where can I ask for help?**
Open an [issue](https://github.com/ahmedbebars/klipper-auto-eject/issues) with your
`auto_eject_settings.cfg`, the console output and a photo of the blade, or ask in the
[discussions](https://github.com/ahmedbebars/klipper-auto-eject/discussions).

## Updates and removal

**How do I update?**
Click *Update* next to `klipper-auto-eject` in the Mainsail/Fluidd update panel, then
`FIRMWARE_RESTART` (not while printing). Your settings are never overwritten.

**What does the installer change on my printer?**
It adds two `[include]` lines to `printer.cfg` and one section to `moonraker.conf`, after making
a backup of each. With `--web` it also adds a small web server file and a sidebar link
([web-page.md](web-page.md)).

**How do I remove it?**
`~/klipper-auto-eject/install.sh --uninstall` takes everything back out
([installation.md](installation.md#uninstalling)).
