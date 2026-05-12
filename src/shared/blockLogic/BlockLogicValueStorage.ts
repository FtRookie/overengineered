import { MathUtils } from "engine/shared/fixes/MathUtils";
import { Strings } from "engine/shared/fixes/String.propmacro";
import type {
	BlockLogic,
	BlockLogicBothDefinitions,
	BlockLogicNoConfigDefinitionTypes,
	BlockLogicFullInputDef,
	BlockLogicTickContext,
} from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";

export type BlockLogicValueResults = (typeof BlockLogicValueResults)[keyof typeof BlockLogicValueResults];
export const BlockLogicValueResults = {
	/** Indicates that the value is not yet available, but will be later. Any block receiving this should defer its execution until available. */
	availableLater: "$BLOCKLOGIC_AVAILABLELATER",

	/** Indicates that the value is not available and never will be. Any block receiving this should disable and destroy itself. */
	garbage: "$BLOCKLOGIC_GARBAGE",
} as const;

const blockLogicValueResultsBackwards = asObject(new Set(asMap(BlockLogicValueResults).map((k, v) => v)));
export const isCustomBlockLogicValueResult = (value: unknown): value is BlockLogicValueResults =>
	typeIs(value, "string") && value in blockLogicValueResultsBackwards;

type Primitives = BlockLogicTypes.Primitives;
type PrimitiveKeys = keyof Primitives;

type MiniPrimitives = { readonly [k in PrimitiveKeys]: Omit<Primitives[k], "config" | "default"> };

//

type Filter<K extends PrimitiveKeys> = {
	readonly filter: (value: Primitives[K]["default"], definition: MiniPrimitives[K]) => Primitives[K]["default"];
};
type GenericFilter = Filter<PrimitiveKeys>;
const Filters: { readonly [k in PrimitiveKeys]?: Filter<k> } = {
	byte: {
		filter: (value) => {
			if (typeIs(value, "table")) {
				$warn("clamping a table", Strings.pretty(value ?? "NIL"));
			}

			return math.clamp(value, 0, 255);
		},
	},
	number: {
		filter: (value, definition) => {
			if (definition.clamp) {
				const clamp = definition.clamp;
				value = MathUtils.clamp(value, clamp.min, clamp.max, clamp.step);
			}

			return value;
		},
	},
};

type DefinitionTypes<TType extends PrimitiveKeys> =
	| Partial<BlockLogicNoConfigDefinitionTypes<TType>>
	| readonly TType[];
const filterValue = <TType extends PrimitiveKeys>(
	value: Primitives[TType]["default"],
	definitionTypes: DefinitionTypes<TType>,
	valueType: TType,
): Primitives[TType]["default"] => {
	const isArr = (types: typeof definitionTypes): types is readonly TType[] => 1 in types;
	if (isArr(definitionTypes)) {
		return filterValueArr(value, definitionTypes, valueType);
	}

	if (!definitionTypes[valueType]) {
		return value;
	}

	const filter = Filters[valueType] as GenericFilter | undefined;
	if (!filter) return value;

	return filter.filter(value, definitionTypes[valueType]!);
};
const filterValueArr = <TType extends PrimitiveKeys>(
	value: Primitives[TType]["default"],
	definitionTypes: readonly TType[],
	valueType: TType,
): Primitives[TType]["default"] => {
	if (!definitionTypes.includes(valueType)) {
		return value;
	}

	const filter = Filters[valueType] as GenericFilter | undefined;
	if (!filter) return value;

	return filter.filter(value, {});
};

//

export type TypedLogicValue<TTypes extends PrimitiveKeys> = {
	readonly value: Primitives[TTypes]["default"] & defined;
	readonly type: TTypes;
	readonly changedSinceLastTick: boolean;
};

export type ReadonlyLogicValueStorage<TTypes extends PrimitiveKeys> = {
	get(ctx: BlockLogicTickContext): TypedLogicValue<TTypes> | BlockLogicValueResults;
};
export type WriteonlyLogicValueStorage<TTypes extends PrimitiveKeys> = {
	set<TType extends TTypes & PrimitiveKeys>(valueType: TType, value: Primitives[TType]["default"]): void;
};
export type ILogicValueStorage<TTypes extends PrimitiveKeys> = ReadonlyLogicValueStorage<TTypes> &
	WriteonlyLogicValueStorage<TTypes>;

/** Storage for a value of a block logic. Automatically filters the value based on the type. */
export class LogicValueStorageContainer<TType extends PrimitiveKeys>
	implements ReadonlyLogicValueStorage<TType>, WriteonlyLogicValueStorage<TType>
{
	private value?: Omit<TypedLogicValue<TType>, "changedSinceLastTick">;
	private lastChangeTick?: number;
	private changedThisTick = false;
	private wasChanged = false;

	constructor(private readonly definitions: DefinitionTypes<TType>) {}

	get(ctx: BlockLogicTickContext): TypedLogicValue<TType> | BlockLogicValueResults {
		if (!this.value) {
			return BlockLogicValueResults.availableLater;
		}

		if (this.changedThisTick) {
			this.changedThisTick = false;
			this.lastChangeTick = ctx.tick;
		}

		return {
			value: this.value.value,
			type: this.value.type,
			changedSinceLastTick: ctx.tick === this.lastChangeTick,
		};
	}
	unset(): void {
		this.changedThisTick = true;
		this.wasChanged = true;

		this.value = undefined;
	}
	set<TType2 extends TType>(valueType: TType2, value: Primitives[TType2]["default"]): void {
		this.changedThisTick = true;
		this.wasChanged = true;

		value = filterValue(value, this.definitions, valueType);
		this.value = {
			type: valueType,
			value,
		};
	}

	/** Returns the currently stored value or throws if there's none yet. Use only inside BlockLogic. */
	justGet(): typeof this.value & defined {
		if (this.value === undefined) {
			throw "Trying to get an unset cached output " + this.wasChanged + "\n" + debug.traceback();
		}

		return this.value;
	}
	/** Returns the currently stored value. Use only inside BlockLogic. */
	tryJustGet(): typeof this.value {
		return this.value;
	}
}

/** Storage for a value of a block logic that gets its value from another block output. Automatically filters the value based on the type. */
export class BlockBackedInputLogicValueStorage<
	TType extends PrimitiveKeys,
> implements ReadonlyLogicValueStorage<TType> {
	constructor(
		private readonly inputDefinitions: BlockLogicFullInputDef,
		private readonly outputBlock: BlockLogic<BlockLogicBothDefinitions>,
		private readonly key: string,
	) {}

	get(ctx: BlockLogicTickContext): TypedLogicValue<TType> | BlockLogicValueResults {
		const result = this.outputBlock.getOutputValue(ctx, this.key);
		if (isCustomBlockLogicValueResult(result)) {
			return result;
		}

		let filtered = filterValueArr(result.value, this.outputBlock.definition.output[this.key].types, result.type);
		filtered = filterValue(result.value, this.inputDefinitions.types, result.type);

		return {
			type: result.type,
			value: filtered,
			changedSinceLastTick: result.changedSinceLastTick,
		} as TypedLogicValue<TType>;
	}
}

export const UnsetBlockLogicValueStorage: ReadonlyLogicValueStorage<PrimitiveKeys> = {
	get(): BlockLogicValueResults {
		return BlockLogicValueResults.garbage;
	},
};

//

const NewPrimitiveLogicValueStorage = <TType extends PrimitiveKeys>(valueType: TType) => {
	return class extends LogicValueStorageContainer<TType> {
		constructor(config: Primitives[TType]["config"], definition: OmitOverUnion<Primitives[TType], "default">) {
			super({ [valueType]: definition } as unknown as BlockLogicNoConfigDefinitionTypes<TType>);
			this.set(valueType, config);
		}
	};
};

type ConfigBackedLogicValueStorage<TType extends PrimitiveKeys> = ReadonlyLogicValueStorage<TType>;
type ConfigBackedLogicValueStorageCtor<TType extends PrimitiveKeys> = new (
	config: Primitives[TType]["config"],
	definition: OmitOverUnion<Primitives[TType], "default">,
) => ConfigBackedLogicValueStorage<TType>;
export const LogicValueStorages: {
	readonly [k in Exclude<PrimitiveKeys, "wire" | "unset">]: ConfigBackedLogicValueStorageCtor<k>;
} = {
	number: NewPrimitiveLogicValueStorage("number"),
	bool: NewPrimitiveLogicValueStorage("bool"),
	key: NewPrimitiveLogicValueStorage("key"),
	vector3: NewPrimitiveLogicValueStorage("vector3"),
	string: NewPrimitiveLogicValueStorage("string"),
	color: NewPrimitiveLogicValueStorage("color"),
	byte: NewPrimitiveLogicValueStorage("byte"),
	bytearray: NewPrimitiveLogicValueStorage("bytearray"),
	code: NewPrimitiveLogicValueStorage("code"),
	enum: NewPrimitiveLogicValueStorage("enum"),
	sound: NewPrimitiveLogicValueStorage("sound"),
	particle: NewPrimitiveLogicValueStorage("particle"),
};
