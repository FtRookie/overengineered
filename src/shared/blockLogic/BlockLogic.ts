import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { ArgsSignal } from "engine/shared/event/Signal";
import { Objects } from "engine/shared/fixes/Objects";
import { BlockLogicValueResults } from "shared/blockLogic/BlockLogicValueStorage";
import {
	BlockBackedInputLogicValueStorage,
	isCustomBlockLogicValueResult,
	LogicValueStorages,
	UnsetBlockLogicValueStorage,
	LogicValueStorageContainer,
} from "shared/blockLogic/BlockLogicValueStorage";
import { RemoteEvents } from "shared/RemoteEvents";
import { PartUtils } from "shared/utils/PartUtils";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { ReadonlyLogicValueStorage, TypedLogicValue } from "shared/blockLogic/BlockLogicValueStorage";

type Primitives = BlockLogicTypes.Primitives;
type PrimitiveKeys = keyof Primitives;

export type BlockLogicWithConfigDefinitionTypes<TKeys extends PrimitiveKeys> = {
	readonly [k in TKeys]: OmitOverUnion<Primitives[k], "default">;
};

export type BlockLogicInputDef = {
	readonly displayName: string;
	readonly types: Partial<BlockLogicWithConfigDefinitionTypes<PrimitiveKeys>>;
	readonly group?: string;
	readonly connectorHidden?: boolean;
	readonly configHidden?: boolean;
};

export type BlockLogicNoConfigDefinitionTypes<TKeys extends PrimitiveKeys> = {
	readonly [k in TKeys]: OmitOverUnion<Primitives[k], "default" | "config">;
};
export type BlockLogicOutputDef = {
	readonly displayName: string;
	readonly tooltip?: string;
	readonly unit?: string;
	readonly types: readonly PrimitiveKeys[];
	readonly group?: string;
	readonly connectorHidden?: boolean;
};

export type BlockLogicInputDefs = { readonly [k in string]: BlockLogicInputDef };
export type BlockLogicOutputDefs = { readonly [k in string]: BlockLogicOutputDef };

export type BlockLogicBothDefinitions = {
	/** Visual order for the inputs */
	readonly inputOrder?: readonly string[];

	/** Visual order for the outputs (wire markers) */
	readonly outputOrder?: readonly string[];

	readonly input: BlockLogicInputDefs;
	readonly output: BlockLogicOutputDefs;
};

export type BlockLogicFullInputDef = {
	readonly displayName: string;
	readonly tooltip?: string;
	readonly unit?: string;
	readonly types: Partial<BlockLogicWithConfigDefinitionTypes<PrimitiveKeys>>;
	readonly group?: string;
	readonly connectorHidden?: boolean;
	readonly configHidden?: boolean;
};
export type BlockLogicFullOutputDef = BlockLogicOutputDef;
export type BlockLogicFullBothDefinitions = {
	/** Visual order for the inputs */
	readonly inputOrder?: readonly string[];

	/** Visual order for the outputs (wire markers) */
	readonly outputOrder?: readonly string[];

	readonly input: { readonly [k in string]: BlockLogicFullInputDef };
	readonly output: { readonly [k in string]: BlockLogicFullOutputDef };
};

//

export type GenericBlockLogicCtor<TDef extends BlockLogicBothDefinitions = BlockLogicFullBothDefinitions> = new (
	block: InstanceBlockLogicArgs,
	...args: any[]
) => GenericBlockLogic<TDef>;

export type GenericBlockLogic<TDef extends BlockLogicBothDefinitions = BlockLogicFullBothDefinitions> =
	BlockLogic<TDef>;

//

type ValueTypeByInputDef<TDef extends BlockLogicInputDef> = TDef extends {
	readonly types: { readonly enum: { readonly elementOrder: readonly (infer E)[] } };
}
	? E & (Primitives[keyof TDef["types"] & PrimitiveKeys] & defined)["default"]
	: (Primitives[keyof TDef["types"] & PrimitiveKeys] & defined)["default"];

type AllInputKeysToArgsObject<TDef extends BlockLogicInputDefs, TKeys extends keyof TDef = keyof TDef> = {
	readonly [k in TKeys]: ValueTypeByInputDef<TDef[k]>;
};
type AllInputKeysToTypesObject<TDef extends BlockLogicInputDefs, TKeys extends keyof TDef = keyof TDef> = {
	readonly [k in string & TKeys as `${k}Type`]: keyof TDef[k]["types"] & PrimitiveKeys;
};
type AllInputKeysToChangedObject<TDef extends BlockLogicInputDefs, TKeys extends keyof TDef = keyof TDef> = {
	readonly [k in string & TKeys as `${k}Changed`]: boolean;
};
export type AllInputKeysToObject<
	TDef extends BlockLogicInputDefs,
	TKeys extends keyof TDef = keyof TDef,
> = AllInputKeysToArgsObject<TDef, TKeys> &
	AllInputKeysToTypesObject<TDef, TKeys> &
	AllInputKeysToChangedObject<TDef, TKeys>;
export type AllInputKeysToObjectAny<TDef extends BlockLogicInputDefs, TKeys extends keyof TDef = keyof TDef> = Partial<
	AllInputKeysToArgsObject<TDef, TKeys>
> &
	Partial<AllInputKeysToTypesObject<TDef, TKeys>> &
	AllInputKeysToChangedObject<TDef, TKeys>;

export type AllOutputKeysToObject<TDef extends BlockLogicOutputDefs> = {
	readonly [k in string & keyof TDef]: Omit<TypedLogicValue<TDef[k]["types"][number]>, "changedSinceLastTick">;
};

type OutputBlockLogicValues<TDef extends BlockLogicOutputDefs> = {
	readonly [k in keyof TDef]: LogicValueStorageContainer<PrimitiveKeys & TDef[k]["types"][number]>;
};
type ReadonlyBlockLogicValues<TDef extends BlockLogicInputDefs> = {
	readonly [k in keyof TDef]: ReadonlyLogicValueStorage<PrimitiveKeys & keyof (TDef[k]["types"] & defined)>;
};

const isnan = (val: unknown) => val !== val;
const inputValuesToFullObject = <TDef extends BlockLogicBothDefinitions, K extends keyof TDef["input"] & string>(
	ctx: BlockLogicTickContext,
	inputs: {
		readonly [k in K]: ReadonlyLogicValueStorage<
			keyof BlockLogicTypes.Primitives & keyof (TDef["input"][k]["types"] & defined)
		>;
	},
	keys: readonly K[],
	inputCachePrev: { [k in string]: unknown },
	inputCacheNext: { [k in string]: unknown },
	returnUndefinedIfUnchanged: boolean,
): AllInputKeysToObject<TDef["input"], K> | BlockLogicValueResults | undefined => {
	if (keys.size() === 0) {
		return {} as never;
	}

	const input: { [k in string | number | symbol]: unknown } = {};
	let anyChanged = false;

	for (const k of keys) {
		const value = inputs[k].get(ctx);
		if (isCustomBlockLogicValueResult(value)) {
			return value;
		}

		let equalToPrev: boolean;
		if (isnan(value.value)) {
			equalToPrev = isnan(inputCachePrev[k]);
		} else {
			equalToPrev = inputCachePrev[k] === value.value;
		}

		const changed = !equalToPrev || inputCachePrev[`${tostring(k)}Type`] !== value.type;
		anyChanged ||= changed;

		input[k] = value.value;
		input[`${tostring(k)}Type`] = value.type;
		input[`${tostring(k)}Changed`] = changed;

		if (inputCacheNext[`${tostring(k)}Tick`] !== ctx.tick) {
			inputCacheNext[k] = value.value;
			inputCacheNext[`${tostring(k)}Tick`] = ctx.tick;
			inputCacheNext[`${tostring(k)}Type`] = value.type;
		}
	}

	if (returnUndefinedIfUnchanged && !anyChanged) {
		return undefined;
	}
	return input as AllInputKeysToObject<TDef["input"], K>;
};

export type BlockLogicTickContext = {
	/** Current tick number */
	readonly tick: number;

	/** Time between the previous tick and the current one, seconds */
	readonly dt: number;
};
export type BlockLogicArgs = {
	readonly instance?: BlockModel;
};

export abstract class BlockLogic<TDef extends BlockLogicBothDefinitions> extends Component {
	private readonly _input: Writable<ReadonlyBlockLogicValues<TDef["input"]>>;
	readonly input: ReadonlyBlockLogicValues<TDef["input"]>;

	private readonly _output: OutputBlockLogicValues<TDef["output"]>;
	protected readonly output: OutputBlockLogicValues<TDef["output"]>;

	private readonly ticked = new ArgsSignal<[ctx: BlockLogicTickContext]>();
	private readonly recalculated = new ArgsSignal<[ctx: BlockLogicTickContext]>();

	readonly instance?: BlockModel;

	constructor(
		readonly definition: TDef,
		args: BlockLogicArgs,
		disableIfBroken: boolean = true,
	) {
		super();

		this.instance = args.instance;
		if (args.instance) {
			ComponentInstance.init(this, args.instance);
		}

		this._input = Objects.mapValues(definition.input, () => UnsetBlockLogicValueStorage) as typeof this._input;
		this.input = this._input;

		this._output = Objects.mapValues(
			definition.output,
			(k, v) => new LogicValueStorageContainer<PrimitiveKeys>(v.types),
		) as typeof this._output;
		this.output = this._output;

		if (disableIfBroken) {
			this.onDescendantDestroyed(() => this.disable());
		}
	}

	private _initializeInputCache<K extends keyof TDef["input"]>(
		key: K,
		initFunc: (
			keys: readonly K[],
			func: (inputs: AllInputKeysToObject<TDef["input"], K>, ctx: BlockLogicTickContext) => void,
			elseFunc?: (result: BlockLogicValueResults) => void,
		) => SignalConnection,
	) {
		type ttypes = keyof TDef["input"][K]["types"] & PrimitiveKeys;
		type tvalue = Primitives[ttypes]["default"];

		let value: unknown;
		let valueType: unknown;

		initFunc(
			[key],
			(ctx) => {
				value = ctx[key];
				valueType = ctx[`${tostring(key)}Type` as never];
			},
			(result) => {
				if (result !== BlockLogicValueResults.availableLater) return;
				value = valueType = undefined;
			},
		);

		return {
			get: () => value as tvalue,
			tryGet: () => value as tvalue | undefined,
			getType: () => valueType as ttypes,
			tryGetType: () => valueType as ttypes | undefined,
		};
	}
	/** Initializes an object that stores and auto-updates a single input. **Might be processed before recalc, do not use in blocks where this.on\*Recalc\*() is used.** */
	protected initializeInputCache<K extends keyof TDef["input"]>(key: K) {
		return this._initializeInputCache(key, this.onk.bind(this));
	}
	/** Initializes an object that stores and auto-updates a single input. **Processed only on recalc, do not use in blocks without any outputs.** */
	protected initializeRecalcInputCache<K extends keyof TDef["input"]>(key: K) {
		return this._initializeInputCache(key, this.onkRecalcInputs.bind(this));
	}

	protected subscribeOnDestroyed(instance: Instance, func: () => void) {
		const update = () => {
			if (instance.IsA("BasePart") && !instance.CanTouch) return;

			func();
		};

		instance.GetPropertyChangedSignal("Parent").Once(update);
		instance.Destroying.Once(update);
	}
	protected onDescendantDestroyed(func: () => void) {
		if (!this.instance) return;

		const subscribe = (instance: Instance) => {
			this.subscribeOnDestroyed(instance, func);
		};

		PartUtils.applyToAllDescendantsOfType("BasePart", this.instance, (part) => subscribe(part));
		PartUtils.applyToAllDescendantsOfType("Constraint", this.instance, (part) => subscribe(part));
		PartUtils.applyToAllDescendantsOfType("WeldConstraint", this.instance, (part) => subscribe(part));
	}

	initializeInputs(config: PlacedBlockConfig, allBlocks: ReadonlyMap<BlockUuid, GenericBlockLogic>) {
		// explicit copying is needed
		for (const key of asMap(this.input).keys()) {
			if (!typeIs(key, "string")) {
				throw `Invalid key type ${typeOf(key)}`;
			}
			if (!(key in config)) {
				throw `Invalid block config provided; Key ${tostring(key)} was not found in config keys ${asMap(config).keys().join()}`;
			}

			const cfg = config[key];
			if (cfg.type === "wire") {
				const outputBlock = allBlocks.get(cfg.config.blockUuid);
				if (!outputBlock) {
					throw `Invalid connection to a nonexistent block ${cfg.config.blockUuid}`;
				}

				const output = outputBlock.output[cfg.config.connectionName];
				if (!output) {
					throw `Invalid connection to a nonexistent block ${cfg.config.blockUuid} output ${cfg.config.connectionName}`;
				}

				this.replaceInput(
					key,
					new BlockBackedInputLogicValueStorage(
						this.definition.input[key],
						outputBlock,
						cfg.config.connectionName,
					),
				);
				continue;
			}

			if (cfg.type === "unset") {
				//

				continue;
			}

			const def = this.definition.input[key].types[cfg.type];
			if (!def) continue;

			const storageCtor = LogicValueStorages[cfg.type];
			const storage = new storageCtor(cfg.config as never, def as never);
			this.replaceInput(key, storage);
		}
	}

	replaceInput(
		key: keyof TDef["input"],
		value: ReadonlyLogicValueStorage<PrimitiveKeys & keyof TDef["input"][keyof TDef["input"]]["types"]>,
	) {
		if (!(key in this._input)) {
			throw `Key ${tostring(key)} is not in input definition (${asMap(this.definition.input).keys().join()})`;
		}

		this._input[key] = value;
	}

	private calculatingRightNow = false;
	private isGarbage = false;
	getOutputValue(
		ctx: BlockLogicTickContext,
		key: keyof typeof this.output,
	): TypedLogicValue<TDef["output"][keyof TDef["output"]]["types"][number]> | BlockLogicValueResults {
		if (this.calculatingRightNow) {
			const value = this._output[key].get(ctx);
			if (!isCustomBlockLogicValueResult(value)) {
				return value;
			}

			return BlockLogicValueResults.availableLater;
		}

		this.calculatingRightNow = true;
		if (this.isEnabled()) {
			this.recalculate(ctx);
		}

		if (this.isGarbage) {
			return BlockLogicValueResults.garbage;
		}

		const value = this._output[key].get(ctx);

		this.calculatingRightNow = false;
		return value;
	}

	/** @deprecated Internal use only */
	setOutputValue(key: string, valueType: PrimitiveKeys, value: BlockLogicTypes.Primitives[PrimitiveKeys]["default"]) {
		this.output[key].set(valueType, value);
	}

	protected onTicc(func: (ctx: BlockLogicTickContext) => void): SignalConnection {
		return this.ticked.Connect(func);
	}
	/** Runs the provided function when another block requests a value from this one, but no more than once per tick. */
	private onRecalc(func: (ctx: BlockLogicTickContext) => void): SignalConnection {
		return this.recalculated.Connect(func);
	}

	private prevTick?: number;
	/** @sealed */
	ticc(ctx: BlockLogicTickContext) {
		if (!this.isEnabled()) return;

		// execute only once per tick
		if (this.prevTick === ctx.tick) {
			return;
		}

		this.prevTick = ctx.tick;
		this.ticked.Fire(ctx);
	}

	private prevRecalcTick?: number;
	/** @sealed */
	recalculate(ctx: BlockLogicTickContext) {
		if (!this.isEnabled()) return;

		this.ticc(ctx);

		// execute only once per tick
		if (this.prevRecalcTick === ctx.tick) {
			return;
		}

		this.prevRecalcTick = ctx.tick;
		this.recalculated.Fire(ctx);
	}

	//

	private readonly inputCache1: { [k in string]: unknown } = {};
	private readonly inputCache2: { [k in string]: unknown } = {};
	private executeFuncWithValues<TKeys extends keyof TDef["input"]>(
		ctx: BlockLogicTickContext,
		keys: readonly TKeys[],
		func: (inputs: AllInputKeysToObject<TDef["input"], TKeys>, ctx: BlockLogicTickContext) => void,
		skipIfUnchanged: boolean,
		elseFunc?: (result: BlockLogicValueResults) => void,
	) {
		const inputs = inputValuesToFullObject(
			ctx,
			this.input,
			keys as (TKeys & string)[],
			// alternating between caches so that multiple calls to this in the same tick don't get stuck thinking the values aren't changed
			ctx.tick % 2 === 0 ? this.inputCache1 : this.inputCache2,
			ctx.tick % 2 === 0 ? this.inputCache2 : this.inputCache1,
			skipIfUnchanged,
		);

		if (!inputs) return;

		if (isCustomBlockLogicValueResult(inputs)) {
			elseFunc?.(inputs);
			return;
		}

		func(inputs as never, ctx);
	}

	/** Runs the provided function when any of the input values change, but only if all of them are available. */
	protected on(
		func: (inputs: AllInputKeysToObject<TDef["input"]>, ctx: BlockLogicTickContext) => void,
	): SignalConnection {
		return this.onTicc((ctx) => this.executeFuncWithValues(ctx, Objects.keys(this.input), func, true));
	}
	/** Runs the provided function when any of the provided input values change, but only if all of them are available. */
	protected onk<const TKeys extends keyof TDef["input"]>(
		keys: readonly TKeys[],
		func: (inputs: AllInputKeysToObject<TDef["input"], TKeys>, ctx: BlockLogicTickContext) => void,
	): SignalConnection {
		return this.onTicc((ctx) => this.executeFuncWithValues(ctx, keys, func, true));
	}

	private onStartWithInputs<const TKeys extends keyof TDef["input"]>(
		keys: readonly TKeys[],
		func: (inputs: AllInputKeysToObject<TDef["input"]>, ctx: BlockLogicTickContext) => void,
	): void {
		const prevFunc = func;
		func = (...args: Parameters<typeof prevFunc>) => {
			prevFunc(...args);
			connection.Disconnect();
		};

		const connection = this.onTicc((ctx) => this.executeFuncWithValues(ctx, keys, func, false));
	}
	/** Runs the provided function first time all of the input values are available. */
	protected onFirstInputs(
		func: (inputs: AllInputKeysToObject<TDef["input"]>, ctx: BlockLogicTickContext) => void,
	): void {
		this.onStartWithInputs(Objects.keys(this.input), func);
	}
	/** Runs the provided function first time all of the provided input values are available. */
	protected onkFirstInputs<const TKeys extends keyof TDef["input"]>(
		keys: readonly TKeys[],
		func: (inputs: AllInputKeysToObject<TDef["input"], TKeys>, ctx: BlockLogicTickContext) => void,
	): void {
		this.onStartWithInputs(keys, func);
	}

	/** Runs the provided function when another block requests a value from this one, but no more than once per tick, if all of the input values are available and only when any input value changes. */
	protected onRecalcInputs(
		func: (inputs: AllInputKeysToObject<TDef["input"]>, ctx: BlockLogicTickContext) => void,
		elseFunc?: (result: BlockLogicValueResults) => void,
	): SignalConnection {
		return this.onkRecalcInputs(Objects.keys(this.input), func, elseFunc);
	}

	/** Runs the provided function when another block requests a value from this one, but no more than once per tick, if all of the provided sinput values are available and only when any input value changes. */
	protected onkRecalcInputs<const TKeys extends keyof TDef["input"]>(
		keys: readonly TKeys[],
		func: (inputs: AllInputKeysToObject<TDef["input"], TKeys>, ctx: BlockLogicTickContext) => void,
		elseFunc?: (result: BlockLogicValueResults) => void,
	): SignalConnection {
		const empty = {} as AllInputKeysToObject<TDef["input"], TKeys>;
		if (!asMap(this.input).any()) {
			return this.onRecalc((ctx) => func(empty, ctx));
		}

		return this.onRecalc((ctx) => this.executeFuncWithValues(ctx, keys, func, true, elseFunc));
	}

	/** Runs the provided function when another block requests a value from this one, but no more than once per tick, only when any input value changes. */
	protected onkRecalcInputsAny<const TKeys extends keyof TDef["input"]>(
		keys: readonly TKeys[],
		func: (inputs: AllInputKeysToObjectAny<TDef["input"], TKeys>, ctx: BlockLogicTickContext) => void,
	): SignalConnection {
		const prev: { [k in string | number | symbol]: { v?: unknown; t?: unknown } } = {};
		const caches = keys.mapToMap((key) => $tuple(key, this.initializeRecalcInputCache(key)));

		return this.onkRecalcInputs([], (_, ctx) => {
			const obj: { [k in string | number | symbol]: unknown } = {};

			for (const [k, c] of caches) {
				const [v, t] = [c.tryGet(), c.tryGetType()];

				obj[k] = v;
				obj[`${tostring(k)}Type`] = t;
				obj[`${tostring(k)}Changed`] = prev[k]?.v !== v || prev[k]?.t !== t;

				prev[k] = { v, t };
			}

			func(obj as never, ctx);
		});
	}

	/** Runs the provided function on every tick, but only if all of the input values are available. */
	protected onAlwaysInputs(
		func: (inputs: AllInputKeysToObject<TDef["input"]>, ctx: BlockLogicTickContext) => void,
	): void {
		const keys = Objects.keys(this.input);
		this.onTicc((ctx) => this.executeFuncWithValues(ctx, keys, func, false));
	}

	getDebugInfo(ctx: BlockLogicTickContext): readonly string[] {
		const result: string[] = [];
		if (!this.isEnabled()) {
			result.push("!DISABLED!");
		}

		const forInput = (
			k: keyof TDef["input"],
			input: ReadonlyBlockLogicValues<TDef["input"]>[keyof TDef["input"]] & defined,
		) => {
			const value = input.get(ctx);

			if (isCustomBlockLogicValueResult(value)) {
				result.push(`[${tostring(k)}] ${value.sub("$BLOCKLOGIC_".size() + 1)}`);
			} else {
				result.push(`[${tostring(k)}] ${value.value}`);
			}
		};

		const forOutput = (
			k: keyof TDef["output"],
			output: OutputBlockLogicValues<TDef["output"]>[keyof TDef["output"]] & defined,
		) => {
			const value = output.tryJustGet();

			if (value !== undefined) {
				result.push(`[${tostring(k)}] ${value.value}`);
			}
		};

		if (this.definition.inputOrder) {
			for (const k of this.definition.inputOrder) {
				forInput(k, this.input[k]);
			}
		} else {
			for (const [k, input] of pairs(this.input)) {
				forInput(k, input);
			}
		}

		if (this.definition.outputOrder) {
			for (const k of this.definition.outputOrder) {
				forOutput(k, this.output[k]);
			}
		} else {
			for (const [k, output] of pairs(this.output)) {
				forOutput(k, output);
			}
		}

		return result;
	}

	disableAndBurn(): void {
		this.isGarbage = true;
		this.disable();

		if (this.instance?.PrimaryPart) {
			RemoteEvents.Burn.send([this.instance?.PrimaryPart]);
		}
	}
}

export type InstanceBlockLogicArgs = ReplaceWith<BlockLogicArgs, { readonly instance: BlockModel }>;
/** Block logic with a required block model instance */
export abstract class InstanceBlockLogic<
	TDef extends BlockLogicFullBothDefinitions,
	TBlock extends BlockModel = BlockModel,
> extends BlockLogic<TDef> {
	readonly instance: TBlock;

	constructor(definition: TDef, args: InstanceBlockLogicArgs) {
		super(definition, args);
		this.instance = args.instance as TBlock;
	}
}

/** Block logic that calculates its output only based on its logical inputs (ADD, MUX, converters, etc.) */
export abstract class CalculatableBlockLogic<TDef extends BlockLogicBothDefinitions> extends BlockLogic<TDef> {
	private currentCustomResult?: BlockLogicValueResults;

	constructor(definition: TDef, args: BlockLogicArgs) {
		super(definition, args);

		const unset = (results: BlockLogicValueResults) => {
			this.currentCustomResult = results;

			if (results === BlockLogicValueResults.garbage) {
				this.disableAndBurn();
			}

			for (const [, v] of pairs(this.output)) {
				v.unset();
			}
		};

		this.onRecalcInputs((inputs, ctx) => {
			const results = this.calculate(inputs, ctx);
			if (isCustomBlockLogicValueResult(results)) {
				unset(results);
				return;
			}

			this.currentCustomResult = undefined;
			for (const [k, v] of pairs(results)) {
				this.output[k].set(v.type, v.value);
			}
		}, unset);
	}

	override getOutputValue(
		ctx: BlockLogicTickContext,
		key: keyof TDef["output"],
	): TypedLogicValue<TDef["output"][keyof TDef["output"]]["types"][number]> | BlockLogicValueResults {
		// super() call should happen before checking this.currentCustomResult for nil since it ticks
		const result = super.getOutputValue(ctx, key);

		return this.currentCustomResult ?? result;
	}

	protected abstract calculate(
		inputs: AllInputKeysToObject<TDef["input"]>,
		ctx: BlockLogicTickContext,
	): AllOutputKeysToObject<TDef["output"]> | BlockLogicValueResults;
}
