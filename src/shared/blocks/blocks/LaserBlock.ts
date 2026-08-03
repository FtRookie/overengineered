import { RunService, Workspace } from "@rbxts/services";
import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { TagUtils } from "shared/utils/TagUtils";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const absoluteMaxDistance = 100000;

// never change
const partMaxSize = 2048;
const raycastInterval = 15000;
const beamRotation = CFrame.Angles(0, math.rad(90), 0);
const emptyFilter: Instance[] = [];

const workspacePlots = Workspace.WaitForChild("Plots");

const definition = {
	input: {
		alwaysEnabled: {
			displayName: "Always visible",
			types: {
				bool: {
					config: false,
				},
			},
		},
		maxDistance: {
			displayName: "Max distance",
			types: {
				number: {
					config: 2048,
					clamp: {
						showAsSlider: true,
						min: 0.1,
						max: absoluteMaxDistance,
					},
				},
			},
		},
		rayTransparency: {
			displayName: "Transparency",
			types: {
				number: {
					config: 0.9,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 1,
					},
				},
			},
		},
		rayColor: {
			displayName: "Ray color",
			types: {
				color: {
					config: Color3.fromRGB(255, 255, 255),
				},
			},
		},
		dotColor: {
			displayName: "Dot color",
			types: {
				color: {
					config: Color3.fromRGB(255, 255, 255),
				},
			},
			connectorHidden: true,
		},
		enableReflections: {
			displayName: "Enable Reflections",
			tooltip: `Limit of ${math.ceil(absoluteMaxDistance / partMaxSize) - 1} bounces`,
			types: {
				bool: {
					config: false,
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		distance: {
			displayName: "Distance",
			types: ["number"],
		},
		targetColor: {
			displayName: "Target Color",
			types: ["vector3"],
			tooltip: "Black color (0, 0, 0) by default and if nothing found",
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type LaserModel = BlockModel & {
	Ray: BasePart;
	Dot: BasePart;
};

const isReflective = (block: BasePart): boolean => {
	if (!block.IsDescendantOf(workspacePlots)) return false;
	if (block.HasTag(TagUtils.allTags.MIRROR_REFLECTIVE)) return true;
	return block.Material === Enum.Material.Glass; // && (part.Transparency <= 0.35 || part.Transparency === 0.3);
};

const reflect = (incomingVector: Vector3, normalVector: Vector3) => {
	return incomingVector.sub(normalVector.mul(2 * incomingVector.Dot(normalVector)));
};

const DOT_SIZE = 0.3;
const MAX_BEAM_COUNT = math.ceil(absoluteMaxDistance / partMaxSize) - 1;

/**
 * Beam pool and dot for one laser model. The owning client raycasts and draws through this; a spectator is handed
 * the finished geometry over the synchronizer and draws through the same code, so there is one implementation of
 * the beam placement rather than one per side.
 *
 * The model's own `Ray` is only the clone source, never drawn with and never destroyed: on a spectator it is a
 * replicated part, and destroying it locally would not come back.
 */
class LaserBeams {
	private readonly beams: BasePart[] = [];
	private readonly folder = new Instance("Folder");
	private readonly dot;
	private next = 0;
	private prevNext = 0;
	private lastRayColor?: Color3;
	private lastTransparency?: number;

	constructor(model: LaserModel) {
		const source = model.Ray;
		source.Transparency = 1;

		this.dot = model.Dot;
		this.dot.Size = Vector3.one.mul(DOT_SIZE);

		// it was getting too cluttered
		this.folder.Name = "laserFolder";
		this.folder.Parent = model;

		for (let i = 0; i <= MAX_BEAM_COUNT; i++) {
			const clone = source.Clone();
			clone.Name = `Ray${i}`;
			clone.CanCollide = false;
			clone.CanQuery = false;
			this.beams.push(clone);
		}
	}

	/** Written only on change: an unchanged colour is 49 boundary crossings for nothing. */
	setRayColor(color: Color3) {
		if (this.lastRayColor === color) return;

		this.lastRayColor = color;
		for (const beam of this.beams) {
			beam.Color = color;
		}
	}
	setDotColor(color: Color3) {
		this.dot.Color = color;
	}
	setTransparency(transparency: number) {
		if (this.lastTransparency === transparency) return;

		this.lastTransparency = transparency;
		for (const beam of this.beams) {
			beam.Transparency = transparency;
		}
	}

	private drawBetween(origin: Vector3, target: Vector3) {
		const totalDist = origin.sub(target).Magnitude;
		const direction = target.sub(origin).Unit;

		for (let i = 0; i < totalDist; i += partMaxSize) {
			if (this.beams.size() <= this.next) return;

			const thisDist = math.min(partMaxSize, totalDist - i);
			const beam = this.beams[this.next++];
			const position = origin.add(direction.mul(i + thisDist / 2));

			beam.Size = new Vector3(thisDist, 0.1, 0.1);
			beam.CFrame = CFrame.lookAlong(position, direction).mul(beamRotation);
			if (beam.Parent !== this.folder) {
				beam.Parent = this.folder;
			}
		}
	}

	/** Parallel arrays rather than points: the caster already builds them that way, per segment, every tick. */
	draw(origins: readonly Vector3[], ends: readonly Vector3[], showDot: boolean, dotAt: Vector3, dotDir: Vector3) {
		this.next = 0;
		for (let i = 0; i < origins.size(); i++) {
			this.drawBetween(origins[i], ends[i]);
		}

		// Only the prefix used last time can still be parented, so the rest is not worth touching.
		for (let i = this.next; i < this.prevNext; i++) {
			this.beams[i].Parent = undefined;
		}
		this.prevNext = this.next;

		this.dot.Transparency = showDot ? (this.lastTransparency ?? 1) : 1;
		if (showDot) this.dot.CFrame = CFrame.lookAlong(dotAt, dotDir);
	}

	destroy() {
		for (const beam of this.beams) {
			beam.Destroy();
		}

		this.folder.Destroy();
		this.dot.Transparency = 1;
	}
}

/** Minimum seconds between replicated updates. A laser on a moving machine changes every frame. */
const SEND_INTERVAL = 1 / 15;
/** Both ends of every segment, so the whole bounce chain fits with the first origin. */
const MAX_REPLICATED_POINTS = MAX_BEAM_COUNT + 2;

const pointList = t.array(t.vector3);
const updateDataType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<LaserModel>(),
	// Bounded in the checker rather than in the handler: an oversized list would otherwise be broadcast to
	// every client before anything looked at it.
	points: t.custom(
		(value): value is Vector3[] => t.typeCheck(value, pointList) && value.size() <= MAX_REPLICATED_POINTS,
	),
	showDot: t.boolean,
	dotAt: t.vector3,
	dotDir: t.vector3,
	transparency: t.numberWithBounds(0, 1),
	rayColor: t.color,
	dotColor: t.color,
});
type UpdateData = t.Infer<typeof updateDataType>;

/** Lasers this client owns. Their own logic draws every frame, so a replicated payload must not fight it. */
const locallyDriven = new Set<LaserModel>();
const spectated = new Map<LaserModel, LaserBeams>();
// One payload is handled at a time, so the expansion buffers are shared rather than per block.
const scratchOrigins: Vector3[] = [];
const scratchEnds: Vector3[] = [];

const update = ({ block, points, showDot, dotAt, dotDir, transparency, rayColor, dotColor }: UpdateData) => {
	if (locallyDriven.has(block)) return;
	if (!block.IsDescendantOf(Workspace)) return;

	let beams = spectated.get(block);
	if (!beams) {
		beams = new LaserBeams(block);
		spectated.set(block, beams);
		block.Destroying.Once(() => {
			spectated.get(block)?.destroy();
			spectated.delete(block);
		});
	}

	beams.setRayColor(rayColor);
	beams.setDotColor(dotColor);
	beams.setTransparency(transparency);

	table.clear(scratchOrigins);
	table.clear(scratchEnds);
	for (let i = 0; i + 1 < points.size(); i++) {
		scratchOrigins.push(points[i]);
		scratchEnds.push(points[i + 1]);
	}

	beams.draw(scratchOrigins, scratchEnds, showDot, dotAt, dotDir);
};

export type LaserBlockLogic = typeof Logic;

@injectable
class Logic extends InstanceBlockLogic<typeof definition, LaserModel> {
	static readonly events = {
		update: new BlockSynchronizer<UpdateData>("laser_update", updateDataType, update),
	} as const;

	constructor(block: InstanceBlockLogicArgs, @tryInject playerData?: PlayerDataStorage) {
		super(definition, block);
		const rayMaxBounces = MAX_BEAM_COUNT + 1; // readd back cause funny

		const beams = new LaserBeams(this.instance);

		/*
		// laser normal debug
		const db = new Instance("Part");
		db.Size = new Vector3(0.5, 0.5, 2);
		db.CanCollide = false;
		db.CanQuery = false;
		db.CanTouch = false;
		db.Transparency = 0.5;

		function moveDisplay(disp: Part, pos: Vector3, normal: Vector3) {
			disp.CFrame = new CFrame(pos, pos.add(normal)).add(normal.mul(disp.Size.Z / 2));
			disp.Parent = laserFolder;
		}

		const db_normals: Part[] = [];
		for (let i=0; i<30; i++) {
			db_normals.push(db.Clone());
		}*/

		locallyDriven.add(this.instance);
		this.onDisable(() => {
			locallyDriven.delete(this.instance);
			beams.destroy();
		});

		const newParams = new RaycastParams();
		newParams.FilterType = Enum.RaycastFilterType.Exclude;
		const selfFilter: Instance[] = [this.instance];
		newParams.FilterDescendantsInstances = selfFilter;
		const segmentOrigins: Vector3[] = [];
		const segmentEnds: Vector3[] = [];

		const pushSegment = (from: Vector3, to: Vector3) => {
			segmentOrigins.push(from);
			segmentEnds.push(to);
		};

		// out-variables written by castRay, read by the callback below
		let filterCleared = false;
		let castResult: RaycastResult | undefined;
		let castTotalDist = 0;
		let castEndOrigin = Vector3.zero;
		let castEndDir = Vector3.zero;

		let pendingSend = false;
		let lastSend = 0;
		let prevSegmentOrigins: Vector3[] = [];
		let prevSegmentEnds: Vector3[] = [];
		let prevHadResult = false;
		let lastAlwaysEnabled = false;
		let lastTransparency = 0;
		let needsRedraw = true;

		const castRay = (
			origin: Vector3,
			direction: Vector3,
			maxDist: number,
			enableReflections: boolean,
			alwaysEnabled: boolean,
		) => {
			castResult = undefined;
			castTotalDist = 0;
			let distanceLeft = maxDist;
			let bounces = 0;
			while (distanceLeft > 0) {
				const offset = direction.mul(0.001);
				let raycastRemaining = distanceLeft;

				let segmentStart = origin;
				let /** me */ hit: RaycastResult | undefined;

				// Raycast limit is 15,000 studs so it has to be segmented
				while (raycastRemaining > 0) {
					const rayDir = direction.mul(math.min(raycastRemaining, raycastInterval));
					hit = Workspace.Raycast(segmentStart.add(offset), rayDir, newParams);
					if (hit) break;
					raycastRemaining -= raycastInterval;
					segmentStart = segmentStart.add(rayDir);
				}

				if (hit) {
					const hitPos = hit.Position;
					const segmentDist = origin.sub(hitPos).Magnitude;

					pushSegment(origin, hitPos);
					castResult = hit;
					castTotalDist += segmentDist;

					if (!enableReflections || !isReflective(hit.Instance)) break;
					// [debug] display bounces
					// moveDisplay(db_normals[bounces], hitPos, undefined);
					const reflected = reflect(hitPos.sub(origin).Unit, hit.Normal);
					if (bounces === 0) {
						newParams.FilterDescendantsInstances = emptyFilter;
						filterCleared = true;
					}
					origin = hitPos;
					direction = reflected;
					distanceLeft -= segmentDist;
					bounces++;

					if (bounces >= rayMaxBounces) {
						castTotalDist = -1;
						break;
					}
				} else {
					const missEnd = segmentStart;
					if (bounces !== 0 || alwaysEnabled) pushSegment(origin, missEnd);
					origin = missEnd;
					castResult = undefined;
					break;
				}
			}

			castEndOrigin = origin;
			castEndDir = direction;
		};

		// Kept for the payload as well as the draw: every send carries complete state, so a joining player is
		// replayed the colours too rather than a beam in the template's default.
		let lastRayColor = Color3.fromRGB(255, 255, 255);
		let lastDotColor = lastRayColor;
		this.onk(["rayColor"], ({ rayColor }) => {
			lastRayColor = rayColor;
			beams.setRayColor(rayColor);
			pendingSend = true;
		});
		this.onk(["dotColor"], ({ dotColor }) => {
			lastDotColor = dotColor;
			beams.setDotColor(dotColor);
			pendingSend = true;
		});
		this.onk(["rayTransparency"], ({ rayTransparency }) => {
			beams.setTransparency(rayTransparency);
		});

		this.onAlwaysInputs(({ maxDistance, alwaysEnabled, rayTransparency, enableReflections }) => {
			table.clear(segmentOrigins);
			table.clear(segmentEnds);

			const pivot = this.instance.GetPivot();
			if (filterCleared) {
				newParams.FilterDescendantsInstances = selfFilter;
				filterCleared = false;
			}

			castRay(
				pivot.Position,
				pivot.UpVector,
				math.min(maxDistance, absoluteMaxDistance),
				enableReflections,
				alwaysEnabled,
			);

			// Only update visual if
			// A. alwaysEnabled
			// B. result changed
			let changed =
				alwaysEnabled !== lastAlwaysEnabled ||
				rayTransparency !== lastTransparency ||
				(castResult !== undefined) !== prevHadResult ||
				segmentOrigins.size() !== prevSegmentOrigins.size();
			if (!changed) {
				for (let i = 0; i < segmentOrigins.size(); i++) {
					if (segmentOrigins[i] !== prevSegmentOrigins[i] || segmentEnds[i] !== prevSegmentEnds[i]) {
						changed = true;
						break;
					}
				}
			}
			if (changed) {
				needsRedraw = true;
				pendingSend = true;
				prevHadResult = castResult !== undefined;
				lastAlwaysEnabled = alwaysEnabled;
				lastTransparency = rayTransparency;
				prevSegmentOrigins = table.clone(segmentOrigins);
				prevSegmentEnds = table.clone(segmentEnds);
			}

			const hitColor = castResult?.Instance.Color;
			this.output.targetColor.set("vector3", hitColor ? hitColor.toVector3() : Vector3.zero);
			this.output.distance.set("number", castResult !== undefined ? castTotalDist : -1);
		});

		if (!RunService.IsClient()) return;
		this.event.subscribe(RunService.PreRender, () => {
			if (!lastAlwaysEnabled && !needsRedraw) return;
			needsRedraw = false;

			beams.draw(
				segmentOrigins,
				segmentEnds,
				lastAlwaysEnabled || castResult !== undefined,
				castResult?.Position ?? castEndOrigin,
				castEndDir,
			);
		});

		// Rate-limited rather than per-tick: a laser on a moving machine changes every frame, and one send per
		// laser per frame is what makes this unaffordable. pendingSend survives the throttle, so whatever the
		// geometry settles on is always the last thing sent.
		this.event.subscribe(RunService.PostSimulation, () => {
			if (!pendingSend) return;

			const now = time();
			if (now - lastSend < SEND_INTERVAL) return;
			if (!playerData?.config.get().replication.publicLasers) return;

			lastSend = now;
			pendingSend = false;

			// Contiguous by construction: each bounce continues from the previous hit, so the segment pairs are
			// one polyline and only the ends need sending after the first origin.
			const points: Vector3[] = [];
			if (segmentOrigins.size() > 0) {
				points.push(segmentOrigins[0]);
				for (const to of segmentEnds) {
					points.push(to);
				}
			}

			// Burn rather than send: the server kicks on a failed type check, and a NaN reaching transparency
			// would take the player down with it.
			Logic.events.update.sendOrBurn(
				{
					block: this.instance,
					points,
					showDot: lastAlwaysEnabled || prevHadResult,
					dotAt: castResult?.Position ?? castEndOrigin,
					dotDir: castEndDir,
					transparency: lastTransparency,
					rayColor: lastRayColor,
					dotColor: lastDotColor,
				},
				this,
			);
		});
	}
}

export const LaserBlock = {
	...BlockCreation.defaults,
	id: "laser",
	displayName: "Laser pointer",
	description: "shoot beem boom target!",
	logic: { definition, ctor: Logic },
	search: { partialAliases: ["sensor", "beam", "range"] },
} as const satisfies BlockBuilder;
