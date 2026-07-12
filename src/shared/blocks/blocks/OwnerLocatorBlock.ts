import { Players, RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";
import type { DistanceUnit, RadialUnit } from "shared/data/GameDefinitions";

const definition = {
	outputOrder: ["linear", "angular"],
	input: {
		ulinear: {
			displayName: "Distance Unit",
			types: {
				enum: {
					config: "studs",
					elementOrder: ["studs", "meters"],
					elements: {
						studs: { displayName: "Studs", tooltip: "The default unit of Roblox" },
						meters: { displayName: "Meters", tooltip: "100x the standard metric unit of length" },
						feet: { displayName: "Feet", tooltip: "About a third of a meter" },
						miles: { displayName: "Miles", tooltip: "5280 feet" },
					},
				},
			},
			connectorHidden: true,
		},
		uradial: {
			displayName: "Radial Unit",
			types: {
				enum: {
					config: "radian",
					elementOrder: ["radian", "degree"],
					elements: {
						radian: { displayName: "Radians", tooltip: "The default unit of 180°/π" },
						degree: { displayName: "Degrees", tooltip: "Degrees" },
					},
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		linear: {
			displayName: "Offset",
			unit: "Studs, relative",
			types: ["vector3"],
		},
		angular: {
			displayName: "Angular offset",
			unit: "Radians, relative",
			types: ["vector3"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as OwnerLocatorBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const linearUnitCache = this.initializeInputCache("ulinear");
		const radialUnitCache = this.initializeInputCache("uradial");

		this.event.subscribe(RunService.PostSimulation, () => {
			if (!this.instance.PrimaryPart) return;
			const linearUnit = linearUnitCache.get() as DistanceUnit;
			const radialUnit = radialUnitCache.get() as RadialUnit;
			if (!linearUnit || !radialUnit) return;

			const owner = Players.LocalPlayer;
			const playerPart = owner.Character?.FindFirstChild("HumanoidRootPart") as Part | undefined;
			if (!playerPart) return;

			const localPosition = this.instance
				.GetPivot()
				.mul(CFrame.Angles(-math.pi / 2, 0, math.pi / 2))
				.PointToObjectSpace(playerPart.Position);

			const xa = Vector3.yAxis.Angle(localPosition.mul(new Vector3(0, 1, 1)), Vector3.xAxis);
			const ya = Vector3.zAxis.Angle(localPosition.mul(new Vector3(1, 0, 1)), Vector3.yAxis);
			const za = Vector3.xAxis.Angle(localPosition.mul(new Vector3(1, 1, 0)), Vector3.zAxis);
			const comb = new Vector3(xa, ya, za);

			this.output.angular.set(
				"vector3",
				comb.apply((v) => v * GameDefinitions.RADIANS_TO[radialUnit]),
			);

			this.output.linear.set(
				"vector3",
				localPosition.apply((v) => v * GameDefinitions.STUDS_TO[linearUnit]),
			);
		});
	}
}

export const OwnerLocatorBlock = {
	...BlockCreation.defaults,
	id: "ownerlocator",
	displayName: "Owner Locator",
	description: "IT WILL FIND YOU",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
