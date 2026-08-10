import { Players, UserInputService } from "@rbxts/services";
import { NumberTextBoxControlNullable } from "client/gui/controls/NumberTextBoxControl";
import { ProgressBarControl } from "client/gui/controls/ProgressBarControl";
import { PartialControl } from "engine/client/gui/PartialControl";
import { EventHandler } from "engine/shared/event/EventHandler";
import { NumberObservableValue } from "engine/shared/event/NumberObservableValue";
import { Signal } from "engine/shared/event/Signal";
import { MathUtils } from "engine/shared/fixes/MathUtils";
import type { RelativeApply } from "client/gui/controls/NumberTextBoxControl";
import type {
	ProgressBarControlDefinition,
	ProgressBarControlDefinitionParts,
} from "client/gui/controls/ProgressBarControl";

type ToNum<TAllowNull extends boolean> = TAllowNull extends false ? number : number | undefined;
export type SliderControlDefinition = ProgressBarControlDefinition & SliderControlDefinitionParts;
export type SliderControlDefinitionParts = ProgressBarControlDefinitionParts & {
	readonly TextBox?: TextBox;
	readonly Hitbox?: GuiObject;
};

export interface SliderControlConfig {
	readonly min: number;
	readonly max: number;
	readonly step?: number;
	readonly inputStep?: number;
}

/** Control that represents a number via a slider. */
class _SliderControl<TAllowNull extends boolean = false> extends PartialControl<
	SliderControlDefinitionParts,
	GuiObject,
	SliderControlDefinitionParts & { readonly Hitbox: GuiObject }
> {
	private numberBox?: NumberTextBoxControlNullable;
	private readonly _submitted = new Signal<(value: number, apply?: RelativeApply) => void>();
	readonly submitted = this._submitted.asReadonly();
	private readonly _moved = new Signal<(value: number) => void>();
	readonly moved = this._moved.asReadonly();
	readonly value;

	private readonly progressBar;
	private readonly inputStep;

	constructor(
		gui: SliderControlDefinition,
		private readonly config: SliderControlConfig,
		parts?: SliderControlDefinitionParts,
	) {
		if (!parts?.Hitbox) {
			parts = { ...parts, Hitbox: gui };
		}

		super(gui, parts);

		const { min, max, step, inputStep } = config;
		this.inputStep = inputStep ?? step ?? 0.01;

		this.progressBar = new ProgressBarControl(this.gui, min, max, step, this.parts);
		this.progressBar.instance.Active = true;
		this.add(this.progressBar);

		this.value = new NumberObservableValue<ToNum<TAllowNull>>(min, min, max, step);
		this.value.subscribe((value) => this.progressBar.value.set(value ?? 0), true);

		this.subscribeMovement();

		if (this.parts.TextBox) {
			const num = new NumberTextBoxControlNullable(this.parts.TextBox, this.value);
			this.event.subscribe(num.submitted, (value, apply) => this._submitted.Fire(value, apply));
			this.add(num);
			this.numberBox = num;
		}
	}

	/** Forwarded to the manual entry box; the slider itself has no text to read an adjustment out of. */
	setRelative(relative: boolean) {
		if (this.numberBox) this.numberBox.relative = relative;
	}

	private subscribeMovement() {
		const eh = new EventHandler();
		let startpos: number | undefined;

		const moveMouse = () => {
			if (startpos === undefined) return;

			if (this.progressBar.vertical) {
				const y = this.parts.Hitbox.AbsoluteSize.Y - Players.LocalPlayer.GetMouse().Y;

				let value =
					((y - startpos) / this.parts.Hitbox.AbsoluteSize.Y) * this.value.getRange() + this.value.min;
				value = MathUtils.round(value, this.inputStep);

				this.value.set(value);
				this._moved.Fire(math.clamp(value, this.config.min, this.config.max));
			} else {
				const x = Players.LocalPlayer.GetMouse().X;

				let value =
					((x - startpos) / this.parts.Hitbox.AbsoluteSize.X) * this.value.getRange() + this.value.min;
				value = MathUtils.round(value, this.inputStep);

				this.value.set(value);
				this._moved.Fire(math.clamp(value, this.config.min, this.config.max));
			}
		};

		let st = false;
		const unsub = () => {
			st = false;
			startpos = undefined;
			eh.unsubscribeAll();

			const value = this.value.get();
			if (value !== undefined) {
				this._submitted.Fire(value);
			}
		};
		const sub = (signal: RBXScriptSignal<(input: InputObject) => void>) => {
			this.event.subscribe(signal, (input) => {
				if (
					input.UserInputState === Enum.UserInputState.Begin &&
					(input.UserInputType === Enum.UserInputType.MouseButton1 ||
						input.UserInputType === Enum.UserInputType.Touch)
				) {
					startpos = this.progressBar.vertical
						? this.parts.Hitbox.AbsoluteSize.Y -
							this.parts.Hitbox.AbsolutePosition.Y +
							this.parts.Hitbox.AbsoluteSize.Y
						: this.parts.Hitbox.AbsolutePosition.X;
					moveMouse();

					eh.subscribe(Players.LocalPlayer.GetMouse().Move, () => moveMouse());
					eh.subscribe(UserInputService.InputEnded, (input, _) => {
						if (startpos === undefined) return;

						if (
							input.UserInputType === Enum.UserInputType.MouseButton1 ||
							input.UserInputType === Enum.UserInputType.Touch
						) {
							unsub();
						}
					});
				}
			});
		};

		if (this.parts.Knob) {
			this.parts.Knob.SelectionGroup = true;
			this.parts.Knob.SelectionBehaviorLeft = Enum.SelectionBehavior.Stop;
			this.parts.Knob.SelectionBehaviorRight = Enum.SelectionBehavior.Stop;
		}

		const moveGamepad = (posx: boolean) => {
			const step = this.inputStep;
			const value = (this.value.get() ?? 0) + (posx ? step : -step);
			this.value.set(value);
			this._moved.Fire(value);
		};

		if (this.parts.Knob) {
			this.event.subscribe(this.parts.Knob.SelectionGained, () => {
				eh.subscribe(UserInputService.InputBegan, (input) => {
					if (!st) return;

					if (input.UserInputType === Enum.UserInputType.Gamepad1) {
						if (this.progressBar.vertical) {
							if (input.KeyCode === Enum.KeyCode.DPadUp) moveGamepad(true);
							else if (input.KeyCode === Enum.KeyCode.DPadDown) moveGamepad(false);
						} else {
							if (input.KeyCode === Enum.KeyCode.DPadRight) moveGamepad(true);
							else if (input.KeyCode === Enum.KeyCode.DPadLeft) moveGamepad(false);
						}
					}
				});
				eh.subscribe(UserInputService.InputChanged, (input) => {
					if (!st) return;

					if (this.progressBar.vertical) {
						if (input.UserInputType === Enum.UserInputType.Gamepad1 && input.Position.X !== 0) {
							moveGamepad(input.Position.X > 0);
						}
					} else {
						if (input.UserInputType === Enum.UserInputType.Gamepad1 && input.Position.Y !== 0) {
							moveGamepad(input.Position.Y > 0);
						}
					}
				});

				st = true;
			});

			this.event.subscribe(this.parts.Knob.SelectionLost, unsub);
			sub(this.parts.Knob.InputBegan);
		}

		if (this.parts.Filled) {
			sub(this.parts.Filled.InputBegan);
		}

		sub(this.parts.Hitbox.InputBegan);
	}
}

/** Control that represents a number via a slider. */
export class SliderControl extends _SliderControl<false> {}

/** Control that represents a number via a slider, nullable. */
export class SliderControlNullable extends _SliderControl<true> {}
