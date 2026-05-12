import { ReplicatedStorage } from "@rbxts/services";
import { Colors } from "engine/shared/Colors";
import { Objects } from "engine/shared/fixes/Objects";
import { BlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { LogControl } from "client/gui/static/LogControl";
import type { BlockLogicArgs, BlockLogicFullBothDefinitions } from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { BlockBuilder } from "shared/blocks/Block";

const vLuau = require(ReplicatedStorage.Modules.vLuau) as {
	luau_execute: (code: string, env: unknown) => LuaTuple<[start: () => void, close: () => void]>;
};

const definitionPart = {
	types: {
		number: { config: 0 },
		bool: { config: false },
		string: { config: "" },
		vector3: { config: Vector3.zero },
		color: { config: new Color3(0, 0, 0) },
	},
	configHidden: true,
};

const definition = {
	inputOrder: ["code", "input1", "input2", "input3", "input4", "input5", "input6", "input7", "input8"],
	outputOrder: ["output1", "output2", "output3", "output4", "output5", "output6", "output7", "output8"],
	input: {
		code: {
			displayName: "Code",
			types: {
				code: {
					config: `-- Read your inputs using "getInput(index)"
-- Write values to outputs using "setOutput(index, value)"
-- You are limited to 8 kilobytes of code. If you're short, use minifers.

onTick(function(deltaTime, tick)
    -- The code here is executed every tick.
    -- deltaTime shows how much time has elapsed since the previous tick. tick shows the current tick number.
    -- Remember that it makes no sense to change the same output several times here.

    -- Key Sensor -> Screen example
    local keyPressed = getInput(1) -- Key sensor
    if keyPressed then
        setOutput(1, "Key pressed") -- Screen
    else
        setOutput(1, "Key is not pressed") -- Screen
    end
end)

print("Hello, OverEngineered!")`,
					lengthLimit: 8192,
				},
			},
			tooltip: "Lua code to run.",
			connectorHidden: true,
		},
		input1: {
			displayName: "Input 1",
			...definitionPart,
		},
		input2: {
			displayName: "Input 2",
			...definitionPart,
		},
		input3: {
			displayName: "Input 3",
			...definitionPart,
		},
		input4: {
			displayName: "Input 4",
			...definitionPart,
		},
		input5: {
			displayName: "Input 5",
			...definitionPart,
		},
		input6: {
			displayName: "Input 6",
			...definitionPart,
		},
		input7: {
			displayName: "Input 7",
			...definitionPart,
		},
		input8: {
			displayName: "Input 8",
			...definitionPart,
		},
	},
	output: {
		output1: {
			displayName: "Output 1",
			types: Objects.keys(definitionPart.types),
		},
		output2: {
			displayName: "Output 2",
			types: Objects.keys(definitionPart.types),
		},
		output3: {
			displayName: "Output 3",
			types: Objects.keys(definitionPart.types),
		},
		output4: {
			displayName: "Output 4",
			types: Objects.keys(definitionPart.types),
		},
		output5: {
			displayName: "Output 5",
			types: Objects.keys(definitionPart.types),
		},
		output6: {
			displayName: "Output 6",
			types: Objects.keys(definitionPart.types),
		},
		output7: {
			displayName: "Output 7",
			types: Objects.keys(definitionPart.types),
		},
		output8: {
			displayName: "Output 8",
			types: Objects.keys(definitionPart.types),
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type { Logic as LuaCircuitBlockLogic };
@injectable
class Logic extends BlockLogic<typeof definition> {
	private close: () => void = undefined!;
	private greenLED: BasePart = undefined!;
	private redLED: BasePart = undefined!;

	constructor(block: BlockLogicArgs, @tryInject logControl?: LogControl) {
		super(definition, block);

		this.greenLED = block.instance?.FindFirstChild("GreenLED") as BasePart;
		this.redLED = block.instance?.FindFirstChild("RedLED") as BasePart;

		this.greenLED.Material = Enum.Material.Neon;
		this.greenLED.Color = Colors.green;

		const inputCaches = {
			[1]: this.initializeInputCache("input1"),
			[2]: this.initializeInputCache("input2"),
			[3]: this.initializeInputCache("input3"),
			[4]: this.initializeInputCache("input4"),
			[5]: this.initializeInputCache("input5"),
			[6]: this.initializeInputCache("input6"),
			[7]: this.initializeInputCache("input7"),
			[8]: this.initializeInputCache("input8"),
		};

		const showErr = (err: unknown) => {
			log(`Runtime error: ${tostring(err)}`, "error");
			blinkRedLEDLoop();
		};

		const log = function (text: string, level: "info" | "warn" | "error"): void {
			if (level === "warn") {
				warn("[Lua Circuit]", text);
				logControl?.addLine(text, Colors.yellow);
			} else if (level === "error") {
				warn("[Lua Circuit]", text);
				logControl?.addLine(text, Colors.red);
			} else {
				print("[Lua Circuit]", text);
				logControl?.addLine(text);
			}
		};

		const tasklib = {
			wait: (duration?: number) => {
				const start = time();
				duration = math.max(duration ?? 0, 0);

				const endTime = start + duration;
				let current = start;

				while (endTime >= current) {
					coroutine.yield();
					current = time();
				}

				return current - start;
			},
			waitTicks: (duration?: number) => {
				const start = time();
				duration = math.max(duration ?? 1, 1);

				for (let i = 0; i < duration; i++) {
					coroutine.yield();
				}

				return time() - start;
			},
		};

		const validOutputTypes: { readonly [k in string]?: keyof BlockLogicTypes.Primitives } = {
			number: "number",
			Vector3: "vector3",
			Color3: "color",
			string: "string",
			boolean: "bool",
		};

		const baseEnv = {
			print: (...args: unknown[]) => {
				for (let i = 0; i < args.size(); i++) {
					args[i] ??= "nil";
				}

				log((args as defined[]).join(" "), "info");
			},
			warn: (...args: unknown[]) => {
				for (let i = 0; i < args.size(); i++) {
					args[i] ??= "nil";
				}

				log((args as defined[]).join(" "), "warn");
			},
			error: (...args: unknown[]) => {
				for (let i = 0; i < args.size(); i++) {
					args[i] ??= "nil";
				}

				log((args as defined[]).join(" "), "error");
			},
			task: tasklib,
			table,
			assert: (condition: boolean, message?: string | undefined) => assert(condition, message),
			pcall,
			xpcall,
			tostring,
			tonumber,
			pairs,
			ipairs,
			type,
			typeof: (obj: unknown) => typeOf(obj),
			math,
			string,
			bit32,
			Vector2,
			Vector3,
			CFrame,
			Color3,
			DateTime,
			time,
			buffer,
			utf8,
			next,
			select,

			onTick: (func: (dt: number, tick: number) => void): void => {
				this.onTicc((ctx) => {
					try {
						const c = coroutine.create(() => func(ctx.dt, ctx.tick));
						const [success, data] = coroutine.resume(c);
						if (!success) throw data;

						coroutines.push(c);
					} catch (err) {
						showErr(err);
						this.close();
					}
				});
			},

			getInput: (input: number): string | number | boolean | Vector3 | Color3 | undefined => {
				if (input < 1 || input > 8) {
					error("Output index must be between 1 and 8", 2);
				}

				return inputCaches[input as 1].tryGet();
			},
			setOutput: (output: number, value: unknown): void => {
				if (output < 1 || output > 8) {
					error("Output index must be between 1 and 8", 2);
				}

				const retType = validOutputTypes[typeOf(value)];
				if (!retType) {
					error(`Invalid object type ${typeOf(value)}`, 2);
				}

				this.output[`output${output}` as "output1"].set(retType as never, value as never);
			},
		};

		const safeEnv = setmetatable(
			{},
			{
				__index: baseEnv as never,
				__newindex: (_, key, value) => {
					if (baseEnv[key as never] !== undefined) {
						error("Attempt to overwrite protected key: " + tostring(key), 2);
					}
					rawset(baseEnv, key, value);
				},
			},
		);

		const blinkRedLEDLoop = () => {
			this.event.loop(0.1, () => {
				this.redLED.Color = this.redLED.Color === Colors.red ? new Color3(91, 93, 105) : Colors.red;
				this.redLED.Material =
					this.redLED.Material === Enum.Material.Neon ? Enum.Material.SmoothPlastic : Enum.Material.Neon;
			});
		};

		const coroutines: thread[] = [];
		const removedCoroutines: thread[] = [];
		this.onTicc((ctx) => {
			for (const t of coroutines) {
				if (coroutine.status(t) === "dead") {
					removedCoroutines.push(t);
					continue;
				}

				const [success, data] = coroutine.resume(t, ctx.dt, ctx.tick);
				if (!success) {
					showErr(data);
				}
			}
			for (const removed of removedCoroutines) {
				coroutines.remove(coroutines.indexOf(removed));
			}
			removedCoroutines.clear();
		});

		this.onkFirstInputs(["code"], ({ code }) => {
			let bytecode: () => void;

			try {
				[bytecode, this.close] = vLuau.luau_execute(code, safeEnv);
			} catch (err) {
				log(`Compilation error: ${tostring(err)}`, "error");
				blinkRedLEDLoop();

				return;
			}

			try {
				coroutines.push(coroutine.create(bytecode));
			} catch (err) {
				showErr(err);
			}
		});
	}
}

export const LuaCircuitBlock = {
	...BlockCreation.defaults,
	id: "luacircuit",
	displayName: "Lua Circuit",
	description: "Allows you to run Lua code to program your buildings. If the code is too large, use a minifier.",
	limit: 1,

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
