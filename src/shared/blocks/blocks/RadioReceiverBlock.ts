import { Objects } from "engine/shared/fixes/Objects";
import { t } from "engine/shared/t";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { radioValueCheckers, RadioTransmitterBlock } from "shared/blocks/blocks/RadioTransmitterBlock";
import { Colors } from "shared/Colors";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
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
	},
	output: {
		value: {
			displayName: "Output",
			types: Objects.keys(BlockConfigDefinitions.any),
			group: "1",
		},
	},
} satisfies BlockLogicFullBothDefinitions;

const allReceivers = new Map<number, Set<Logic>>();
RadioTransmitterBlock.logic.ctor.events.send.invoked.Connect(({ frequency, value, valueType }) => {
	// the tag and the value have to agree, which the payload type cannot state on its own
	if (!t.typeCheck(value, radioValueCheckers[valueType])) return;

	allReceivers.get(frequency)?.forEach((v) => {
		v.setOutput(valueType, value);
		v.blinkLed();
	});
});

export type { Logic as RadioReceiverBlockLogic };
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
			changeFrequency(frequency, prevFrequency);
			prevFrequency = frequency;
		});

		this.onDisable(() => allReceivers.get(prevFrequency)?.delete(this));
	}

	setOutput(
		valueType: BlockLogicTypes.IdListOfOutputType<typeof definition.output.value.types>,
		value: BlockLogicTypes.TypeListOfOutputType<typeof definition.output.value.types>,
	) {
		this.output.value.set(valueType, value);
	}

	blinkLed() {
		const led = this.instance?.FindFirstChild("LED") as BasePart | undefined;
		if (!led) return;

		led.Color = this.colorFade;
		task.delay(0.1, () => (led.Color = this.originalColor));
	}
}

export const RadioReceiverBlock = {
	...BlockCreation.defaults,
	id: "radioreceiver",
	displayName: "Radio Receiver",
	description: "Love is in the air? Wrong! Radio wave radia-tion!",

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fFromAssets("radioreceiver"),
		category: () => ["Logic", "Communication"],
	},
} as const satisfies BlockBuilder;
