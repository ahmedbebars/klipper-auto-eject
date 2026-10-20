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
<span class="ae-stat">230+</span>
automated tests run against the Jinja versions Klipper ships, on every change
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

## Get started { .ae-section }

![Eight steps: check your bed, print the blade, mount it, install, guided setup, watch a test, slicer, print in a row](images/getting-started.svg){ .ae-figure }

About one afternoon, most of it printing the blade. Every step says how to check that it worked.

[Start step by step](getting-started.md){ .md-button .md-button--primary }
[Questions and answers](faq.md){ .md-button }

## Open source { .ae-section }

klipper-auto-eject is free software under the GPLv3, the same license as Klipper. Reports from
other printers, blade designs and translations are very welcome.

[Source on GitHub](https://github.com/ahmedbebars/klipper-auto-eject){ .md-button }
[Discussions](https://github.com/ahmedbebars/klipper-auto-eject/discussions){ .md-button }
[Report a problem](https://github.com/ahmedbebars/klipper-auto-eject/issues){ .md-button }
