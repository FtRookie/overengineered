import { Players, RunService, Workspace } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { SharedPlots } from "shared/building/SharedPlots";
import { CustomRemotes } from "shared/Remotes";
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

const coneAxis = Vector3.yAxis; // dish boresight in block space
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
	RadarView: UnionOperation;
};

if (RunService.IsClient()) {
	const p = Players.LocalPlayer;
	CustomRemotes.modes.set.sent.Connect(({ mode }) => {
		if (mode === "ride") {
			const blocks = SharedPlots.instance.getPlotComponentByOwnerID(p.UserId).getBlocks();

			for (const b of blocks) {
				ownDetectablesSet.add(b);
			}
			return;
		}

		ownDetectablesSet.clear();
	});
}
// whole models, not PrimaryParts — non-primary parts must be excluded from the cast too
const ownDetectablesSet = new Set<BlockModel>();

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

		// RadarView is unwelded (model copied from RadarSection, whose logic re-pivots it manually),
		// so it stops tracking the block once ride mode unanchors it — derive the cast frame from the
		// pivot instead, with RadarView's offset captured while the block is still pristine
		const viewOffset = this.instance.GetPivot().Inverse().mul(this.instance.RadarView.CFrame);

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
		params.FilterType = Enum.RaycastFilterType.Exclude; // todo: convert this to include plot instances only
		const selfFilter: Instance[] = [this.instance];
		params.FilterDescendantsInstances = selfFilter;
		let filterIgnoresSelf = false;
		let filterOwnCount = -1;

		this.event.subscribe(RunService.PostSimulation, () => {
			const visibility = visibilityCache.tryGet() ?? false;
			if (visibility !== lastVisibility) {
				lastVisibility = visibility;
				needsRedraw = true;
			}

			const ignoreSelf = ignoreSelfCache.tryGet() ?? false;
			if (ignoreSelf !== filterIgnoresSelf || (ignoreSelf && ownDetectablesSet.size() !== filterOwnCount)) {
				filterIgnoresSelf = ignoreSelf;
				if (ignoreSelf) {
					filterOwnCount = ownDetectablesSet.size();
					const filter: Instance[] = [this.instance];
					for (const b of ownDetectablesSet) {
						filter.push(b);
					}
					params.FilterDescendantsInstances = filter;
				} else {
					params.FilterDescendantsInstances = selfFilter;
				}
			}

			const maxDistance = maxDistanceCache.tryGet() ?? 0;
			const minDistance = minDistanceCache.tryGet() ?? 0;
			const castFrame = this.instance.GetPivot().mul(viewOffset);
			const boresight = castFrame.UpVector;

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

				let direction = dirX.Unit;
				const dot = direction.Dot(boresight);
				if (dot < coneCos) {
					const perp = direction.sub(boresight.mul(dot)); // still not fixed
					const perpMagnitude = perp.Magnitude;
					direction =
						perpMagnitude > 0.0001
							? boresight.mul(coneCos).add(perp.mul(coneSin / perpMagnitude))
							: castFrame.VectorToWorldSpace(coneEdgeFallback);
				}
				let distanceLeft = dirX.Magnitude * (maxDistance - minDistance);
				let traveled = 0;
				let result: RaycastResult | undefined;

				castProxy.CFrame = castFrame;
				while (distanceLeft > 0) {
					const step = math.min(distanceLeft, shapecastInterval);
					result = Workspace.Shapecast(castProxy, direction.mul(step), params);
					if (result) {
						traveled += result.Distance;
						break;
					}
					distanceLeft -= step;
					if (distanceLeft <= 0) break;
					castProxy.CFrame = castProxy.CFrame.add(direction.mul(step));
				}
				distOutputs[lineIndex].set("number", result ? traveled : -1);
				if (result) {
					const output = result.Instance.Position.sub(
						new CFrame(dirX.mul(traveled)).mul(castProxy.CFrame).Position,
					);
					offOutputs[lineIndex].set("vector3", output);
				} else {
					distOutputs[lineIndex].unset();
					offOutputs[lineIndex].unset();
				}

				const origin = castFrame.Position;
				const endPos = origin.add(direction.mul(traveled));
				if (lineOrigins[lineIndex] !== origin || lineEnds[lineIndex] !== endPos) {
					lineOrigins[lineIndex] = origin;
					lineEnds[lineIndex] = endPos;
					needsRedraw = true;
				}
			}
		});

		if (!RunService.IsClient()) return;

		// fixme: should be a Studio asset
		const beamTemplate = new Instance("Part");
		beamTemplate.Name = "RadarBeam";
		beamTemplate.Anchored = true;
		beamTemplate.CanCollide = false;
		beamTemplate.CanQuery = false;
		beamTemplate.CanTouch = false;
		beamTemplate.CastShadow = false;
		beamTemplate.Material = Enum.Material.Neon;
		beamTemplate.Color = Color3.fromRGB(255, 255, 0);
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

		const drawBeamBetween = (origin: Vector3, target: Vector3, color: Color3) => {
			const totalDist = origin.sub(target).Magnitude;
			const direction = target.sub(origin).Unit;

			for (let i = 0; i < totalDist; i += partMaxSize) {
				if (beams.size() <= nextBeam) return;

				const thisDist = math.min(partMaxSize, totalDist - i);
				const beam = beams[nextBeam++];
				const position = origin.add(direction.mul(i + thisDist / 2));

				beam.Size = new Vector3(thisDist, 2, 2);
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
