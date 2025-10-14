import { RunService } from "@rbxts/services";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["frequency", "range"],
	input: {
		frequency: {
			displayName: "Frequency",
			types: {
				number: {
					config: 868,
					clamp: {
						showAsSlider: true,
						min: 434,
						max: 1500,
					},
				},
			},
		},
		range: {
			displayName: "Range",
			types: {
				number: {
					config: 50,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 2048,
					},
				},
			},
		},
	},
	output: {
		emitters: {
			displayName: "Emitters",
			types: ["number"],
		},
		detected: {
			displayName: "Detected",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

const allReceivers = new Map<number, Set<Logic>>();
/* ProxyEmitterBlock.logic.ctor.sendEvent.invoked.Connect(({ frequency, value, valueType }) => {
	allReceivers.get(frequency)?.forEach((v) => {
		v.setOutput(valueType, value);
		v.blinkLed();
	});
}); */

type proxyScanner = BlockModel & {
	Sphere: BasePart | UnionOperation | MeshPart;
};

export type { Logic as ProxyScannerBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, proxyScanner> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const sphere = this.instance.Sphere;

		const changeFrequency = (freq: number, prev: number) => {
			if (!allReceivers.get(freq)) {
				allReceivers.set(freq, new Set());
			}

			allReceivers.get(prev)?.delete(this);
			allReceivers.get(freq)?.add(this);
		};
		let prevFrequency = -1;
		this.on(({ frequency }) => {
			prevFrequency = frequency;
			changeFrequency(frequency, prevFrequency);
		});

		this.on(({ range }) => {
			if (!sphere) return;
			sphere.Size = Vector3.one.mul(range);
		});

		this.event.subscribe(RunService.Stepped, () => {
			sphere.AssemblyLinearVelocity = Vector3.zero;
			sphere.AssemblyAngularVelocity = Vector3.zero;
			sphere.PivotTo(this.instance.PrimaryPart!.CFrame);
		});

		this.onDisable(() => allReceivers.get(prevFrequency)?.delete(this));
	}

	// eslint-disable-next-line prettier/prettier
	setOutput(
		/* valueType: BlockLogicTypes.IdListOfOutputType<typeof definition.output.value.types>,
		value: BlockLogicTypes.TypeListOfOutputType<typeof definition.output.value.types>, */
	// eslint-disable-next-line prettier/prettier
	) {
		/* this.output.value.set(valueType, value); */
	}
}

export const ProxyScannerBlock = {
	...BlockCreation.defaults,
	id: "proxyscanner",
	displayName: "Proxy Scanner",
	description: "Outputs how many emitters of the same frequency it detects (also returns true/false)",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
