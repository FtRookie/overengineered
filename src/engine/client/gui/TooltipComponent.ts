import { Players, RunService, UserInputService } from "@rbxts/services";
import { ServiceIntegrityChecker } from "client/integrity/ServiceIntegrityChecker";
import { AutoUIScaledComponent } from "engine/client/gui/AutoUIScaledControl";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { Colors } from "engine/shared/Colors";
import { Component } from "engine/shared/component/Component";
import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { Transforms } from "engine/shared/component/Transforms";
import { Element } from "engine/shared/Element";
import { ObservableCollectionArr } from "engine/shared/event/ObservableCollection";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { TransformProps } from "engine/shared/component/Transform";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";

const screen = Element.create("ScreenGui", {
	Name: "TooltipScreen",
	ResetOnSpawn: false,
	IgnoreGuiInset: true,
	ClipToDeviceSafeArea: false,
	SafeAreaCompatibility: Enum.SafeAreaCompatibility.None,
	ScreenInsets: Enum.ScreenInsets.None,
	DisplayOrder: 99999,
	Parent: Players.LocalPlayer.FindFirstChildOfClass("PlayerGui")!,
});
ServiceIntegrityChecker.whitelistInstance(screen);

type TooltipDefinition = GuiObject & {
	readonly TextLabel: TextLabel;
};
const tooltipTemplate = Control.asTemplateWithMemoryLeak(
	Interface.getTemplates<{ Tooltip: TooltipDefinition }>().Tooltip,
	false,
);

class Tooltip extends InstanceComponent<TooltipDefinition> {
	readonly text = new ObservableValue<string | undefined>(undefined);

	constructor() {
		super(tooltipTemplate());

		this.instance.Visible = false;
		this.instance.BackgroundTransparency = 1;
		this.instance.TextLabel.TextTransparency = 1;

		this.instance.Parent = screen;
		this.getComponent(AutoUIScaledComponent);

		this.subscribeVisibilityFrom({
			main: this.enabledState,
			hasText: this.text.createBased((t) => t !== undefined && t.size() !== 0),
		});

		this.visibilityComponent().addTransformFunc((visible) =>
			Transforms.create() //
				.wait(visible ? 0.4 : 0.1)
				.then()
				.transform(this.instance, "BackgroundTransparency", visible ? 0 : 1, Transforms.quadOut02)
				.transform(this.instance.TextLabel, "TextTransparency", visible ? 0 : 1, Transforms.quadOut02),
		);

		{
			const bg = this.valuesComponent().get("BackgroundColor3");
			const flash = new ObservableValue(0);
			this.event.subscribeObservable(flash, () => {
				bg.effect("flash", (color) => color.Lerp(Colors.white, flash.get()), 999999);
			});

			this.event.subscribeObservable(
				this.text,
				(text) => {
					if (!text || text.size() === 0) return;

					this.instance.TextLabel.Text = text;

					Transforms.create() //
						.transformObservable(flash, 0.2)
						.transformObservable(flash, 0, { duration: 0.5 })
						.run(flash, true);
				},
				true,
			);
		}

		const getMousePosition = () => {
			const mousePos = UserInputService.GetMouseLocation();
			return new UDim2(0, mousePos.X + 10, 0, mousePos.Y - 20);
		};
		const moveToMouse = (props?: TransformProps) => {
			Transforms.create() //
				.move(this.instance, getMousePosition(), props)
				.run(this, true);
		};

		const props: TransformProps = { ...Transforms.quadOut02, duration: 0.1 };
		this.event.subscribe(RunService.PostSimulation, () => {
			if (!this.instance.Visible) return;
			moveToMouse(props);
		});
		this.event.subscribeObservable(
			this.event.observableFromInstanceParam(this.instance, "Visible"),
			(visible) => {
				if (!visible) return;
				moveToMouse();
			},
			true,
		);
	}
}

class TooltipController extends Component {
	private readonly tooltip;
	private readonly hovered = new ObservableCollectionArr<TooltipComponent>();

	constructor() {
		super();
		this.tooltip = this.parent(new Tooltip());

		this.event.subscribeObservable(
			this.hovered,
			() => this.tooltip.text.set(this.hovered.get()[this.hovered.size() - 1]?.text.get()),
			true,
		);
	}

	init(component: TooltipComponent): void {
		component.hovered.subscribe((hovered) => {
			if (hovered) {
				this.hovered.add(component);
			} else {
				this.hovered.remove(component);
			}
		});
	}
}

const controller = new TooltipController();
controller.enable();

export class TooltipComponent extends Component {
	readonly hovered: ReadonlyObservableValue<boolean>;
	readonly text = new ObservableValue<string | undefined>(undefined);

	constructor(parent: InstanceComponent<GuiObject>) {
		super();

		const hovered = new ObservableValue(false);
		this.hovered = hovered;

		const start = () => hovered.set(true);
		const stop = () => hovered.set(false);

		this.event.subscribe(parent.instance.MouseEnter, start);
		this.event.subscribe(parent.instance.MouseLeave, stop);
		this.onDisable(stop);

		controller.init(this);
	}
}
