import { Workspace } from "@rbxts/services";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const absoluteMaxDistance = 36000;

const definition = {
	input: {
		alwaysEnabled: {
			displayName: "Laser always enabled",
			types: {
				bool: {
					config: false as boolean,
				},
			},
		},
		maxDistance: {
			displayName: "Max distance",
			types: {
				number: {
					config: 2048 as number,
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
					config: 0.9 as number,
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

export type { Logic as LaserBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const dotSize = 0.3;

		const ray = this.instance.FindFirstChild("Ray") as BasePart | undefined;
		if (!ray) {
			warn(`Ray of laser is nil`);
			this.disableAndBurn();
			return;
		}
		const rayBeams: BasePart[] = [ray];

		ray.Anchored = true;

		const dot = this.instance.FindFirstChild("Dot") as BasePart | undefined;
		if (!dot) {
			warn(`Dot of laser is nil`);
			this.disableAndBurn();
			return;
		}

		dot.Anchored = true;
		dot.Size = new Vector3(dotSize, dotSize, dotSize);

		const count = math.ceil(absoluteMaxDistance / 2048 - 1);
		for (let i = 1; i <= count; i++) {
			const rayClone = ray.Clone();
			rayClone.Name += i;
			rayBeams.push(rayClone);
		}

		this.onDisable(() => {
			for (const r of rayBeams) {
				r.Destroy();
			}
			dot.Destroy();
		});

		const raycastParams = new RaycastParams();
		raycastParams.FilterDescendantsInstances = [this.instance];
		raycastParams.FilterType = Enum.RaycastFilterType.Exclude;

		this.onk(["rayColor"], ({ rayColor }) => {
			for (const r of rayBeams) {
				r.Color = rayColor;
			}
		});
		this.onk(["dotColor"], ({ dotColor }) => (dot.Color = dotColor));

		this.onAlwaysInputs(({ maxDistance, alwaysEnabled, rayTransparency }) => {
			const raycastOrigin = this.instance.GetPivot().Position;
			const raycastDirection = this.instance.GetPivot().UpVector.mul(maxDistance);

			const raycastResult = Workspace.Raycast(raycastOrigin, raycastDirection, raycastParams);
			const distance = raycastResult?.Distance ?? maxDistance;
			const endpos = raycastOrigin.add(this.instance.GetPivot().UpVector.mul(distance));

			this.output.targetColor.set(
				"vector3",
				raycastResult?.Instance?.Color
					? new Vector3(
							raycastResult?.Instance?.Color.R * 255,
							raycastResult?.Instance?.Color.G * 255,
							raycastResult?.Instance?.Color.B * 255,
						)
					: Vector3.zero,
			);

			this.output.distance.set("number", raycastResult?.Distance ?? -1);

			const setRayBeam = () => {
				for (const [i, iRay] of ipairs(rayBeams)) {
					const remainder = distance % 2048;
					const indexSize = (i - 1) * 2048;
					if (indexSize > distance) {
						iRay.Transparency = 1;
						iRay.Parent = undefined;
						continue;
					}
					iRay.Transparency = rayTransparency;
					iRay.CFrame = new CFrame(raycastOrigin, endpos).mul(CFrame.Angles(0, math.rad(90), 0));

					iRay.Parent = this.instance;
					if (indexSize + remainder === distance) {
						iRay.Size = new Vector3(remainder, 0.1, 0.1);
						iRay.CFrame = iRay.CFrame.mul(new CFrame(indexSize + remainder / 2, 0, 0));
						continue;
					}
					iRay.Size = new Vector3(2048, 0.1, 0.1);
					iRay.CFrame = iRay.CFrame.mul(new CFrame(indexSize + 1024, 0, 0));
				}
			};

			if (raycastResult?.Distance !== undefined || alwaysEnabled) {
				setRayBeam();
				dot.Transparency = rayTransparency;
				dot.CFrame = CFrame.lookAlong(endpos, raycastDirection);
			} else {
				ray.Transparency = 1;
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
	search: { partialAliases: ["sensor"] },
} as const satisfies BlockBuilder;
