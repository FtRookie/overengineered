import { Workspace } from "@rbxts/services";
import { BB } from "engine/shared/fixes/BB";

/**
 * The carve-out that keeps terrain from growing through the build area.
 *
 * The baseplate is where players build, so the ground under it is flattened away rather than generated. The
 * mask is 0 inside that rectangle and 1 outside, with a very sharp shoulder, and generators multiply their
 * terrain by it. Lifted from DefaultChunkGenerator so both generators cut exactly the same hole — a second
 * copy of these numbers that drifted would put mountains through somebody's plot.
 */
export namespace TerrainBounds {
	const baseplate = Workspace.WaitForChild("Map").WaitForChild("Permanent").WaitForChild("Base") as Model;
	const bb = BB.fromModel(baseplate);

	const offset = bb.center.Position.div(8);
	const size = bb.originalSize.div(4);
	const edgeInset = 20;

	const slopefunc = (x: number, w: number) => math.max(-math.pow(x / w, -32) + 1, 0);

	/** 0 inside the build area, 1 outside it. Coordinates are in voxels, as the generators receive them. */
	export function outsideBuildArea(x: number, z: number): number {
		return math.max(
			slopefunc(x - offset.X, size.X / 2 - edgeInset),
			slopefunc(z - offset.Z, size.Z / 2 - edgeInset),
		);
	}
}
