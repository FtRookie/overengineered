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
const castSpread = 5; // multiplied by initial radius as final radius
const minConeSteps = 3; // first + last always hit base/end radius, so the cone needs at least 3 facets; also the Fidelity floor
const maxFidelity = 8; // Fidelity is the detection step count directly, capped here
const beamRotation = CFrame.Angles(0, math.rad(90), 0);
const maxBeamCount = math.max(maxFidelity, math.ceil(absoluteMaxDistance / partMaxSize)) * ioNumbers.size();
const beamColors = [
	Color3.fromRGB(255, 64, 64),
	Color3.fromRGB(64, 255, 64),
	Color3.fromRGB(64, 128, 255),
	Color3.fromRGB(255, 255, 64),
] as const;

const coneAxis = Vector3.zAxis; // forward axis for input
const inputToBlockRotation = CFrame.Angles(math.rad(-90), 0, 0);
const coneCos = math.cos(math.rad(60)); // ~120° full cone
const coneSin = math.sin(math.rad(60));
// direction exactly opposite the boresight has no unique nearest cone edge; pick one
const coneEdgeFallback = coneAxis.mul(coneCos).add(new Vector3(coneSin, 0, 0));

const definition = {
	inputOrder: [
		"maxDistance",
		"minDistance",
		"ignoreSelf",
		"visibility",
		"relativePositioning",
		"fidelity",
		...ioNumbers.map((i) => `dir${i}`),
	],
	outputOrder: [...ioNumbers.map((i) => `off${i}`)],
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
		relativePositioning: {
			displayName: "Object-Relative Output",
			types: { bool: { config: false } },
		},
		fidelity: {
			displayName: "Cone Fidelity",
			types: {
				number: {
					config: minConeSteps,
					clamp: {
						min: minConeSteps,
						max: maxFidelity,
						step: 1,
						showAsSlider: true,
					},
				},
			},
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
		const lineEndRadii = new Array<number>(ioNumbers.size());
		let beamUpWorld = Vector3.yAxis;
		let lastVisibility = false;
		let needsRedraw = false;
		let fidelity = minConeSteps;
		let ignoreSelf = false;

		// Spherecast needs no proxy part. The cone widens from the dish radius (base) to castSpread× that at
		// the far end, approximated by growing the swept sphere per step. Casts cap at 1024 studs, so longer
		// beams advance the sphere in steps; each end is pinned by its own radius.
		const radarView = this.instance.RadarView;
		const baseRadius = math.min(radarView.Size.Y, radarView.Size.Z) / 2;
		const endRadius = baseRadius * castSpread;

		const body = this.instance.Body;

		const maxDistanceCache = this.initializeInputCache("maxDistance");
		const minDistanceCache = this.initializeInputCache("minDistance");
		const visibilityCache = this.initializeInputCache("visibility");
		const relativeCache = this.initializeInputCache("relativePositioning");
		const dirCaches = ioNumbers.map((i) => this.initializeInputCache(`dir${i}` as `dir${typeof i}`));
		const offOutputs = ioNumbers.map((i) => this.output[`off${i}` as `off${typeof i}`]);
		for (const out of offOutputs) out.set("vector3", Vector3.zero);

		let filterDirty = true;
		this.onkFirstInputs(["fidelity"], ({ fidelity: value }) => {
			fidelity = math.clamp(math.floor(value), minConeSteps, maxFidelity);
		});
		this.onkFirstInputs(["ignoreSelf"], ({ ignoreSelf: value }) => {
			ignoreSelf = value;
			filterDirty = true;
		});

		// plot blocks only — terrain and map are not detectable
		const params = new RaycastParams();
		params.FilterType = Enum.RaycastFilterType.Include;
		const ownBlocksFolder = this.instance.Parent;
		const otherPlotBlocks: Instance[] = [];
		for (const plot of SharedPlots.instance.plots) {
			const blocks = plot.instance.FindFirstChild("Blocks");
			if (blocks && blocks !== ownBlocksFolder) {
				otherPlotBlocks.push(blocks);
			}
		}

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

		this.onTicc(() => {
			const visibility = visibilityCache.tryGet() ?? false;
			if (visibility !== lastVisibility) {
				lastVisibility = visibility;
				needsRedraw = true;
			}

			if (filterDirty) {
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
			const relative = relativeCache.tryGet() ?? false;
			const pivot = this.instance.GetPivot();
			const inputFrame = pivot.mul(inputToBlockRotation);
			beamUpWorld = inputFrame.YVector;
			const origin = body.Position;

			for (const index of ioNumbers) {
				const lineIndex = index - 1;
				const dirX = dirCaches[lineIndex].tryGet() ?? Vector3.zero;
				//nan check
				if (dirX === Vector3.zero || dirX.Magnitude !== dirX.Magnitude || maxDistance <= minDistance) {
					offOutputs[lineIndex].set("vector3", Vector3.zero);
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

				// detection window is [minDistance, maxDistance]; dir is normalized
				const startPos = origin.add(direction.mul(minDistance));
				const windowSize = maxDistance - minDistance;
				// pin the cone by each end's radius: base sphere rear at minDistance, tip sphere front at maxDistance
				let distanceLeft = windowSize - baseRadius - endRadius;
				// windows too thin to fit the cone still cast once
				if (distanceLeft <= 0) distanceLeft = windowSize;
				let traveled = 0;
				let result: RaycastResult | undefined;

				// uniform steps in distance; radius lerps by step index so first == base, last == end exactly
				const stepCount = math.max(fidelity, math.ceil(distanceLeft / shapecastInterval));
				const step = distanceLeft / stepCount;
				const stepVec = direction.mul(step);
				let castCenter = startPos.add(direction.mul(baseRadius));
				for (let s = 0; s < stepCount; s++) {
					const radius = baseRadius + (endRadius - baseRadius) * (s / (stepCount - 1));
					result = Workspace.Spherecast(castCenter, radius, stepVec, params);
					if (result) {
						traveled = result.Position.sub(origin).Dot(direction);
						break;
					}
					castCenter = castCenter.add(stepVec);
				}
				if (!result) traveled = maxDistance;

				const endPos = origin.add(direction.mul(traveled));
				if (result) {
					const target = result.Instance.GetPivot();
					offOutputs[lineIndex].set(
						"vector3",
						relative ? pivot.ToObjectSpace(target).Position : target.Position.sub(pivot.Position),
					);
				} else {
					offOutputs[lineIndex].set("vector3", Vector3.zero);
				}
				if (lineOrigins[lineIndex] !== startPos || lineEnds[lineIndex] !== endPos) {
					lineOrigins[lineIndex] = startPos;
					lineEnds[lineIndex] = endPos;
					// cone radius at the drawn tip, so the visual tapers to match detection
					const tEnd = math.clamp((traveled - minDistance) / windowSize, 0, 1);
					lineEndRadii[lineIndex] = baseRadius + (endRadius - baseRadius) * tEnd;
					needsRedraw = true;
				}
			}
		});

		if (!RunService.IsClient()) return;

		const beamTemplate = this.instance.RadarView.Clone();
		beamTemplate.Name = "RadarBeam";
		beamTemplate.Material = Enum.Material.Neon;
		beamTemplate.Transparency = 0.5;

		const beamFolder = new Instance("Folder");
		beamFolder.Name = "radarBeams";
		beamFolder.Parent = this.instance;

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

		const drawBeamBetween = (origin: Vector3, target: Vector3, color: Color3, tipRadius: number) => {
			const totalDist = origin.sub(target).Magnitude;
			if (totalDist <= 0) return;
			const direction = target.sub(origin).Unit;
			// segments cap at partMaxSize but never fewer than fidelity, so the configured facet count is visible
			const segCount = math.max(fidelity, math.ceil(totalDist / partMaxSize));
			const segLen = totalDist / segCount;

			for (let s = 0; s < segCount; s++) {
				if (beams.size() <= nextBeam) return;

				const beam = beams[nextBeam++];
				const midDist = s * segLen + segLen / 2;
				const position = origin.add(direction.mul(midDist));

				// diameter lerps by segment index so first == base, last == tip, matching the detection cone
				const diameter = (baseRadius + (tipRadius - baseRadius) * (s / (segCount - 1))) * 2;
				beam.Size = new Vector3(segLen, diameter, diameter);
				beam.CFrame = CFrame.lookAlong(position, direction, beamUpWorld).mul(beamRotation);
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
					drawBeamBetween(origin, lineEnds[index - 1], beamColors[index - 1], lineEndRadii[index - 1]);
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
	description: "Invisible 3D lasers, without a doubt the most complex block you will use",

	logic: { definition, ctor: Logic },
	search: { partialAliases: ["search", "pesa"] },
} as const satisfies BlockBuilder;
