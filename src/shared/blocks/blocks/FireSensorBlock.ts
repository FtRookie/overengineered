import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";
import type { FireEffect } from "shared/effects/FireEffect";

const definition = {
	input: {
		detectionradius: {
			displayName: "Detection Radius",
			types: {
				number: {
					config: 20,
					clamp: {
						showAsSlider: true,
						min: 1,
						max: 300,
						step: 1,
					},
				},
			},
		},
	},
	output: {
		detected: {
			displayName: "Detected",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as FireSensorBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition> {
	private fireDuration: number = 0;

	constructor(block: InstanceBlockLogicArgs, @inject fireffect: FireEffect) {
		super(definition, block);

		const detectionRadiusCache = this.initializeInputCache("detectionradius");
		this.event.subscribe(fireffect.event.s2c.invoked, (args) => {
			const detectionRadius = detectionRadiusCache.tryGet();
			if (!detectionRadius) return;

			const dist = args.part?.GetPivot().Position.sub(this.instance.GetPivot().Position).Magnitude;
			if (!dist) return;
			if (dist > detectionRadius) return;
			if (this.fireDuration > (args.duration ?? 0)) return;

			this.fireDuration = args.duration ?? 0;
		});

		this.onTicc(({ dt }) => {
			if (this.fireDuration > 0) this.fireDuration -= dt;
			this.output.detected.set("bool", this.fireDuration > 0);
		});
		this.unsetOutputsOnDisable();
	}
}

export const FireSensorBlock = {
	...BlockCreation.defaults,
	id: "firesensor",
	displayName: "Fire Sensor",
	description: "Returns true if fire got detected",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
