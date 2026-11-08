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

const profiling = RunService.IsStudio();

const ioNumbers = [1, 2, 3, 4] as const;

const absoluteMaxDistance = 15000;
const shapecastInterval = 1023; // Not 1024 because of some stupid precision errors
const spherecastMaxRadius = 256; // documented WorldRoot:Spherecast limit; an invalid radius throws
const maxConeSpreadTan = math.tan(math.rad(1));
// each cast starts one radius back from its step, so a step can only use what is left of the cast length
const maxStepCount = math.ceil(absoluteMaxDistance / (shapecastInterval - spherecastMaxRadius));
// a step's radius comes from its midpoint, so the last midpoint is the widest cast at max range
const widestCastDistance = absoluteMaxDistance * (1 - 0.5 / maxStepCount);
const minCastLength = 0.1; // windows too thin to fit the cone still cast
const minConeSteps = 3;
const maxFidelity = 8; // Fidelity is the minimum detection step count, capped here
const lostSightGraceTicks = 1; // a lost target keeps reporting its last position this many ticks

const coneAxis = Vector3.zAxis; // default boresight for input
const inputToBlockRotation = CFrame.Angles(math.rad(-90), 0, 0);
const coneCos = math.cos(math.rad(60)); // ~120° full cone
const coneSin = math.sin(math.rad(60));
// a boresight pointing exactly backwards has no unique rotation axis; any 180° turn off the default works
const boresightFlip = CFrame.fromAxisAngle(Vector3.xAxis, math.pi);
// a direction exactly opposite the boresight has no unique nearest cone edge; cross the least aligned basis
// axis so the result stays well conditioned whichever way the boresight points
const coneEdgeFallback = (axis: Vector3) => {
	const ax = math.abs(axis.X);
	const ay = math.abs(axis.Y);
	const az = math.abs(axis.Z);
	const basis = ax <= ay && ax <= az ? Vector3.xAxis : ay <= az ? Vector3.yAxis : Vector3.zAxis;

	return axis.mul(coneCos).add(axis.Cross(basis).Unit.mul(coneSin));
};

const definition = {
	inputOrder: [
		"maxDistance",
		"minDistance",
		"ignoreSelf",
		"visibility",
		"relativePositioning",
		"fidelity",
		"holdLostTarget",
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
		holdLostTarget: {
			displayName: "Hold Lost Target",
			tooltip: "Keeps last object tracked for 1 tick",
			types: { bool: { config: true } },
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
	Body: BasePart & {
		Beam1: Beam;
		Beam2: Beam;
		Beam3: Beam;
		Beam4: Beam;
	};
};

export type { Logic as AESARadarLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition, AESARadarModel> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const lineOrigins = new Array<Vector3 | undefined>(ioNumbers.size());
		const lineEnds = new Array<Vector3>(ioNumbers.size());
		const lineStartRadii = new Array<number>(ioNumbers.size());
		const lineEndRadii = new Array<number>(ioNumbers.size());
		const lastTargets = new Array<BasePart | undefined>(ioNumbers.size());
		const missedTicks = ioNumbers.map(() => 0);
		let lastVisibility = false;
		let needsRedraw = false;
		let fidelity = minConeSteps;
		let ignoreSelf = false;
		let holdLostTarget = true;

		const radarView = this.instance.RadarView;
		const baseRadius = math.min(radarView.Size.Y, radarView.Size.Z) / 2;
		// a scaled radar starts wider, so its spread shrinks to keep the widest cast at the limit
		const spreadTan = math.min(maxConeSpreadTan, (spherecastMaxRadius - baseRadius) / widestCastDistance);
		const radiusAt = (distance: number) => math.min(baseRadius + distance * spreadTan, spherecastMaxRadius);

		const body = this.instance.Body;
		// the own blocks folder is one filter entry because cast cost scales with the entry count, so the radar's
		// own model is detectable; a cast whose sphere starts outside this distance can never reach it
		const [boundsFrame, boundsSize] = this.instance.GetBoundingBox();
		const selfClearance = boundsFrame.Position.sub(body.Position).Magnitude + boundsSize.Magnitude / 2;

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
		this.onkFirstInputs(["holdLostTarget"], ({ holdLostTarget: value }) => (holdLostTarget = value));
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
			if (profiling) debug.profilebegin("AESA tick");
			const visibility = visibilityCache.tryGet() ?? false;
			if (visibility !== lastVisibility) {
				lastVisibility = visibility;
				needsRedraw = true;
			}

			if (filterDirty) {
				filterDirty = false;

				const filter = table.clone(otherPlotBlocks);
				if (!ignoreSelf && ownBlocksFolder) filter.push(ownBlocksFolder);
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
			const boresight = coneAxis;
			//nan check
			const scanAxis =
				boresight === Vector3.zero || boresight.Magnitude !== boresight.Magnitude ? coneAxis : boresight.Unit;
			// undefined means the boresight is still the default, so dir inputs need no swing onto it
			const alignDot = coneAxis.Dot(scanAxis);
			const boresightRotation =
				alignDot > 0.9999
					? undefined
					: alignDot < -0.9999
						? boresightFlip
						: CFrame.fromAxisAngle(coneAxis.Cross(scanAxis).Unit, math.acos(alignDot));
			const pivot = this.instance.GetPivot();
			const inputFrame = pivot.mul(inputToBlockRotation);
			const origin = body.Position;

			for (const index of ioNumbers) {
				const lineIndex = index - 1;
				const dirX = dirCaches[lineIndex].tryGet() ?? Vector3.zero;
				//nan check
				if (dirX === Vector3.zero || dirX.Magnitude !== dirX.Magnitude || maxDistance <= minDistance) {
					offOutputs[lineIndex].set("vector3", Vector3.zero);
					lastTargets[lineIndex] = undefined;
					if (lineOrigins[lineIndex] !== undefined) {
						lineOrigins[lineIndex] = undefined;
						needsRedraw = true;
					}
					continue;
				}

				// dir inputs are model-relative — aim and clamp in block space, then rotate into the world
				let localDir = dirX.Unit;
				if (boresightRotation) {
					localDir = boresightRotation.VectorToWorldSpace(localDir);
				}
				const dot = localDir.Dot(scanAxis);
				if (dot < coneCos) {
					const perp = localDir.sub(scanAxis.mul(dot));
					const perpMagnitude = perp.Magnitude;
					localDir =
						perpMagnitude > 0.0001
							? scanAxis.mul(coneCos).add(perp.mul(coneSin / perpMagnitude))
							: coneEdgeFallback(scanAxis);
				}
				const direction = inputFrame.VectorToWorldSpace(localDir);

				const startPos = origin.add(direction.mul(minDistance));
				const windowSize = maxDistance - minDistance;
				const stepCount = math.max(
					fidelity,
					math.ceil(windowSize / (shapecastInterval - radiusAt(maxDistance))),
				);
				const step = windowSize / stepCount;
				let result: RaycastResult | undefined;

				if (profiling) debug.profilebegin("AESA casts");
				for (let s = 0; s < stepCount; s++) {
					const stepStart = minDistance + s * step;
					const radius = radiusAt(stepStart + step / 2);
					// Spherecast ignores parts inside its starting sphere, so every cast but the first starts clear of
					// its step; the first stays pinned so nothing before minDistance is seen, the last so nothing after
					const from = math.max(s === 0 ? stepStart + radius : stepStart - radius, selfClearance + radius);
					const to = s === stepCount - 1 ? maxDistance - radius : stepStart + step;

					result = Workspace.Spherecast(
						origin.add(direction.mul(from)),
						radius,
						direction.mul(math.max(to - from, minCastLength)),
						params,
					);
					if (result) break;
				}
				if (profiling) debug.profileend();
				const traveled = result
					? math.clamp(result.Position.sub(origin).Dot(direction), minDistance, maxDistance)
					: maxDistance;

				const endPos = origin.add(direction.mul(traveled));
				let target: BasePart | undefined;
				if (result) {
					target = result.Instance;
					lastTargets[lineIndex] = target;
					missedTicks[lineIndex] = 0;
				} else if (
					holdLostTarget &&
					missedTicks[lineIndex] < lostSightGraceTicks &&
					lastTargets[lineIndex]?.Parent
				) {
					missedTicks[lineIndex]++;
					target = lastTargets[lineIndex];
				}

				if (target) {
					const targetPosition = target.GetPivot().Position;
					offOutputs[lineIndex].set(
						"vector3",
						relative ? pivot.PointToObjectSpace(targetPosition) : targetPosition.sub(pivot.Position),
					);
				} else {
					offOutputs[lineIndex].set("vector3", Vector3.zero);
				}
				if (lineOrigins[lineIndex] !== startPos || lineEnds[lineIndex] !== endPos) {
					lineOrigins[lineIndex] = startPos;
					lineEnds[lineIndex] = endPos;
					// cone radius at both drawn ends; the casts stay within about 10 studs of this
					lineStartRadii[lineIndex] = radiusAt(minDistance);
					lineEndRadii[lineIndex] = radiusAt(traveled);
					needsRedraw = true;
				}
			}
			if (profiling) debug.profileend();
		});

		if (!RunService.IsClient()) return;

		const beams = [body.Beam1, body.Beam2, body.Beam3, body.Beam4];
		const beamStarts = beams.map((beam) => beam.Attachment0!);
		const beamEnds = beams.map((beam) => beam.Attachment1!);

		this.onDisable(() => {
			for (const beam of beams) {
				beam.Enabled = false;
			}
		});

		this.event.subscribe(RunService.PreRender, () => {
			if (!needsRedraw) return;
			needsRedraw = false;

			for (const index of ioNumbers) {
				const lineIndex = index - 1;
				const beam = beams[lineIndex];
				const origin = lineOrigins[lineIndex];
				if (!lastVisibility || origin === undefined) {
					beam.Enabled = false;
					continue;
				}

				beamStarts[lineIndex].WorldPosition = origin;
				beamEnds[lineIndex].WorldPosition = lineEnds[lineIndex];
				beam.Width0 = lineStartRadii[lineIndex] * 2;
				beam.Width1 = lineEndRadii[lineIndex] * 2;
				beam.Enabled = true;
			}
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
