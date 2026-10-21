---
template: home.html
title: Your printer clears its own bed
description: Klipper macros and a printed blade that push finished parts off the bed, check it with the probe and start the next print.
hide:
  - navigation
  - toc
---

## One print after another, without you { .ae-section }

When a print ends, `AUTO_EJECT` runs from the slicer's end G-code. It knows where every part is,
because the slicer wrote the outlines into the file.

<div class="grid cards ae-steps" markdown>

-   :material-thermometer-low:{ .lg } __1 · Cool down__

    Heaters off, part fan on, and the toolhead circles over the parts until they let go of the sheet.

-   :material-arrow-collapse-down:{ .lg } __2 · Push them off__

    The blade comes down behind the parts and pushes them over the edge, slowly and with less motor force.

-   :material-radar:{ .lg } __3 · Check the bed__

    X and Y are homed again and the probe touches the bed where each part was. Still there? Pushed again, lower and harder.

-   :material-play-circle-outline:{ .lg } __4 · Next print__

    The bed is clear, so Moonraker starts the next job. If a part would not move, the queue stops instead.

</div>

![One AUTO_EJECT run: cool down, plan, push, re-home, probe, retry or stop](images/how-it-works.svg){ .ae-figure }

## What it does { .ae-section }

<div class="grid cards" markdown>

-   :material-shield-check-outline:{ .lg } __Safe by design__

    ---

    The motors run at lower current while pushing, so a stuck part makes them skip instead of
    breaking something. Nothing is printed on top of a part that stayed behind.

-   :material-gesture-tap-button:{ .lg } __Set up with buttons__

    ---

    Five short dialogs in Mainsail or Fluidd. With Voron Tap the printer measures the blade
    by itself, to a fraction of a millimetre.

-   :material-monitor-dashboard:{ .lg } __Its own page__

    ---

    A live map of the bed, the print queue, a check for your G-code files and every setting,
    in English or Arabic. [See it](web-page.md)

-   :material-power-plug-off-outline:{ .lg } __Survives power cuts__

    ---

    The parts on the bed are remembered. After a restart the printer homes beside them, never
    on them. [How](recovery.md)

-   :material-layers-off-outline:{ .lg } __Leaves stencils alone__

    ---

    Prints too flat for the blade stay on the bed, and the queue waits until you take them off.

-   :material-tune-variant:{ .lg } __Fits your printer__

    ---

    Any drop edge, three ways to plan the pushes, contact, offset and eddy probes, and stock,
    DEMON or Klippain macros.

</div>

## Built to be checked { .ae-section }

<div class="ae-stats" markdown>

<div markdown>
<span class="ae-stat">360+</span>
automated tests of the macros, the page and the services, against the Jinja versions Klipper ships
</div>

<div markdown>
<span class="ae-stat">5</span>
dialogs in the guided setup, no config file to edit and no ruler
</div>

<div markdown>
<span class="ae-stat">2–3 min</span>
to measure the blade with Voron Tap, by touching a small printed block
</div>

<div markdown>
<span class="ae-stat">0</span>
internet connections needed: everything runs on the printer
</div>

</div>

## See it before you install it { .ae-section }

<div class="ae-split" markdown>

<div markdown>
![The Auto-eject page while the printer clears the bed](images/web-page.png){ .ae-shot }
</div>

<div markdown>
The web page runs right here in your browser, against a pretend printer: it prints, cools, clears
the bed and starts the next job by itself. Press **Eject now**, open the queue, check a file, or
change a setting.

[Open the live demo](demo.md){ .md-button .md-button--primary }
[About the page](web-page.md){ .md-button }
</div>

</div>

<div class="ae-split" markdown>

<div markdown>
![The auto-eject app on a phone: clearing the bed, the printer farm in Arabic, the blade](images/phone-app.png){ .ae-shot }
</div>

<div markdown>
**On your phone, as an app.** Open it from anywhere through Tailscale, install it with its own
icon, and get a notification when the printer needs you, even while the app is closed. In
English and Arabic, light and dark.

[Remote access](remote-access.md){ .md-button }
[Notifications](notifications.md){ .md-button }
</div>

</div>

<div class="ae-split" markdown>

<div markdown>
![The printer farm: the printers that need you first](images/farm.png){ .ae-shot }
</div>

<div markdown>
**A printer farm.** Every Klipper printer of your network on one page, the ones that need you
first. **Search the network** finds and adds them; the other printers need nothing installed.

[The printer farm](farm.md){ .md-button }
</div>

</div>

## The blade { .ae-section }

<div class="ae-photos" markdown>
![Blade on a Voron Stealthburner, front](assets/hardware/voron-stealthburner-front.jpg)
![Mount, arm and blade up close](assets/hardware/voron-stealthburner-closeup.jpg)
![Side view: the blade reaches ahead of the toolhead](assets/hardware/voron-stealthburner-side.jpg)
</div>

Three printed parts held with M3 screws. Every joint has slots, so one design fits most toolheads,
and blades come 60, 80 and 100 mm wide. [Print and mount it](hardware.md)

## Works with { .ae-section }

<div class="grid cards ae-compat" markdown>

-   :material-check-circle:{ .ae-ok } __CoreXY__

    Voron, RatRig, VzBot, Sovol SV08… The bed stays still: ideal.

-   :material-check-circle:{ .ae-ok } __Cartesian and bed slingers__

    On Klipper. Bed slingers push left or right.

-   :material-alert-circle:{ .ae-warn } __Vendor Klipper__

    Creality K1, Qidi, Sovol: if you can edit the config.

-   :material-close-circle:{ .ae-no } __Not supported__

    Delta printers, Marlin, Bambu Lab and stock Prusa firmware.

</div>

<p class="ae-logos">
  <a href="https://www.klipper3d.org/" title="Klipper"><img src="images/logos/klipper.png" alt="Klipper"></a>
  <a href="https://docs.mainsail.xyz/" title="Mainsail"><img src="images/logos/mainsail.svg" alt="Mainsail"></a>
  <a href="https://docs.fluidd.xyz/" title="Fluidd"><img src="images/logos/fluidd.svg" alt="Fluidd"></a>
  <a href="https://github.com/SoftFever/OrcaSlicer" title="OrcaSlicer"><img src="images/logos/orcaslicer.svg" alt="OrcaSlicer"></a>
  <a href="https://github.com/prusa3d/PrusaSlicer" title="PrusaSlicer"><img src="images/logos/prusaslicer.svg" alt="PrusaSlicer"></a>
</p>

Klipper and Moonraker, Mainsail or Fluidd, and OrcaSlicer, PrusaSlicer, SuperSlicer or Cura.
Phone access through Tailscale.

## Get started { .ae-section }

![Eight steps: check your bed, print the blade, mount it, install, guided setup, watch a test, slicer, print in a row](images/getting-started.svg){ .ae-figure }

About one afternoon, most of it printing the blade. Every step says how to check that it worked.
Installing is one line on the printer; it asks a few questions and does the rest:

```bash
cd ~ && git clone https://github.com/ahmedbebars/klipper-auto-eject.git && ./klipper-auto-eject/install.sh
```

[Start step by step](getting-started.md){ .md-button .md-button--primary }
[Questions and answers](faq.md){ .md-button }
[Removing it](uninstall.md){ .md-button }
[بالعربية](ar/index.md){ .md-button }

## Open source { .ae-section }

klipper-auto-eject is free software under the GPLv3, the same license as Klipper. Reports from
other printers, blade designs and translations are very welcome.

[Source on GitHub](https://github.com/ahmedbebars/klipper-auto-eject){ .md-button }
[Discussions](https://github.com/ahmedbebars/klipper-auto-eject/discussions){ .md-button }
[Report a problem](https://github.com/ahmedbebars/klipper-auto-eject/issues){ .md-button }
