import { C2CRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { Colors } from "shared/Colors";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["enabled", "frequency", "range"],
	input: {
		enabled: {
			displayName: "Enabled",
			types: {
				bool: {
					config: false,
				},
			},
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
		detected: {
			displayName: "Detected",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as ProxyEmitterBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	static readonly sendEvent = new C2CRemoteEvent<{
		/* readonly frequency: number;
		readonly valueType: BlockLogicTypes.IdListOfType<typeof definition.input.value.types>;
		readonly value: BlockLogicTypes.TypeListOfType<typeof definition.input.value.types>; */
	}>("b_proxy_emitter_send", "RemoteEvent");

	private readonly colorFade = Color3.fromRGB(0, 0, 0);
	private readonly originalColor;

	constructor(block: BlockLogicArgs) {
		super(definition, block);

		const led = block.instance?.FindFirstChild("LED") as BasePart | undefined;
		this.originalColor = led?.Color ?? Colors.black;

		/* this.on(({ value, valueType, frequency }) => {
			this.blinkLed();
			Logic.sendEvent.send({ frequency, value, valueType });
		}); */
	}

	blinkLed() {
		const led = this.instance?.FindFirstChild("LED") as BasePart | undefined;
		if (!led) return;

		led.Color = this.colorFade;
		task.delay(0.1, () => (led.Color = this.originalColor));
	}
}

export const ProxyEmitterBlock = {
	...BlockCreation.defaults,
	id: "proxyemitter",
	displayName: "Proxy Emitter",
	description: "placeholder",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
