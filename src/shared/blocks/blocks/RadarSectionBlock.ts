import { Players, RunService } from "@rbxts/services";
import { t } from "engine/shared/t";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { SharedPlots } from "shared/building/SharedPlots";
import { CustomRemotes } from "shared/Remotes";
import { TagUtils } from "shared/utils/TagUtils";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const profiling = RunService.IsStudio();

const definition = {
	inputOrder: [
		"maxDistance",
		"detectionSize",
		"visibility",
		"detectSelf",
		"relativePositioning",
		"minimalDistance",
		"holdLostTarget",
	],
	input: {
		maxDistance: {
			displayName: "Max Distance",
			tooltip: "Returns coordinates relative to this block instead of relative to global grid",
			unit: "Studs",
			types: {
				number: {
					config: 100,
					clamp: {
						showAsSlider: true,
						min: 1,
						max: 2048,
					},
				},
			},
		},
		detectionSize: {
			displayName: "Detection Area Size",
			types: {
				number: {
					config: 1,
					clamp: {
						showAsSlider: true,
						min: 1,
						max: 5,
					},
				},
			},
		},
		visibility: {
			displayName: "Detection Area Visibility",
			types: {
				bool: {
					config: false,
				},
			},
		},
		detectSelf: {
			displayName: "Detect Self",
			types: {
				bool: {
					config: true,
				},
			},
			connectorHidden: true,
		},
		relativePositioning: {
			displayName: "Object-Relative Output",
			types: {
				bool: {
					config: true,
				},
			},
		},
		minimalDistance: {
			displayName: "Minimal Detection Distance",
			types: {
				number: {
					config: 5,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 2048,
					},
				},
			},
		},
		holdLostTarget: {
			displayName: "Hold Lost Target",
			tooltip: "Keeps last object tracked for 1 tick",
			types: {
				bool: {
					config: true,
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		distance: {
			displayName: "Offset",
			types: ["vector3"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

const definitionRadial = {
	...definition,
	input: {
		...definition.input,
		maxDistance: {
			...definition.input.maxDistance,
			types: {
				number: {
					...definition.input.maxDistance.types.number,
					clamp: {
						...definition.input.maxDistance.types.number.clamp,
						max: definition.input.maxDistance.types.number.clamp.max * 0.5,
					},
				},
			},
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type RadarBlock = BlockModel & {
	readonly RadarView: BasePart | UnionOperation | MeshPart;
};

if (RunService.IsClient()) {
	const p = Players.LocalPlayer;
	CustomRemotes.modes.set.sent.Connect(({ mode }) => {
		if (mode === "ride") {
			const blocks = SharedPlots.instance.getPlotComponentByOwnerID(p.UserId).getBlocks();

			for (const b of blocks) {
				if (!b.PrimaryPart) continue;
				ownDetectablesSet.add(b.PrimaryPart);
			}
			return;
		}

		ownDetectablesSet.clear();
	});
}

const updateEventType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<RadarBlock>(),
	size: t.vector3,
	offset: t.cframe,
	position: t.vector3,
});

type UpdateData = t.Infer<typeof updateEventType>;

const events = {
	updateSize: new BlockSynchronizer(
		"b_radar_size_update",
		updateEventType, //useless comment just to calm down the text formatter
		({ block, size, offset, position }: UpdateData) => {
			block.RadarView.Size = size;
			block.RadarView.Position = position;
			block.RadarView.PivotOffset = offset;
		},
	),
} as const;

const ownDetectablesSet = new Set<BasePart>();
let radarBindCounter = 0;
const lostSightGraceTicks = 1; // a lost target keeps reporting its last position this many ticks

export type { Logic as RadarSectionBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition, RadarBlock> {
	constructor(
		def: typeof definition,
		block: InstanceBlockLogicArgs,
		sizeAndOffsetCalculator: (
			view: MeshPart | UnionOperation | BasePart,
			detectionSize: number,
			maxDistance: number,
		) => void,
	) {
		super(def, block);

		let updateTask: thread | undefined;
		let minDistance = 0;
		let lastTarget: BasePart | undefined;
		let missedTicks = 0;
		let holdLostTarget = true;
		this.onkFirstInputs(["holdLostTarget"], ({ holdLostTarget: value }) => (holdLostTarget = value));
		const view = this.instance.FindFirstChild("RadarView") as MeshPart | UnionOperation | BasePart;
		const metalPlate = this.instance.FindFirstChild("MetalBase") as BasePart;
		const renderBindName = `rs_radar_visibility_${radarBindCounter++}`;

		this.onk(["visibility"], ({ visibility }) => (view.Transparency = visibility ? 0.8 : 1));
		this.onk(["relativePositioning"], ({ relativePositioning }) => (this.isRelativePosition = relativePositioning));
		this.onk(["detectionSize", "maxDistance"], ({ detectionSize, maxDistance }) => {
			const pivo = metalPlate.GetPivot();
			view.Position = pivo.PointToWorldSpace(Vector3.xAxis.mul(maxDistance / 2 + 0.5));
			view.Size = view.Size.with(undefined, maxDistance);

			sizeAndOffsetCalculator(view, detectionSize, maxDistance);
			this.triggerDistanceListUpdate = true;
		});

		this.onAlwaysInputs(({ minimalDistance }) => (minDistance = minimalDistance));

		const selfDetect = this.initializeConfigCache("detectSelf");
		const onTouched = (part: BasePart) => {
			//just to NOT detect radar view things
			// probably pointless check
			// since it detects only colboxes anyway
			// ...or does it?
			// Hey, VSausage. Michael here.
			// Can the radar detect non-colboxes?
			if (part.HasTag(TagUtils.allTags.SPECIAL_RADARVIEW)) return;

			//just to NOT detect own blocks
			if (!selfDetect.get() && ownDetectablesSet.has(part)) return;

			if (!minDistance) return;

			this.allTouchedBlocks.add(part);
			this.triggerDistanceListUpdate = true;
		};
		this.event.subscribe(view.Touched, (part) => {
			if (profiling) debug.profilebegin("RadarTouchStart");
			onTouched(part);
			if (profiling) debug.profileend();
		});

		const onTouchEnded = (part: BasePart) => {
			this.allTouchedBlocks.delete(part);
			if (this.triggerDistanceListUpdate) return;
			this.triggerDistanceListUpdate = part === this.closestDetectedPart;
		};
		this.event.subscribe(view.TouchEnded, (part) => {
			if (profiling) debug.profilebegin("RadarTouchEnded");
			onTouchEnded(part);
			if (profiling) debug.profileend();
		});

		const setView = () => {
			const primary = this.instance.PrimaryPart;
			if (!primary) return;
			if (profiling) debug.profilebegin("RadarSetBeam");
			view.AssemblyLinearVelocity = Vector3.zero;
			view.AssemblyAngularVelocity = Vector3.zero;
			view.PivotTo(primary.CFrame);
			if (profiling) debug.profileend();
		};

		// For actual contacts
		this.event.subscribe(RunService.PreSimulation, () => {
			if (profiling) debug.profilebegin("RadarStepped");
			if (this.closestDetectedPart?.Parent === undefined || this.triggerDistanceListUpdate) {
				this.triggerDistanceListUpdate = false;

				this.closestDetectedPart = this.findClosestPart(minDistance);

				// Only needed with a target: without one, every frame rescans and would cancel it before it fires.
				if (updateTask) task.cancel(updateTask);
				updateTask = this.closestDetectedPart
					? task.delay(5, () => (this.triggerDistanceListUpdate = true))
					: undefined;
			}
			let target: BasePart | undefined;
			if (this.closestDetectedPart) {
				target = this.closestDetectedPart;
				lastTarget = target;
				missedTicks = 0;
			} else if (holdLostTarget && missedTicks < lostSightGraceTicks && lastTarget?.Parent) {
				missedTicks++;
				target = lastTarget;
			}
			this.output.distance.set("vector3", target ? this.getOffsetTo(target.GetPivot().Position) : Vector3.zero);
			setView();
			if (profiling) debug.profileend();
		});

		// For rendering (so people don't think it lags)
		this.onk(["visibility"], ({ visibility }) => {
			if (visibility) {
				RunService.BindToRenderStep(renderBindName, Enum.RenderPriority.Camera.Value, setView);
			} else {
				RunService.UnbindFromRenderStep(renderBindName);
			}
		});

		this.onDisable(() => {
			RunService.UnbindFromRenderStep(renderBindName);
			if (view) view.Transparency = 1;
			this.allTouchedBlocks.clear();
		});
	}

	private isRelativePosition = false;
	private triggerDistanceListUpdate: boolean = false;
	private closestDetectedPart: BasePart | undefined = undefined;
	private readonly allTouchedBlocks: Set<BasePart> = new Set<BasePart>();

	private getOffsetTo = (position: Vector3) => {
		const pivot = this.instance.GetPivot();
		if (this.isRelativePosition) return pivot.PointToObjectSpace(position);
		return position.sub(pivot.Position);
	};

	private findClosestPart(minDist: number) {
		if (profiling) debug.profilebegin("RadarSortingClosest");
		let smallestDistance = math.huge;
		let closestPart: BasePart | undefined;

		for (const bp of this.allTouchedBlocks) {
			const distance = this.getOffsetTo(bp.GetPivot().Position).Magnitude;

			if (distance < minDist) continue;
			if (distance > smallestDistance) continue;

			smallestDistance = distance;
			closestPart = bp;
		}
		if (profiling) debug.profileend();
		return closestPart;
	}
}

class RadialRadarLogic extends Logic {
	constructor(block: InstanceBlockLogicArgs) {
		const zeroOffset = new CFrame(0, 0, 0);
		super(definitionRadial, block, (view, detectionSize, maxDistance) => {
			events.updateSize.send({
				block: this.instance,
				size: new Vector3(maxDistance, maxDistance, maxDistance),
				offset: zeroOffset,
				position: this.instance.GetPivot().Position,
			});
		});
	}
}

class RadarSectionLogic extends Logic {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block, (view, detectionSize, maxDistance) => {
			const halvedMaxDist = maxDistance / 2;
			const ds = detectionSize * (detectionSize - math.sqrt(halvedMaxDist / (maxDistance + halvedMaxDist))) * 10;
			events.updateSize.send({
				block: this.instance,
				size: new Vector3(ds, view.Size.Y, ds),
				offset: new CFrame(0, -view.Size.Y / 2 - 0.4, 0),
				position: view.Position,
			});
		});
	}
}

export const RadarBlocks = [
	{
		...BlockCreation.defaults,
		id: "radarsection",
		displayName: "Radar Section",
		description: "Returns the position of the closest object in it's field of view",

		logic: { definition, ctor: RadarSectionLogic, events },
	},
	{
		...BlockCreation.defaults,
		id: "radialradar",
		displayName: "Radial Radar",
		description: "Returns the position of the closest object in it's spherical field of view",

		logic: { definition: definitionRadial, ctor: RadialRadarLogic, events },
	},
] as const satisfies BlockBuilder[];
