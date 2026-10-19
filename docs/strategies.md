[klipper-auto-eject](../README.md) › [Documentation](README.md) › Strategies

# Path strategies

`AUTO_EJECT` turns the part outlines from `[exclude_object]` into a list of pushes. Each push
moves to a start point at a safe height, lowers the blade, drives it to the drop edge, and
lifts again. The strategy decides where those pushes go.

The examples below push to the **front** (Y-). The other directions work the same way, rotated.

Throughout, "behind" means further from the drop edge, and the start point of a push is:

```
start = (back edge of the part(s) in the lane) + rear_clearance + blade_offset
```

That puts the blade's face `rear_clearance` mm behind the part before it comes down.

---

## `columns` (default)

The bed is split into lanes as wide as the blade, overlapping by `column_overlap`. The lanes
cover only the span where parts are. Each lane starts behind the **rearmost** part in that lane
and sweeps everything in front of it off the edge.

```
   back ─────────────────────────────
            ↓ start      ↓ start
          ┌─────┐      ┌─────┐
          │ ▲ ▲ │      │  ▲  │        ▲ = parts
          │ ▲   │      │ ▲ ▲ │
          │  ▲  │      │     │
          └──┼──┘      └──┼──┘
   front ────┼────────────┼──────────  drop edge
             ▼            ▼
```

- **Works with any layout.** No gaps are needed between parts, because the blade always comes
  down behind everything in its lane.
- Parts in the same lane are pushed together, and the front ones are carried along by the rear ones.
  That suits small, light parts (cookie cutters, badges, clips).
- Empty stretches of bed between groups of parts are not swept.

## `objects`

One push per part, starting with the part **nearest the drop edge**, so that by the time a
part is pushed, everything between it and the edge is already gone.

```
   back ─────────────────────────────
                         ↓ 2
                       ┌───┐
              ↓ 1      │ ▲ │
            ┌───┐      └─┼─┘
            │ ▲ │        │
            └─┼─┘        │
   front ─────┼──────────┼──────────
              ▼          ▼
```

- Each part is pushed on its own and centred on the blade, which works better for larger parts.
- **Needs room behind each part.** Before planning, the macro checks that no other part sits in
  the area where the blade and toolhead come down (`head_depth` × `blade_width` +
  `side_margin`). If one does, it stops with an error naming both parts, before anything moves.
  Use `columns` for tightly packed plates.

## `full_width`

Sweeps the whole bed width in lanes, every lane starting at the far axis limit. It ignores part
positions, so it works **without object labels**.

- The slowest strategy, but the most thorough.
- Useful as `no_objects_action: "full_width"` for files sliced without labels.
- Verification is skipped, because there are no part positions to probe.

---

## Choosing

| Your plates look like… | Use |
|---|---|
| Many small parts, packed tightly | `columns` |
| A few larger parts with space between them | `objects` |
| Files from a slicer without object labels | `full_width` |

You can override the strategy for a single run: `AUTO_EJECT STRATEGY=objects`.

## Edge cases the planner handles

- **A part close to the far edge.** If the start point would be beyond the axis limit, the
  blade cannot get behind the part. The macro stops with an error, unless
  `allow_clamped_start: True`.
- **Lanes near the side limits.** Lane centres are clamped to the cross axis travel. The blade
  width still covers parts at the very edge as long as the blade is wider than the gap.
- **Probe offsets** are applied only during verification. Pushing is planned for the nozzle
  position plus `blade_offset`.
