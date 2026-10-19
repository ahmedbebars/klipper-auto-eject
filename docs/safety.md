# Safety

klipper-auto-eject moves the printer on its own, without anyone watching, and can start the next
print. Read this page before relying on it.

## Built-in protections

| Risk | What the macros do |
|---|---|
| Homing with parts on the bed (wrong Z, then the blade hits the bed) | `AUTO_EJECT` refuses to run unhomed. `AUTO_EJECT HOME=1` homes X/Y normally and measures Z with the probe on the spot furthest from every stored part |
| Printing on top of parts left by an interrupted print | Part outlines are saved while printing. `AUTO_EJECT_GUARD` in the start G-code stops the print, or ejects first |
| A part that will not move | Motor current on the push steppers drops to `push_current`, so the motor skips instead of breaking the blade, the part or the belt |
| Fast, violent moves | Pushing runs at `push_speed` and `push_accel`. The previous acceleration and currents are restored afterwards |
| The blade landing on a part | Each push starts `rear_clearance` behind the parts. Starts that cannot get behind a part (too close to the far edge) are refused. `objects` checks the landing zone before anything moves |
| A part left on the bed, then printed over | The probe checks the old positions. Anything found raises an error, so the job queue does not continue |
| Pushing hot, soft parts | Heaters off, part fan on, wait for `cool_temp` |
| A misconfigured setting | Unknown strategy or direction names stop with an error before any movement |

## What you still need to do

- **Watch it.** Do several `DRY=1` runs and several real ejects while standing next to the
  printer before leaving it unattended.
- **Thermal runaway protection** must be active (`verify_heater` is on by default in Klipper).
  Do not run unattended print farms without it, or without a smoke detector near the printers.
- **Keep the drop zone clear,** and make sure the box cannot overflow back onto the bed.
- **Check the blade after crashes.** A bent blade changes its height and offset.
- **Re-measure after toolhead changes:** a new nozzle, hotend or probe changes the geometry.
- **Eddy-current probes cannot see plastic.** Without a contact/touch command in
  `verify_probe_gcode`, the bed is not verified ([probes.md](probes.md)).
- **Verification has limits.** Three outline points can miss a part that was pushed partly off
  and rotated, and `center` mode cannot see hollow parts. Thin, flat leftovers (under
  `verify_threshold`) are not detected.
- **Purge lines and skirts** are too thin to be swept and will build up. Use `EJECT_PURGE`.

## Emergency stop

`M112` (or the emergency stop button in Mainsail/Fluidd) stops everything immediately. After
an emergency stop, clear the bed by hand before homing.
