import { A2SRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";
import { BlockManager } from "shared/building/BlockManager";

type Piston = BlockModel & {
	readonly Top: Part & {
		readonly Beam: Beam;
	};
	readonly Bottom: Part & {
		PrismaticConstraint: PrismaticConstraint;
	};
	readonly ColBox: Part;
};

const definition = {
	input: {
		extend: {
			displayName: "Length",
			types: {
				number: {
					config: 0,
					clamp: {
						showAsSlider: false,
						min: 0,
						max: 10,
					},
					control: {
						config: {
							enabled: true,
							startValue: 0,
							mode: {
								type: "smooth",
								instant: {
									mode: "onRelease",
								},
								smooth: {
									speed: 2,
									mode: "stopOnRelease",
								},
							},
							keys: [
								{ key: "R", value: 10 },
								{ key: "F", value: 0 },
							],
						},
					},
				},
			},
		},
		maxforce: {
			displayName: "Max Force",
			tooltip: "The piston's maximum force as the piston attempts to reach its desired Speed",
			types: {
				number: {
					config: 5000,
					clamp: {
						min: 0,
						max: 20000,
						showAsSlider: true,
					},
				},
			},
		},
		responsiveness: {
			displayName: "Responsiveness",
			tooltip: "Specifies the sharpness of the piston in reaching the max length",
			types: {
				number: {
					config: 45,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 100,
						step: 0.01,
					},
				},
			},
			connectorHidden: true,
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export { Logic as PistonBlockLogic };
export class Logic extends InstanceBlockLogic<typeof definition, Piston> {
	static readonly events = {
		update: new A2SRemoteEvent<{
			readonly block: BlockModel;
			readonly speed: number;
			readonly position: number;
			readonly force: number;
		}>("piston_update"),
	} as const;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const blockScale = BlockManager.manager.scale.get(this.instance) ?? Vector3.one;

		this.on((ctx) => {
			const speed = 1000;

			this.instance.Bottom.PrismaticConstraint.Speed = speed;
			this.instance.Bottom.PrismaticConstraint.TargetPosition = ctx.extend;
			this.instance.Bottom.PrismaticConstraint.ServoMaxForce = ctx.maxforce * 100000;
			this.instance.Bottom.PrismaticConstraint.LinearResponsiveness = ctx.responsiveness;

			Logic.events.update.send({
				block: this.instance,
				force: ctx.maxforce,
				position: ctx.extend,
				speed: speed,
			});
		});

		this.onEnable(()=>{
			const beam = this.instance.Top.Beam;
			// default width of the beam at scale 1
			const default_width = 0.4;
			const scale = math.min(blockScale.X, blockScale.Z) * default_width;
			beam.Width0 = scale;
			beam.Width1 = scale;
		});

		this.onDisable(() => block.instance.FindFirstChild("Top")?.FindFirstChild("Beam")?.Destroy());
	}
}

export const PistonBlock = {
	...BlockCreation.defaults,
	id: "piston",
	displayName: "Piston",
	description: "No Pi jokes here. It just moves stuff..",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
