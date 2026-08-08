import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

/** Reads shared by both widths; only the stored array and the output type differ. */
const sharedInput = {
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
} as const;

const order = {
	inputOrder: ["read", "address", "data"],
	outputOrder: ["size", "output1", "output2", "output3", "output4"],
} as const;

const definition8 = {
	...order,
	input: {
		...sharedInput,
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
		size: { displayName: "Size", types: ["number"] },
		output1: { displayName: "Output 1", types: ["byte"] },
		output2: { displayName: "Output 2", types: ["byte"] },
		output3: { displayName: "Output 3", types: ["byte"] },
		output4: { displayName: "Output 4", types: ["byte"] },
	},
} satisfies BlockLogicFullBothDefinitions;

const definition16 = {
	...order,
	input: {
		...sharedInput,
		data: {
			displayName: "Word Array",
			types: {
				bytearray: {
					config: [],
					lengthLimit: 2048,
					valueLimit: 0xffff,
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		size: { displayName: "Size", types: ["number"] },
		output1: { displayName: "Output 1", types: ["number"] },
		output2: { displayName: "Output 2", types: ["number"] },
		output3: { displayName: "Output 3", types: ["number"] },
		output4: { displayName: "Output 4", types: ["number"] },
	},
} satisfies BlockLogicFullBothDefinitions;

/** Undefined means the address is out of range and the block should burn. */
const resolveAddress = (address: number, limit: number): number | undefined => {
	// a wired address can be fractional, and a non-integer table index reads nil instead of the value
	const addr = math.floor(address);
	if (addr >= limit || addr < 0) return undefined;

	return addr;
};

export type { Logic8 as ReadonlyMemoryBlockLogic };
class Logic8 extends BlockLogic<typeof definition8> {
	constructor(block: BlockLogicArgs) {
		super(definition8, block);

		const limit = definition8.input.data.types.bytearray.lengthLimit;
		const outputs = [this.output.output1, this.output.output2, this.output.output3, this.output.output4] as const;

		this.onRecalcInputs(({ read, address, data, dataChanged }) => {
			if (dataChanged) {
				this.output.size.set("number", data.size());
			}

			if (!read) return;

			const addr = resolveAddress(address, limit);
			if (addr === undefined) {
				this.disableAndBurn();
				return;
			}

			for (let i = 0; i < outputs.size(); i++) {
				outputs[i].set("byte", data[addr + i] ?? 0);
			}
		});
	}
}

export type { Logic16 as ReadonlyMemoryBlock16Logic };
class Logic16 extends BlockLogic<typeof definition16> {
	constructor(block: BlockLogicArgs) {
		super(definition16, block);

		const limit = definition16.input.data.types.bytearray.lengthLimit;
		const outputs = [this.output.output1, this.output.output2, this.output.output3, this.output.output4] as const;

		this.onRecalcInputs(({ read, address, data, dataChanged }) => {
			if (dataChanged) {
				this.output.size.set("number", data.size());
			}

			if (!read) return;

			const addr = resolveAddress(address, limit);
			if (addr === undefined) {
				this.disableAndBurn();
				return;
			}

			for (let i = 0; i < outputs.size(); i++) {
				outputs[i].set("number", data[addr + i] ?? 0);
			}
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

	logic: { definition: definition8, ctor: Logic8 },
} as const satisfies BlockBuilder;

export const ReadonlyMemoryBlock16 = {
	...BlockCreation.defaults,
	id: "readonlymemory16",
	displayName: "ROM 16",
	description: "Regular ROM but cooler, allows to store up to 2048 16 bit values",
	search: { partialAliases: ["readonly memory"] },
	limit: 1,
	limitFamily: "rom",

	logic: { definition: definition16, ctor: Logic16 },
} as const satisfies BlockBuilder;
