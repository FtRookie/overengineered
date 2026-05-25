# AtmosphereService Analysis

> Surface-level reference for `src/client/AtmosphereService.ts`.
> Edit config in `src/client/3DAtmosphereConfig.ts`, not this file.

---

## Core derived variables (computed every frame)

| Variable | Formula | What it represents |
|---|---|---|
| `x` | `(camY + altOff) × scaleFactor` | Normalized altitude. Master input for all geometry and threshold calculations. |
| `xOverSF` | `camY + altOff` | Raw (unscaled) altitude. Used for world-space mesh positioning. |
| `altExp` | `2^(−x / 500000)` | Exponential altitude decay: 1.0 at ground, ~0.5 at 500 km, ~0 in deep orbit. Shrinks twilight thresholds at altitude to simulate a thinner atmosphere cross-section. |
| `horizElev` | `−arccos(R / (R + x))` deg, R = 20925656.2 | Geometric horizon depression angle. 0° at ground; grows negative with altitude (ISS ≈ −20°). |
| `sunElevation` | `atan(dir.Y / sqrt(dir.X²+dir.Z²))` deg | Elevation of the sun direction relative to the camera look vector. |
| `horizElevSunsetDiff` (HESD) | `sunElevation − horizElev` | Degrees the sun is above your geometric horizon. **The single master driver of all day/night/twilight transitions.** |
| `H1` | `6 × altExp` | HESD threshold for full sunset glow onset. Shrinks at altitude. |
| `H3` | `10 × altExp` | HESD threshold for full daylight. |
| `H15` | `15 × altExp` | HESD threshold used for fog color altitude fade. |

---

## Inter-frame carry state

| Field | Written by | Read by | Purpose |
|---|---|---|---|
| `horizElevSunsetDiff10` | `onSunshineStep` (Last priority) | `onRenderStep` | HESD clamped to [0, H1]. Controls sun corona intensity on the next render step. |
| `fogEndRatio` | `updateAltitudeGeometry` | `updateTwilightColors` | Altitude-based multiplier on fog end distance. Carries within the same frame. |
| `extinctionWidthEquation` | `updateExtinctionPositioning` | `updateExtinctionBeams`, `updateSunsetScatteringBeams` | Beam width: ~80000 near ground, ~40000 at normal altitude, narrows above ~200 km. |
| `extinctionOrientationEquation` | `updateExtinctionPositioning` | `updateAttachmentOrientations` | Pitch angle of extinction beam attachments (79° near ground, 81° normal). |
| `sunOffsetX` / `sunOffsetZ` | `updateEarthApparentMovement` | `updateEarthApparentMovement` | Accumulated player velocity in degrees. Applied to `ClockTime` / `GeographicLatitude`. |

---

## Twilight stages (HESD thresholds)

| HESD range | Stage | Observable state |
|---|---|---|
| > 3.75° | Full daylight | Atmosphere color, maximum fog range, 0 stars |
| 0° – 3.75° | Golden hour | Fog lerps toward sunset color, fog range shrinks, sun corona at maximum |
| −7° – 0° | Civil twilight | Fog darkens, airglow appears, distant surface goes black, Belt of Venus begins |
| −14° – −7° | Nautical twilight | Fog continues darkening, Belt of Venus fully active |
| < −14° | Night | Black fog, 3000 stars, atmosphere fully transparent |

---

## Formula summaries as observable behaviours

### Horizon depression (`horizElev`)

Uses the real Earth mean radius. At ground level the horizon is at 0°. At orbital altitude it dips well below horizontal — so the sun can be geometrically above the horizon even when it appears to be near the ground from a high vantage point. This is what makes civil/nautical twilight bands look correct from different altitudes.

### Altitude decay (`altExp`)

`2^(-x / 500000)` — all sunset and twilight thresholds (H1, H3, H15) are proportional to this. At sea level full-sunset glow spans ≈ 6° of sun elevation; from 5000 km orbit the same glow compresses to a fraction of a degree, matching how the atmospheric limb appears from space.

### Sun color temperature

Piecewise logarithmic/linear approximation of the Planckian locus across six temperature bands:

- ≤ 2000 K → orange-red
- 2000–6600 K → yellow-white (the normal daytime range)
- > 6600 K → blue-white

When sunset scattering is enabled this full-temperature color is replaced near the horizon by `SunExtinctionColor`, blended via HESD / H1.

### Sun corona glow

`horizElevSunsetDiff10` (clamped HESD, 0 → H1) scales both the size and transparency of the sun texture layers. The FOV is divided out of the glow size so it stays physically consistent when the camera zooms. A secondary `sunsetFOVTransScale` term suppresses the halo when the FOV is very narrow (telephoto).

### Twilight fog color

Inside each twilight band the fog colour linearly blends between `AtmosphereSunsetColor` and `AtmosphereColor` using `|HESD| / div`. Brightness is scaled by `(HESD + 14) / 17.75`, so the sky is black at −14° and fully bright above 3.75°. Fog end distance is a separate piecewise function:

- Daytime: `100000 × fogEndRatio × atmoThinness` (long-range haze)
- Golden hour: `(−100000 × (HESD − 3.75) + 100000) × …` (distance shrinks as sun sets)
- Civil twilight: `(−25000 × HESD + 475000) × …`
- Nautical twilight: linear ramp back outward

### Altitude → atmosphere geometry

Piecewise power-law / rational fits keep the atmosphere mesh and distant-surface mesh visually anchored on the horizon at every altitude. `FogStart` transitions from 0 at ground to a nonzero value above ~100 km to create atmospheric haze at orbital views.

### Earth sphere (`updateEarthPosition`)

Roughly seven altitude bands, each with its own polynomial. The sphere is invisible below ~100 km, fades in across 100–150 km, and its apparent diameter (`earthMeshEquation`) is sized to match the real angular diameter of Earth at each orbital distance. The terminator overlay (day/night boundary) is a separate mesh that always faces the sun.

### Extinction beams

Sixteen Roblox `Beam` objects, arranged radially, always pointing toward the sun. Two logical sets:

- **Regular extinction** (Beams 1–8): visible from any direction, represent the general scattering of the atmospheric limb. Transparency driven by HESD; color lerps from `AtmosphericExtinctionColor` to white.
- **Sunset scattering** (Sunset Beams 1–12): only enabled when `extSunsetTransEq < 1` and scattering is on. Represent the orange/red horizon gradient and the anti-solar Belt of Venus.

Belt of Venus beams use `BeltOfVenusColor` and activate when HESD ∈ [−7°, 0°], growing wider as the sun sinks further below the horizon (`width = baseWidth × clamp(−0.4×HESD + 1, 1, 10)`).

### Apparent planet movement

Player horizontal velocity is converted to angular degrees per frame:

```
velocityX = (hrpVel.X / scale × dt) / circumference   // longitude degrees
velocityZ = (hrpVel.Z / scale × dt) / circumference   // latitude degrees
```

These accumulate into `sunOffsetX / sunOffsetZ`, which offset `Lighting.ClockTime` and `GeographicLatitude`. Moving east shifts the sun backward (simulating sunrise in your direction of travel). Simultaneously, the Earth sphere rotates opposite to the player's motion via `CFrame.Angles`, creating the illusion of standing on a spherical planet.

### Atmospheric reflection

`Lighting.Ambient` is set to `AtmosphereReflectionColor × clamp(HESD / 10, 0, 1)`. At ground level in daylight (HESD ≈ 10°) ambient is at full configured value; it fades to black as the sun approaches the horizon.

### Airglow

When enabled, the airglow layer is positioned at the Earth sphere position and scaled to `earthMeshEquation × 1.014 × 8.137` (just slightly larger than the Earth sphere). Transparency is controlled by the twilight stage: 1 (invisible) in daytime, `Config.AirglowTransparency` at night.

### Ground atmosphere twilight darkness

`bottomAtmosphereDarkness` uses a fitted power law `ATDa × x^ATDb + ATDc × x^ATDd` against altitude, combined with a clock-time component `atdTimeComp` that ramps between 0 and 1 around the transition hours (≈ 05:00–06:30 and ≈ 18:00–19:30). The overlay is fully transparent outside the altitude band 5060–250251.
