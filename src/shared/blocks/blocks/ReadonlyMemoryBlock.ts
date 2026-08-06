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
			displayName: "Byte Array",
			types: {
				bytearray: {
					config: [],
					lengthLimit: 4096,
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
			types: ["byte"],
		},
		output2: {
			displayName: "Output 2",
			types: ["byte"],
		},
		output3: {
			displayName: "Output 3",
			types: ["byte"],
		},
		output4: {
			displayName: "Output 4",
			types: ["byte"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as ReadonlyMemoryBlockLogic };
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs) {
		super(definition, block);

		const limit = definition.input.data.types.bytearray.lengthLimit;

		const readValue = (address: number, data: readonly number[]) => {
			// a wired address can be fractional, and a non-integer table index reads nil instead of the word
			const addr = math.floor(address);
			if (addr >= limit || addr < 0) {
				this.disableAndBurn();
				return;
			}

			this.output.output1.set("byte", data[addr] ?? 0);
			this.output.output2.set("byte", data[addr + 1] ?? 0);
			this.output.output3.set("byte", data[addr + 2] ?? 0);
			this.output.output4.set("byte", data[addr + 3] ?? 0);
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

export const ReadonlyMemoryBlock = {
	...BlockCreation.defaults,
	id: "readonlymemory",
	displayName: "ROM",
	description: "A programmable memory. Allows you to read values you've written in",
	search: { partialAliases: ["readonly memory"] },
	limit: 1,
	limitFamily: "rom",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
