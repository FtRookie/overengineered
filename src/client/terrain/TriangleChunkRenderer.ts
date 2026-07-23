import { Workspace } from "@rbxts/services";
import { Element } from "engine/shared/Element";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { ChunkGenerator, ChunkRenderer } from "client/terrain/ChunkLoader";

type config = {
	readonly addSandBelowSeaLevel: boolean;
	readonly snowOnly: boolean;
	readonly override: TerrainConfiguration["override"];
};
const obstaclesFolder = Workspace.WaitForChild("Obstacles");
export const TriangleChunkRenderer = (
	generator: ChunkGenerator,
	chunkResolution: number = 8,
	config?: config,
): ChunkRenderer<Instance> => {
	const parent = Element.create("Folder", { Name: "Triterra", Parent: obstaclesFolder });
	const chunkSize = 128 * 4;
	const squareSize = chunkSize / chunkResolution;
	const squareHalfSize = squareSize / 2;
	const thickness = 10;
	const half_thickness = thickness / 2;
	const newWedge = (size: Vector3, cframe: CFrame) => {
		const wedge = new Instance("WedgePart");
		wedge.Size = size;
		wedge.CFrame = cframe;
		wedge.Anchored = true;
		wedge.CastShadow = false;
		wedge.Locked = true;

		return wedge;
	};
	const createTriangle = (a: Vector3, b: Vector3, c: Vector3) => {
		let [ab, ac, bc] = [b.sub(a), c.sub(a), c.sub(b)];
		const [abd, acd, bcd] = [ab.Dot(ab), ac.Dot(ac), bc.Dot(bc)];

		// Put the longest edge on bc, so the split runs down the altitude from a.
		if (abd > acd && abd > bcd) {
			[c, a] = [a, c];
		} else if (acd > bcd && acd > abd) {
			[a, b] = [b, a];
		}

		[ab, ac, bc] = [b.sub(a), c.sub(a), c.sub(b)];

		const right = ac.Cross(ab).Unit;
		const up = bc.Cross(right).Unit;
		const back = bc.Unit;

		// These wedges are 10 studs thick, unlike the flat ones the classic two-wedge trick assumes, so each
		// has to be pushed half its thickness along the normal to sit UNDER the surface rather than centred
		// on it. Which way that is depends on where `right` ended up pointing, and that flips with the
		// vertex order — reordering above chose it, and the caller's winding chose it again.
		//
		// Reading the sign back out of the CFrame's Euler angles is what it used to do, and it could not
		// work: at 90 degrees of yaw the decomposition is degenerate, so the answer was arbitrary exactly
		// where it mattered. Ask the normal directly instead. Any wedge that got this wrong stuck out of
		// the hillside as a spike.
		const sink = right.Y > 0 ? -half_thickness : half_thickness;

		const height = math.abs(ab.Dot(up));

		const w1CFrame = CFrame.fromMatrix(a.add(b).div(2), right, up, back);
		const w1 = newWedge(new Vector3(thickness, height, math.abs(ab.Dot(back))), w1CFrame.add(right.mul(sink)));

		const w2CFrame = CFrame.fromMatrix(a.add(c).div(2), right.mul(-1), up, back.mul(-1));
		const w2 = newWedge(new Vector3(thickness, height, math.abs(ac.Dot(back))), w2CFrame.add(right.mul(sink)));

		return $tuple(w1, w2);
	};
	const generateSquare = (x: number, z: number, xpzp: number, xpzn: number, xnzp: number, xnzn: number) => {
		const vpp = new Vector3(x + squareHalfSize, xpzp, z + squareHalfSize);
		const vpn = new Vector3(x + squareHalfSize, xpzn, z - squareHalfSize);
		const vnp = new Vector3(x - squareHalfSize, xnzp, z + squareHalfSize);
		const vnn = new Vector3(x - squareHalfSize, xnzn, z - squareHalfSize);

		// Both halves must be wound the same way round. They were not: the second ran the opposite
		// direction, so its normal pointed the other way and its wedges built inside out.
		const [w11, w12] = createTriangle(vpp, vpn, vnp);
		const [w21, w22] = createTriangle(vnp, vpn, vnn);

		const minHeight = math.min(xpzp, xpzn, xnzp, xnzn) - GameDefinitions.HEIGHT_OFFSET;
		const maxHeight = math.max(xpzp, xpzn, xnzp, xnzn) - GameDefinitions.HEIGHT_OFFSET;
		const heightDiff = maxHeight - minHeight;

		if (config?.override?.enabled) {
			for (const wedge of [w11, w12, w21, w22]) {
				wedge.Material = Enum.Material[config.override.material];
				wedge.Color = config.override.color.color;
			}
		} else if (config?.snowOnly) {
			for (const wedge of [w11, w12, w21, w22]) {
				wedge.Material = Enum.Material.Snow;
				wedge.Color = math.random() > 0.9999 ? new Color3(0.8, 0.8, 0.4) : new Color3(0.8, 0.8, 0.8);
			}
		} else {
			if (heightDiff > 80 / math.sqrt(chunkResolution / 8)) {
				for (const wedge of [w11, w12, w21, w22]) {
					wedge.Material = Enum.Material.Basalt;
					wedge.Color = new Color3(0.2, 0.2, 0.2);
				}
			} else if (maxHeight > 250) {
				for (const wedge of [w11, w12, w21, w22]) {
					wedge.Material = Enum.Material.Ice;
					wedge.Color = new Color3(1, 1, 1);
				}
			} else {
				if (
					config?.addSandBelowSeaLevel &&
					(w11.Position.Y < GameDefinitions.HEIGHT_OFFSET ||
						w12.Position.Y < GameDefinitions.HEIGHT_OFFSET ||
						w21.Position.Y < GameDefinitions.HEIGHT_OFFSET ||
						w22.Position.Y < GameDefinitions.HEIGHT_OFFSET)
				) {
					for (const wedge of [w11, w12, w21, w22]) {
						wedge.Material = Enum.Material.Sand;
						wedge.Color = Color3.fromRGB(246, 215, 176);
					}
				} else {
					for (const wedge of [w11, w12, w21, w22]) {
						wedge.Material = Enum.Material.Grass;
						wedge.Color = Color3.fromRGB(102, 130, 84);
					}
				}
			}
		}

		return $tuple(w11, w12, w21, w22);
	};

	return {
		chunkSize,
		loadDistanceMultiplier: 2,

		renderChunk(chunkx: number, chunkz: number): Instance {
			const chunk = new Instance("Folder", parent);

			for (let iterx = 0; iterx < chunkResolution; iterx++) {
				if (chunkResolution > 1 && math.random() > 0.8) {
					task.wait();
				}

				for (let iterz = 0; iterz < chunkResolution; iterz++) {
					const relx = iterx * squareSize;
					const relz = iterz * squareSize;

					const absx = chunkx * chunkSize + relx;
					const absz = chunkz * chunkSize + relz;

					debug.profilebegin("Generating height");
					const xpzp =
						generator.getHeight((absx + squareHalfSize) / 4, (absz + squareHalfSize) / 4) +
						GameDefinitions.HEIGHT_OFFSET;
					const xpzn =
						generator.getHeight((absx + squareHalfSize) / 4, (absz - squareHalfSize) / 4) +
						GameDefinitions.HEIGHT_OFFSET;
					const xnzp =
						generator.getHeight((absx - squareHalfSize) / 4, (absz + squareHalfSize) / 4) +
						GameDefinitions.HEIGHT_OFFSET;
					const xnzn =
						generator.getHeight((absx - squareHalfSize) / 4, (absz - squareHalfSize) / 4) +
						GameDefinitions.HEIGHT_OFFSET;
					debug.profileend();

					debug.profilebegin("Generating triangles");
					const [w11, w12, w21, w22] = generateSquare(absx, absz, xpzp, xpzn, xnzp, xnzn);
					w11.Parent = chunk;
					w12.Parent = chunk;
					w21.Parent = chunk;
					w22.Parent = chunk;
					debug.profileend();
				}
			}

			return chunk;
		},
		destroyChunk(chunkX: number, chunkZ: number, chunk: Instance): void {
			// destroying a chunk is 4 * resolution^2 parts; unmarked, it read as unattributed script time
			debug.profilebegin("Destroying triangles");
			chunk.Destroy();
			debug.profileend();
		},
		unloadAll(chunks) {
			for (const chunk of chunks) {
				chunk.Destroy();
			}
		},
		destroy() {
			parent.Destroy();
		},
	};
};
