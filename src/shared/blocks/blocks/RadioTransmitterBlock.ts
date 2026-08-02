import { t } from "engine/shared/t";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { Colors } from "shared/Colors";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["value", "frequency"],
	input: {
		value: {
			displayName: "Input",
			types: BlockConfigDefinitions.any,
			group: "1",
		},
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
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type RadioValueTag = BlockLogicTypes.IdListOfType<typeof definition.input.value.types>;

/** One checker per value tag, so a receiver can confirm the payload's value matches the type it claims. */
export const radioValueCheckers: { readonly [k in RadioValueTag]: t.Type<unknown> } = {
	bool: t.boolean,
	number: t.number,
	vector3: t.vector3,
	string: t.string,
	byte: t.numberWithBounds(0, 255, 1),
	color: t.color,
	sound: t.interface({ id: t.string }),
} as const;

const sendEventType = t.interface({
	block: t.instance("Model").nominal("blockModel"),
	frequency: t.numberWithBounds(
		definition.input.frequency.types.number.clamp.min,
		definition.input.frequency.types.number.clamp.max,
	),
	valueType: t.union(
		t.const("bool"),
		t.const("number"),
		t.const("vector3"),
		t.const("string"),
		t.const("byte"),
		t.const("color"),
		t.const("sound"),
	),
	// `as` is compile-time only; whether the value matches `valueType` is a two-field constraint no single
	// field type can state, so receivers check it against radioValueCheckers before using it
	value: t.any.as<BlockLogicTypes.TypeListOfType<typeof definition.input.value.types>>(),
});
export type RadioSendData = t.Infer<typeof sendEventType>;

const events = {
	send: new BlockSynchronizer("b_radio_transmitter_send", sendEventType),
} as const;

export type { Logic as RadioTransmitterBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	static readonly events = events;

	private readonly colorFade = Color3.fromRGB(0, 0, 0);
	private readonly originalColor;

	constructor(block: BlockLogicArgs) {
		super(definition, block);

		const led = block.instance?.FindFirstChild("LED") as BasePart | undefined;
		this.originalColor = led?.Color ?? Colors.black;

		const instance = block.instance;
		this.on(({ value, valueType, frequency }) => {
			this.blinkLed();
			if (!instance) return;

			events.send.sendOrBurn({ block: instance, frequency, value, valueType }, this);
		});
	}

	blinkLed() {
		const led = this.instance?.FindFirstChild("LED") as BasePart | undefined;
		if (!led) return;

		led.Color = this.colorFade;
		task.delay(0.1, () => (led.Color = this.originalColor));
	}
}

export const RadioTransmitterBlock = {
	...BlockCreation.defaults,
	id: "radiotransmitter",
	displayName: "Radio Transmitter",
	description: "Transmits data over air for EVERYONE! True magic for a caveman!",

	logic: { definition, ctor: Logic, events },
} as const satisfies BlockBuilder;
