import { RunService, Workspace } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { TagUtils } from "shared/utils/TagUtils";
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

export type { Logic as LaserBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, LaserModel> {
	static readonly dotSize = 0.3;
	static readonly maxBeamCount = math.ceil(absoluteMaxDistance / partMaxSize) - 1; // Sub original instance

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
		const rayMaxBounces = Logic.maxBeamCount + 1; // readd back cause funny

		const ray = this.instance.Ray;
		ray.Transparency = 0.5;
		const dot = this.instance.Dot;
		const rayBeams: BasePart[] = [ray];
		dot.Size = Vector3.one.mul(Logic.dotSize);

		let nextBeam = 0;
		// 1 because the original beam starts parented
		let prevNextBeam = 1;

		// it was getting too cluttered
		const laserFolder = new Instance("Folder");
		laserFolder.Name = "laserFolder";
		laserFolder.Parent = this.instance;

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

		for (let i = 1; i <= Logic.maxBeamCount; i++) {
			const rayClone = ray.Clone();
			rayClone.Name += i;
			rayClone.CanCollide = false;
			rayClone.CanQuery = false;
			rayBeams.push(rayClone);
		}

		this.onDisable(() => {
			for (const r of rayBeams) {
				r.Destroy();
			}
		});

		// Move beam instances into position
		const drawBeamBetween = (origin: Vector3, target: Vector3) => {
			const totalDist = origin.sub(target).Magnitude;
			const direction = target.sub(origin).Unit;

			for (let i = 0; i < totalDist; i += partMaxSize) {
				if (rayBeams.size() <= nextBeam) return;

				const thisDist = math.min(partMaxSize, totalDist - i);
				const ray = rayBeams[nextBeam++];
				const position = origin.add(direction.mul(i + thisDist / 2));

				ray.Size = new Vector3(thisDist, 0.1, 0.1);
				ray.CFrame = CFrame.lookAlong(position, direction).mul(beamRotation);
				if (ray.Parent !== laserFolder) {
					ray.Parent = laserFolder;
				}
			}
		};

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

		this.onk(["rayColor"], ({ rayColor }) => {
			for (const r of rayBeams) {
				r.Color = rayColor;
			}
		});
		this.onk(["dotColor"], ({ dotColor }) => {
			dot.Color = dotColor;
		});
		this.onk(["rayTransparency"], ({ rayTransparency }) => {
			for (const r of rayBeams) {
				r.Transparency = rayTransparency;
			}
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

			nextBeam = 0;
			for (let i = 0; i < segmentOrigins.size(); i++) {
				drawBeamBetween(segmentOrigins[i], segmentEnds[i]);
			}
			for (let i = nextBeam; i < prevNextBeam; i++) {
				rayBeams[i].Parent = undefined;
			}
			prevNextBeam = nextBeam;

			if (lastAlwaysEnabled || castResult !== undefined) {
				dot.Transparency = lastTransparency;
				dot.CFrame = CFrame.lookAlong(castResult?.Position ?? castEndOrigin, castEndDir);
			} else {
				dot.Transparency = 1;
			}
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
