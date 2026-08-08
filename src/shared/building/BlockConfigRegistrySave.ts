namespace BlockConfigTypes {
	type BlockConfigType<TName extends string, TDefault, TConfig> = {
		readonly type: TName;
		readonly default: TDefault;
		readonly config: TConfig;
		readonly connectorHidden?: boolean;
		readonly configHidden?: boolean;
	} & ConfigType<TName, TConfig>;
	type BlockConfigPrimitiveType<TName extends string, TDefault> = BlockConfigType<TName, TDefault, TDefault>;

	export type Bool = BlockConfigPrimitiveType<"bool", boolean>;
	export type Vec3 = BlockConfigPrimitiveType<"vector3", Vector3>;
	export type Key = BlockConfigPrimitiveType<"key", string>;
	export type Number = BlockConfigPrimitiveType<"number", number>;
	export type String = BlockConfigPrimitiveType<"string", string>;
	export type Color = BlockConfigPrimitiveType<"color", Color3>;
	export type Byte = BlockConfigPrimitiveType<"byte", number>;
	export type ByteArray = BlockConfigPrimitiveType<"bytearray", readonly number[]> & {
		readonly lengthLimit: number;
	};
	export type Code = BlockConfigPrimitiveType<"code", string> & {
		readonly lengthLimit: number;
	};

	export type MultiKey<TKeys extends string = string> = BlockConfigPrimitiveType<
		"multikey",
		Readonly<Record<TKeys, string>>
	> & {
		readonly keyDefinitions: ConfigTypesToDefinition<string, Readonly<Record<TKeys, Key>>>;
	};

	export type KeyBool = BlockConfigType<
		"keybool",
		boolean,
		{
			readonly key: string;
			readonly switch: boolean;
			readonly reversed: boolean;
		}
	> & {
		readonly canBeSwitch: boolean;
		readonly canBeReversed: boolean;
	};

	export type ClampedNumber = BlockConfigPrimitiveType<"clampedNumber", number> & {
		readonly min: number;
		readonly max: number;
		readonly step: number;
	};

	export type OrConfigType<TType extends keyof Types> = Types[TType]["config"];
	export type Or<
		T extends readonly Types[Exclude<keyof Types, "or">][] = readonly Types[Exclude<keyof Types, "or">][],
	> = BlockConfigType<
		"or",
		OrConfigType<T[number]["type"]>,
		{ readonly type: T[number]["type"] | "unset"; readonly value: OrConfigType<T[number]["type"]> }
	> & {
		readonly types: { readonly [k in T[number]["type"]]?: Types[k] };
		readonly group?: string;
	};

	export type MotorRotationSpeed = BlockConfigType<
		"motorRotationSpeed",
		number,
		{
			readonly rotation: {
				readonly add: KeyCode;
				readonly sub: KeyCode;
			};
			readonly speed: number;
			readonly switchmode: boolean;
		}
	> & {
		readonly maxSpeed: number;
	};

	export type ServoMotorAngle = BlockConfigType<
		"servoMotorAngle",
		number,
		{
			readonly rotation: {
				readonly add: KeyCode;
				readonly sub: KeyCode;
			};
			readonly switchmode: boolean;
			readonly angle: number;
		}
	> & {
		readonly minAngle: number;
		readonly maxAngle: number;
	};
	export type Thrust = BlockConfigType<
		"thrust",
		number,
		{
			readonly thrust: {
				readonly add: KeyCode;
				readonly sub: KeyCode;
			};
			readonly switchmode: boolean;
		}
	> & {
		readonly canBeSwitch: boolean;
	};
	export type ControllableNumber = BlockConfigType<
		"controllableNumber",
		number,
		{
			readonly value: number;
			readonly control: {
				readonly add: KeyCode;
				readonly sub: KeyCode;
			};
		}
	> & {
		readonly min: number;
		readonly max: number;
		readonly step: number;
	};

	//

	export type Definitions = ConfigTypesToDefinition<keyof Types, Types>;
	export type Definition = ConfigTypeToDefinition<Types[keyof Types]>;
	export type BothDefinitions = {
		readonly input: Definitions;
		readonly output: Definitions;
	};

	export interface Types {
		readonly bool: Bool;
		readonly vector3: Vec3;
		readonly number: Number;
		readonly string: String;
		readonly color: Color;
		readonly clampedNumber: ClampedNumber;
		readonly key: Key;
		readonly multikey: MultiKey;
		readonly keybool: KeyBool;
		readonly or: Or;
		readonly motorRotationSpeed: MotorRotationSpeed;
		readonly servoMotorAngle: ServoMotorAngle;
		readonly thrust: Thrust;
		readonly controllableNumber: ControllableNumber;
		readonly byte: Byte;
		readonly bytearray: ByteArray;
		readonly code: Code;
	}
}

const connectors = {
	any(
		group?: string,
		additional?: Partial<
			ConfigTypeToDefinition<
				BlockConfigTypes.Or<
					[
						BlockConfigTypes.Bool,
						BlockConfigTypes.Number,
						BlockConfigTypes.Vec3,
						BlockConfigTypes.Byte,
						BlockConfigTypes.String,
					]
				>
			>
		>,
	): ConfigTypeToDefinition<
		BlockConfigTypes.Or<
			[
				BlockConfigTypes.Bool,
				BlockConfigTypes.Number,
				BlockConfigTypes.Vec3,
				BlockConfigTypes.String,
				BlockConfigTypes.Byte,
			]
		>
	> {
		return {
			type: "or",
			default: "" as string,
			config: {
				type: "unset",
				value: 0,
			},
			group,
			types: {
				bool: {
					type: "bool",
					config: false as boolean,
					default: false as boolean,
				},
				number: {
					type: "number",
					default: 0 as number,
					config: 0 as number,
				},
				vector3: {
					type: "vector3",
					default: Vector3.zero,
					config: Vector3.zero,
				},
				string: {
					type: "string",
					default: "" as string,
					config: "" as string,
				},
				byte: {
					type: "byte",
					default: 0 as number,
					config: 0 as number,
				},
			},
			...(additional ?? {}),
		};
	},
} as const;

const disconnectblock = {
	input: {
		disconnect: {
			type: "keybool",
			default: false as boolean,
			config: {
				key: "F" as KeyCode,
				switch: false as boolean,
				reversed: false as boolean,
			},
			canBeSwitch: false,
			canBeReversed: false,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const motorblock = {
	input: {
		rotationSpeed: {
			type: "motorRotationSpeed",
			default: 0 as number,
			config: {
				rotation: {
					add: "R" as KeyCode,
					sub: "F" as KeyCode,
				},
				speed: 15 as number,
				switchmode: false as boolean,
			},
			maxSpeed: 150 as number,
		},
		max_torque: {
			type: "clampedNumber",
			default: 200 as number,
			config: 200 as number,
			max: 600,
			min: 0,
			step: 0.1,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const wheelblock = {
	input: {
		friction: {
			type: "clampedNumber",
			default: 50 as number,
			config: 50 as number,
			max: 100,
			min: 0.1,
			step: 0.1,
		},
		elasticity: {
			type: "clampedNumber",
			default: 50 as number,
			config: 50 as number,
			max: 100,
			min: 0.1,
			step: 0.1,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const bracedshaft = {
	input: {
		angle: {
			type: "clampedNumber",
			min: -180,
			max: 180,
			step: 0.1,
			default: 0 as number,
			config: 0 as number,
			connectorHidden: true,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const bytesplitter = {
	input: {
		value: {
			type: "byte",
			default: 0 as number,
			config: 0 as number,
		},
	},
	output: {
		"1": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		"2": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		"4": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		"8": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		"16": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		"32": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		"64": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		"128": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const bytemaker = {
	input: {
		"1": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		"2": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		"4": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		"8": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		"16": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		"32": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		"64": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		"128": {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
	},
	output: {
		value: {
			type: "byte",
			default: 0 as number,
			config: 0 as number,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const vec3objectworldtransformer = {
	input: {
		toobject: {
			type: "bool",
			config: true as boolean,
			default: true as boolean,
		},
		originpos: {
			type: "vector3",
			config: Vector3.zero,
			default: Vector3.zero,
		},
		originrot: {
			type: "vector3",
			config: Vector3.zero,
			default: Vector3.zero,
		},
		position: {
			type: "vector3",
			config: Vector3.zero,
			default: Vector3.zero,
		},
	},
	output: {
		position: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const rocketengine = {
	input: {
		thrust: {
			type: "thrust",
			default: 0 as number,
			config: {
				thrust: {
					add: "W" as KeyCode,
					sub: "S" as KeyCode,
				},
				switchmode: false as boolean,
			},
			canBeSwitch: true as boolean,
		},
		strength: {
			type: "clampedNumber",
			min: 0,
			max: 100,
			step: 0.01,
			default: 100 as number,
			config: 100 as number,
		},
	},
	output: {
		maxpower: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const rcsengine = {
	input: {
		direction: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
		trailLength: {
			type: "clampedNumber",
			min: 1,
			max: 5,
			step: 0.1,
			default: 1,
			config: 1,
		},
		trailColor: {
			type: "color",
			default: Color3.fromRGB(255, 255, 255),
			config: Color3.fromRGB(255, 255, 255),
			connectorHidden: true,
		},
	},
	output: {
		maxpower: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const piston = {
	input: {
		extend: {
			type: "thrust",
			default: 0 as number,
			config: {
				thrust: {
					add: "R" as KeyCode,
					sub: "F" as KeyCode,
				},
				switchmode: true as boolean,
			},
			canBeSwitch: true as boolean,
		},

		speed: {
			type: "clampedNumber",
			min: 0,
			max: 10,
			step: 0.01,
			default: 4 as number,
			config: 4 as number,
			connectorHidden: true,
		},

		maxforce: {
			type: "clampedNumber",
			min: 0,
			max: 2000,
			step: 0.01,
			default: 500 as number,
			config: 500 as number,
			connectorHidden: true,
		},

		distance: {
			type: "clampedNumber",
			min: 0,
			max: 8,
			step: 0.01,
			default: 1 as number,
			config: 1 as number,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const ballast = {
	input: {
		density: {
			type: "controllableNumber",
			min: 0.15,
			max: 10,
			step: 0.01,
			default: 0.15 as number,
			config: {
				value: 0.15 as number,
				control: {
					add: "R" as KeyCode,
					sub: "F" as KeyCode,
				},
			},
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const heliumblock = {
	input: {
		density: {
			type: "clampedNumber",
			default: 0.17 as number,
			config: 0.17 as number,
			min: 0.05,
			max: 2,
			step: 0.01,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const rope = {
	input: {
		length: {
			type: "clampedNumber",
			min: 1,
			max: 50,
			step: 0.01,
			default: 15 as number,
			config: 15 as number,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const servomotorblock = {
	input: {
		speed: {
			type: "clampedNumber",
			min: 0,
			max: 50,
			step: 0.01,
			default: 15 as number,
			config: 15 as number,
		},
		angle: {
			type: "servoMotorAngle",
			default: 0 as number,
			config: {
				rotation: {
					add: "R" as KeyCode,
					sub: "F" as KeyCode,
				},
				switchmode: false as boolean,
				angle: 45 as number,
			},
			minAngle: -180,
			maxAngle: 180,
		},
		stiffness: {
			type: "clampedNumber",
			min: 0,
			max: 100,
			step: 0.01,
			default: 45 as number,
			config: 45 as number,
			connectorHidden: true,
		},
		max_torque: {
			type: "clampedNumber",
			default: 200 as number,
			config: 200 as number,
			max: 600,
			min: 0,
			step: 0.1,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;
const sidewaysservo = {
	...servomotorblock,
	input: {
		...servomotorblock.input,
		angle: {
			...servomotorblock.input.angle,
			minAngle: -90,
			maxAngle: 90,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const magnet = {
	input: {
		strength: {
			type: "clampedNumber",
			min: 0,
			max: 100,
			step: 0.01,
			default: 100 as number,
			config: 100 as number,
		},
		invertPolarity: {
			type: "keybool",
			default: false as boolean,
			config: {
				key: "G" as KeyCode,
				switch: false as boolean,
				reversed: false as boolean,
			},
			canBeSwitch: true,
			canBeReversed: true,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const tnt = {
	input: {
		explode: {
			type: "keybool",
			default: false as boolean,
			config: {
				key: "B" as KeyCode,
				switch: false as boolean,
				reversed: false as boolean,
			},
			canBeSwitch: false,
			canBeReversed: false,
		},
		radius: {
			type: "clampedNumber",
			default: 12 as number,
			min: 1,
			max: 12,
			step: 0.01,
			config: 12 as number,
		},
		pressure: {
			type: "clampedNumber",
			default: 2500 as number,
			min: 0,
			max: 2500,
			step: 0.01,
			config: 2500 as number,
		},
		flammable: {
			type: "bool",
			default: true as boolean,
			config: true as boolean,
		},
		impact: {
			type: "bool",
			default: true as boolean,
			config: true as boolean,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const lamp = {
	input: {
		enabled: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		brightness: {
			type: "number",
			config: 20,
			default: 20,
		},
		lightRrange: {
			type: "number",
			config: 20,
			default: 20,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const singleimpulse = {
	input: {
		impulse: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
	},
	output: {
		value: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const leddisplay = {
	input: {
		posx: {
			type: "clampedNumber",
			default: 0 as number,
			config: 0 as number,
			configHidden: true,
			min: 0,
			max: 7,
			step: 1,
		},
		posy: {
			type: "clampedNumber",
			default: 0 as number,
			config: 0 as number,
			configHidden: true,
			min: 0,
			max: 7,
			step: 1,
		},
		color: {
			type: "vector3",
			default: new Vector3(0, 0, 1),
			config: new Vector3(0, 0, 1),
			configHidden: true,
		},
		update: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
			configHidden: true,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const sevensegmentdisplay = {
	input: {
		value: {
			type: "byte",
			default: 0 as number,
			config: 0 as number,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const suspensionblock = {
	input: {
		damping: {
			type: "clampedNumber",
			default: 250 as number,
			min: 0,
			max: 10_000,
			step: 0.01,
			config: 250 as number,
			connectorHidden: true,
		},
		stiffness: {
			type: "clampedNumber",
			default: 75_000 as number,
			min: 0,
			max: 100_000,
			step: 0.01,
			config: 75_000 as number,
			connectorHidden: true,
		},
		free_length: {
			type: "clampedNumber",
			default: 4.5 as number,
			min: 1,
			max: 10,
			step: 0.01,
			config: 4.5 as number,
		},
		max_force: {
			type: "clampedNumber",
			min: 1,
			max: 800000,
			step: 0.1,
			default: 1000 as number,
			config: 1000 as number,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const vehicleseat = {
	input: {},
	output: {
		occupied: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const speedometer = {
	input: {},
	output: {
		linear: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
		angular: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const masssensor = {
	input: {
		assemblyonly: {
			type: "bool",
			connectorHidden: true,
			default: false as boolean,
			config: false as boolean,
		},
	},
	output: {
		result: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const gravitysensor = {
	input: {},
	output: {
		result: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const keysensor = {
	input: {
		key: {
			type: "keybool",
			connectorHidden: true,
			default: false as boolean,
			config: {
				key: "F" as KeyCode,
				switch: false as boolean,
				reversed: false,
			},
			canBeSwitch: true,
			canBeReversed: true,
		},
	},
	output: {
		result: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const mousesensor = {
	input: {},
	output: {
		position: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
		angle: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
		direction: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
		angle3d: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const tpscounter = {
	input: {},
	output: {
		fps: {
			type: "number",
			default: 60 as number,
			config: 60 as number,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const wing = {
	input: {
		enabled: {
			type: "bool",
			default: true as boolean,
			config: true as boolean,
			connectorHidden: true,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const anyProcessing = {
	input: {
		value: connectors.any("1"),
	},
	output: {
		result: connectors.any("1"),
	},
} as const satisfies BlockConfigBothDefinitions;

const screen = {
	input: {
		data: connectors.any("1"),
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const laser = {
	input: {
		alwaysEnabled: {
			type: "bool",
			config: false as boolean,
			default: false as boolean,
		},
		maxDistance: {
			type: "clampedNumber",
			config: 200 as number,
			default: 200 as number,
			min: 0.1,
			max: 600,
			step: 0.1,
		},
		rayTransparency: {
			type: "clampedNumber",
			config: 0 as number,
			default: 0 as number,
			min: 0,
			max: 1,
			step: 0.01,
		},
		rayColor: {
			type: "color",
			config: Color3.fromRGB(255, 0, 0),
			default: Color3.fromRGB(255, 0, 0),
			connectorHidden: true,
		},
		dotColor: {
			type: "color",
			config: Color3.fromRGB(255, 255, 0),
			default: Color3.fromRGB(255, 255, 0),
			connectorHidden: true,
		},
	},
	output: {
		distance: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const twoNumbersInputBooleanOutput = {
	input: {
		value1: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
		value2: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
	},
	output: {
		result: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const vec3combiner = {
	input: {
		value_x: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
		value_y: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
		value_z: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
	},
	output: {
		result: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const vec3splitter = {
	input: {
		value: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
	},
	output: {
		result_x: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
		result_y: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
		result_z: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const anglesensor = {
	input: {},
	output: {
		result: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const ownerlocator = {
	input: {},
	output: {
		linear: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
		angular: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const ownercameralocator = {
	input: {},
	output: {
		position: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
		direction: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
		up: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const altimeter = {
	input: {},
	output: {
		result: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const logicmemory = {
	input: {
		set: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
			configHidden: true,
		},
		value: connectors.any("1"),
	},
	output: {
		result: connectors.any("1"),
	},
} as const satisfies BlockConfigBothDefinitions;

const stackmemory = {
	input: {
		push: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
			configHidden: true,
		},
		pop: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
			configHidden: true,
		},
		value: connectors.any("1"),
	},
	output: {
		size: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
		result: connectors.any("1"),
	},
} as const satisfies BlockConfigBothDefinitions;

const randomaccessmemory = {
	input: {
		read: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
			configHidden: true,
		},
		write: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
			configHidden: true,
		},
		address: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
		value: connectors.any("1"),
	},
	output: {
		size: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
		result: connectors.any("1"),
	},
} as const satisfies BlockConfigBothDefinitions;

const readonlymemory = {
	input: {
		read: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
			configHidden: true,
		},
		address: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
		data: {
			type: "bytearray",
			config: [],
			default: [],
			lengthLimit: 4096,
			connectorHidden: true,
		},
	},
	output: {
		size: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
		output1: {
			type: "byte",
			default: 0 as number,
			config: 0 as number,
		},
		output2: {
			type: "byte",
			default: 0 as number,
			config: 0 as number,
		},
		output3: {
			type: "byte",
			default: 0 as number,
			config: 0 as number,
		},
		output4: {
			type: "byte",
			default: 0 as number,
			config: 0 as number,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const counter = {
	input: {
		value: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
		step: {
			type: "number",
			default: 1 as number,
			config: 1 as number,
		},
		triggerStep: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
			configHidden: true,
		},
		triggerValue: {
			//a.k.a. rewrite value
			type: "bool",
			default: false as boolean,
			config: false as boolean,
			configHidden: true,
		},
	},
	output: {
		value: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const impulsegenerator = {
	input: {
		delay: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
		isInverted: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		isSinglePulse: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
	},
	output: {
		value: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const radiotransmitter = {
	input: {
		value: connectors.any("1"),
		frequency: {
			type: "clampedNumber",
			default: 868 as number,
			config: 868 as number,
			min: 434,
			max: 1500,
			step: 0.1,
		},
	},
	output: {},
} as const satisfies BlockConfigBothDefinitions;

const radioreceiver = {
	input: {
		frequency: {
			type: "clampedNumber",
			default: 868 as number,
			config: 868 as number,
			min: 434,
			max: 1500,
			step: 0.1,
		},
	},
	output: {
		value: connectors.any("1"),
	},
} as const satisfies BlockConfigBothDefinitions;

const radarsection = {
	input: {
		maxDistance: {
			type: "clampedNumber",
			default: 100 as number,
			config: 100 as number,
			min: 1,
			max: 550,
			step: 1,
		},
		detectionSize: {
			type: "clampedNumber",
			default: 1 as number,
			config: 1 as number,
			min: 1,
			max: 5,
			step: 0.1,
		},
		visibility: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
		//angleOffset: {
		//	//	type: "vector3",
		//	default: Vector3.zero,
		//	config: Vector3.zero,
		//},
		minimalDistance: {
			type: "clampedNumber",
			default: 0 as number,
			config: 0 as number,
			min: 0,
			max: 550,
			step: 0.1,
		},
	},
	output: {
		distance: {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const firesensor = {
	input: {
		detectionradius: {
			type: "clampedNumber",
			default: 20 as number,
			config: 20 as number,
			min: 1,
			max: 100,
			step: 1,
		},
	},
	output: {
		detected: {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
		},
	},
} as const satisfies BlockConfigBothDefinitions;

const delayBlock = {
	input: {
		value: connectors.any("1"),
		duration: {
			type: "number",
			default: 0 as number,
			config: 0 as number,
		},
	},
	output: {
		result: connectors.any("1"),
	},
} as const satisfies BlockConfigBothDefinitions;

const defcs = {
	bool(
		additional?: Partial<ConfigTypeToDefinition<BlockConfigTypes.Bool>>,
	): ConfigTypeToDefinition<BlockConfigTypes.Bool> {
		return {
			type: "bool",
			default: false as boolean,
			config: false as boolean,
			...(additional ?? {}),
		};
	},
	vector3(
		additional?: Partial<ConfigTypeToDefinition<BlockConfigTypes.Vec3>>,
	): ConfigTypeToDefinition<BlockConfigTypes.Vec3> {
		return {
			type: "vector3",
			default: Vector3.zero,
			config: Vector3.zero,
			...(additional ?? {}),
		};
	},
	number(
		additional?: Partial<ConfigTypeToDefinition<BlockConfigTypes.Number>>,
	): ConfigTypeToDefinition<BlockConfigTypes.Number> {
		return {
			type: "number",
			default: 0 as number,
			config: 0 as number,
			...(additional ?? {}),
		};
	},
	numberOrByteOrBool(
		group?: string,
		additional?: Partial<
			ConfigTypeToDefinition<
				BlockConfigTypes.Or<[BlockConfigTypes.Number, BlockConfigTypes.Bool, BlockConfigTypes.Byte]>
			>
		>,
	): ConfigTypeToDefinition<
		BlockConfigTypes.Or<[BlockConfigTypes.Number, BlockConfigTypes.Bool, BlockConfigTypes.Byte]>
	> {
		return {
			type: "or",
			default: 0 as number,
			config: {
				type: "unset",
				value: 0,
			},
			group,
			types: {
				number: {
					type: "number",
					default: 0 as number,
					config: 0 as number,
				},
				bool: {
					type: "bool",
					default: false as boolean,
					config: false as boolean,
				},
				byte: {
					type: "byte",
					default: 0 as number,
					config: 0 as number,
				},
			},
			...(additional ?? {}),
		};
	},
	numberOrVector(
		group?: string,
		additional?: Partial<
			ConfigTypeToDefinition<BlockConfigTypes.Or<[BlockConfigTypes.Number, BlockConfigTypes.Vec3]>>
		>,
	): ConfigTypeToDefinition<BlockConfigTypes.Or<[BlockConfigTypes.Number, BlockConfigTypes.Vec3]>> {
		return {
			type: "or",
			default: 0 as number,
			config: {
				type: "unset",
				value: 0,
			},
			group,
			types: {
				number: {
					type: "number",
					default: 0 as number,
					config: 0 as number,
				},
				vector3: {
					type: "vector3",
					default: Vector3.zero as Vector3,
					config: Vector3.zero as Vector3,
				},
			},
			...(additional ?? {}),
		};
	},
	byte(
		additional?: Partial<ConfigTypeToDefinition<BlockConfigTypes.Byte>>,
	): ConfigTypeToDefinition<BlockConfigTypes.Byte> {
		return {
			type: "byte",
			default: 0 as number,
			config: 0 as number,
			...(additional ?? {}),
		};
	},
} as const;

const autos = {
	constant: {
		input: { value: connectors.any("1", { connectorHidden: true }) },
		output: { result: connectors.any("1") },
	},
	pi: { input: {}, output: { value: defcs.number() } },
	e: { input: {}, output: { value: defcs.number() } },
	sqrt: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	tan: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	atan: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	sin: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	asin: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	cos: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	acos: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	log: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	log10: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	loge: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	deg: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	rad: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	sign: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	floor: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	ceil: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	round: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	abs: { input: { value: defcs.number() }, output: { result: defcs.number() } },
	rand: {
		input: {
			min: defcs.number({ default: 0, config: 0 }),
			max: defcs.number({ default: 1, config: 1 }),
		},
		output: { result: defcs.number() },
	},
	nsqrt: {
		input: { value: defcs.number(), root: defcs.number() },
		output: { result: defcs.number() },
	},
	pow: {
		input: { value: defcs.number(), power: defcs.number() },
		output: { result: defcs.number() },
	},
	clamp: {
		input: { value: defcs.number(), min: defcs.number(), max: defcs.number() },
		output: { result: defcs.number() },
	},
	atan2: { input: { y: defcs.number(), x: defcs.number() }, output: { result: defcs.number() } },
	mod: {
		input: { value1: defcs.number(), value2: defcs.number() },
		output: { result: defcs.number() },
	},
	equals: {
		input: { value1: defcs.numberOrByteOrBool(), value2: defcs.numberOrByteOrBool() },
		output: { result: defcs.bool() },
	},
	notequals: {
		input: { value1: defcs.numberOrByteOrBool(), value2: defcs.numberOrByteOrBool() },
		output: { result: defcs.bool() },
	},
	greaterthan: {
		input: { value1: defcs.number(), value2: defcs.number() },
		output: { result: defcs.bool() },
	},
	greaterthanorequals: {
		input: { value1: defcs.number(), value2: defcs.number() },
		output: { result: defcs.bool() },
	},
	lessthan: {
		input: { value1: defcs.number(), value2: defcs.number() },
		output: { result: defcs.bool() },
	},
	lessthanorequals: {
		input: { value1: defcs.number(), value2: defcs.number() },
		output: { result: defcs.bool() },
	},
	add: {
		input: { value1: defcs.numberOrVector("1"), value2: defcs.numberOrVector("1") },
		output: { result: defcs.numberOrVector("1") },
	},
	sub: {
		input: { value1: defcs.numberOrVector("1"), value2: defcs.numberOrVector("1") },
		output: { result: defcs.numberOrVector("1") },
	},
	mul: {
		input: { value1: defcs.numberOrVector("1"), value2: defcs.numberOrVector("1") },
		output: { result: defcs.numberOrVector("1") },
	},
	div: {
		input: { value1: defcs.numberOrVector("1"), value2: defcs.numberOrVector("1") },
		output: { result: defcs.numberOrVector("1") },
	},
	bytenot: { input: { value: defcs.byte() }, output: { result: defcs.byte() } },
	byteneg: { input: { value: defcs.byte() }, output: { result: defcs.byte() } },
	bytexor: {
		input: { value1: defcs.byte(), value2: defcs.byte() },
		output: { result: defcs.byte() },
	},
	bytexnor: {
		input: { value1: defcs.byte(), value2: defcs.byte() },
		output: { result: defcs.byte() },
	},
	byteand: {
		input: { value1: defcs.byte(), value2: defcs.byte() },
		output: { result: defcs.byte() },
	},
	bytenand: {
		input: { value1: defcs.byte(), value2: defcs.byte() },
		output: { result: defcs.byte() },
	},
	byteor: {
		input: { value1: defcs.byte(), value2: defcs.byte() },
		output: { result: defcs.byte() },
	},
	bytenor: {
		input: { value1: defcs.byte(), value2: defcs.byte() },
		output: { result: defcs.byte() },
	},
	byterotateright: {
		input: { value1: defcs.byte(), value2: defcs.byte() },
		output: { result: defcs.byte() },
	},
	byterotateleft: {
		input: { value1: defcs.byte(), value2: defcs.byte() },
		output: { result: defcs.byte() },
	},
	byteshiftright: {
		input: { value1: defcs.byte(), value2: defcs.byte() },
		output: { result: defcs.byte() },
	},
	byteshiftleft: {
		input: { value1: defcs.byte(), value2: defcs.byte() },
		output: { result: defcs.byte() },
	},
	bytearithmeticshiftright: {
		input: { value1: defcs.byte(), value2: defcs.byte() },
		output: { result: defcs.byte() },
	},
	xor: {
		input: { value1: defcs.bool(), value2: defcs.bool() },
		output: { result: defcs.bool() },
	},
	xnor: {
		input: { value1: defcs.bool(), value2: defcs.bool() },
		output: { result: defcs.bool() },
	},
	and: {
		input: { value1: defcs.bool(), value2: defcs.bool() },
		output: { result: defcs.bool() },
	},
	nand: {
		input: { value1: defcs.bool(), value2: defcs.bool() },
		output: { result: defcs.bool() },
	},
	or: {
		input: { value1: defcs.bool(), value2: defcs.bool() },
		output: { result: defcs.bool() },
	},
	nor: {
		input: { value1: defcs.bool(), value2: defcs.bool() },
		output: { result: defcs.bool() },
	},
	not: { input: { value: defcs.bool() }, output: { result: defcs.bool() } },
	numbertobyte: { input: { value: defcs.number() }, output: { result: defcs.byte() } },
	bytetonumber: { input: { value: defcs.byte() }, output: { result: defcs.number() } },
	vec3combiner: {
		input: { value_x: defcs.number(), value_y: defcs.number(), value_z: defcs.number() },
		output: { result: defcs.vector3() },
	},
	vec3splitter: {
		input: { value: defcs.vector3() },
		output: { result_x: defcs.number(), result_y: defcs.number(), result_z: defcs.number() },
	},
	multiplexer: {
		input: {
			value: defcs.bool(),
			truevalue: connectors.any("1"),
			falsevalue: connectors.any("1"),
		},
		output: { result: connectors.any("1") },
	},
};

/**
 * Block config registry, saved for upgrating the save versions ONLY.
 * @deprecated
 */
export const _BlockConfigRegistrySave = {
	...autos,

	wheel: wheelblock,
	bigwheel: wheelblock,
	smalloldwheel: wheelblock,
	oldwheel: wheelblock,
	bigoldwheel: wheelblock,
	/// ...
	disconnectblock,
	motorblock,
	smallrocketengine: rocketengine,
	rocketengine: rocketengine,
	rcsengine: rcsengine,
	rope,
	servomotorblock,
	sidewaysservo,
	tnt,
	cylindricaltnt: tnt,
	sphericaltnt: tnt,
	suspensionblock,
	vehicleseat,
	passengerseat: vehicleseat,
	magnet,
	piston,
	ballast,
	heliumblock,
	bracedshaft,

	bytemaker,
	bytesplitter,
	vec3objectworldtransformer,

	wing1x1: wing,
	wing1x2: wing,
	wing1x3: wing,
	wing1x4: wing,
	wedgewing1x1: wing,
	wedgewing1x2: wing,
	wedgewing1x3: wing,
	wedgewing1x4: wing,
	lamp: lamp,
	smalllamp: lamp,
	leddisplay,
	sevensegmentdisplay,
	screen,
	laser,

	ownerlocator,
	ownercameralocator,
	speedometer,
	masssensor,
	anglesensor,
	keysensor,
	mousesensor,
	tpscounter: tpscounter,
	altimeter,
	radiotransmitter,
	radioreceiver,

	radarsection,
	firesensor,

	delayblock: delayBlock,

	impulsegenerator,
	counter,
	logicmemory,
	stackmemory,
	gravitysensor,
	randomaccessmemory,
	readonlymemory,
	buffer: anyProcessing,

	vec3splitter,
	vec3combiner,

	singleimpulse,
} as const satisfies { [k in BlockId]?: BlockConfigBothDefinitions };

type BlockConfigDefinitions = ConfigTypesToDefinition<keyof BlockConfigTypes.Types, BlockConfigTypes.Types>;
type BlockConfigBothDefinitions = {
	readonly input: BlockConfigDefinitions;
	readonly output: BlockConfigDefinitions;
};

export type BlockConfigRegistry = Readonly<Record<keyof typeof _BlockConfigRegistrySave, BlockConfigBothDefinitions>>;
