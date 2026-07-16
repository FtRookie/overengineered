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
		// craft-relative up for every lookAlong: beams are cone-limited to 60° off the boresight, so
		// they never align with it (world-Y up would go degenerate on vertical beams)
		let beamUpWorld = Vector3.yAxis;
		let lastVisibility = false;
		let needsRedraw = false;

		// Shapecast casts from the part's own CFrame with a 1024 stud limit; RadarView is an invisible
		// anchored template, and this detached clone of it advances along the beam between casts
		const castProxy = this.instance.RadarView.Clone();
		castProxy.Name = "RadarCastProxy"; // a second "RadarView" child would shadow the typed one
		castProxy.ClearAllChildren();
		castProxy.Transparency = 1;
		castProxy.Parent = this.instance;
		this.onDisable(() => castProxy.Destroy());
		// the cylinder casts lengthwise, nose-first — its X (length) axis runs along the beam
		const proxyDepth = castProxy.Size.X;

		const body = this.instance.Body;

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

		this.onTicc(() => {
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
			beamUpWorld = inputFrame.YVector;
			const origin = body.Position;

			for (const index of ioNumbers) {
				const lineIndex = index - 1;
				const dirX = dirCaches[lineIndex].tryGet() ?? Vector3.zero;
				//nan check
				if (dirX === Vector3.zero || dirX.Magnitude !== dirX.Magnitude || maxDistance <= minDistance) {
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

				// detection window is [minDistance, maxDistance]; dir is normalized, its magnitude carries no meaning
				const startPos = origin.add(direction.mul(minDistance));
				// start the shape fully ahead of the window start and stop its travel early,
				// so the swept volume covers exactly the window
				let distanceLeft = maxDistance - minDistance - proxyDepth;
				let traveled = 0;
				let result: RaycastResult | undefined;

				// beamRotation points the cylinder's X (length) axis down the beam, same as the beam visuals
				castProxy.CFrame = CFrame.lookAlong(
					startPos.add(direction.mul(proxyDepth / 2)),
					direction,
					beamUpWorld,
				).mul(beamRotation);
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
				if (!result) traveled = maxDistance;

				const endPos = origin.add(direction.mul(traveled));
				if (result) {
					distOutputs[lineIndex].set("number", traveled);
					// beam space: X = right of the beam, Y = up, Z = further along the beam
					// (the proxy frame maps mesh X along the beam, Y up, Z right)
					const off = castProxy.CFrame.VectorToObjectSpace(result.Instance.Position.sub(endPos));
					offOutputs[lineIndex].set("vector3", new Vector3(off.Z, off.Y, off.X));
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
		});

		if (!RunService.IsClient()) return;

		const beamTemplate = this.instance.RadarView.Clone();
		beamTemplate.Name = "RadarBeam";
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

				// beams share the proxy's orientation (X along the beam), so the cross-section is native
				beam.Size = new Vector3(thisDist, viewSize.Y, viewSize.Z);
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
	description: "Invisible 3D lasers, without a doubt the most complex block you will use",

	logic: { definition, ctor: Logic },
	search: { partialAliases: ["search", "pesa"] },
} as const satisfies BlockBuilder;
