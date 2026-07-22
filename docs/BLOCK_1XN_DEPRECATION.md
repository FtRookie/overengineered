# 1×N block deprecation

Manifest for the deprecation of the elongated `NxM` building-block variants, folded onto their `1x1`
counterparts by save-migration **v36**. Phase 1 is live and verified in Studio (2026-07); Phase 2 (deleting the
shells) is deferred — see the trap at the bottom.

## What & why

Each elongated variant is a pure linear scale of a `1x1` base, so keeping a separate block per length was
redundant. On load, migration v36 rewrites every deprecated id to its base id plus a `scale` vector that
reproduces the original footprint. The old ids stay registered as `hidden: true` shells so existing saves keep
loading (and so v36 can measure the prefabs — see below).

Two-phase on purpose:

- **Phase 1 (done):** add v36, mark the variants `hidden: true`. They become unbuyable but still load, and each
  rewrite prints a log.
- **Phase 2 (later):** once the logs go quiet across live sessions, delete the shells + models. **Read the trap
  first.**

## Mapping (36 variants → 12 bases)

| Family | Deprecated ids | Base |
| --- | --- | --- |
| Beams | `beam2x1`, `beam3x1`, `beam4x1` | `block` |
| Wedges | `wedge1x2`, `wedge1x3`, `wedge1x4` | `wedge1x1` |
| Half wedges | `halfwedge1x2`, `halfwedge1x3`, `halfwedge1x4` | `halfwedge1x1` |
| Corner wedges | `cornerwedge2x1`, `cornerwedge3x1`, `cornerwedge4x1` | `cornerwedge1x1` |
| Inner tetras | `innertetra2x1`, `innertetra3x1`, `innertetra4x1` | `innertetra` |
| Tetrahedra | `tetrahedron2x1`, `tetrahedron3x1`, `tetrahedron4x1` | `tetrahedron` |
| Half corner wedges | `halfcornerwedge2x1`, `halfcornerwedge3x1`, `halfcornerwedge4x1` | `halfcornerwedge1x1` |
| Half corner wedges (mirrored) | `halfcornerwedge2x1mirrored`, `halfcornerwedge3x1mirrored`, `halfcornerwedge4x1mirrored` | `halfcornerwedge1x1mirrored` |
| Wings | `wing1x2`, `wing1x3`, `wing1x4` | `wing1x1` |
| Wedge wings | `wedgewing1x2`, `wedgewing1x3`, `wedgewing1x4` | `wedgewing1x1` |
| Cylinders | `cylinder1x2`, `cylinder2x1`, `cylinder2x2` | `cylinder1x1` |
| Half cylinders | `halfcylinder1x2`, `halfcylinder2x1`, `halfcylinder2x2` | `halfcylinder1x1` |

Wings fold cleanly because their lift is derived from `WingSurface.Size`/`Mass` at runtime (no per-variant
constants), so a scaled `wing1x1` behaves identically. Cylinders fold cleanly because a per-axis-scaled cylinder
is exactly its wider/taller/elliptical variant.

### Excluded

- **Cylinder ↔ cube connectors** — `cylinderto{2x1,2x2,2x4}cubeconnector` (+ `…hollow`) and
  `halfcylinderto{2x1,2x2}cubeconnector` (+ `…hollow`). Unique parts, not pure scales: the circular mouth would
  distort to an ellipse under non-uniform scaling.
- **`hollowtruncatedcylinder1x1`** — has no elongated variants.

## Mechanism

Migration `v36` in `src/shared/building/BlocksSerializer.ts`:

- `baseOf` maps each deprecated id → base id.
- `measureVisual(model)` returns the model's visual size in its **own pivot frame**, projecting each part's
  oriented box onto the pivot axes and **skipping `colbox` / `radarview`**. The auto-generated colbox is placed at
  identity rotation carrying the visual's *local* size, so reading `PrimaryPart.Size` (what
  `SharedBuilding.calculateScale` does) gives the wrong aspect on a rotated visual — this avoids that.
- `scale = measureVisual(variant) / measureVisual(base)`, cached per id, then composed with any player scale:
  `(block.scale ?? Vector3.one).mul(scale)`. `location` is left untouched.
- Each rewrite logs `Rescaling deprecated block <id> -> <base> x(<vec>)`.

Shells are marked `hidden: true` in:

- `src/shared/blocks/blocks/grouped/BuildingBlocks.ts` — beams, wedges, half-wedges, corner wedges, inner
  tetras, tetrahedra, half corner wedges (+mirrored), cylinders, half cylinders.
- `src/shared/blocks/blocks/grouped/WingsBlocks.ts` — wings, wedge wings.

## Phase 2 trap (before deleting the shells)

v36 **measures the retained prefabs at load**. If the shells are deleted while v36 still measures at runtime,
`blockList.blocks[oldId]?.model` is nil and v36 falls back to `Vector3.one` — loading the block **unscaled**, with
only a `$log`, no error. See the `// fixme:` at the fallback in `scaleFor`.

Order for Phase 2:

1. Harvest the per-id scale vectors from the `Rescaling…` logs.
2. Bake them into literals in v36 (replace the runtime `measureVisual` measurement).
3. Then delete the `hidden: true` shells and their models.
