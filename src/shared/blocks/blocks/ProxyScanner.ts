import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { Colors } from "shared/Colors";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
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
					config: 2048,
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

export type { Logic as ProxyScannerBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	private readonly colorFade = Color3.fromRGB(0, 0, 0);
	private readonly originalColor;

	constructor(block: BlockLogicArgs) {
		super(definition, block);

		const led = block.instance?.FindFirstChild("LED") as BasePart | undefined;
		this.originalColor = led?.Color ?? Colors.black;

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
	description: "placeholder",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
