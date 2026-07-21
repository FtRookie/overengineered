# Materials — System Analysis

> How block materials are modeled, painted, stored, and replicated today, and what
> it would take to add **custom materials**.
> Source of truth for material metadata is `src/engine/shared/data/Materials.ts`; the
> pickable set is `src/shared/building/BuildingManager.ts`. Edit those, not this file.

---

## TL;DR

- **Material identity is a raw `Enum.Material`** (a closed Roblox enum) everywhere at
  runtime and on the wire. There is **no** custom material type, union, or registry class.
- The **universe of pickable materials** = the Roblox enum minus two: `Water`, `Air`.
- `Materials.Properties` is a **metadata sidecar** (texture thumbnail + physics + thermal),
  keyed by material *name*. It augments the enum; it does not define what exists.
- A material persists as **`mat: number` = `Enum.Material.Value`** (numeric), color as a hex
  string. Default (Plastic / white-opaque) is stripped — absence means default.
- Appearance is stored **once per block** (a model attribute) and fanned out to every
  descendant `BasePart.Material` on apply.
- Replication is **passive**: the server mutates the server-owned model; Roblox instance
  replication carries it. A C2S2C remote covers the acting client + server validation.
- **Zero** `MaterialVariant` / `MaterialService` / `SurfaceAppearance` / PBR usage anywhere.
  "Custom" today means only 2D texture-thumbnail asset ids for the picker.

---

## 1. Material identity

The canonical runtime representation is the raw `Enum.Material` EnumItem — not a string,
not a custom union, not a wrapper. The string form `Enum.Material["Name"]` is used **only**
as a map-key type for lookup tables.

| Where | Type | Ref |
|---|---|---|
| Per-block appearance record | `readonly material: Enum.Material` | `src/shared/building/BlockManager.ts:10-11` |
| Paint remote payload | `readonly material?: Enum.Material` | `src/shared/Remotes.ts:58-63` |
| Every build/paint/edit tool selection | `ObservableValue<Enum.Material>` (default `Plastic`) | `PaintTool.ts:127`, `BuildTool.ts:1076`, `EditTool.ts:353`, `TriangleTool.ts:786` |
| Runtime type-check schema | `material: ofEnum(Enum.Material)` | `src/engine/shared/t.ts:191` |

String-key form (only as a mapped-type key over the material-name union):
`Materials.ts:32,36`, `src/shared/block/impact/ImpactController.ts:12`.

There is **no** custom material enum, string-union alias, or registry class. The union of
names is derived structurally from `Enum.Material["Name"]`.

---

## 2. The material registry — `src/engine/shared/data/Materials.ts`

`Materials.Properties: MaterialTable` maps **material name → `MaterialEntry`**. `Default` is
mandatory; every real material is optional; keys are constrained to Roblox material names.

```ts
type MaterialEntry = {
    readonly id: string;                    // Roblox texture-image asset id (bare number)
    readonly Density?: number;              // physics overrides (sparse), consumed by SharedBuilding
    readonly Elasticity?: number;
    readonly ElasticityWeight?: number;
    readonly Friction?: number;
    readonly FrictionWeight?: number;
    readonly thermalProperties?: {          // heat system
        readonly heatGlow?: boolean;
        readonly neonGlow?: boolean;
        readonly conductivity?: number;
        readonly ignitionChance?: number;
        readonly thermalResilience?: number;
    };
};
type MaterialTable = { readonly Default: MaterialEntry } & {
    readonly [k in Enum.Material["Name"]]?: MaterialEntry;
};
```

Namespace members (`Materials.ts:35-334`):

| Member | Purpose |
|---|---|
| `Properties` | the registry (`:94-333`), authored in commented groups (Special, Organic, Polymers, Metals, Masonry/Stone, Earth/Terrain, Ice/Cold) |
| `Default` | `id: ""`, baseline thermal values (`:95-104`) |
| `getMaterialDisplayName(m)` | pretty-name override map, else `m.Name` (`:61-63`) |
| `getMaterialTexture(m)` | `Properties[m.Name]?.id` (`:65-67`) |
| `getMaterialTextureAssetId(m)` | wraps id as `rbxassetid://…`, else `""` (`:68-73`) |
| `getMaterialDefaultColor(m)` | `Workspace.Terrain.GetMaterialColor(m)`, catch → white (`:75-82`) |

Notes:
- Only `Ice` / `Glacier` set the physics-friction overrides. Nothing sets `Density`.
- `id` is a **2D preview thumbnail** for the picker UI — NOT a SurfaceAppearance / MaterialVariant.
  In-world appearance is the stock Roblox material + `Color3` (Glass gets a hardcoded 0.3 transparency).
- There is **no exported array** of materials in this module — the enumerable list lives elsewhere (§3).

---

## 3. The pickable list (source of truth)

```ts
// src/shared/building/BuildingManager.ts:9
export const AllowedMaterials =
    Enum.Material.GetEnumItems().except([Enum.Material.Water, Enum.Material.Air]);
```

The material universe = **`Enum.Material:GetEnumItems()` minus `Water` and `Air`** — a filtered
subset of the Roblox enum (NOT the keys of `Materials.Properties`, not hardcoded).

Consumers:

| Consumer | Ref |
|---|---|
| Material picker grid | `src/client/gui/MaterialChooser.ts:111` |
| Server placement guard (`"Disallowed material"`) | `src/server/building/PlacementValidation.ts:39-42` |
| Pipette filter | `src/client/gui/controls/BlockPipetteButton.ts:100` |
| "Use every material" achievement denominator | `src/server/AchievementList.ts:1369` |

Default selected material everywhere is `Enum.Material.Plastic`.

---

## 4. Painting UI

| Layer | File | What it is |
|---|---|---|
| Paint tool (state + request) | `src/client/tools/PaintTool.ts` | holds `selectedMaterial`/`selectedColor` + `enableMaterial`/`enableColor` toggles (`:126-130`); `paint()` sends only the enabled halves (`:153-164`) |
| Paint-tool drop-up | `src/client/gui/buildmode/MaterialColorEditControl.ts` | Material + Color windows, pipettes, two-way binds to the tool |
| Grid picker | `src/client/gui/MaterialChooser.ts` | **searchable grid of texture-swatch tiles**, one per `AllowedMaterial`, sorted by enum `Value`; click → `value.submit(material)` |
| Reusable config control | `src/client/gui/configControls/ConfigControlMaterial.ts` | `addMaterial(...)` (`ConfigControlsList.ts:68-69`); preview + popup with search + `MaterialChooser` |

The picker is a **texture-thumbnail grid, not a dropdown or enum list**. Color and material are
**separate** (independent toggles, separate PAINT buttons) but travel in one request.

---

## 5. Apply path (UI selection → `BasePart.Material`)

```
PaintTool.paint()
  → ClientBuilding.paintOperation (undo grouping)              src/client/modes/build/ClientBuilding.ts:361-430
  → building.paintBlocks.send({ plot, material, color, blocks })   (C2S2C remote)
  → ServerBuildingRequestController (perm + PlacementValidation)     src/server/building/ServerBuildingRequestController.ts:184-196
  → BuildingPlot.paintBlocks → SharedBuilding.paint(...)            src/shared/building/BuildingPlot.ts:256-264
  → SharedBuilding.paint(blocks, color, material, byBuild)          src/shared/building/SharedBuilding.ts:99-151
      • BlockManager.manager.material.set(block, material)   (attribute)
      • PartUtils.switchDescendantsMaterial(block, material) (part.Material)
      • Glass → transparency 0.3; CustomPhysicalProperties from Materials.Properties
      • BlockManager.manager.color.set(block, color); switchDescendantsColor; alpha → transparency
```

The actual property write — `src/shared/utils/PartUtils.ts:27-42`:

```ts
// switchDescendantsMaterial
applyToAllDescendantsOfType("BasePart", model, (part) => {
    if (part.HasTag(TagUtils.allTags.STATIC_MATERIAL)) return;
    if (part.HasTag(TagUtils.allTags.TRANSPARENT_MATERIAL)) return;
    part.Material = material;
});
```

Per-part opt-out tags (`src/shared/utils/TagUtils.ts:12-14`): `STATIC_MATERIAL`, `STATIC_COLOR`,
`TRANSPARENT_MATERIAL`. A block is painted **uniformly across all descendant parts** minus these.
The same `paint()` runs at placement time (`BuildingPlot.ts:142`).

---

## 6. Serialization (save format)

A painted material persists as a **number = `Enum.Material.Value`** — not the name, not the object.

| Field (JSON) | Type | Ref |
|---|---|---|
| `mat` | `SerializedEnum = number` (`= Enum.Material.Value`) | `BlocksSerializer.ts:1662`, `SerializedTypes.d.ts:9` |
| `col` | `SerializedColor = string` (hex Color4) | `BlocksSerializer.ts:1663` |

```ts
// src/shared/Serializer.ts:20-28
export namespace EnumMaterialSerializer {
    export function serialize(material: Enum.Material): SerializedEnum {
        return material.Value;                                    // → NUMBER
    }
    export function deserialize(v: SerializedEnum): Enum.Material {
        return Enum.Material.GetEnumItems().find((m) => m.Value === v)!;   // by numeric Value
    }
}
```

- **In-memory** shape uses real types: `SerializedBlockV0.material?: Enum.Material`,
  `color?: Color3` (`:44-49`); `V7` upgrades color to `Color4` with alpha (`:66-69`).
- **Default-stripping**: Plastic and white/alpha-1 are DELETED from the save (`Filter.deleteDefaultValues`,
  `:74-91`) — "default" is represented by absence.
- **Version history** (append-only `UpgradableBlocksSerializer`): material/color existed from the first
  schema; `v17` was **removed** ("caused the loss of block material and color"), `v18` fixed it
  (`:626-649`); `v33` migrated `Color3 → Color4` (`:1601-1613`). Current latest = `v35`.
- **Unresolved material**: if a stored `Value` no longer exists, `.find(...)!` yields `nil`; downstream
  defaults to `Enum.Material.Plastic` (`:1780`, `BlockManager.ts:90`) — silently lost, not a crash.
- **Coupling**: stored by numeric `.Value`, so Roblox *renaming* a material is safe; *renumbering* or
  *removing* it would silently drop the paint to Plastic.

---

## 7. Replication

There is **no** paint/material `BlockSynchronizer` (`BlockSynchronizer.ts` is logic-values only).
Appearance replicates two ways:

1. **Passive (primary):** material/color are attributes on the server-owned `BlockModel`, and the
   BaseParts get `Material`/`Color`/`Transparency` set directly — both carried by normal Roblox
   instance replication. `BlockManager.ts:86-102`:
   - material → `SetAttribute("material", EnumMaterialSerializer.serialize(value))` (**number**)
   - color → `SetAttribute("color", JSON.serialize(value))` (**JSON string of `Color4`**)
2. **Active:** `paintBlocks` C2S2C remote (`"building_paint"`, `PlayerDataRemotes.ts:11,78`) — the acting
   client applies locally, the server validates + applies authoritatively, replication does the rest.

Storage granularity: **one appearance record per block** (`PlacedBlockData`, `BlockManager.ts:10-11`),
fanned out to all descendant parts at apply time. No per-part color/material in the save.

---

## 8. Adjacent metadata consumers

| System | Reads | Ref |
|---|---|---|
| Physics (`CustomPhysicalProperties`) | `Materials.Properties[name]` overrides, else Roblox defaults | `SharedBuilding.ts:121-137` |
| Heat / thermal / ignition | `Materials.Properties[name]?.thermalProperties`, else `Default` | `ServerBlockDamageController.ts:95-113,360`; `HeatGlowEffect.ts:60` |
| Impact strength | derived from `PhysicalProperties(material).Density`, separate from the registry | `src/shared/block/impact/ImpactController.ts:12-20` |
| Impact sounds | grouped by material (`Metal/Glass/Wood/WoodPlanks`), `Default` = Metal | `src/shared/effects/ImpactSoundEffect.ts:15-20` |
| Default color | `Workspace.Terrain.GetMaterialColor(material)` | `Materials.ts:75` |

(Terrain material overrides in `src/client/terrain/*` use `Enum.Material[name]` string indexing but are
terrain generation, distinct from the buildable-material registry.)

---

## Key files

| Concern | File |
|---|---|
| Metadata registry (texture/physics/thermal) | `src/engine/shared/data/Materials.ts` |
| Pickable set | `src/shared/building/BuildingManager.ts:9` |
| Per-block appearance record + attribute store | `src/shared/building/BlockManager.ts:10-11,86-103` |
| Apply (per-part fan-out) | `src/shared/building/SharedBuilding.ts:99-151`, `src/shared/utils/PartUtils.ts:27-42` |
| Save format | `src/shared/building/BlocksSerializer.ts` (`mat`/`col` ~1662), `src/shared/Serializer.ts:20-54` |
| Paint remote | `src/shared/Remotes.ts:58-63`, `src/shared/remotes/PlayerDataRemotes.ts:11,78` |
| Server validation | `src/server/building/PlacementValidation.ts:39-74` |
| Picker UI | `src/client/gui/MaterialChooser.ts`, `src/client/gui/configControls/ConfigControlMaterial.ts` |
| Paint tool | `src/client/tools/PaintTool.ts`, `src/client/gui/buildmode/MaterialColorEditControl.ts` |

---

# Adding custom materials

## The core constraint

Material identity **is** `Enum.Material`, persisted as its numeric `.Value`. Custom materials have
no `Enum.Material.Value`, so **every layer is hardwired to the closed enum**: the type, the pickable
list, the apply call (`part.Material = material`), the `mat: number` save field, and the metadata key
type (`Enum.Material["Name"]`). Adding custom materials means introducing a material identity that
isn't a Roblox enum item — that is the whole job.

## Decision fork

**Path A — Roblox `MaterialVariant` (recommended).** Custom PBR looks authored in Studio under
`MaterialService` (a `Name`, a `BaseMaterial`, texture maps). A part renders one by setting
`part.Material = BaseMaterial` **and** `part.MaterialVariant = "<name>"`. Native, replicates like any
part property, and **additive** to storage (the base material stays a real enum; you add a variant name).

> ⚠️ The exact `BasePart.MaterialVariant` / `MaterialService` API wiring must be confirmed against
> Roblox Creator Docs before implementation — the whole rendering path hinges on it.

**Path B — game-defined pseudo-materials.** Entries that aren't Roblox materials (e.g. "Gold" = Metal +
a fixed color/texture look). More control, but you invent identity, rendering, and a fallback for every
consumer from scratch — meaningfully more work.

Path A reuses the existing `part.Material` pipeline and is far less invasive. The change list below
assumes Path A.

## What has to change, by subsystem (Path A)

1. **Material identity/type (widest-reaching).** Introduce a compound identity
   `{ base: Enum.Material; variant?: string }` (or a small `MaterialId` wrapper). Ripples through
   `PlacedBlockData.material`, `PaintBlocksRequest.material`, the `ObservableValue<Enum.Material>` in
   every tool, and the `ConfigControlMaterial` generic.
2. **Registry & asset pipeline.** `MaterialVariant` instances live in Studio under `MaterialService`,
   synced via Rojo (declare instances in Studio, not code). Widen `MaterialTable`'s key type from
   `Enum.Material["Name"]` to include variant ids; give variants a thumbnail `id`, thermal, and physics
   (or inherit the base material's).
3. **Pickable list.** `AllowedMaterials` (`BuildingManager.ts:9`) must append the variant identities;
   everything downstream reads from here (chooser, validation, pipette, achievement denominator).
4. **Apply path.** `PartUtils.switchDescendantsMaterial` must set both `part.Material = base` and
   `part.MaterialVariant = variant ?? ""` — and crucially **clear** the variant when switching back to a
   stock material, or old variants stick. Same in `SharedBuilding.paint`, plus deciding how variants
   interact with the Glass/transparency and `CustomPhysicalProperties` special-cases.
5. **Serialization (additive).** Keep `mat: number` (base); add optional `matvar: string` behind a
   **new `vN`** in `BlocksSerializer.ts` (append-only; old saves lack it → no variant). Strip when
   default. On an unresolved variant, fall back to the base material (mirror the existing Plastic
   degrade, not a crash). This is the same de/serialization `v17` broke once — treat as save-touching:
   plan-first + Studio load-test on a real pre-change save.
6. **Server validation.** `PlacementValidation.checkMaterial` must validate the variant identity too;
   the paint/place remote payloads must carry it.
7. **UI.** `MaterialChooser` tiles per variant (variant-aware `getMaterialTextureAssetId` /
   `getMaterialDisplayName`); pipette (`BlockPipetteButton`) reads `MaterialVariant` back off a part;
   `ConfigControlMaterial` preview.
8. **Adjacent metadata consumers.** Thermal/heat, impact strength, impact sounds, and default color all
   key on `Enum.Material` today — variants inherit their base unless overridden. `getMaterialDefaultColor`
   uses `Terrain.GetMaterialColor`, which has no answer for a variant, so variants need their own default
   color source.

## Risks / gotchas

- **The compound-identity refactor is the real cost**, not the rendering. `Enum.Material` is threaded
  through ~10 files as a bare type.
- **Variant cleanup**: forgetting to clear `part.MaterialVariant` when repainting to a stock material is
  the obvious latent bug.
- **Save safety**: additive field + append-only version keeps it non-breaking, but this exact code path
  has a scarred history (`v17`) — treat the migration as save-touching.
- **Path B** additionally requires inventing rendering (no `part.Material` slot to reuse) and a fallback
  for every metadata consumer.
