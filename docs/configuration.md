# Configuration

Settings come in three layers, each overriding the one before:

| Layer | Where | Who changes it |
|---|---|---|
| Defaults | `_AUTO_EJECT_DEFAULTS` in `auto_eject.cfg` | Updated with each release |
| Your settings | `_AUTO_EJECT_SETTINGS` in `auto_eject_settings.cfg` | You |
| Saved by the guided setup | `[save_variables]` (`auto_eject_*`) | `AUTO_EJECT_SETUP` |

Your file only needs the values you want to change. Settings added in a new release work
straight away with their defaults, and updates never touch your file.

Text values must be in double quotes (`"columns"`). Numbers and `True`/`False` are written
without quotes. Run `FIRMWARE_RESTART` after editing.

> **The easiest way** is the guided setup, `AUTO_EJECT_SETUP` ([setup-wizard.md](setup-wizard.md)).
> `AUTO_EJECT_SETUP STEP=reset` forgets what it saved.

## Strategy and direction

| Setting | Default | Description |
|---|---|---|
| `strategy` | `"columns"` | How the path is calculated: `"columns"`, `"objects"` or `"full_width"`. See [strategies.md](strategies.md). Can be overridden per run with `AUTO_EJECT STRATEGY=...` |
| `direction` | `"front"` | Edge the parts fall off: `"front"` (Y-), `"back"` (Y+), `"left"` (X-), `"right"` (X+) |
| `no_objects_action` | `"skip"` | When the print has no labelled objects: `"skip"`, `"full_width"` or `"error"` |

## Blade geometry

Measure these after mounting the blade, with `AUTO_EJECT_SETUP` or by hand
([hardware.md](hardware.md#measuring)). With Voron Tap, `AUTO_EJECT_CALIBRATE` measures them for you
([setup-wizard.md](setup-wizard.md#automatic-blade-measurement)).

| Setting | Default | Description |
|---|---|---|
| `blade_offset` | `20.0` | Distance from the nozzle to the blade's pushing face, along the push direction, in mm. Positive means the blade is ahead of the nozzle |
| `blade_width` | `80.0` | Blade width across the push direction, in mm, centred on the nozzle |
| `blade_lift` | `"unknown"` | Height of the blade's lower edge above the nozzle tip, in mm. Set by `AUTO_EJECT_CALIBRATE`. Retries use it so a blade hanging below the nozzle never drags on the bed |
| `blade_clearance` | `1.0` | Where `AUTO_EJECT_CALIBRATE` puts the blade's lower edge while pushing, in mm above the bed. The nozzle never goes below `push_z_min` |
| `column_overlap` | `15.0` | Overlap between neighbouring lanes (`columns` / `full_width`) |
| `head_depth` | `40.0` | Toolhead depth behind the blade. `objects` uses it to check there is room to lower the blade |
| `side_margin` | `5.0` | Extra side margin for that check |

If the blade is not centred on the nozzle, centre it in the hardware, or use a width that
covers the offset side as well.

## Motion

| Setting | Default | Description |
|---|---|---|
| `push_z` | `1.5` | Nozzle Z while pushing. The blade's lower edge sits at `push_z + blade lift`. Start high (3–5 mm) and lower it after watching a run |
| `push_end` | `"auto"` | Where each push ends on the push axis. `"auto"` = the axis limit on the drop side. A number pushes only to that coordinate |
| `rear_clearance` | `10.0` | Gap behind a part before the blade comes down |
| `allow_clamped_start` | `False` | Allow a push to start at the axis limit when the blade cannot get fully behind a part. The blade may then land on the part |
| `push_speed` | `1500` | mm/min while pushing (25 mm/s) |
| `travel_speed` | `9000` | mm/min for travel moves |
| `z_speed` | `600` | mm/min for Z moves |
| `push_accel` | `1500` | Acceleration while ejecting. The previous value is restored afterwards |
| `z_hop` | `5.0` | Added to the current Z height for travel moves |
| `min_safe_z` | `20.0` | Travel moves never go below this Z. It must be taller than your tallest part |
| `dry_pause` | `500` | Pause in ms at each start point during `DRY=1` |

> **Safe Z.** Travel height is `max(current Z + z_hop, min_safe_z)`. At the end of a print the
> toolhead is above the tallest layer, so the current Z is usually enough. If your end G-code
> lowers Z before calling `AUTO_EJECT`, raise `min_safe_z`.

## Motor current

| Setting | Default | Description |
|---|---|---|
| `reduce_current` | `True` | Lower the current of the steppers below while pushing |
| `current_steppers` | `"stepper_x,stepper_y"` | Comma-separated stepper names. CoreXY needs both. A Cartesian printer pushing along Y needs `"stepper_y"` (add `stepper_y1` for dual Y) |
| `push_current` | `0.5` | Amps while pushing. The configured `run_current` is restored afterwards |

The TMC driver section (`tmc2209 stepper_x`, `tmc5160 stepper_y`, …) is found automatically.
Steppers without a TMC section are skipped.

Choose `push_current` so that a part that won't move makes the motor skip. Start around 50–60% of
`run_current`, and lower it if the blade can bend or tear anything.

## Cooling

| Setting | Default | Description |
|---|---|---|
| `cool_mode` | `"temperature"` | `"temperature"` waits for the bed to reach `cool_temp`, `"time"` waits `cool_time` seconds, `"none"` doesn't wait |
| `cool_temp` | `32` | Bed temperature in °C at which parts release. PEI and CryoGrip usually release PLA below 30–35 °C |
| `cool_timeout` | `1800` | The longest wait for `cool_temp`, in seconds. In a warm room the bed may never get there: after this the parts are pushed anyway, with a warning |
| `cool_time` | `600` | Seconds, for `"time"` mode (also for beds without a `heater_bed`) |
| `heaters_off` | `True` | Turn the hotend and bed heaters off before cooling |
| `cool_fan_speed` | `1.0` | Part fan speed while cooling, from 0.0 to 1.0. Turned off after the sweep |
| `cool_tour` | `True` | While waiting, circle over the parts so the fan blows on each one in turn |
| `cool_tour_gap` | `8.0` | Gap in mm between the nozzle and the tallest part while circling. With an unknown print height the toolhead stays at `min_safe_z` |
| `cool_tour_dwell` | `5.0` | Seconds over each part per pass |

The bed is a heavy plate and its sensor cools at its own pace, but the air on the parts cools them
and the sheet right under them, which is what makes them let go. Each pass checks the bed
temperature (or the time) again, so the toolhead stops circling as soon as cooling is done.

## After the sweep

| Setting | Default | Description |
|---|---|---|
| `rehome_xy` | `True` | Home X and Y again after pushing. A part that would not move makes the motor skip on purpose, and re-homing makes the position exact again before probing. If your homing macro un-homes Z, Z is found again around the parts |
| `retries` | `1` | How many times a part found still on the bed is pushed again (0–2). Each retry only sweeps the parts that were left |
| `retry_z_step` | `0.3` | Each retry pushes this many mm lower than the one before |
| `push_z_min` | `0.5` | A retry never pushes lower than this, and never higher than `push_z` |
| `retry_current_step` | `0.15` | Each retry adds this many amps to `push_current`, never more than the stepper's `run_current` |

With the defaults, a part left after the first sweep is pushed once more at `push_z − 0.3` and
`push_current + 0.15 A`, then checked again. If it is still there, the queue stops.

## Thin parts

Stencils, flat signs and other prints only a few layers tall are too thin for the blade to catch.
`AUTO_EJECT` leaves them alone: no cool-down wait, no movement, no probing. It forgets them,
pauses Moonraker's job queue so the next job does not print on top of them, and opens a dialog.
Take the part off and click **Bed is clear - continue the queue** (or run `AUTO_EJECT_CONTINUE`).

| Setting | Default | Description |
|---|---|---|
| `min_part_height` | `2.0` | Prints lower than this, in mm, count as thin. `0` turns this off |
| `thin_parts_action` | `"ignore"` | `"ignore"` leaves them on the bed, `"eject"` pushes them anyway (for a blade that rides on the bed) |
| `thin_pause_queue` | `True` | Pause Moonraker's job queue while thin parts are on the bed. Turn it off without Moonraker |

The print height comes from the slicer when the end G-code passes it
(`AUTO_EJECT HEIGHT=[max_layer_z]`, see [slicer-setup.md](slicer-setup.md)). Otherwise it is the
highest Z seen while printing. Slicers that report layers (`SET_PRINT_STATS_INFO`, as OrcaSlicer
does) keep homing and probing moves of the start G-code out of it. If the height is unknown, the
parts are ejected as usual.

Verification follows the height too: the probe treats anything higher than half the print height
(at least 0.2 mm, at most `verify_threshold`) as a part still on the bed.

## Verification

| Setting | Default | Description |
|---|---|---|
| `verify` | `True` | Probe where the parts were after the sweep. Requires `[probe]` or `[bltouch]` |
| `verify_points` | `"outline"` | `"outline"` probes three points just inside each part's outline, which works for hollow parts like cookie cutters and frames. `"center"` probes one point in the centre, for solid parts |
| `verify_inset` | `1.0` | How far inside the outline the `outline` points are, in mm |
| `verify_threshold` | `1.0` | A probe trigger more than this many mm above the empty-bed trigger height (`z_offset`) means a part is still there |
| `verify_z` | `10.0` | Z height for moves between probe points |

The probe's `x_offset`/`y_offset` are applied, so BLTouch-style probes probe at the right spot.
Points the toolhead cannot reach are skipped.

## Probe

| Setting | Default | Description |
|---|---|---|
| `probe_type` | `"auto"` | `"auto"` detects `[probe]`/`[bltouch]` as **contact**, and `probe_eddy_current`, `beacon`, `cartographer`, `scanner` and `probe_eddy_ng` as **eddy**. Set `"contact"` or `"eddy"` to override |
| `verify_probe_gcode` | `"PROBE"` | Command run at each verification point. Eddy probes need their contact/touch command here, otherwise verification is skipped with a warning |
| `home_z_gcode` | `"PROBE"` | Command `AUTO_EJECT HOME=1` uses to find Z at the chosen spot. With `"PROBE"`, Z is set from the probe result. Any other command must home Z by itself at the current XY |
| `nozzle_clearance` | `5.0` | Offset probes: while probing, the nozzle stays at least this far from where any part was |
| `verify_unsafe_action` | `"error"` | A part that cannot be probed without the nozzle passing over a part: `"error"` stops, `"skip"` warns |

See [probes.md](probes.md) for how offset and eddy-current probes are handled.

## Recovery

| Setting | Default | Description |
|---|---|---|
| `persist_state` | `True` | Save part outlines and print height in `[save_variables]` while printing |
| `guard_action` | `"error"` | What `AUTO_EJECT_GUARD` does when old parts may be on the bed: `"error"` or `"eject"` |
| `home_method` | `"auto"` | `AUTO_EJECT HOME=1`: `"auto"`, `"probe"` or `"g28"` |
| `home_clearance` | `20.0` | Minimum distance in mm between any part and the probe, the nozzle or the blade while Z is homed |
| `home_edge_margin` | `15.0` | Distance in mm kept from the bed edges when choosing that spot |

Details in [recovery.md](recovery.md).

## EJECT_PURGE

| Setting | Default | Description |
|---|---|---|
| `purge_length` | `30.0` | Filament to purge, in mm |
| `purge_height` | `6.0` | Pellet height in mm. The nozzle rises while extruding |
| `purge_start_z` | `0.4` | Z where the pellet starts |
| `purge_flow` | `8.0` | Volumetric flow in mm³/s. Sets how fast the nozzle rises |
| `purge_retract` | `0.8` | Retraction after the pellet |
| `purge_gap` | `15.0` | Distance between the pellet and the nearest part |
| `purge_edge_margin` | `50.0` | Minimum distance between the pellet and the drop edge. Keep the pellet on the build surface |
| `filament_diameter` | `1.75` | |

A pellet extrudes a lot of filament over a short move, so Klipper's
`max_extrude_cross_section` in `[extruder]` must be large enough. `EJECT_PURGE` tells you the
value it needs. 50 is a common setting on printers that already use adaptive purging.
