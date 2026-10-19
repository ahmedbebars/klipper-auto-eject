# Slicer setup

Every slicer needs three things for auto-eject:

| | What | Why |
|:-:|---|---|
| 1 | **Object labels** in the G-code | `AUTO_EJECT` plans the sweep from the part outlines |
| 2 | **Start G-code** with `AUTO_EJECT_GUARD` and `EJECT_PURGE` | Never print on old parts. A purge pellet the sweep can remove |
| 3 | **End G-code** with `AUTO_EJECT` | Runs while the printer is still homed, before your end macro |

The examples call your start macro `PRINT_START` and your end macro `PRINT_END`. Use the names
your configuration uses (`START_PRINT`, `DEMON_START`, …).

> **Guard.** `AUTO_EJECT_GUARD` goes first. It stops the print, or ejects first, if parts from an
> interrupted print may still be on the bed ([recovery.md](recovery.md)).
>
> **Purge.** `EJECT_PURGE` runs *after* `PRINT_START`, so turn off the purge line inside your start
> macro (KAMP `LINE_PURGE`, DEMON purge line, Voron purge). Otherwise you get both.

## Temperature placeholders at a glance

| Slicer | Bed (first layer) | Nozzle (first layer) |
|---|---|---|
| OrcaSlicer | `[bed_temperature_initial_layer_single]` | `[nozzle_temperature_initial_layer]` |
| PrusaSlicer / SuperSlicer | `[first_layer_bed_temperature]` | `[first_layer_temperature]` |
| Cura | `{material_bed_temperature_layer_0}` | `{material_print_temperature_layer_0}` |

---

## OrcaSlicer

**Object labels:** *Process → Others → G-code output*: turn on **Label objects** and **Exclude objects**.

**Printer settings → Machine G-code → Machine start G-code**

```gcode
AUTO_EJECT_GUARD
M104 S0
M140 S0
PRINT_START BED=[bed_temperature_initial_layer_single] EXTRUDER=[nozzle_temperature_initial_layer]
EJECT_PURGE
```

**Machine end G-code**

```gcode
AUTO_EJECT
PRINT_END
```

`M104 S0` / `M140 S0` before the macro stop Orca from adding its own heat-and-wait commands.

---

## PrusaSlicer / SuperSlicer

**Object labels:** *Print Settings → Output options → Label objects*: **Firmware-specific** (with
G-code flavor *Klipper*). Older SuperSlicer builds only write comments. If so, use
[Moonraker object processing](#cura-and-slicers-without-native-labels).

**Printer Settings → Custom G-code → Start G-code**

```gcode
AUTO_EJECT_GUARD
M104 S0
M140 S0
PRINT_START BED=[first_layer_bed_temperature] EXTRUDER=[first_layer_temperature]
EJECT_PURGE
```

**End G-code**

```gcode
AUTO_EJECT
PRINT_END
```

---

## Cura

**Machine Settings → Printer → Start G-code**

```gcode
AUTO_EJECT_GUARD
PRINT_START BED={material_bed_temperature_layer_0} EXTRUDER={material_print_temperature_layer_0}
EJECT_PURGE
```

Using these variables stops Cura from inserting its own heating commands.

**End G-code**

```gcode
AUTO_EJECT
PRINT_END
```

**Object labels:** see the next section.

---

## Cura and slicers without native labels

Moonraker can add the labels for you. In `moonraker.conf`:

```ini
[file_manager]
enable_object_processing: True
```

Restart Moonraker. Uploaded files that contain object tags are then rewritten with Klipper's
`EXCLUDE_OBJECT` commands. It works with any slicer that marks objects in comments.

---

## Other slicer settings

- **Skirt:** turn it off, or keep it inside the area of the parts. A skirt is too thin for the blade to catch.
- **Brim:** fine. It comes away with the part.
- **Without labels at all:** use `STRATEGY=full_width`, or set `no_objects_action: "full_width"`.

## Prints you will remove by hand

Keep a second printer profile, or swap the end G-code, without `AUTO_EJECT`:

```gcode
PRINT_END
```

The same file then works on a printer without the blade fitted.

## DEMON Klipper Essentials

`DEMON_END` parks and turns the motors off, so pass a parameter instead and let the
`_CUSTOM_PRE_END` hook call `AUTO_EJECT` ([integration.md](integration.md#demon-klipper-essentials)):

```gcode
DEMON_END EJECT=1
```

## Check the G-code

After slicing, open the G-code and search for:

| Look for | Means |
|---|---|
| `EXCLUDE_OBJECT_DEFINE` | Object labels are in the file |
| `EJECT_PURGE` | The pellet purge is in the start G-code |
| `AUTO_EJECT` near the end | The eject runs after the print |

If the labels are missing and Moonraker object processing is on, check the file in Mainsail or
Fluidd: the *Exclude objects* button appears during the print once it has been processed.

## Back-to-back printing

Queue jobs from Mainsail or Fluidd and turn on Moonraker's automatic transition. Moonraker
describes this option as meant for machines that clear the build area themselves:

```ini
[job_queue]
load_on_startup: False
automatic_transition: True
job_transition_delay: 5
```

Don't put `AUTO_EJECT` in `job_transition_gcode`: by then the end macro has usually turned the
motors off, and `AUTO_EJECT` refuses to run on an unhomed printer.
