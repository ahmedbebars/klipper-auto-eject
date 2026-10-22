[klipper-auto-eject](../README.md) › [Documentation](README.md) › Troubleshooting

# Troubleshooting

## Errors

### `AUTO_EJECT: printer is not homed`
Something turned the steppers off (`M84`) or an idle timeout disabled them before
`AUTO_EJECT` ran. Run `AUTO_EJECT HOME=1` to home around the parts ([recovery.md](recovery.md)),
and call `AUTO_EJECT` earlier in your end sequence ([integration.md](integration.md)).

### `AUTO_EJECT_GUARD: ... may still be on the bed`
A previous print was never ejected (restart, power loss, cancelled eject). Run
`AUTO_EJECT HOME=1 SOURCE=saved`, or remove the parts by hand and run `AUTO_EJECT_CLEAR`.

### `AUTO_EJECT HOME=1: no free spot ...`
The stored parts cover the bed, leaving no spot `home_clearance` mm away from all of them. Remove
the parts by hand and run `AUTO_EJECT_CLEAR`.

### `no labelled objects found`
The G-code has no `EXCLUDE_OBJECT_DEFINE` lines. Turn on label/exclude objects in the slicer and
add `[exclude_object]` to `printer.cfg`. Or set `no_objects_action: "full_width"`.

### `'X' sits where the blade must come down behind 'Y'`
The `objects` strategy found a part in the blade's landing zone. Space the parts further apart,
reduce `head_depth`/`side_margin` if they are larger than your real toolhead, or use
`STRATEGY=columns`.

### `a part is too close to the far edge of the bed`
The blade cannot get behind a part near the far edge (the edge opposite the drop edge). Keep
parts at least `rear_clearance + blade_offset` mm away from that edge.

### `'X' is STILL ON THE BED`
The probe found something at a part position after the sweep and after every retry
(`retries`, see [configuration.md](configuration.md#after-the-sweep)).

- The part really is still there: it did not release (bed not cool enough, see `cool_temp`), the
  blade passed over it (`push_z` too high), or the motor skipped (`push_current` too low).
- False alarm: `verify_threshold` is too low for your probe's noise, or the probe triggered on
  the edge of a dent or a leftover purge line.
- With an offset probe, a part listed as `not checked` was skipped because the nozzle could have
  hit the part that was found. It may already be gone.

### `could not probe ... without the nozzle passing over a part`
With an offset probe, some part could not be checked without lowering the nozzle where a part
might still be. Check the bed by hand and run `AUTO_EJECT_CLEAR`. Spacing parts further apart, or
`verify_points: "center"`, usually avoids it. See [probes.md](probes.md).

### `WARNING - eddy-current probes cannot see plastic parts`
Your probe senses the metal bed through plastic. Set `verify_probe_gcode` to its contact/touch
command if it has one ([probes.md](probes.md)).

### `too thin to push`
The print is lower than `min_part_height`, so it was left on the bed and the job queue was paused.
Remove it and click **Bed is clear - continue the queue**, or run `AUTO_EJECT_CONTINUE`. If a tall
print is reported as thin, the height was not known correctly: pass it from the slicer with
`AUTO_EJECT HEIGHT=[max_layer_z]` ([slicer-setup.md](slicer-setup.md)).

### The blade measurement stops
The dialog names the reason. The usual ones:

- `no block found under the nozzle`: the nozzle came down on the bed. Print the calibration
  block, or put it right under the nozzle.
- `the bed is at .. C`: a warm printed block goes soft. Let the bed cool to 55 °C or less.
- `the blade lower edge is not above the nozzle tip`: the measurement needs the blade 1–2 mm above
  the tip. Loosen the arm screws, set the height with the blade gauge and measure again.
- `the blade never came down on the block`: the blade sits too high above the nozzle tip, or the
  fan duct reaches the block first. Set the blade 1.5 mm above the tip with the gauge, and use the
  3.5 mm calibration block.
- `something other than the blade touched the block`: usually the fan duct. Use the 3.5 mm block.
- `the block moved while it was measured`: it slid or gave way. Print it with 100 % infill on a
  50–55 °C bed and measure right after the print, while it is still stuck.
- `the blade is on the other side of the nozzle`: you chose the wrong drop edge in step 1. Start
  again and choose the edge the dialog names.
- `too close to the edge of the bed`: the search needs room behind the block. Put it nearer the
  middle.

### The setup stops after the first click
Update. Versions before 0.5.0 called the setup macro from inside itself, which Klipper refuses
(`Macro AUTO_EJECT_SETUP called recursively`).

### `EJECT_PURGE: [extruder] max_extrude_cross_section must be at least ...`
Raise `max_extrude_cross_section` in `[extruder]` to the value shown, or lower `purge_length` /
raise `purge_height`.

### `Unknown command: "AUTO_EJECT"`
`auto_eject.cfg` is not included. Check the `[include]` lines in `printer.cfg`.

### A setting is missing from my `auto_eject_settings.cfg`
That's fine: every setting has a default in `auto_eject.cfg`. Add a line to your file only to change it.

### `AUTO_EJECT_SETUP needs a [respond] section`
Add `[respond]` to `printer.cfg` and run `FIRMWARE_RESTART`. The setup dialogs are sent with
`RESPOND`.

### The web page does not open
- `404 Not Found` at `/auto-eject/`: the page is not set up in nginx. Run
  `~/klipper-auto-eject/install.sh --web` ([web-page.md](web-page.md)).
- *Moonraker did not let this browser in*: add your network to `trusted_clients` in
  `moonraker.conf`, as for Mainsail.
- *The auto-eject macros were not found*: the `[include]` lines are missing from `printer.cfg`.
- An old version keeps showing after an update: reload the page with Ctrl+F5.

### The setup dialog does not appear
Update Mainsail or Fluidd: older versions ignore Klipper's `action:prompt` messages. The console
still shows the setup's progress. Run `AUTO_EJECT_SETUP STEP=close` to clear a half-open
dialog.

## Behaviour

**Parts are pushed but stay on the edge of the bed.** The push ends too early. Check `push_end`,
and that the blade face passes the edge of the build surface at the axis limit. Lengthen the
blade's reach or set `push_end` to the axis limit.

**The blade rides over parts.** `push_z` is too high, or the parts are shorter than the blade's
lower edge. Lower `push_z`. Parts flatter than ~2 mm are hard to push reliably.

**The motor skips on every push.** `push_current` is too low or `push_speed` too high, or the bed
is still too warm for the parts to release.

**The parts tip over or break.** Push lower (`push_z`), slower (`push_speed`), or use a taller,
flatter blade face.

**Dry run looks right but the real run is offset.** Re-measure `blade_offset` with the hotend at
its normal position. `AUTO_EJECT` uses ordinary `G1` moves, so an active `SET_GCODE_OFFSET`
(for example baby-stepping from the print) shifts them too. A Z baby-step of +0.2 mm raises the
blade by 0.2 mm.

## Getting help

In the web page, **Report a problem** (on **Hardware** or **Activity**) gathers most of what an issue
needs: the versions, the printer, its state, the settings you changed and the console. Copy it into
the issue and add what happened. Otherwise, open an issue with:

- your `auto_eject_settings.cfg`
- the console output of `AUTO_EJECT DRY=1`
- `klippy.log` from the failed run
- a photo of the blade
