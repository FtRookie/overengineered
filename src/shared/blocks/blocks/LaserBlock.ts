import { Workspace } from "@rbxts/services";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

// the max distance the raycast can travel
const absoluteMaxDistance = 36000;

// the number of instances to make to cover the full distance
let beamInstanceCount = math.ceil(absoluteMaxDistance / 2048);
const rayMaxBounces = beamInstanceCount;

// tag for if a part reflects the laser
// DO NOT CHANGE
const mirrorTag = "Mirror_Reflective";

// if plots doesn't exist then theres a much bigger issue
const workspacePlots = Workspace.WaitForChild("Plots");

beamInstanceCount = math.max(beamInstanceCount, rayMaxBounces);
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
					config: true, // on by default
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

// returns if a block can reflect a laser
function isReflective(block: Instance): boolean {
	const part = block as Part;

	// must be a placed part
	if (!block.IsDescendantOf(workspacePlots)) return false;

	if (block.HasTag(mirrorTag)) return true;

	// glass material
	return part.Material === Enum.Material.Glass; // && (part.Transparency <= 0.35 || part.Transparency === 0.3);
}

function reflect(incomingVector: Vector3, normalVector: Vector3) {
	return incomingVector.sub(normalVector.mul(2 * incomingVector.Dot(normalVector)));
}

export class LaserBlockLogic extends InstanceBlockLogic<typeof definition, LaserModel> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const dotSize = 0.3;

		const ray = this.instance.Ray;
		ray.Transparency = 0.5;
		const dot = this.instance.Dot;
		const rayBeams: BasePart[] = [ray];
		dot.Size = Vector3.one.mul(dotSize);

		let nextBeam = 0;

		// it was getting to cluttered
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

		// makes a beam between 2 positions using the rayBeams
		function createBeamBetween(origin: Vector3, target: Vector3) {
			const totalDist = origin.sub(target).Magnitude;
			const direction = target.sub(origin).Unit;

			for (let i = 0; i < totalDist; i += 2048) {
				if (rayBeams.size() <= nextBeam) return;

				const thisDist = math.min(2048, totalDist - i);
				const ray = rayBeams[nextBeam++];
				const position = origin.add(direction.mul(i + thisDist / 2));

				ray.Size = new Vector3(thisDist, 0.1, 0.1);
				ray.CFrame = new CFrame(position, position.add(direction)).mul(CFrame.Angles(0, math.rad(90), 0));
				if (ray.Parent === undefined) {
					ray.Parent = laserFolder;
				}
			}
		}

		// amount of instances needed to cover the absolute max distance minus original ray
		for (let i = 1; i <= beamInstanceCount; i++) {
			const rayClone = ray.Clone();
			rayClone.Name += i;
			rayClone.CanCollide = false;
			rayClone.CanQuery = false;
			rayBeams.push(rayClone);
		}

		this.onDisable(() => {
			for (const ray of rayBeams) {
				ray.Destroy();
			}
		});

		this.onk(["rayColor"], ({ rayColor }) => {
			for (const r of rayBeams) {
				r.Color = rayColor;
			}
		});
		this.onk(["dotColor"], ({ dotColor }) => {
			dot.Color = dotColor;
		});

		this.onAlwaysInputs(({ maxDistance, alwaysEnabled, rayTransparency, enableReflections }) => {
			const thisPivot = this.instance.GetPivot();
			const raycastOrigin = thisPivot.Position;
			const raycastDirection = thisPivot.UpVector;

			let newOrigin = raycastOrigin;
			let newDirection = raycastDirection;
			const newParams = new RaycastParams();
			newParams.FilterDescendantsInstances = [this.instance];
			newParams.FilterType = Enum.RaycastFilterType.Exclude;

			let availDistance = math.min(maxDistance, absoluteMaxDistance);
			let totalDistance = 0;
			let lastResult: RaycastResult | undefined = undefined;

			const cachedBeams: Array<[Vector3, Vector3]> = [];

			let laserBounces = 0;
			nextBeam = 0;
			while (availDistance > 0) {
				const rayDir = newDirection.mul(availDistance);
				const raycastResult = Workspace.Raycast(newOrigin, rayDir, newParams);
				if (raycastResult) {
					const ray_hit = raycastResult.Position;
					const ray_block = raycastResult.Instance;
					const lightVector = ray_hit.sub(newOrigin).Unit;
					const reflected = reflect(lightVector, raycastResult.Normal);

					const distance = newOrigin.sub(ray_hit).Magnitude;

					// [debug] display bounces
					// moveDisplay(db_normals[laserBounces], ray_hit, reflected);

					// store beams for later
					cachedBeams.push([newOrigin, ray_hit]);

					lastResult = raycastResult;
					totalDistance += distance;

					// detect if should continue casting (if it reflects)
					if (enableReflections && isReflective(ray_block)) {
						// set new origin & direction
						newOrigin = ray_hit.add(reflected.Unit.mul(0.001));
						newDirection = reflected;
						if (laserBounces === 0) {
							// clear original exclude on first bounce
							newParams.FilterDescendantsInstances = [];
						}
						availDistance -= distance;
					} else {
						break;
					}
				} else {
					// ray did not hit
					const endpos = newOrigin.add(rayDir);
					if (availDistance > 0 && (laserBounces !== 0 || alwaysEnabled)) {
						// create beam still with max dist
						cachedBeams.push([newOrigin, endpos]);
					}
					newOrigin = endpos;
					lastResult = undefined;
					break;
				}
				laserBounces++;
				if (laserBounces >= rayMaxBounces) {
					totalDistance = -1;
					break;
				}
			}

			// create the actual beams
			for (const [origin, endpos] of cachedBeams) {
				createBeamBetween(origin, endpos);
			}

			// remove parent of any unused beams
			const beamCount = rayBeams.size();
			for (let i = nextBeam; i < beamCount; i++) {
				const beam = rayBeams[i];
				if (beam.Parent !== undefined) beam.Parent = undefined;
			}

			const endpos = lastResult?.Position || newOrigin;

			const color = lastResult?.Instance.Color;
			this.output.targetColor.set(
				"vector3",
				color ? new Vector3(color.R, color.G, color.B).mul(255) : Vector3.zero,
			);

			this.output.distance.set("number", lastResult?.Distance ? totalDistance : -1);

			if (lastResult?.Distance !== undefined || alwaysEnabled) {
				for (const r of rayBeams) {
					r.Transparency = rayTransparency;
				}
				dot.Transparency = rayTransparency;
				dot.CFrame = CFrame.lookAlong(endpos, newDirection);
			} else {
				for (const r of rayBeams) {
					r.Transparency = 1;
				}
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
	logic: { definition, ctor: LaserBlockLogic },
	search: { partialAliases: ["sensor", "beam"] },
} as const satisfies BlockBuilder;
