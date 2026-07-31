import { Players } from "@rbxts/services";
import { BB } from "engine/shared/fixes/BB";
import { BlockManager } from "shared/building/BlockManager";
import { VectorUtils } from "shared/utils/VectorUtils";
import type { SharedPlot } from "shared/building/SharedPlot";

/** Methods for for getting information about blocks in a building */
export namespace BuildingManager {
	export const AllowedMaterials = Enum.Material.GetEnumItems().except([Enum.Material.Water, Enum.Material.Air]);

	/** Shared for client and server validation */
	export const MinScale = 1 / 128;
	export const MaxScale = 512;

	export function getAssemblyBlocks(block: BlockModel): BlockModel[] {
		// using set to prevent duplicates
		return [
			...new Set(block.PrimaryPart!.GetConnectedParts(true).map((b) => BlockManager.tryGetBlockModelByPart(b)!)),
		];
	}
	export function getMachineBlocks(block: BlockModel): BlockModel[] {
		const find = (result: Set<BlockModel>, visited: Set<Instance>, instance: BlockModel) => {
			for (const part of instance.GetDescendants()) {
				if (!part.IsA("BasePart")) continue;

				const assemblyConnected = part.GetConnectedParts(false);
				for (const cpart of assemblyConnected) {
					if (cpart.Name === "HumanoidRootPart") continue;
					if (visited.has(cpart)) continue;

					visited.add(cpart);

					const connected = BlockManager.getBlockDataByPart(cpart)?.instance;
					if (!connected) {
						throw `CPart ${part.Name} is not a block`;
					}

					result.add(connected);
					find(result, visited, connected);
				}
			}
		};

		const result = new Set<BlockModel>();
		find(result, new Set(), block);

		return [...result];
	}

	/** Returns the block or nothing that is set on (or near) the given vector
	 * @param vector The vector to check
	 * @deprecated slow & stupid
	 */
	export function getBlockByPosition(plot: SharedPlot, vector: Vector3): BlockModel | undefined {
		const blocks = plot.getBlocks();
		for (let i = 0; i < blocks.size(); i++) {
			const block = blocks[i];
			if (
				VectorUtils.roundVectorToNearestHalf(block.GetPivot().Position) ===
				VectorUtils.roundVectorToNearestHalf(vector)
			) {
				return block;
			}
		}

		return undefined;
	}

	export function blockCanBePlacedAt(
		plot: SharedPlot,
		block: { readonly model: Model },
		pivot: CFrame,
		scale: Vector3,
	): boolean {
		return serverBlockCanBePlacedAt(plot, block, pivot, scale, Players.LocalPlayer.UserId);
	}

	export function serverBlockCanBePlacedAt(
		plot: SharedPlot,
		block: { readonly model: Model },
		pivot: CFrame,
		scale: Vector3,
		playerId: number,
	): boolean {
		if (!plot.isBuildingAllowed(playerId)) {
			return false;
		}

		if (
			!plot.bounds.isBBInside(
				BB.fromModel(block.model)
					.withCenter(pivot)
					.withSize((s) => s.mul(scale)),
			)
		) {
			return false;
		}

		return true;
	}

	type MirroredBlock = {
		readonly id: BlockId;
		readonly pos: CFrame;
		readonly scale: Vector3;
	};
	export function getMirroredBlocks(
		center: CFrame,
		origBlock: MirroredBlock,
		mode: MirrorMode,
		blockList: BlockList,
		filterSamePositions = false,
	): readonly MirroredBlock[] {
		const reflect = (block: MirroredBlock, mode: "x" | "y" | "z", mirrorCFrame: CFrame): MirroredBlock => {
			let outScale = block.scale;

			function rotate(cframe: CFrame): CFrame {
				function normalRotation(cframe: CFrame) {
					const [X, Y, Z, R00, R01, R02, R10, R11, R12, R20, R21, R22] = mirrorCFrame
						.ToObjectSpace(cframe)
						.GetComponents();

					const reflection = new CFrame(X, Y, -Z, -R00, R01, R02, -R10, R11, R12, R20, -R21, -R22);
					const reflectedCFrame = mirrorCFrame.ToWorldSpace(reflection);
					return reflectedCFrame.Rotation;
				}

				const block = blockList.blocks[origBlock.id];
				if (!block) return cframe;
				const rad = math.rad;

				const method = block.mirror.behaviour;
				switch (method) {
					case "offset90":
						return normalRotation(cframe.mul(CFrame.fromEulerAnglesYXZ(0, math.pi / 2, 0)));
					case "offset180":
						return normalRotation(cframe.mul(CFrame.fromEulerAnglesYXZ(0, math.pi, 0)));
					case "offset270":
						return normalRotation(cframe.mul(CFrame.fromEulerAnglesYXZ(0, math.pi * 1.5, 0)));
					case "normal":
						return normalRotation(cframe);
					case "wedgeWing": {
						const [x, y, z, x0, x1, x2, y0, y1, y2, z0, z1, z2] = cframe.GetComponents();
						if (mode === "x") {
							return new CFrame(x, y, z, x0, -x1, x2, y0, -y1, y2, -z0, z1, -z2);
						} else if (mode === "y") {
							return new CFrame(x, y, z, x0, -x1, x2, -y0, y1, -y2, z0, -z1, z2);
						} else if (mode === "z") {
							return new CFrame(x, y, z, -x0, x1, -x2, y0, -y1, y2, z0, -z1, z2);
						}

						throw "Unknown mode";
					}
					case "tetra": {
						outScale = CFrame.fromOrientation(0, 0, rad(90)).mul(outScale).apply(math.abs);
						return normalRotation(cframe.mul(CFrame.fromEulerAnglesYXZ(0, 0, rad(270))));
					}
					case "innertetra": {
						outScale = CFrame.fromOrientation(0, 0, rad(90)).mul(outScale).apply(math.abs);
						return normalRotation(cframe.mul(CFrame.fromEulerAnglesYXZ(0, 0, rad(90))));
					}
					case "cornerwedge": {
						outScale = CFrame.fromOrientation(0, rad(90), 0).mul(outScale).apply(math.abs);
						return normalRotation(cframe.mul(CFrame.fromEulerAnglesYXZ(0, rad(-90), 0)));
					}
					case "hcylquart": {
						outScale = CFrame.fromOrientation(0, rad(90), 0).mul(outScale).apply(math.abs);
						return normalRotation(cframe.mul(CFrame.fromEulerAnglesYXZ(0, rad(90), 0)));
					}
					case "hcylvertical": {
						outScale = CFrame.fromOrientation(rad(90), 0, 0).mul(outScale).apply(math.abs);
						const rot =
							mode === "x"
								? CFrame.fromEulerAnglesYXZ(rad(90), rad(180), rad(180))
								: mode === "y"
									? CFrame.fromEulerAnglesYXZ(rad(90), 0, rad(180))
									: mode === "z"
										? CFrame.fromEulerAnglesYXZ(rad(90), 0, rad(180))
										: CFrame.identity;

						return normalRotation(cframe.mul(CFrame.fromEulerAnglesYXZ(rad(90), 0, rad(180))));
					}
				}
			}

			const rotated = rotate(block.pos);
			const pos = mirrorCFrame.PointToObjectSpace(block.pos.Position);

			return {
				id: (blockList.blocks[block.id]?.mirror.replacementId as BlockId | undefined) ?? block.id,
				pos: new CFrame(mirrorCFrame.ToWorldSpace(new CFrame(pos.X, pos.Y, -pos.Z)).Position).mul(
					rotated.Rotation,
				),
				scale: outScale,
			};
		};

		const axes: ["x" | "y" | "z", CFrame][] = [];
		if (mode.y !== undefined) {
			axes.push(["y", CFrame.fromAxisAngle(Vector3.xAxis, math.pi / 2).add(new Vector3(0, mode.y, 0))]);
		}
		if (mode.x !== undefined) {
			axes.push(["x", CFrame.identity.add(new Vector3(0, 0, mode.x))]);
		}
		if (mode.z !== undefined) {
			axes.push(["z", CFrame.fromAxisAngle(Vector3.yAxis, math.pi / 2).add(new Vector3(mode.z, 0, 0))]);
		}

		const origPos = VectorUtils.roundVector3(origBlock.pos.Position);
		const ret = new Map<Vector3, MirroredBlock>([[origPos, origBlock]]);
		for (const [axe, axis] of axes) {
			for (const [, frame] of [...ret]) {
				const reflected = reflect(frame, axe, center.ToWorldSpace(axis));
				ret.set(
					filterSamePositions ? VectorUtils.roundVector3(reflected.pos.Position) : reflected.pos.Position,
					reflected,
				);
			}
		}
		if (ret.size() !== 1) {
			ret.delete(origPos);
		}

		return ret.values();
	}
}
