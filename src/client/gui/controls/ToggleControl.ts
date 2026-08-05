import { Control } from "engine/client/gui/Control";
import { Transforms } from "engine/shared/component/Transforms";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Signal } from "engine/shared/event/Signal";
import { Colors } from "shared/Colors";
import type { Theme } from "client/Theme";

export type ToggleControlDefinition = TextButton & {
	readonly Circle: TextButton;
};

type TAllowNull<Allow extends boolean> = Allow extends true ? boolean | undefined : boolean;
class _ToggleControl<AllowNull extends boolean> extends Control<ToggleControlDefinition> {
	private readonly _submitted = new Signal<(value: boolean) => void>();
	readonly submitted = this._submitted.asReadonly();
	readonly value = new ObservableValue<TAllowNull<AllowNull>>(false);

	constructor(gui: ToggleControlDefinition) {
		super(gui);

		const clicked = () => {
			const val = !this.value.get();
			this.value.set(val);
			this._submitted.Fire(val);
		};

		gui.Circle.AutoButtonColor = false;
		this.event.subscribe(gui.MouseButton1Click, clicked);

		const colorTrue = new ObservableValue(Colors.accent);
		const colorFalse = new ObservableValue(Colors.accentDark);

		this.onInject((di) => {
			const theme = di.resolve<Theme>();
			this.event.subscribeObservable(theme.get("buttonActive"), (c) => colorTrue.set(c), true);
			this.event.subscribeObservable(theme.get("buttonNegative"), (c) => colorFalse.set(c), true);
		});

		const circle = this.parent(new Control(gui.Circle));

		const val = this.event.addObservable(this.value.fReadonlyWithDefault(false));
		this.valuesComponent() //
			.get("BackgroundColor3")
			.addTransitionBetweenBoolObservables(this.event, val, colorTrue, colorFalse, Transforms.quadOut02);

		circle
			.valuesComponent()
			.get("Position")
			.addChildOverlay(this.value.createBased((enabled) => new UDim2(enabled ? 0.5 : 0, 0, 0, 0)))
			.addBasicTransform(Transforms.quadOut02);
	}
}

/** Control that represents a boolean */
export class ToggleControl extends _ToggleControl<false> {}

/** Control that represents a boolean, with support of undefined state */
export class ToggleControlNullable extends _ToggleControl<true> {}
