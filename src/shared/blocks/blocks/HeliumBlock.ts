import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import { GameEnvironment } from "shared/data/GameEnvironment";
import { Physics } from "shared/Physics";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		density: {
			displayName: "Density",
			unit: "m/V",
			types: {
				number: {
					config: 0.17,
					clamp: {
						showAsSlider: true,
						min: 0.05,
						max: 2,
						step: 0.01,
					},
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type HeliumModel = BlockModel & {
	readonly Part: BasePart & {
		readonly VectorForce: VectorForce;
	};
};

export type { Logic as HeliumBlockLogic };

@injectable
class Logic extends InstanceBlockLogic<typeof definition, HeliumModel> {
	private readonly part;
	private readonly vectorForce;
	private airDensityConstant = 1.2 / GameEnvironment.EarthAirDensity;

	constructor(block: InstanceBlockLogicArgs, @tryInject playerData?: PlayerDataStorage) {
		super(definition, block);

		this.part = this.instance.Part;
		this.vectorForce = this.part.VectorForce;

		const blockScale = BlockManager.manager.scale.get(this.instance) ?? Vector3.one;
		const scale = blockScale.X * blockScale.Y * blockScale.Z;

		const densityCache = this.initializeInputCache("density");
		const f = () => {
			const density = densityCache.tryGet();
			if (!density) return;

			//tick works when block works
			const height = Physics.LocalHeight.fromGlobal(this.part.GetPivot().Y);
			const counterforce = Physics.GetGravityOnHeight(height) * this.part.Mass;
			this.vectorForce.Force = new Vector3(
				0,
				((Physics.GetAirDensityOnHeight(
					height,
					playerData?.config.get().environment.physics.airDensityMultiplier,
				) *
					this.airDensityConstant) /
					density) *
					counterforce *
					scale,
				0,
			);
		};

		this.event.subscribe(RunService.PostSimulation, f);
	}
}

export const HeliumBlock = {
	...BlockCreation.defaults,
	id: "heliumblock",
	displayName: "Helium",
	description: "I still have no idea how did they manage to pump helium into soap",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
