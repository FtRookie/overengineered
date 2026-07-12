import { KeyPressingDefinitionsController } from "client/controller/KeyPressingController";
import { Component } from "engine/shared/component/Component";
import { Keys } from "engine/shared/fixes/Keys";
import { MathUtils } from "engine/shared/fixes/MathUtils";
import { Objects } from "engine/shared/fixes/Objects";
import type { KeyDefinitions } from "client/controller/KeyPressingController";
import type { TouchModeButtonData } from "client/gui/ridemode/TouchModeButtonControl";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { ILogicValueStorage } from "shared/blockLogic/BlockLogicValueStorage";

type Controls = BlockLogicTypes.Controls;
type ControlKeys = keyof Controls;

namespace ClientBlockControlsNamespace {
	export class Bool extends Component implements IClientBlockControl {
		private readonly touchButtonDatas: readonly TouchModeButtonData[];

		constructor(
			value: ILogicValueStorage<"bool">,
			config: Controls["bool"]["config"],
			definition: OmitOverUnion<Controls["bool"], "config">,
		) {
			super();

			let val = config.reversed;
			const get = () => val;
			const set = (newValue: boolean) => value.set("bool", (val = newValue));
			set(config.reversed);

			if (Keys.isKey(config.key)) {
				if (definition.canBeSwitch && config.switch) {
					this.event.onKeyDown(config.key, () => set(!get()));
				} else {
					this.event.onKeyDown(config.key, () => set(!config.reversed));
					this.event.onKeyUp(config.key, () => set(config.reversed));
				}
			}

			this.touchButtonDatas = [
				{
					name: config.key,
					press: () => set(true),
					release: () => set(false),
					isPressed: () => get(),
					toggleMode: definition.canBeSwitch && config.switch,
				},
			];
		}

		getTouchButtonDatas(): readonly TouchModeButtonData[] {
			return this.touchButtonDatas;
		}
	}

	function createNumberController(
		value: ILogicValueStorage<"number">,
		config: BlockLogicTypes.NumberControl["config"],
		definition: Omit<BlockLogicTypes.Number, "config">,
	): KeyPressingDefinitionsController<KeyDefinitions<string>> {
		let currentValue = config.startValue;
		const actualSet = (newValue: number) => value.set("number", (currentValue = newValue));

		const clamp = definition.clamp;

		let smoothMovingTask: thread | undefined;
		let smoothAmount = config.startValue;
		const smoothSet = (target: number, speed: number | undefined) => {
			if (smoothMovingTask) {
				smoothCancel();
			}

			if (!speed) {
				smoothAmount = MathUtils.round(target, clamp?.step);
				actualSet(smoothAmount);
				return;
			}

			const step = smoothAmount < target ? speed : -speed;
			if (step === 0) return;

			const direction = math.sign(step) as -1 | 1;
			smoothMovingTask = task.spawn(() => {
				while (true as boolean) {
					const dt = task.wait();

					smoothAmount = MathUtils.clamp(smoothAmount + step * dt, clamp?.min, clamp?.max);

					if (direction < 0) smoothAmount = math.max(smoothAmount, target);
					else smoothAmount = math.min(smoothAmount, target);

					actualSet(MathUtils.round(smoothAmount, clamp?.step));

					// stop when reached the target
					if (direction > 0 && smoothAmount >= target) return;
					if (direction < 0 && smoothAmount <= target) return;
				}
			});
		};
		const smoothCancel = () => smoothMovingTask && task.cancel(smoothMovingTask);

		//

		let movingTo: string | undefined;
		const createDoublePress = (
			v: BlockLogicTypes.NumberControlKey,
			onSet: (valuye: number) => void,
			onReset: () => void,
		) => {
			return () => {
				if (movingTo !== v.key) {
					onSet(v.value);
					movingTo = v.key;
				} else {
					onReset();
					movingTo = undefined;
				}
			};
		};

		let set: (value: number) => void;
		const reset = () => set(config.startValue);
		const instantReset = () => smoothSet(config.startValue, undefined);

		let mapper: (v: BlockLogicTypes.NumberControlKey) => {
			readonly keyDown: (() => void) | undefined;
			readonly keyUp: (() => void) | undefined;
		};

		const mode = config.mode;
		if (mode.type === "smooth") {
			const mode = config.mode.smooth;
			const speed = mode.speed;
			set = (value) => smoothSet(value, speed);

			if (mode.mode === "never") {
				mapper = (v) => ({
					keyDown: () => set(v.value),
					keyUp: undefined,
				});
			} else if (mode.mode === "stopOnRelease") {
				mapper = (v) => ({
					keyDown: () => set(v.value),
					keyUp: smoothCancel,
				});
			} else if (mode.mode === "stopOnDoublePress") {
				mapper = (v) => ({
					keyDown: createDoublePress(v, set, smoothCancel),
					keyUp: undefined,
				});
			} else if (mode.mode === "resetOnRelease") {
				mapper = (v) => ({
					keyDown: () => set(v.value),
					keyUp: reset,
				});
			} else if (mode.mode === "instantResetOnRelease") {
				mapper = (v) => ({
					keyDown: () => set(v.value),
					keyUp: instantReset,
				});
			} else if (mode.mode === "resetOnDoublePress") {
				mapper = (v) => ({
					keyDown: createDoublePress(v, set, reset),
					keyUp: undefined,
				});
			} else if (mode.mode === "instantResetOnDoublePress") {
				mapper = (v) => ({
					keyDown: createDoublePress(v, set, instantReset),
					keyUp: undefined,
				});
			}
		} else {
			const mode = config.mode.instant;
			set = actualSet;

			if (mode.mode === "never") {
				mapper = (v) => ({
					keyDown: () => set(v.value),
					keyUp: undefined,
				});
			} else if (mode.mode === "onRelease") {
				mapper = (v) => ({
					keyDown: () => set(v.value),
					keyUp: reset,
				});
			} else if (mode.mode === "onDoublePress") {
				mapper = (v) => ({
					keyDown: createDoublePress(v, set, reset),
					keyUp: undefined,
				});
			}
		}

		//

		actualSet(config.startValue);

		const allKeys = config.keys.map((k) => k.key);
		const def: KeyDefinitions<string> = Objects.map(
			config.keys,
			(i, v) => v.key,
			(_, v) => ({
				key: v.key,
				conflicts: allKeys.except([v.key]),
				...mapper(v),
			}),
		);

		return new KeyPressingDefinitionsController(def);
	}

	export class Number extends Component implements IClientBlockControl {
		private readonly touchButtonDatas: readonly TouchModeButtonData[];

		constructor(
			value: ILogicValueStorage<"number">,
			config: BlockLogicTypes.NumberControl["config"],
			definition: Omit<BlockLogicTypes.Number, "config">,
		) {
			super();

			const controller = this.parent(createNumberController(value, config, definition));
			this.touchButtonDatas = config.keys.map(
				(k): TouchModeButtonData => ({
					name: k.key,
					press: () => controller.controller.keyDown(k.key),
					release: () => controller.controller.keyUp(k.key),
					isPressed: () => controller.controller.isDown(k.key),
					toggleMode: false,
				}),
			);
		}

		getTouchButtonDatas(): readonly TouchModeButtonData[] {
			return this.touchButtonDatas;
		}
	}
}

export type IClientBlockControl = Component & {
	getTouchButtonDatas(): readonly TouchModeButtonData[];
};

type ClientBlockControlStorage<TType extends ControlKeys> = (
	value: ILogicValueStorage<TType>,
	config: Controls[TType]["config"],
	definition: MakeRequired<OmitOverUnion<BlockLogicTypes.Primitives[TType], "config">, "control">,
) => IClientBlockControl;
type GenericClientBlockControlStorage = (
	value: ILogicValueStorage<keyof BlockLogicTypes.Primitives>,
	config: Controls[ControlKeys]["config"],
	definition: MakeRequired<OmitOverUnion<BlockLogicTypes.Primitives[ControlKeys], "config">, "control">,
) => IClientBlockControl;

export const ClientBlockControls: { readonly [k in ControlKeys]?: GenericClientBlockControlStorage } = {
	bool: (value, config, definition) => new ClientBlockControlsNamespace.Bool(value, config, definition.control),
	number: (value, config, definition) => new ClientBlockControlsNamespace.Number(value, config, definition),
} satisfies { readonly [k in ControlKeys]?: ClientBlockControlStorage<k> } as never;
