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
The probe found something at a part position after the sweep.

- The part really is still there: it did not release (bed not cool enough, see `cool_temp`), the
  blade passed over it (`push_z` too high), or the motor skipped (`push_current` too low).
- False alarm: `verify_threshold` is too low for your probe's noise, or the probe triggered on
  the edge of a dent or a leftover purge line.

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

Open an issue with:

- your `auto_eject_settings.cfg`
- the console output of `AUTO_EJECT DRY=1`
- `klippy.log` from the failed run
- a photo of the blade
