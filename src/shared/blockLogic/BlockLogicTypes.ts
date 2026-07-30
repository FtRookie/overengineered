import { t } from "engine/shared/t";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type { BlockLogicFullInputDef } from "shared/blockLogic/BlockLogic";
import type { SoundLogic } from "shared/blockLogic/SoundLogic";

type LEnum<T extends string> = {
	readonly config: NoInfer<T>;
	readonly elementOrder: NoInfer<readonly T[]>;
	readonly elements: BlockLogicTypes.Enum<T>["elements"];
};
/** Infers the T of the `enum` type because without this it returns Enum\<string\> which is not helpful */
export const inferEnumLogicType = <const T extends string>(value: LEnum<T>): LEnum<T> => value;

export namespace BlockLogicTypes {
	export type IdListOfType<T extends BlockLogicFullInputDef["types"]> = keyof T;
	export type TypeListOfType<T extends BlockLogicFullInputDef["types"]> = TypeListOfOutputTypea<
		keyof T & keyof Primitives
	>;

	export type IdListOfOutputType<T extends readonly (keyof Primitives)[]> = T[number];
	export type TypeListOfOutputType<T extends readonly (keyof Primitives)[]> = TypeListOfOutputTypea<T[number]>;

	type TypeListOfOutputTypea<T extends keyof Primitives> = Primitives[T]["config"];

	type BCType<TDefault, TConfig> = {
		readonly config: TConfig;

		/** @deprecated Used only to indicate the type for the type system */
		readonly default: TDefault;
	};
	type BCPrimitive<TDefault> = BCType<TDefault, TDefault>;

	export type UnsetValue = { readonly ___nominal: "Unset" };
	export type Unset = BCPrimitive<UnsetValue>;

	export type WireValue = {
		/** OUTPUT block uiid */
		readonly blockUuid: BlockUuid;

		/** OUTPUT connector name */
		readonly connectionName: BlockConnectionName;

		readonly prevConfig: PlacedBlockConfig[string] | undefined;
	};
	export type Wire = BCPrimitive<WireValue>;

	export type BoolControls = {
		readonly config: {
			readonly enabled: boolean;
			readonly key: string;
			readonly switch: boolean;
			readonly reversed: boolean;
		};
		readonly canBeSwitch: boolean;
		readonly canBeReversed: boolean;
	};
	export type Bool = BCPrimitive<boolean> & {
		readonly control?: BoolControls;
	};

	export type NumberControlModesResetMode = "onRelease" | "onDoublePress" | "never";
	export type NumberControlModesSmoothMode =
		| "resetOnRelease"
		| "instantResetOnRelease"
		| "stopOnRelease"
		| "resetOnDoublePress"
		| "instantResetOnDoublePress"
		| "stopOnDoublePress"
		| "never";
	export interface NumberControlModes {
		readonly type: "smooth" | "instant";
		readonly smooth: {
			readonly speed: number;
			readonly mode: NumberControlModesSmoothMode;
		};
		readonly instant: {
			readonly mode: NumberControlModesResetMode;
		};
	}
	export interface NumberControlKey {
		readonly key: string | KeyCode;
		readonly value: number;
	}

	export type NumberControlKeys = readonly NumberControlKey[];
	export type NumberControl = {
		readonly config: {
			/** Starting value */
			readonly startValue: number;

			readonly enabled: boolean;
			readonly keys: NumberControlKeys;
			readonly mode: NumberControlModes;
		};
	};
	export type Number = BCPrimitive<number> & {
		readonly control?: NumberControl;
		readonly clamp?: {
			readonly showAsSlider: boolean;
			readonly min: number;
			readonly max: number;
			readonly step?: number;
		};
	};
	export type String = BCPrimitive<string>;
	export type Key = BCPrimitive<string>;
	export type Vec3 = BCPrimitive<Vector3>;
	export type Color = BCPrimitive<Color3>;
	export type Byte = BCPrimitive<number>;
	export type ByteArray = BCPrimitive<readonly number[]> & {
		readonly lengthLimit: number;
	};
	export type Word = BCPrimitive<number>;
	export type WordArray = BCPrimitive<readonly number[]> & {
		readonly lengthLimit: number;
	};
	export type Code = BCPrimitive<string> & {
		readonly lengthLimit: number;
	};

	type EnumElement = {
		readonly displayName: string;
		readonly tooltip?: string;
	};
	export type Enum<T extends string = string> = BCPrimitive<T> & {
		readonly elementOrder: readonly T[];
		readonly elements: { readonly [k in T]: EnumElement };
	};

	export type SoundEffect<T extends SoundLogic.Instances = SoundLogic.Instances> = {
		readonly type: T;
		readonly properties: Partial<Instances[T]>;
	};
	export type SoundValue = {
		readonly id: string;
		readonly effects?: readonly SoundEffect[];
		readonly speed?: number;
		readonly start?: number;
		readonly length?: number;
	};
	export type Sound = BCPrimitive<SoundValue>;

	//
	export type ParticleValue = {
		readonly flipbookLayout?: string;
		readonly particleID: string;

		readonly acceleration?: Vector3;
		readonly spreadAngle?: Vector3;

		readonly color?: Color3;

		readonly shape?: Enum.ParticleEmitterShape;
		readonly shapeStyle?: Enum.ParticleEmitterShapeStyle;
		readonly shapeInOut?: Enum.ParticleEmitterShapeInOut;
		readonly emissionDirection?: Enum.NormalId;

		readonly velocityInheritance?: number;
		readonly lockedToPart?: boolean;
		readonly rotationSpeed?: number;
		readonly transparency?: number;
		readonly orientation?: number;
		readonly brightness?: number;
		readonly timeScale?: number;
		readonly rotation?: number;
		readonly lifetime?: number;
		readonly squash?: number;
		readonly speed?: number;
		readonly rate?: number;
		readonly size?: number;
		readonly drag?: number;
	};

	export type Particle = BCPrimitive<ParticleValue>;

	export type Primitives = {
		readonly unset: Unset;
		readonly wire: Wire;

		readonly bool: Bool;
		readonly number: Number;
		readonly string: String;
		readonly key: Key;
		readonly vector3: Vec3;
		readonly color: Color;
		readonly byte: Byte;
		readonly bytearray: ByteArray;
		readonly word: Word;
		readonly wordarray: WordArray;
		readonly code: Code;
		readonly enum: Enum;
		readonly sound: Sound;
		readonly particle: Particle;
	};

	export type Controls = {
		readonly [k in ExtractKeys<Primitives, { readonly control?: unknown }>]: Primitives[k]["control"] & defined;
	};

	export namespace T {
		export const soundEffect = t.interface({
			type: t.string,
			properties: t.mappedInterfaceKV(t.string, t.any),
		}) as t.Type<SoundEffect>;

		export const primitives: { [k in keyof Primitives]?: t.Type<Primitives[k]["config"]> } = {
			bool: t.boolean,
			number: t.number,
			string: t.string,
			key: t.string,
			byte: t.numberWithBounds(0, 255),
			bytearray: t.array(t.numberWithBounds(0, 255)),
			word: t.numberWithBounds(0, 65535),
			wordarray: t.array(t.numberWithBounds(0, 65535)),
			code: t.string,
			enum: t.string,
			vector3: t.vector3,
			color: t.color,
			sound: t.interface({
				id: t.string,
				effects: t.array(soundEffect).orUndefined(),
			}),
			particle: t.interface({
				particleID: t.string,
			}),
		};

		export const fromBlockConfigDefinition = <T extends BlockLogicFullInputDef["types"]>(def: T) => {
			type ret = ReturnType<typeof t.union<readonly t.Type<Primitives[keyof T & keyof Primitives]["config"]>[]>>;

			const v = asMap(def).map((k, v) => primitives[k as keyof BlockLogicTypes.Primitives]!);
			return t.union(...v) as ret;
		};
	}
}
