import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { RemoteEvents } from "shared/RemoteEvents";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["delay", "delay_low", "isInverted", "isSinglePulse", "isInSeconds"],
	input: {
		delay: {
			//не переименовывал чтоб совметимость была
			displayName: "High Level Length",
			unit: "Tick",
			tooltip: `The amount of ticks that signal will be in high (true) state.`,
			types: {
				number: {
					config: 1,
				},
			},
		},
		delay_low: {
			displayName: "Low Level Length",
			unit: "Tick",
			tooltip: `The amount of ticks that signal will be in low (false) state.`,
			types: {
				number: {
					config: 1,
				},
			},
		},
		isInverted: {
			displayName: "Invert",
			tooltip: `Make signal inverted. True will be false and false will be true. Basically, switchable "NOT" gate.`,
			types: {
				bool: {
					config: false,
				},
			},
		},
		isSinglePulse: {
			displayName: "Single Pulse",
			tooltip: `Make the impulse generator output single tick impulses.`,
			types: {
				bool: {
					config: false,
				},
			},
		},
		isInSeconds: {
			displayName: "In Seconds",
			tooltip: `Make the delay count in seconds instead of ticks. Disables "Single Pulse" option.`,
			types: {
				bool: {
					config: false,
				},
			},
		},
	},
	output: {
		value: {
			displayName: "Output",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as ImpulseGeneratorBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		const flip = (isInverted: boolean) => {
			this.output.value.set("bool", lastState !== !isInverted);
			lastState = !lastState;
			isSecondsDelayDone = true;
		};

		const updateDelay = (highDelay: number, lowDelay: number, isInverted: boolean) => {
			if (lastState) delayTask = task.delay(highDelay, () => flip(isInverted));
			else delayTask = task.delay(lowDelay, () => flip(isInverted));
		};

		let lastState = false;
		let isSecondsDelayDone = true;
		let impulseProgress = -1;
		let delayTask: thread | undefined;
		this.onAlwaysInputs(({ delay, delay_low, isSinglePulse, isInverted, isInSeconds, isInSecondsChanged }) => {
			if (delay < 0 || delay_low < 0)
				if (this.instance) {
					RemoteEvents.Burn.send([this.instance.PrimaryPart as BasePart]);
					return;
				}

			if (delay + delay_low <= 0) return;

			if (!isInSeconds) {
				// if just turned on then cancel current delay
				if (isInSecondsChanged && delayTask) {
					task.cancel(delayTask);
					isSecondsDelayDone = true;
				}
			} else {
				//check if the delay is done
				if (isSecondsDelayDone) {
					isSecondsDelayDone = false;
					updateDelay(delay, delay_low, isInverted);
				}
				return;
			}

			const len = delay + delay_low;
			impulseProgress = ++impulseProgress % len;

			const res = impulseProgress < (isSinglePulse ? 1 : delay);
			this.output.value.set("bool", !res !== !isInverted); //xor (a.k.a. управляемая инверсия)
		});
	}
}

export const ImpulseGeneratorBlock = {
	...BlockCreation.defaults,
	id: "impulsegenerator",
	displayName: "Impulse Generator",
	description: "A signal generator. Generates meander (a fancy way of saying square-shaped signal).",
	search: {
		partialAliases: ["clock", "clk"],
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
