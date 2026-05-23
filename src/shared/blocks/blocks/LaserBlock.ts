import { Workspace } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { TagUtils } from "shared/utils/TagUtils";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const absoluteMaxDistance = 36000;

const workspacePlots = Workspace.WaitForChild("Plots");

const definition = {
	input: {
		alwaysEnabled: {
			displayName: "Laser always enabled",
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
			tooltip: "If reflections of the laser should be enabled",
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
	static readonly maxBeamCount = math.ceil(absoluteMaxDistance / 2048);

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
		const rayMaxBounces = Logic.maxBeamCount;

		const ray = this.instance.Ray;
		ray.Transparency = 0.5;
		const dot = this.instance.Dot;
		const rayBeams: BasePart[] = [ray];
		dot.Size = Vector3.one.mul(Logic.dotSize);

		let nextBeam = 0;

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

			for (let i = 0; i < totalDist; i += 2048) {
				if (rayBeams.size() <= nextBeam) return;

				const thisDist = math.min(2048, totalDist - i);
				const ray = rayBeams[nextBeam++];
				const position = origin.add(direction.mul(i + thisDist / 2));

				ray.Size = new Vector3(thisDist, 0.1, 0.1);
				ray.CFrame = CFrame.lookAlong(position, direction).mul(CFrame.Angles(0, math.rad(90), 0));
				if (ray.Parent !== laserFolder) {
					ray.Parent = laserFolder;
				}
			}
		};

		const newParams = new RaycastParams();
		newParams.FilterType = Enum.RaycastFilterType.Exclude;
		const selfFilter: Instance[] = [this.instance];
		const segmentOrigins: Vector3[] = [];
		const segmentEnds: Vector3[] = [];

		const pushSegment = (from: Vector3, to: Vector3) => {
			segmentOrigins.push(from);
			segmentEnds.push(to);
		};

		// out-variables written by castRay, read by the callback below
		let castResult: RaycastResult | undefined;
		let castTotalDist = 0;
		let castEndOrigin = Vector3.zero;
		let castEndDir = Vector3.zero;

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
				const rayDir = direction.mul(distanceLeft);
				const hit = Workspace.Raycast(origin.add(direction.mul(0.001)), rayDir, newParams);

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
					if (bounces === 0) newParams.FilterDescendantsInstances = [];
					origin = hitPos;
					direction = reflected;
					distanceLeft -= segmentDist;
					bounces++;

					if (bounces >= rayMaxBounces) {
						castTotalDist = -1;
						break;
					}
				} else {
					const missEnd = origin.add(rayDir);
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

		this.onAlwaysInputs(({ maxDistance, alwaysEnabled, rayTransparency, enableReflections }) => {
			const pivot = this.instance.GetPivot();
			newParams.FilterDescendantsInstances = selfFilter;
			table.clear(segmentOrigins);
			table.clear(segmentEnds);
			nextBeam = 0;

			castRay(
				pivot.Position,
				pivot.UpVector,
				math.min(maxDistance, absoluteMaxDistance),
				enableReflections,
				alwaysEnabled,
			);

			for (let i = 0; i < segmentOrigins.size(); i++) {
				drawBeamBetween(segmentOrigins[i], segmentEnds[i]);
			}

			for (let i = nextBeam; i < rayBeams.size(); i++) {
				rayBeams[i].Parent = undefined;
			}

			const hitColor = castResult?.Instance.Color;
			this.output.targetColor.set(
				"vector3",
				hitColor ? new Vector3(hitColor.R, hitColor.G, hitColor.B).mul(255) : Vector3.zero,
			);

			if (alwaysEnabled || castResult !== undefined) {
				for (let i = 0; i < nextBeam; i++) {
					rayBeams[i].Transparency = rayTransparency;
				}
				dot.Transparency = rayTransparency;
				dot.CFrame = CFrame.lookAlong(castResult?.Position ?? castEndOrigin, castEndDir);
			} else {
				dot.Transparency = 1;
			}

			this.output.distance.set("number", castResult !== undefined ? castTotalDist : -1);
		});
	}
}

export const LaserBlock = {
	...BlockCreation.defaults,
	id: "laser",
	displayName: "Laser pointer",
	description: "shoot beem boom target!",
	logic: { definition, ctor: Logic },
	search: { partialAliases: ["sensor", "beam"] },
} as const satisfies BlockBuilder;
