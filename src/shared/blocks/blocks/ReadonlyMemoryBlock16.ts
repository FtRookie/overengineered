import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["read", "address", "data"],
	outputOrder: ["size", "output1", "output2", "output3", "output4"],
	input: {
		read: {
			displayName: "Read",
			types: {
				bool: {
					config: false,
				},
			},
		},
		address: {
			displayName: "Address",
			types: {
				number: {
					config: 0,
				},
			},
		},
		data: {
			displayName: "Word Array",
			types: {
				wordarray: {
					config: [],
					lengthLimit: 2048,
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		size: {
			displayName: "Size",
			types: ["number"],
		},
		output1: {
			displayName: "Output 1",
			types: ["number"],
		},
		output2: {
			displayName: "Output 2",
			types: ["number"],
		},
		output3: {
			displayName: "Output 3",
			types: ["number"],
		},
		output4: {
			displayName: "Output 4",
			types: ["number"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as ReadonlyMemoryBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		const limit = definition.input.data.types.wordarray.lengthLimit;

		const readValue = (address: number, data: readonly number[]) => {
			const wordAddr = address;

			if (address >= limit || address < 0) {
				this.disableAndBurn();
				return;
			}

			this.output.output1.set("number", data[wordAddr] ?? 0);
			this.output.output2.set("number", data[wordAddr + 1] ?? 0);
			this.output.output3.set("number", data[wordAddr + 2] ?? 0);
			this.output.output4.set("number", data[wordAddr + 3] ?? 0);
		};

		this.onRecalcInputs(({ read, address, data, dataChanged }) => {
			if (dataChanged) {
				this.output.size.set("number", data.size());
			}

			if (!read) return;
			readValue(address, data);
		});
	}
}

export const ReadonlyMemoryBlock16 = {
	...BlockCreation.defaults,
	id: "readonlymemory16",
	displayName: "ROM 16",
	description: "Regular ROM but cooler, allow to store up to 65535 values",
	limit: 1,

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
