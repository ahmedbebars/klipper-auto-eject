[klipper-auto-eject](../README.md) › [Documentation](README.md) › Glossary

# Glossary

The words used in this documentation, in plain language.

## The printer and its software

| Word | Meaning |
|---|---|
| **Klipper** | The firmware that runs the printer. Its settings are in `printer.cfg`. |
| **Moonraker** | The program that connects Klipper to the web interface. It also keeps the **job queue** and installs **updates**. Its settings are in `moonraker.conf`. |
| **Mainsail / Fluidd** | The web page you open in the browser to control the printer. Either one works. |
| **Console** | The box in Mainsail or Fluidd where you type commands such as `AUTO_EJECT` and read the printer's answers. |
| **`printer.cfg`** | Klipper's main settings file. You open it on the *Machine* page (Mainsail) or *Configuration* page (Fluidd). |
| **`[include]`** | A line in `printer.cfg` that loads another settings file. The installer adds two: `auto_eject.cfg` (the macros) and `auto_eject_settings.cfg` (your settings). |
| **Section** | A heading in a settings file in square brackets, such as `[respond]`. Adding the line turns that feature on. |
| **`FIRMWARE_RESTART`** | Restarts Klipper so it reads its settings again. Needed after editing a `.cfg` file. Never do it while printing. |
| **Macro** | A named list of commands stored in Klipper. `AUTO_EJECT` is a macro. |
| **SSH** | A text connection from your computer to the printer's computer, used once to install. |
| **Update manager** | The *Update* panel in Mainsail/Fluidd. The installer adds klipper-auto-eject to it. |

## Printing words

| Word | Meaning |
|---|---|
| **G-code** | The file the slicer makes. It is a list of commands the printer follows. |
| **Slicer** | The program that turns a 3D model into G-code: OrcaSlicer, PrusaSlicer, Cura… |
| **Start / end G-code** | Commands the slicer adds at the start and end of every print. `AUTO_EJECT` goes in the end G-code. |
| **Object labels** (Label objects, Exclude objects) | A slicer option that writes the outline of every part into the G-code. Klipper uses it to cancel single parts; auto-eject uses it to know where to push. Klipper needs `[exclude_object]` in `printer.cfg` for it. |
| **Homing** | The printer finding the zero position of each axis (`G28`). After a restart it does not know where the toolhead is until it homes. |
| **Probe** | A sensor that finds the bed's height. **Contact probes** (Voron Tap, BLTouch, Klicky) touch the bed. **Eddy-current probes** (BTT Eddy, Beacon, Cartographer) sense the metal bed without touching and cannot see plastic. |
| **Nozzle probe** | A contact probe that touches with the nozzle itself, such as Voron Tap. With one, the printer measures the blade by itself. |
| **Offset probe** | A probe beside the nozzle, such as a BLTouch. Its distance from the nozzle is its *offset*. |
| **CoreXY / bed slinger** | A CoreXY printer (Voron, Sovol SV08…) keeps the bed still and moves the toolhead. A bed slinger (Ender 3, Prusa MK3…) moves the bed back and forth. |
| **Job queue** | A list of prints Moonraker starts one after another. |

## Auto-eject words

| Word | Meaning |
|---|---|
| **Blade** (plow) | The printed part on the toolhead that pushes the parts. The nozzle never touches them. |
| **Drop edge** | The edge of the bed the parts are pushed over (front, back, left or right). Put a box under it. Setting: `direction`. |
| **Blade offset** | How far the blade's face is ahead of the nozzle, in mm. Setting: `blade_offset`. |
| **Blade lift** | How far the blade's lower edge is above the nozzle tip, in mm (about 1.5). Setting: `blade_lift`. |
| **Push height** | The nozzle's height above the bed while pushing. Setting: `push_z`. |
| **Push lane** | One stroke of the blade from behind the parts to the drop edge. A bed full of parts takes several lanes, side by side. |
| **Strategy** | How the lanes are planned: `columns` (side-by-side lanes, works with any layout), `objects` (one part at a time) or `full_width` (the whole bed). |
| **Push current** | Less motor power while pushing (`push_current`), so a stuck part makes the motor skip instead of breaking something. |
| **Cool temperature** | The bed temperature at which parts let go, and pushing starts. Setting: `cool_temp`. |
| **Dry run** | `AUTO_EJECT DRY=1`: the toolhead traces every lane at a safe height without pushing. For checking the path. |
| **Verification** | After pushing, the probe touches the bed where each part was, to make sure it is gone. |
| **Leftover** | A part the probe still finds after pushing. It is pushed again, lower and harder; if it still does not move, the queue stops. |
| **Thin parts** | Prints lower than `min_part_height` (2 mm), such as stencils. The blade cannot catch them, so they are left on the bed for you. |
| **Guard** | `AUTO_EJECT_GUARD` at the start of a print: it stops the print if parts from an earlier print may still be on the bed. |
| **Smart homing** | `AUTO_EJECT HOME=1`: homes after a restart by finding Z on an empty spot, never on a part. |
| **Calibration block** | A small printed block (20 × 20 × 3.5 mm) the setup touches to measure the blade, with a nozzle probe. |
| **Blade gauge** | A printed 1.5 mm strip for setting the blade's height when mounting it. |
| **Guided setup** | `AUTO_EJECT_SETUP`: five dialogs that set everything up. |
| **`EJECT_PURGE`** | A tall blob of plastic at the start of a print instead of a thin purge line, so the blade can push it off with the parts. |
