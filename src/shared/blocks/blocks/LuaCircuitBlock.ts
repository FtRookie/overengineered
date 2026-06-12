import { ReplicatedStorage } from "@rbxts/services";
import { Colors } from "engine/shared/Colors";
import { JSON } from "engine/shared/fixes/Json";
import { Objects } from "engine/shared/fixes/Objects";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { LogControl } from "client/gui/static/LogControl";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { BlockBuilder } from "shared/blocks/Block";

type VLuauSettings = {
	callHooks: { interruptHook?: () => void };
};
const vLuau = require(ReplicatedStorage.Modules.vLuau) as {
	luau_execute: (
		code: string,
		env: unknown,
		chunkname?: string,
		settings?: VLuauSettings,
	) => LuaTuple<[start: () => void, close: () => void]>;
	create_settings: () => VLuauSettings;
};

// one cycle = one function call or loop back-edge in user code (Fiu interrupt hook); bounds worst-case interpreter time per tick
const cyclesPerTick = 8192;
// throttled code parks threads instead of finishing them; cap the pileup
const maxThreads = 1024;

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

const ioNumbers = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const definition = {
	inputOrder: ["code", ...ioNumbers.map((i) => `input${i}`)],
	outputOrder: ioNumbers.map((i) => `output${i}`),
	input: {
		code: {
			displayName: "Code",
			types: {
				code: {
					// dont change formatting, it's important how it is
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

							print("Hello, OverEngineered!")`.gsub("\n" + "\t".rep(7), "\n")[0],
					lengthLimit: 8192,
				},
			},
			tooltip: "Lua code to run.",
			connectorHidden: true,
		},
		...asObject(
			ioNumbers.mapToMap((i) =>
				$tuple(`input${i}` as `input${typeof i}`, { displayName: `Input ${i}`, ...definitionPart }),
			),
		),
	},
	output: asObject(
		ioNumbers.mapToMap((i) =>
			$tuple(`output${i}` as `output${typeof i}`, {
				displayName: `Output ${i}`,
				types: Objects.keys(definitionPart.types),
			}),
		),
	),
} satisfies BlockLogicFullBothDefinitions;

type LuaCircuitModel = BlockModel & {
	readonly GreenLED: BasePart;
	readonly RedLED: BasePart;
};

type LogLevel = "info" | "warn" | "error";

export type { Logic as LuaCircuitBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition, LuaCircuitModel> {
	static validOutputTypes: { readonly [k in string]?: keyof BlockLogicTypes.Primitives } = {
		number: "number",
		Vector3: "vector3",
		Color3: "color",
		string: "string",
		boolean: "bool",
	};
	private close: () => void = undefined!;

	constructor(block: InstanceBlockLogicArgs, @tryInject logControl?: LogControl) {
		super(definition, block);

		this.instance.GreenLED.Material = Enum.Material.Neon;
		this.instance.GreenLED.Color = Colors.green;

		const inputCaches = asObject(
			ioNumbers.mapToMap((i) => $tuple(i, this.initializeInputCache(`input${i}` as "input1"))),
		);

		const showErr = (err: unknown) => {
			log(`Runtime error: ${tostring(err)}`, "error");
			blinkRedLEDLoop();
		};

		const log = function (text: string, level: LogLevel): void {
			switch (level) {
				case "warn":
					warn("[Lua Circuit]", text);
					logControl?.addLine(text, Colors.yellow);
					break;
				case "error":
					warn("[Lua Circuit]", text);
					logControl?.addLine(text, Colors.red);
					break;
				default:
					print("[Lua Circuit]", text);
					logControl?.addLine(text);
			}
		};

		let remainingCycles = cyclesPerTick;
		let warnedThrottle = false;
		const vmSettings = vLuau.create_settings();
		vmSettings.callHooks.interruptHook = () => {
			if (remainingCycles-- > 0) return;

			if (!warnedThrottle) {
				warnedThrottle = true;
				log(`Cycle budget (${cyclesPerTick}/tick) exceeded; execution throttled`, "warn");
			}
			coroutine.yield();
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
			spawn: (callback: Callback, ...args: unknown[]) => {
				const thread = coroutine.create(() => {
					const [ok, err] = pcall(callback, ...args);
					if (!ok) showErr(err);
				});
				// resume immediately up to first yield, matching task.spawn semantics
				const [ok, err] = coroutine.resume(thread);
				if (!ok) showErr(err);
				if (coroutine.status(thread) !== "dead") {
					registerThread(thread);
				}
				return () => {
					const idx = coroutines.indexOf(thread);
					if (idx !== -1) coroutines.remove(idx);
				};
			},

			defer: (callback: Callback, ...args: unknown[]) => {
				const thread = coroutine.create(() => {
					const [ok, err] = pcall(callback, ...args);
					if (!ok) showErr(err);
				});
				// no immediate resume — runs on next tick
				registerThread(thread);
				return () => {
					const idx = coroutines.indexOf(thread);
					if (idx !== -1) coroutines.remove(idx);
				};
			},

			delay: (seconds: number, callback: Callback, ...args: unknown[]) => {
				const thread = coroutine.create(() => {
					// reuse wait so it drives off the same tick loop
					tasklib.wait(math.max(seconds, 0));
					const [ok, err] = pcall(callback, ...args);
					if (!ok) showErr(err);
				});
				registerThread(thread);
				return () => {
					const idx = coroutines.indexOf(thread);
					if (idx !== -1) coroutines.remove(idx);
				};
			},
		};
		const logFunction =
			(level: LogLevel) =>
			(...args: unknown[]) => {
				for (let i = 0; i < args.size(); i++) {
					args[i] ??= "nil";
				}

				log((args as defined[]).join(" "), level);
			};
		const baseEnv = {
			print: logFunction("info"),
			warn: logFunction("warn"),
			error: (message?: unknown, level?: number) => error(message, level),
			task: tasklib,
			table,
			assert: (condition: unknown, message?: unknown) => {
				if (condition === undefined || condition === false) {
					error(message ?? "assertion failed!", 2);
				}
				return $tuple(condition, message);
			},
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
			coroutine,
			json: { encode: JSON.serialize, decode: JSON.deserialize },

			onTick: (func: (dt: number, tick: number) => void): void => {
				this.onTicc((ctx) => {
					try {
						const c = coroutine.create(() => func(ctx.dt, ctx.tick));
						const [success, data] = coroutine.resume(c);
						if (!success) throw data;

						registerThread(c);
					} catch (err) {
						showErr(err);
						this.close();
					}
				});
			},

			getInput: (input: number): string | number | boolean | Vector3 | Color3 | undefined => {
				if (!typeIs(input, "number") || input < 1 || input > 8 || input % 1 !== 0) {
					error("Input index must be an integer between 1 and 8", 2);
				}

				return inputCaches[input as 1].tryGet();
			},
			setOutput: (output: number, value: unknown): void => {
				if (!typeIs(output, "number") || output < 1 || output > 8 || output % 1 !== 0) {
					error("Output index must be an integer between 1 and 8", 2);
				}

				const storage = this.output[`output${output}` as "output1"];
				if (value === undefined) {
					storage.unset();
					return;
				}

				const retType = Logic.validOutputTypes[typeOf(value)];
				if (!retType) {
					error(`Invalid object type ${typeOf(value)}`, 2);
				}

				storage.set(retType as never, value as never);
			},
		};

		const safeEnv = setmetatable(
			{},
			{
				__index: baseEnv as never,
				__newindex: (t, key, value) => {
					if (baseEnv[key as never] !== undefined) {
						error("Attempt to overwrite protected key: " + tostring(key), 2);
					}
					// store user globals on the proxy itself: once the key exists there, reassignments are plain writes that skip __newindex
					rawset(t, key, value);
				},
			},
		);

		let blinking = false;
		const blinkRedLEDLoop = () => {
			if (blinking) return;
			blinking = true;

			this.event.loop(0.1, () => {
				this.instance.RedLED.Color =
					this.instance.RedLED.Color === Colors.red ? new Color3(91, 93, 105) : Colors.red;
				this.instance.RedLED.Material =
					this.instance.RedLED.Material === Enum.Material.Neon
						? Enum.Material.SmoothPlastic
						: Enum.Material.Neon;
			});
		};

		const coroutines: thread[] = [];
		const removedCoroutines: thread[] = [];
		const registerThread = (t: thread) => {
			if (coroutines.size() >= maxThreads) {
				error(`Too many active threads (max ${maxThreads})`, 2);
			}
			coroutines.push(t);
		};
		this.onTicc((ctx) => {
			remainingCycles = cyclesPerTick;
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
				[bytecode, this.close] = vLuau.luau_execute(code, safeEnv, "LuaCircuit", vmSettings);
			} catch (err) {
				log(`Compilation error: ${tostring(err)}`, "error");
				blinkRedLEDLoop();
				return;
			}

			try {
				registerThread(coroutine.create(bytecode));
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
