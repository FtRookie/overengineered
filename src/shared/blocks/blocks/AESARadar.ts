import { Players, RunService, Workspace } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { SharedPlots } from "shared/building/SharedPlots";
import type {
	BlockLogicFullBothDefinitions,
	BlockLogicInputDef,
	BlockLogicOutputDef,
	InstanceBlockLogicArgs,
} from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const ioNumbers = [1, 2, 3, 4] as const;

const absoluteMaxDistance = 15000;
const shapecastInterval = 1023; // Not 1024 because of some stupid precision errors
const partMaxSize = 2048;
const beamRotation = CFrame.Angles(0, math.rad(90), 0);
const maxBeamCount = math.ceil(absoluteMaxDistance / partMaxSize) * ioNumbers.size();
const beamColors = [
	Color3.fromRGB(255, 64, 64),
	Color3.fromRGB(64, 255, 64),
	Color3.fromRGB(64, 128, 255),
	Color3.fromRGB(255, 255, 64),
] as const;

const coneAxis = Vector3.zAxis; // dish boresight in input space
// the model pivot's axes don't match the dish mesh — remap inputs so +Z is the actual boresight
const inputToBlockRotation = CFrame.Angles(math.rad(-90), 0, 0);
const coneCos = math.cos(math.rad(60)); // ~120° full cone
const coneSin = math.sin(math.rad(60));
// direction exactly opposite the boresight has no unique nearest cone edge; pick one
const coneEdgeFallback = coneAxis.mul(coneCos).add(new Vector3(coneSin, 0, 0));

const definition = {
	inputOrder: ["maxDistance", "minDistance", "ignoreSelf", "visibility", ...ioNumbers.map((i) => `dir${i}`)],
	outputOrder: [...ioNumbers.map((i) => `dist${i}`), ...ioNumbers.map((i) => `off${i}`)],
	input: {
		maxDistance: {
			displayName: "Max Distance",
			types: {
				number: {
					config: 2048,
					clamp: {
						min: 0,
						max: absoluteMaxDistance,
						step: 0.1,
						showAsSlider: true,
					},
				},
			},
		},
		minDistance: {
			displayName: "Min Distance",
			types: {
				number: {
					config: 0,
					clamp: {
						min: 0,
						max: absoluteMaxDistance,
						step: 0.1,
						showAsSlider: true,
					},
				},
			},
		},
		visibility: {
			displayName: "Visibility",
			types: { bool: { config: false } },
		},
		ignoreSelf: {
			displayName: "Ignore Self",
			types: { bool: { config: false } },
			connectorHidden: true,
		},
		...asObject(
			ioNumbers.mapToMap((i) =>
				$tuple(`dir${i}` as `dir${typeof i}`, {
					displayName: `Direction ${i}`,
					types: { vector3: { config: Vector3.zero } },
				} satisfies BlockLogicInputDef),
			),
		),
	},
	output: {
		...asObject(
			ioNumbers.mapToMap((i) =>
				$tuple(`dist${i}` as `dist${typeof i}`, {
					displayName: `Distance ${i}`,
					types: ["number"],
				} satisfies BlockLogicOutputDef),
			),
		),
		...asObject(
			ioNumbers.mapToMap((i) =>
				$tuple(`off${i}` as `off${typeof i}`, {
					displayName: `Offset ${i}`,
					types: ["vector3"],
				} satisfies BlockLogicOutputDef),
			),
		),
	},
} satisfies BlockLogicFullBothDefinitions;

type AESARadarModel = BlockModel & {
	RadarView: Part;
	Body: BasePart;
};

export type { Logic as AESARadarLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition, AESARadarModel> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const lineOrigins = new Array<Vector3 | undefined>(ioNumbers.size());
		const lineEnds = new Array<Vector3>(ioNumbers.size());
		let lastVisibility = false;
		let needsRedraw = false;

		// Shapecast casts from the part's own CFrame with a 1024 stud limit; RadarView is welded,
		// so longer casts advance this detached clone instead of dragging the whole assembly
		const castProxy = this.instance.RadarView.Clone();
		castProxy.Name = "RadarCastProxy"; // a second "RadarView" child would shadow the typed one
		castProxy.ClearAllChildren();
		castProxy.Anchored = true;
		castProxy.CanCollide = false;
		castProxy.CanQuery = false;
		castProxy.CanTouch = false;
		castProxy.Transparency = 1;
		castProxy.Parent = this.instance;
		this.onDisable(() => castProxy.Destroy());
		// thickness of the swept shape along the beam (it faces -Z when posed with lookAlong)
		const proxyDepth = castProxy.Size.Z;

		// RadarView is unwelded and purely visual — the tick poses it manually, with its pristine
		// offset (captured now) as the idle pose. It must be anchored or it free-falls in ride mode
		// until FallenPartsDestroyHeight deletes it; the tick re-asserts this in case ride mode
		// unanchors the machine after logic construction
		const viewOffset = this.instance.GetPivot().Inverse().mul(this.instance.RadarView.CFrame);
		const radarView = this.instance.RadarView;
		radarView.Anchored = true;
		const body = this.instance.Body;
		let lastDishCFrame: CFrame | undefined;

		const maxDistanceCache = this.initializeInputCache("maxDistance");
		const minDistanceCache = this.initializeInputCache("minDistance");
		const ignoreSelfCache = this.initializeInputCache("ignoreSelf");
		const visibilityCache = this.initializeInputCache("visibility");
		const dirCaches = ioNumbers.map((i) => this.initializeInputCache(`dir${i}` as `dir${typeof i}`));
		const distOutputs = ioNumbers.map((i) => this.output[`dist${i}` as `dist${typeof i}`]);
		const offOutputs = ioNumbers.map((i) => this.output[`off${i}` as `off${typeof i}`]);
		for (const out of distOutputs) out.unset();
		for (const out of offOutputs) out.unset();

		const params = new RaycastParams();
		params.FilterType = Enum.RaycastFilterType.Include; // plot blocks only — terrain and map are not detectable
		const ownBlocksFolder = this.instance.Parent;
		const otherPlotBlocks: Instance[] = [];
		for (const plot of SharedPlots.instance.plots) {
			const blocks = plot.instance.FindFirstChild("Blocks");
			if (blocks && blocks !== ownBlocksFolder) {
				otherPlotBlocks.push(blocks);
			}
		}
		let filterIgnoresSelf: boolean | undefined;
		let filterDirty = false;

		const watchCharacter = (player: Player) => {
			this.event.subscribe(player.CharacterAdded, () => (filterDirty = true));
			this.event.subscribe(player.CharacterRemoving, () => (filterDirty = true));
		};
		for (const player of Players.GetPlayers()) {
			watchCharacter(player);
		}
		this.event.subscribe(Players.PlayerAdded, (player) => {
			filterDirty = true;
			watchCharacter(player);
		});
		this.event.subscribe(Players.PlayerRemoving, () => (filterDirty = true));

		this.event.subscribe(RunService.PostSimulation, () => {
			const visibility = visibilityCache.tryGet() ?? false;
			if (visibility !== lastVisibility) {
				lastVisibility = visibility;
				needsRedraw = true;
			}

			const ignoreSelf = ignoreSelfCache.tryGet() ?? false;
			if (ignoreSelf !== filterIgnoresSelf || filterDirty) {
				filterIgnoresSelf = ignoreSelf;
				filterDirty = false;

				const filter = table.clone(otherPlotBlocks);
				if (!ignoreSelf) {
					// own vehicle is detectable, but never the radar's own model
					for (const b of ownBlocksFolder?.GetChildren() ?? []) {
						if (b !== this.instance) {
							filter.push(b);
						}
					}
				}
				for (const player of Players.GetPlayers()) {
					if (ignoreSelf && player === Players.LocalPlayer) continue;

					const character = player.Character;
					if (character) {
						filter.push(character);
					}
				}
				params.FilterDescendantsInstances = filter;
			}

			const maxDistance = maxDistanceCache.tryGet() ?? 0;
			const minDistance = minDistanceCache.tryGet() ?? 0;
			const pivot = this.instance.GetPivot();
			const inputFrame = pivot.mul(inputToBlockRotation);
			const origin = body.Position;
			let dishDirection: Vector3 | undefined;

			for (const index of ioNumbers) {
				const lineIndex = index - 1;
				const dirX = dirCaches[lineIndex].tryGet() ?? Vector3.zero;
				if (dirX === Vector3.zero || maxDistance <= minDistance) {
					distOutputs[lineIndex].unset();
					offOutputs[lineIndex].unset();
					if (lineOrigins[lineIndex] !== undefined) {
						lineOrigins[lineIndex] = undefined;
						needsRedraw = true;
					}
					continue;
				}

				// dir inputs are model-relative — clamp to the cone in block space, then rotate into the world
				let localDir = dirX.Unit;
				const dot = localDir.Dot(coneAxis);
				if (dot < coneCos) {
					const perp = localDir.sub(coneAxis.mul(dot));
					const perpMagnitude = perp.Magnitude;
					localDir =
						perpMagnitude > 0.0001
							? coneAxis.mul(coneCos).add(perp.mul(coneSin / perpMagnitude))
							: coneEdgeFallback;
				}
				const direction = inputFrame.VectorToWorldSpace(localDir);
				dishDirection ??= direction;

				// detection window is [minDistance, maxDistance], scaled by the input's magnitude
				const startDistance = minDistance * dirX.Magnitude;
				const range = dirX.Magnitude * (maxDistance - minDistance);
				const startPos = origin.add(direction.mul(startDistance));
				// start the shape fully ahead of the window start and stop its travel early,
				// so the swept volume covers exactly the window
				let distanceLeft = range - proxyDepth;
				let traveled = 0;
				let result: RaycastResult | undefined;

				castProxy.CFrame = CFrame.lookAlong(startPos.add(direction.mul(proxyDepth / 2)), direction);
				while (distanceLeft > 0) {
					const step = math.min(distanceLeft, shapecastInterval);
					result = Workspace.Shapecast(castProxy, direction.mul(step), params);
					if (result) {
						// result.Distance measures the proxy's travel until its leading surface touches,
						// not the beam length — project the actual contact point onto the beam instead
						traveled = result.Position.sub(origin).Dot(direction);
						break;
					}
					distanceLeft -= step;
					if (distanceLeft <= 0) break;
					castProxy.CFrame = castProxy.CFrame.add(direction.mul(step));
				}
				// nothing hit — the beam visual still spans the whole window
				if (!result) traveled = startDistance + range;

				const endPos = origin.add(direction.mul(traveled));
				if (result) {
					distOutputs[lineIndex].set("number", traveled);
					offOutputs[lineIndex].set("vector3", result.Instance.Position.sub(endPos));
				} else {
					distOutputs[lineIndex].set("number", -1);
					offOutputs[lineIndex].set("vector3", Vector3.zero);
				}
				if (lineOrigins[lineIndex] !== startPos || lineEnds[lineIndex] !== endPos) {
					lineOrigins[lineIndex] = startPos;
					lineEnds[lineIndex] = endPos;
					needsRedraw = true;
				}
			}

			// unwelded, so it must track the block manually; faces the first active line, idles at the pristine pose
			if (!radarView.Anchored) radarView.Anchored = true;
			const dishCFrame =
				dishDirection !== undefined ? CFrame.lookAlong(origin, dishDirection) : pivot.mul(viewOffset);
			if (dishCFrame !== lastDishCFrame) {
				lastDishCFrame = dishCFrame;
				radarView.PivotTo(dishCFrame);
			}
		});

		if (!RunService.IsClient()) return;

		const beamTemplate = this.instance.RadarView.Clone();
		beamTemplate.Name = "RadarBeam";
		beamTemplate.ClearAllChildren();
		beamTemplate.Anchored = true;
		beamTemplate.CanCollide = false;
		beamTemplate.CanQuery = false;
		beamTemplate.CanTouch = false;
		beamTemplate.CastShadow = false;
		beamTemplate.Material = Enum.Material.Neon;
		beamTemplate.Transparency = 0.5;

		const beamFolder = new Instance("Folder");
		beamFolder.Name = "radarBeams";
		beamFolder.Parent = this.instance;

		// the beam visual's cross-section matches the swept shape's face
		const viewSize = beamTemplate.Size;

		const beams: BasePart[] = [beamTemplate];
		for (let i = 1; i < maxBeamCount; i++) {
			beams.push(beamTemplate.Clone());
		}

		this.onDisable(() => {
			for (const b of beams) {
				b.Destroy();
			}
		});

		let nextBeam = 0;
		let prevNextBeam = 0;

		const drawBeamBetween = (origin: Vector3, target: Vector3, color: Color3) => {
			const totalDist = origin.sub(target).Magnitude;
			const direction = target.sub(origin).Unit;

			for (let i = 0; i < totalDist; i += partMaxSize) {
				if (beams.size() <= nextBeam) return;

				const thisDist = math.min(partMaxSize, totalDist - i);
				const beam = beams[nextBeam++];
				const position = origin.add(direction.mul(i + thisDist / 2));

				beam.Size = new Vector3(thisDist, viewSize.Y, viewSize.X);
				beam.CFrame = CFrame.lookAlong(position, direction).mul(beamRotation);
				if (beam.Color !== color) {
					beam.Color = color;
				}
				if (beam.Parent !== beamFolder) {
					beam.Parent = beamFolder;
				}
			}
		};

		this.event.subscribe(RunService.PreRender, () => {
			if (!needsRedraw) return;
			needsRedraw = false;

			nextBeam = 0;
			if (lastVisibility) {
				for (const index of ioNumbers) {
					const origin = lineOrigins[index - 1];
					if (origin === undefined) continue;
					drawBeamBetween(origin, lineEnds[index - 1], beamColors[index - 1]);
				}
			}
			for (let i = nextBeam; i < prevNextBeam; i++) {
				beams[i].Parent = undefined;
			}
			prevNextBeam = nextBeam;
		});
	}
}

export const AESARadar = {
	...BlockCreation.defaults,
	id: "aesaradar",
	displayName: "AESA Radar",
	description: "Invisible 3D lasers",

	logic: { definition, ctor: Logic },
	search: { partialAliases: ["search", "pesa"] },
} as const satisfies BlockBuilder;
