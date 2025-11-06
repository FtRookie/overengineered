import { Objects } from "engine/shared/fixes/Objects";
import type { BlockLogicFullInputDef } from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";

type Primitives = BlockLogicTypes.Primitives;
type PrimitiveKeys = keyof Primitives;

type Controls = BlockLogicTypes.Controls;
type ControlKeys = keyof Controls;

export type BlockConfigPart<TKey extends PrimitiveKeys> = {
	readonly type: TKey;
	readonly config: Primitives[TKey]["config"];
	readonly controlConfig?: Controls[TKey & ControlKeys]["config"];
};

type GenericConfig = BlockConfigPart<PrimitiveKeys>;
export type PlacedBlockConfig = {
	readonly [k in string]: { [k in PrimitiveKeys]: BlockConfigPart<k> }[PrimitiveKeys];
};
type PartialPlacedBlockConfig = {
	readonly [k in string]?: Partial<{ [k in PrimitiveKeys]: BlockConfigPart<k> }[PrimitiveKeys]>;
};

export type BlockConfigOf<TKey extends keyof Primitives> =
	| Primitives[TKey]["config"]
	| Controls[TKey & keyof Controls]["config"];

// Partial but doesn't make the properties partial, just undefined
type MiniPartial<T> = {
	[k in keyof T]: T[k] | undefined;
};

export namespace BlockConfig {
	type Def = {
		readonly [k in string]: BlockLogicFullInputDef;
	};

	export function addDefaults(
		config: PartialPlacedBlockConfig | undefined,
		definition: Def,
		treatUnsetAsUnset = false,
	): PlacedBlockConfig {
		const result: { [k in string]?: Partial<GenericConfig> } = { ...(config ?? {}) };

		const getDefaultType = (def: BlockLogicFullInputDef): PrimitiveKeys => {
			if (Objects.size(def.types) === 1) {
				return firstKey(def.types)!;
			}

			if (def.connectorHidden && !treatUnsetAsUnset) {
				// without a connector we can only configure the value with the config tool; thus, "unset" makes zero sense
				const t = firstKey(def.types);
				if (!t) {
					throw "Unset type is not supported without a visible marker";
				}
			}

			return "unset";
		};
		const getDefaultConfig = (objType: GenericConfig["type"], def: BlockLogicFullInputDef) =>
			objType === "unset" ? (undefined as never) : def.types[objType]!.config;

		const createDefault = (def: BlockLogicFullInputDef) => {
			const defaultType = getDefaultType(def);

			const cfg: GenericConfig = {
				type: defaultType,
				config: defaultType === "unset" ? (undefined as never) : def.types[defaultType]!.config,
				controlConfig: (def.types[defaultType] as Primitives[ControlKeys])?.control?.config,
			};
			return cfg;
		};

		const calculateType = (obj: Partial<GenericConfig>, def: BlockLogicFullInputDef): GenericConfig["type"] => {
			// If type is nil, return the default type
			if (obj.type === undefined) {
				return getDefaultType(def);
			}

			// If type is not in definitions, return the default type. (Wire and Unset are not present in any definition so are skipped)
			if (obj.type !== "unset" && obj.type !== "wire" && !(obj.type in def.types)) {
				return getDefaultType(def);
			}

			return obj.type;
		};
		const calculateConfig = (
			obj: MakeRequired<Partial<GenericConfig>, "type">,
			def: BlockLogicFullInputDef,
		): GenericConfig["config"] => {
			// Unset doesn't have/need a config
			if (obj.type === "unset") {
				return undefined! as BlockLogicTypes.UnsetValue;
			}

			if (obj.type === "wire") {
				// If type is Wire but config is nil, unrecoverable situation - return the default config
				if (obj.config === undefined) {
					return getDefaultConfig(obj.type, def);
				}

				// Otherwise, just return the config
				return obj.config;
			}

			const defConfig = def.types[obj.type]!.config;

			// If config is nil, set the default one
			if (obj.config === undefined) {
				return defConfig;
			}

			// If definition config is table, merge it with the default config
			if (typeIs(defConfig, "table")) {
				// If config is not table, unrecoverable situation - return the default config of the same type
				if (!typeIs(obj.config, "table")) {
					return defConfig;
				}

				return { ...(defConfig as {}), ...(obj.config as {}) } as never;
			}

			return obj.config;
		};
		const calculateControlConfig = (
			obj: MakeRequired<MiniPartial<GenericConfig>, "type" | "config">,
			def: BlockLogicFullInputDef,
		): GenericConfig["controlConfig"] => {
			const control = def.types[obj.type] as Primitives[ControlKeys] | undefined;
			if (!control) {
				return obj.controlConfig;
			}

			// If not a control type, return nil
			if (!control.control) {
				return undefined;
			}

			const defConfig = control.control.config;

			// If config is nil, set the default one
			if (obj.controlConfig === undefined) {
				return defConfig;
			}

			// If definition config is table, merge it with the default config
			if (typeIs(defConfig, "table")) {
				// If config is not table, unrecoverable situation - return the default config
				if (!typeIs(obj.controlConfig, "table")) {
					return defConfig;
				}

				return { ...defConfig, ...obj.controlConfig };
			}

			return obj.controlConfig;
		};

		for (const [k, def] of pairs(definition)) {
			assert(typeIs(k, "string"));

			const obj = result[k];
			if (!obj) {
				result[k] = createDefault(def);
				continue;
			}

			const rtype = calculateType(obj, def);
			const rcfg = calculateConfig({ ...obj, type: rtype }, def);
			const rccfg = calculateControlConfig({ ...obj, type: rtype, config: rcfg }, def);

			result[k] = {
				type: rtype,
				config: rcfg,
				controlConfig: rccfg,
			};
		}

		return result as PlacedBlockConfig;
	}
}
