# Probes

The probe is used twice: to **verify** the bed is clear after a sweep, and to find Z when
**homing around parts** (`AUTO_EJECT HOME=1`). How well each works depends on the probe.

| Probe | Examples | Verify the bed | Smart homing |
|---|---|:-:|:-:|
| **Nozzle contact** | Voron Tap, load cells | ✅ | ✅ |
| **Offset contact** | BLTouch, CR Touch, Klicky, inductive | ✅ The nozzle is kept clear of parts (below) | ✅ Probe **and** nozzle spot both kept clear |
| **Eddy current** | BTT Eddy, Beacon, Cartographer, Eddy-NG | ⚠️ **Only with a contact/touch mode** | ✅ Mainline `probe_eddy_current`, or your own command |

`AUTO_EJECT_SETUP` shows which kind it detected on its first screen.

## Offset probes

While an offset probe comes down, the nozzle hangs `x_offset`/`y_offset` away from it, only a
few millimetres above the bed. If a part were under the nozzle, the nozzle would hit it before
the probe triggered. So:

- **Smart homing** picks a spot where both the probe **and** the nozzle are at least
  `home_clearance` (20 mm) from every stored part.
- **Verification** only probes points where the nozzle is at least `nozzle_clearance` (5 mm) away
  from every part that has not been confirmed gone yet. Parts are checked in an order that makes
  each one reachable: once a part is confirmed gone, the nozzle may pass over its spot. A failed
  check stops everything, so this is safe.
- A part that still cannot be probed safely stops with an error (`verify_unsafe_action: "error"`).
  Check it by hand and run `AUTO_EJECT_CLEAR`.

## Eddy-current probes

Eddy probes measure the distance to the **metal** bed, and plastic is invisible to them.

- **Homing:** Z comes out correct even with a part underneath. The toolhead still comes down to
  a few millimetres, so the spot is still chosen clear of parts. Klipper's own
  `probe_eddy_current` works with the default `home_z_gcode: "PROBE"`. For Beacon, Cartographer or
  Eddy-NG, set `home_z_gcode` to a command that homes Z at the current XY in your setup.
- **Verification:** a plain proximity reading **cannot** detect a leftover part. Unless you set
  `verify_probe_gcode` to your probe's contact/touch command, verification is skipped and every
  eject prints:

  ```
  AUTO_EJECT: WARNING - eddy-current probes cannot see plastic parts, the bed was NOT verified.
  ```

  Without verification, keep `guard_action: "error"` and check the bed yourself (or with a camera)
  before queued jobs run.

> **Testing status:** contact probes are tested on real hardware (Voron Tap). Offset probes and the
> eddy logic are covered by the automated tests only. If you run an eddy probe, please share
> your `verify_probe_gcode` / `home_z_gcode` in the discussions.
