# Hardware: the blade

The blade (or "plow") is a rigid printed part fixed to the toolhead. It pushes the parts,
so the nozzle never touches them.

## Why not push with the nozzle?

- The nozzle, heater block and heat break are the weakest parts of the toolhead. Side loads can
  loosen the nozzle or bend the heat break, and that shows up later as leaks.
- Nozzle probes (Voron Tap and similar) move the whole toolhead on a vertical rail. Side loads
  on that rail affect probing accuracy.
- Pushing with the nozzle needs it a fraction of a millimetre above the bed, so any Z error
  scratches the build surface.

## Design rules

```
          side view                              front view
                                          ┌──────────── blade_width ────────────┐
       ┌─────────┐ toolhead               │                                     │
       │         ├──┐ mount plate         │            ┌───────────┐            │
       │         │  │ (existing screws)   │            │ toolhead  │            │
       │         │  │                     │            └─────┬─────┘            │
       └────┬────┘  │ arm                 │                  │ nozzle           │
            │       │                     ├──────────────────┴──────────────────┤
     nozzle ▼  ┌────┘                     │                blade                │
               │ blade ← blade_offset →   └─────────────────────────────────────┘
   ────────────┴──────── bed              lower edge = nozzle tip + blade lift
```

1. **Mount it on the carriage or a structural cover**, not on the hotend or a fan duct. A nozzle
   probe's moving part is acceptable for light parts.
2. **The lower edge must sit above the nozzle tip** (the *blade lift*, 1–2 mm), so the blade can
   never touch the bed before the nozzle would.
3. **The pushing face must be ahead of the nozzle** in the push direction (`blade_offset`), far
   enough that the parts never reach the hotend.
4. **Wider than the toolhead.** The blade must cover the toolhead's width, so parts outside the
   blade never hit the hotend or the duct from the side. 70–100 mm is typical.
5. **Make it stiff:** PETG, ABS or ASA, 4+ walls, 40%+ infill, two arms, and a short lever.
6. **Chamfer the lower front edge** so it rides over small bumps instead of digging in.
7. **Check the travel.** At the drop edge the blade sticks out past the toolhead, so make sure
   it cannot hit the frame, the bed mounting hardware or cable chains anywhere along the edge.

## Parametric starting point

[`hardware/plow.scad`](../hardware/plow.scad) is an OpenSCAD model with a two-screw mount plate,
two arms and a chamfered blade. Set the parameters (screw spacing, screw height above the nozzle,
blade lift, reach and width), render it, and check the fit before printing. Every toolhead is
different, so treat it as a template to adapt. Remixes for specific toolheads are very welcome
in pull requests.

## Measuring

Do this with the hotend cold and the printer homed.

1. **`blade_offset`:** move the nozzle to the centre of the bed and lower it to Z=5. Measure
   along the push axis from the nozzle tip to the blade's pushing face. Positive means the face
   is ahead of the nozzle in the push direction.
2. **`blade_width`:** measure across the push axis. If the blade is not centred on the nozzle,
   use twice the distance from the nozzle to the *shorter* side.
3. **Blade lift:** with the nozzle touching a sheet of paper on the bed (Z≈0), the gap under
   the blade should be the lift you designed (1–2 mm).
4. **`push_z`:** the blade's lower edge ends up at `push_z + lift`. Start at `push_z: 3.0`,
   watch a real eject, then lower it until the blade reliably catches your parts at 1.5–3 mm
   above the bed.
5. **`push_end`:** with `"auto"`, the push runs to the axis limit. Check that at the limit the
   blade's face is past the edge of the build surface. If it is not, the parts land on the
   bed's edge instead of falling. Lengthen `blade_offset` in the hardware if needed.

## Catching the parts

A cardboard box, a bin or a printed chute under the drop edge. Leave room for the bed to move in Z
if your bed moves vertically, and keep cables away from the drop zone.

## Bed surfaces

| Surface | Releases when cool? |
|---|---|
| Textured PEI | Yes, PLA/PETG release below ~30 °C |
| Smooth PEI | Yes, but PETG can bond too strongly. Use a release agent |
| BIQU CryoGrip | Yes, PLA slides off once cooled |
| Glass | Often, but brittle. Not recommended |
| Garolite / G10 | Nylon releases well |

Always check by hand first: once the bed is cool, a part should slide off with a finger push.
If it needs flexing the sheet, auto-eject will not work on that surface.
