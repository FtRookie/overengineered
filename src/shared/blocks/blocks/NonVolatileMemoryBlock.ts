import { Objects } from "engine/shared/fixes/Objects";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockConfigDefinitions } from "shared/blocks/BlockConfigDefinitions";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import type { RideToBuildModeSlotScheduler } from "client/modes/ride/RideToBuildModeSlotScheduler";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["set", "value", "defaultValue", "reset"],
	input: {
		set: {
			displayName: "Set",
			types: {
				bool: {
					config: false,
				},
			},
		},
		value: {
			displayName: "Value",
			types: BlockConfigDefinitions.any,
			group: "1",
		},
		defaultValue: {
			displayName: "Default value",
			types: BlockConfigDefinitions.any,
			group: "1",
			connectorHidden: true,
		},
		reset: {
			displayName: "Reset",
			tooltip: "Reset the value to the default one",
			types: BlockConfigDefinitions.bool,
			configHidden: true,
		},
	},
	output: {
		result: {
			displayName: "Result",
			types: Objects.keys(BlockConfigDefinitions.any),
			group: "1",
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as NonVolatileMemoryBlockLogic };
@injectable
class Logic extends BlockLogic<typeof definition> {
	constructor(block: BlockLogicArgs, @inject s: RideToBuildModeSlotScheduler) {
		super(definition, block);

		// get
		let storedValue = (
			BlockManager.manager.customData.get(block.instance!) as { storedValue?: unknown } | undefined
		)?.storedValue as BlockLogicTypes.TypeListOfType<typeof definition.input.value.types>;

		let dataType = (
			BlockManager.manager.customData.get(block.instance!) as
				| { dataType?: BlockLogicTypes.IdListOfType<typeof definition.input.value.types> | undefined }
				| undefined
		)?.dataType;

		// scheule a function to be executed after build mode load
		s.schedule((building, plot) => {
			building.updateCustomData({
				plot,
				datas: [
					{
						block: block.instance!,
						data: {
							...(BlockManager.manager.customData.get(block.instance!) ?? {}),
							storedValue,
							dataType,
						},
					},
				],
			});
		});

		this.onkFirstInputs([], () => {
			if (dataType !== undefined) this.output.result.set(dataType, storedValue);
		});

		this.onk(["defaultValue"], ({ defaultValue, defaultValueType, defaultValueChanged }) => {
			if (!defaultValueChanged) return;
			this.output.result.set(defaultValueType, defaultValue);
		});
		this.onk(["value", "set"], ({ value, valueType, set }) => {
			if (!set) return;
			dataType = valueType;
			this.output.result.set(valueType, (storedValue = value));
		});

		this.onk(["reset", "defaultValue"], ({ reset, resetChanged, defaultValue, defaultValueType }) => {
			if (resetChanged && reset) {
				this.output.result.set(defaultValueType, defaultValue);
			}
		});
	}
}

export const NonVolatileMemoryBlock = {
	...BlockCreation.defaults,
	id: "nonvolatilememory",
	displayName: "Non-Volitile Memory Cell",
	description: "Saves the given value. This value will be available even in new sessions and after mode switching.",

	logic: { definition, ctor: Logic },
	modelSource: {
		model: BlockCreation.Model.fAutoCreated("DoubleGenericLogicBlockPrefab", "NVMC"),
		category: () => BlockCreation.Categories.memory,
	},
	search: {
		partialAliases: ["nvmc", "memory", "nonvolatile"],
	},
	limit: 128,
} as const satisfies BlockBuilder;
