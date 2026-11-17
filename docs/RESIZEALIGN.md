# ResizeAlign: ideas to borrow

Notes on stravant's ResizeAlign Studio plugin (same author as GapFill, whose corner snapping the Polygon tool already
borrows). Source: https://github.com/stravant/roblox-resizealign — `src/doExtend.lua` holds the resize maths,
`src/createResizeAlignSession.lua` the face picking. Nothing here is implemented yet.

## What it does

Click a face on part A, then a face on part B; the parts are resized so the faces meet. Modes:

| Mode | Result |
| --- | --- |
| Outer Touch / Inner Touch | both parts extend until their outer (inner) edges meet at the corner |
| Extend Up To / Extend Into | only A extends, to B's near / far side |
| Wedge Join | Inner Touch, then a wedge fills the sharp outer corner |
| Rounded Join | Inner Touch, then a cylinder fills the corner (a ball when both are cylinders) |
| Butt Joint | A is pulled back so it ends flush against B's face instead of overlapping it |

## Worth taking

- **Near-edge face picking.** A click within 25% (or 15%) of an edge, measured in screen space across the face,
  picks the narrower neighbouring face instead, so a thin panel's edge can be hit. Wedge slopes split 30/40/30: the
  outer bands pick the flat face beside the slope, only the middle picks the slope. Corner wedges do the same with
  barycentric distance to the triangle's edges. Fits the Polygon tool as edge/face snapping next to corner snapping.
- **Face outlines for every primitive,** wedge and corner-wedge slopes included, each with its outward normal. The
  natural extension of `PartGeometry` from corners to faces: start a polygon from a clicked face, or snap to a face
  centre or an edge midpoint.
- **A Resize Align tool of our own.** Resizing a face is grow along one local axis plus move half the change, which
  `SharedBuilding.scale` already does for blocks; it would go through edit requests to the server. Two guards to
  copy:
  - faces within ~0.57° of parallel fall back to a plain plane-to-plane resize when the true meeting point would
    need an extension over 2048 studs or 8× the size of the parts involved;
  - a resize that would shrink a part past zero is refused.
  The ray solve is written in cross-product form (`startSep:Cross(dirB):Dot(crossDir) / sin²`) because the usual
  dot-product form loses precision as the faces approach parallel.
- **Wedge Join's corner fill** is the same idea as the Polygon tool's panel-plus-triangle split; Lines meeting at an
  angle could get a filled corner the same way.

## Not yet looked at

`stravant/roblox-geometry` (vertices, edges and faces of any part; nearest edge on a mesh) — read it before writing
face geometry by hand.
