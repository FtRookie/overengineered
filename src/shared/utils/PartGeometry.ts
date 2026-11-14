import { BlockManager } from "shared/building/BlockManager";

const boxCorners: readonly Vector3[] = [-1, 1].flatmap((x) =>
	[-1, 1].flatmap((y) => [-1, 1].map((z) => new Vector3(x, y, z))),
);
const bottomCorners = boxCorners.filter((c) => c.Y < 0);
// measured in Studio: a wedge's slope rises toward +Z, a corner wedge's apex sits over the +X -Z corner
const wedgeCorners: readonly Vector3[] = [...bottomCorners, new Vector3(-1, 1, 1), new Vector3(1, 1, 1)];
const cornerWedgeCorners: readonly Vector3[] = [...bottomCorners, new Vector3(1, 1, -1)];

const isColbox = (part: BasePart) => part.Name.lower() === "colbox";

/** The parts of a block that make up its visible shape; invisible parts, collision boxes and folders (WeldRegions) are skipped */
const forEachShapePart = (target: BasePart, func: (part: BasePart) => void) => {
	const block = BlockManager.tryGetBlockModelByPart(target);
	if (!block) {
		if (target.Transparency < 1) func(target);
		return;
	}

	for (const child of block.GetChildren()) {
		if (!child.IsA("BasePart") || isColbox(child) || child.Transparency >= 1) continue;
		func(child);
	}
};

/** Exact vertex positions of primitive part shapes */
export namespace PartGeometry {
	/** Corners in units of half the part's size, or undefined for shapes without corners (balls, cylinders, meshes, unions) */
	export function localCorners(part: BasePart): readonly Vector3[] | undefined {
		if (part.IsA("WedgePart")) return wedgeCorners;
		if (part.IsA("CornerWedgePart")) return cornerWedgeCorners;
		if (!part.IsA("Part")) return;

		if (part.Shape === Enum.PartType.Block) return boxCorners;
		if (part.Shape === Enum.PartType.Wedge) return wedgeCorners;
		if (part.Shape === Enum.PartType.CornerWedge) return cornerWedgeCorners;
	}

	/** World-space corners of one part */
	export function snapPoints(part: BasePart): Vector3[] {
		const corners = localCorners(part);
		if (!corners) return [];

		const half = part.Size.div(2);
		const cframe = part.CFrame;
		return corners.map((c) => cframe.PointToWorldSpace(c.mul(half)));
	}

	/** World-space corners of the whole block the part belongs to, or of the part alone when it is not in a block */
	export function blockSnapPoints(part: BasePart): Vector3[] {
		const points: Vector3[] = [];
		forEachShapePart(part, (p) => {
			for (const point of snapPoints(p)) points.push(point);
		});

		return points;
	}

	/** The corner of the part's block nearest to `position`, without building the point list */
	export function nearestSnapPoint(part: BasePart, position: Vector3): Vector3 | undefined {
		let best: Vector3 | undefined;
		let bestDist = math.huge;

		forEachShapePart(part, (p) => {
			const corners = localCorners(p);
			if (!corners) return;

			const half = p.Size.div(2);
			const cframe = p.CFrame;
			for (const corner of corners) {
				const world = cframe.PointToWorldSpace(corner.mul(half));
				const dist = world.sub(position).Magnitude;
				if (dist >= bestDist) continue;

				bestDist = dist;
				best = world;
			}
		});

		return best;
	}
}
