import { Workspace } from "@rbxts/services";
import { BB } from "engine/shared/fixes/BB";
import { TerrainDataInfo } from "shared/TerrainDataInfo";

type Marker = {
	readonly cx: number;
	readonly cz: number;
	readonly hx: number;
	readonly hz: number;
	readonly hxOut: number;
	readonly hzOut: number;
	readonly blend: number;
	readonly rightX: number;
	readonly rightZ: number;
	readonly lookX: number;
	readonly lookZ: number;
};

//Baseplate Bounding Box
const edgeInset = 20;
const baseBlend = 512; // max ramp width for the fallback baseplate box (world studs)

// Special TerrainMarkers
const defaultMarkerBlend = 512; // max ramp width when terrain is tall (world studs); per-marker: `TerrainBlend`
const minBlendFrac = 0.6; // low terrain ramps over this fraction of the max width (abrupt)
const maxEncroach = 1024; // how far (studs) the ramp toe sits inside the flat edge at full height (keep < blend)
const blendRefHeight = TerrainDataInfo.data.maximumHeight * 0.6; // raw height at which the ramp is fully gentle

// height multiplier: 0 inside (w - encroach), ease-out ramp to 1 across `maxBlend * blendScale` studs —
// climbs fast off the flat edge so terrain hugs it, then eases smoothly into full terrain (no crease there)
const rampFactor = (d: number, w: number, maxBlend: number, encroach: number, blendScale: number): number => {
	const blend = maxBlend * blendScale;
	const outside = math.abs(d) - (w - encroach);
	if (outside <= 0) return 0;
	if (outside >= blend) return 1;

	const t = outside / blend;
	return t * (2 - t);
};

const permanent = Workspace.WaitForChild("Map").WaitForChild("Permanent");
const bb = BB.fromModel(permanent.WaitForChild("Base") as Model);
const offset = bb.center.Position.div(8);
const size = bb.originalSize.div(4);

const buildMarkers = (): readonly Marker[] => {
	const folder = permanent.FindFirstChild("TerrainMask");
	if (!folder) return [];

	const result: Marker[] = [];
	for (const part of folder.GetDescendants()) {
		if (!part.IsA("BasePart")) continue;

		const cf = part.CFrame;
		const right = cf.RightVector;
		const look = cf.LookVector;
		const inset = (part.GetAttribute("TerrainInset") as number | undefined) ?? 0;
		const blend = math.max((part.GetAttribute("TerrainBlend") as number | undefined) ?? defaultMarkerBlend, 1);
		const hx = math.max(part.Size.X / 2 - inset, 1);
		const hz = math.max(part.Size.Z / 2 - inset, 1);

		result.push({
			cx: cf.X,
			cz: cf.Z,
			hx,
			hz,
			hxOut: hx + blend,
			hzOut: hz + blend,
			blend,
			// project a world XZ offset onto the part's horizontal axes; rampFactor uses |offset| so sign is irrelevant
			rightX: right.X,
			rightZ: right.Z,
			lookX: look.X,
			lookZ: look.Z,
		});
	}

	return result;
};
const markers = buildMarkers();
const hasMarkers = markers.size() > 0;

const baseSuppression = (x: number, z: number, heightFactor: number): number => {
	const blendScale = minBlendFrac + (1 - minBlendFrac) * heightFactor;
	const encroach = (maxEncroach / 4) * heightFactor;
	return math.max(
		rampFactor(x - offset.X, size.X / 2 - edgeInset, baseBlend / 4, encroach, blendScale),
		rampFactor(z - offset.Z, size.Z / 2 - edgeInset, baseBlend / 4, encroach, blendScale),
	);
};
const markerSuppression = (x: number, z: number, heightFactor: number): number => {
	const blendScale = minBlendFrac + (1 - minBlendFrac) * heightFactor;
	const encroach = maxEncroach * heightFactor;
	const wx = x * 4;
	const wz = z * 4;

	let mult = 1;
	for (const m of markers) {
		const dx = wx - m.cx;
		const dz = wz - m.cz;

		const lx = dx * m.rightX + dz * m.rightZ;
		if (math.abs(lx) >= m.hxOut) continue;
		const lz = dx * m.lookX + dz * m.lookZ;
		if (math.abs(lz) >= m.hzOut) continue;

		const factor = math.max(
			rampFactor(lx, m.hx, m.blend, encroach, blendScale),
			rampFactor(lz, m.hz, m.blend, encroach, blendScale),
		);
		if (factor < mult) mult = factor;
		if (mult <= 0) break;
	}

	return mult;
};

/** Flattens generated terrain over designer-placed regions so the buildable platform isn't buried under hills.*/
export namespace TerrainMask {
	/** Height multiplier at (x, z): 0 = fully flattened, 1 = full terrain height. `rawHeight` drives the adaptive ramp. */
	export function getMultiplier(x: number, z: number, rawHeight: number): number {
		// tall terrain gets a wider, gentler ramp; low terrain a short, abrupt one
		const heightFactor = math.clamp(rawHeight / blendRefHeight, 0, 1);
		return hasMarkers ? markerSuppression(x, z, heightFactor) : baseSuppression(x, z, heightFactor);
	}
}
