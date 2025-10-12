import { Objects } from "engine/shared/fixes/Objects";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["value", "enqueue", "dequeue", "clear"],
	outputOrder: ["result", "size"],
	input: {
		enqueue: {
			displayName: "Enqueue",
			types: {
				bool: {
					config: false,
				},
			},
			configHidden: true,
		},
		dequeue: {
			displayName: "Dequeue",
			types: {
				bool: {
					config: false,
				},
			},
			configHidden: true,
		},
		value: {
			displayName: "Input",
			types: BlockConfigDefinitions.any,
			group: "1",
		},
		clear: {
			displayName: "Clear",
			types: BlockConfigDefinitions.bool,
			configHidden: true,
		},
	},
	output: {
		size: {
			displayName: "Size",
			types: ["number"],
		},
		result: {
			displayName: "Output",
			types: Objects.keys(BlockConfigDefinitions.any),
			group: "1",
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export const size = 0xff;

export type { Logic as QueueMemoryBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		type PrimitiveValues = BlockLogicTypes.TypeListOfOutputType<typeof definition.output.result.types>;
		type PrimitiveKeys = BlockLogicTypes.IdListOfOutputType<typeof definition.output.result.types>;
		const internalMemory: { readonly value: PrimitiveValues; readonly type: PrimitiveKeys }[] = [];

		const enqueueValue = (value: PrimitiveValues, valueType: PrimitiveKeys) => {
			if (internalMemory.size() >= size) {
				this.disableAndBurn();
				return;
			}

			internalMemory.push({ value, type: valueType });
			this.output.size.set("number", internalMemory.size());
		};

		const dequeueValue = () => {
			const value = internalMemory.shift();
			if (value === undefined) {
				this.disableAndBurn();
				return;
			}

			this.output.result.set(value.type as never, value.value as never);
			this.output.size.set("number", internalMemory.size());
		};

		this.output.size.set("number", 0);
		this.onk(["dequeue"], ({ dequeue }) => {
			if (!dequeue) return;
			dequeueValue();
		});

		this.onk(["enqueue", "value"], ({ enqueue, value, valueType }) => {
			if (!enqueue) return;
			enqueueValue(value, valueType);
		});

		this.onk(["clear"], ({ clear, clearChanged }) => {
			if (clearChanged && clear) {
				internalMemory.clear();

				this.output.result.unset();
				this.output.size.set("number", internalMemory.size());
			}
		});
	}
}

export const QueueMemoryBlock = {
	...BlockCreation.defaults,
	id: "queuememory",
	displayName: "Queue",
	description: `Works like Stack, except values come out the bottom. Allows to store up to ${size + 1} values`,

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
