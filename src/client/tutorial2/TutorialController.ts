import { ContextActionService } from "@rbxts/services";
import { LabelControl } from "client/gui/controls/LabelControl";
import { ScaledScreenGui } from "client/gui/ScaledScreenGui";
import { ServiceIntegrityChecker } from "client/integrity/ServiceIntegrityChecker";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { Colors } from "engine/shared/Colors";
import { Component } from "engine/shared/component/Component";
import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { Transforms } from "engine/shared/component/Transforms";
import { Element } from "engine/shared/Element";

const prefab = Interface.getInterface<{
	Help: {
		Tutorial: GuiObject & {
			// readonly Dialog: DialogDefinition;
			readonly Progress: ProgressDefinition;
			readonly Text: HelpTextDefinition;
		};
	};
}>().Help.Tutorial;
prefab.Visible = false;

type ProgressTaskDefinition = GuiObject & {
	readonly UIGradient: UIGradient;
	readonly NameLabel: TextLabel;
	readonly ProgressLabel: TextLabel;
};
class ProgressTask extends Control<ProgressTaskDefinition> {
	constructor(gui: ProgressTaskDefinition) {
		super(gui);
	}

	hideProgressText() {
		this.gui.ProgressLabel.Visible = false;
	}

	setText(text: string) {
		this.gui.NameLabel.Text = text;
	}
	setProgress(done: number, count: number) {
		if (count === 0) {
			this.gui.ProgressLabel.Text = "";
			this.gui.UIGradient.Transparency = new NumberSequence(0);
			return;
		}

		this.gui.ProgressLabel.Text = `${done}/${count}`;

		if (done >= count - 0.1) {
			this.gui.UIGradient.Transparency = new NumberSequence(0);
		} else {
			this.gui.UIGradient.Transparency = new NumberSequence([
				new NumberSequenceKeypoint(0, 0),
				new NumberSequenceKeypoint(done / count + 0.05, 0),
				new NumberSequenceKeypoint(done / count + 0.1, 1),
				new NumberSequenceKeypoint(1, 1),
			]);
		}
	}
}

type ProgressDefinition = GuiObject & {
	readonly Header: TextLabel;
	readonly Content: GuiObject & {
		readonly Tasks: GuiObject & {
			readonly Task: ProgressTaskDefinition;
		};
		readonly TextLabel: TextLabel;
		readonly Buttons: GuiObject & {
			readonly Skip: GuiButton;
			readonly Stop: GuiButton;
		};
	};
	readonly Progress: GuiObject & {
		readonly Inner: GuiObject;
	};
};
class Progress extends Control<ProgressDefinition> {
	private readonly taskTemplate;
	private stopAction = () => {};
	private skipAction = () => {};

	constructor(gui: ProgressDefinition) {
		super(gui);
		this.gui.Progress.Size = new UDim2(new UDim(0, 0), this.gui.Progress.Size.Y);
		this.taskTemplate = this.asTemplate(gui.Content.Tasks.Task);

		this.gui.Content.Buttons.Stop.Visible = false;
		this.parent(new Control(gui.Content.Buttons.Stop)) //
			.addButtonAction(() => this.stopAction());
	}

	/** Sets the title */
	setTitle(text: string) {
		this.gui.Header.Text = text;
	}
	/** Sets the text */
	setText(text: string) {
		this.gui.Content.TextLabel.Text = text;
	}

	/** Enables the Skip button, sets it to invoke {@link func} upon pressing */
	enableSkip(): this {
		const btnn = this.parent(new Control(this.gui.Content.Buttons.Skip)) //
			.addButtonAction(() => this.skipAction());
		btnn.setInstanceVisibility(true);

		return this;
	}

	/** Adds a task */
	addTask(text: string, count: number) {
		const progressTask = new ProgressTask(this.taskTemplate());
		progressTask.instance.Parent = this.gui.Content.Tasks;
		progressTask.setText(text);
		progressTask.setProgress(0, count);

		return progressTask;
	}

	/**
	 * Sets the Skip button action
	 * @param func New Skip action. Accepts previous Skip action as `original` parameter
	 */
	setSkipAction(func: (original: () => void) => void) {
		this.gui.Content.Buttons.Stop.Visible = true;

		const prev = this.skipAction;
		this.skipAction = () => func(prev);
	}

	/**
	 * Sets the Stop button action
	 * @param func New Stop action. Accepts previous Stop action as `original` parameter
	 */
	setStopAction(func: (original: () => void) => void) {
		this.gui.Content.Buttons.Stop.Visible = true;

		const prev = this.stopAction;
		this.stopAction = () => func(prev);
	}

	/**
	 * Sets the progress
	 * @argument progress The new progress, 0-1
	 */
	setProgress(progress: number) {
		const color = progress > this.gui.Progress.Size.X.Scale ? Colors.white : Colors.red;
		Transforms.create() //
			.flashColor(this.gui.Progress, color)
			.flashColor(this.gui.Progress.Inner, color)
			.transform(
				this.gui.Progress,
				"Size",
				new UDim2(new UDim(progress, 0), this.gui.Progress.Size.Y),
				Transforms.quadOut02,
			)
			.run(this.gui.Progress);
	}
}

type HelpTextDefinition = GuiObject & {
	readonly Content: GuiObject & {
		readonly TextLabel: TextLabel;
		readonly Key: GuiObject & {
			readonly Controller: ImageLabel;
			readonly Keyboard: ImageLabel & {
				readonly KeyLabel: TextLabel;
			};
		};
	};
	readonly Buttons: GuiObject & {
		readonly Skip: GuiButton;
		readonly Next: GuiButton;
	};
};
class HelpText extends Control<HelpTextDefinition> {
	private readonly textTemplate;
	private readonly keyTemplate;
	private readonly content;

	constructor(
		gui: HelpTextDefinition,
		private readonly scaledScreen: ScaledScreenGui,
		private readonly progress: Progress,
	) {
		super(gui);

		this.content = this.parent(new Control(gui.Content));

		this.textTemplate = this.asTemplate(gui.Content.TextLabel);
		this.keyTemplate = this.asTemplate(gui.Content.Key);

		gui.Buttons.Skip.Visible = gui.Buttons.Next.Visible = false;
	}

	/** Positions this gui around {@link instance}, on its {@link side} with a {@link margin} */
	withPositionAround(instance: GuiObject, side: "right" | "up" | "down" | "left", margin: number = 16): this {
		margin *= 2;

		this.event.loop(0, () => {
			let pos = new Vector2();

			const absolutePos = instance.AbsolutePosition;
			if (side === "right") {
				pos = absolutePos.add(new Vector2(instance.AbsoluteSize.X + margin, instance.AbsoluteSize.Y / 2));
				this.instance.AnchorPoint = new Vector2(0, 0.5);
			} else if (side === "left") {
				pos = absolutePos.add(new Vector2(-margin, instance.AbsoluteSize.Y / 2));
				this.instance.AnchorPoint = new Vector2(1, 0.5);
			} else if (side === "down") {
				pos = absolutePos.add(new Vector2(instance.AbsoluteSize.X / 2, instance.AbsoluteSize.Y + margin));
				this.instance.AnchorPoint = new Vector2(0.5, 0);
			} else if (side === "up") {
				pos = absolutePos.add(new Vector2(instance.AbsoluteSize.X / 2, -margin));
				this.instance.AnchorPoint = new Vector2(0.5, 1);
			}

			this.instance.Position = new UDim2(
				0,
				pos.X / this.scaledScreen.getScale(),
				0,
				pos.Y / this.scaledScreen.getScale(),
			);
		});

		return this;
	}
	/**
	 * Moves this gui to a new position
	 * @argument x New position X, relative to the screen
	 * @argument y New position Y, relative to the screen
	 */
	withRelativePosition(x: number, y: number): this {
		this.instance.Position = new UDim2(x, 0, y, 0);
		return this;
	}

	/** Adds a text line */
	addText(text: string): LabelControl {
		const control = this.parent(new LabelControl(this.textTemplate()));
		control.value.set(text);

		return control;
	}

	/** Adds a text line, returns `this` */
	withText(text: string): this {
		this.addText(text);
		return this;
	}

	/** Enables the Next button, sets it to invoke {@link func} upon pressing */
	withNext(func: () => void): this {
		const btnn = this.parent(new Control(this.gui.Buttons.Next)) //
			.addButtonAction(func);
		btnn.setInstanceVisibility(true);
		this.parent(this.progress.addTask("Press Next", 0));

		return this;
	}
}

export type { TutorialControllerGui };
class TutorialControllerGui extends InstanceComponent<ScreenGui> {
	private readonly scaled;
	readonly progress;

	constructor(gui: ScreenGui) {
		super(gui);

		this.onEnabledStateChange((state) => (gui.Enabled = state));
		this.scaled = this.parent(new ScaledScreenGui(gui));

		this.progress = this.parentGui(new Progress(prefab.Progress.Clone()));
	}

	/** Creates a fullscreen fade control */
	createFullScreenFade() {
		const frame = Element.create("Frame", {
			ZIndex: -9999,
			BorderSizePixel: 0,
			Transparency: 0.5,
			Size: new UDim2(1, 0, 1, 0),
			BackgroundColor3: Color3.fromRGB(0, 0, 0),
			Active: true,
			Parent: this.instance,
		});

		return new Control(frame);
	}
	/** Creates a fullscreen fade control with a hole around {@link gui} + additional margin */
	createFullScreenFadeWithHoleAround(gui: GuiObject, margin: Vector2 = new Vector2(16, 16)) {
		const overlay = new InstanceComponent(
			Element.create("ScreenGui", {
				Name: "overlay",
				DisplayOrder: this.instance.DisplayOrder - 1,
				IgnoreGuiInset: true,
				Parent: this.instance,
			}),
		);

		const addFrame = (color = Color3.fromRGB(0, 0, 0), transparency = 0.5) => {
			return overlay.parentGui(
				new Control(
					Element.create("Frame", {
						ZIndex: -9999,
						BorderSizePixel: 0,
						Transparency: transparency,
						BackgroundColor3: color,
						Active: true,
					}),
				),
			);
		};

		const reposition = (frame: InstanceComponent<GuiObject>, pos: UDim2, size: UDim2) => {
			frame.instance.Position = pos;
			frame.instance.Size = size;
		};

		const color = Color3.fromRGB(255, 0, 0);
		const framesDim = [addFrame(), addFrame(), addFrame(), addFrame()];
		const framesOutline = [addFrame(color, 0), addFrame(color, 0), addFrame(color, 0), addFrame(color, 0)];

		this.event.loop(0, () => {
			let min = gui.AbsolutePosition.sub(margin);
			let max = gui.AbsolutePosition.add(gui.AbsoluteSize).add(margin.mul(2));

			min = min.sub(overlay.instance.AbsolutePosition);
			max = max.sub(overlay.instance.AbsolutePosition);

			reposition(framesDim[0], new UDim2(), new UDim2(1, 0, 0, min.Y));
			reposition(framesDim[1], new UDim2(0, 0, 0, max.Y), new UDim2(1, 0, 1, 0));
			reposition(framesDim[2], new UDim2(0, 0, 0, min.Y), new UDim2(0, min.X, 0, max.Y - min.Y));
			reposition(framesDim[3], new UDim2(0, max.X, 0, min.Y), new UDim2(1, 0, 0, max.Y - min.Y));

			const thickness = 2;
			reposition(framesOutline[0], new UDim2(0, min.X, 0, min.Y), new UDim2(0, max.X - min.X, 0, thickness));
			reposition(framesOutline[1], new UDim2(0, min.X, 0, min.Y), new UDim2(0, thickness, 0, max.Y - min.Y));
			reposition(
				framesOutline[2],
				new UDim2(0, min.X, 0, max.Y),
				new UDim2(0, max.X - min.X + thickness, 0, thickness),
			);
			reposition(framesOutline[3], new UDim2(0, max.X, 0, min.Y), new UDim2(0, thickness, 0, max.Y - min.Y));
		});

		return overlay;
	}

	/** Creates a floating window with ability to add text, or a Next button */
	createText() {
		return this.parent(new HelpText(prefab.Text.Clone(), this.scaled, this.progress));
	}
}

const allInputTypes: readonly (Enum.KeyCode | Enum.PlayerActions)[] = [
	...Enum.KeyCode.GetEnumItems(),
	...Enum.PlayerActions.GetEnumItems(),
];
export class TutorialController extends Component {
	readonly gui;

	constructor() {
		super();

		const screen = Element.create("ScreenGui", { Name: "Tutorial", DisplayOrder: 99999, IgnoreGuiInset: true });
		ServiceIntegrityChecker.whitelistInstance(screen);
		screen.Parent = Interface.getInterface();

		this.gui = this.parent(new TutorialControllerGui(screen));
	}

	/** Creates a component which disables user input of the provided {@link types} and enables back upon destroy */
	disableInput(types: readonly (Enum.KeyCode | Enum.PlayerActions | Enum.UserInputType)[]): Component {
		const component = new Component();
		ContextActionService.BindActionAtPriority(
			"sink@tutorial",
			() => Enum.ContextActionResult.Sink,
			false,
			math.huge,
			...types,
		);
		component.onDestroy(() => ContextActionService.UnbindAction("sink@tutorial"));

		LocalPlayer.getPlayerModule().GetControls().Disable();
		component.onDestroy(() => LocalPlayer.getPlayerModule().GetControls().Enable());

		return component;
	}

	/** Creates a component which disables user input and enables back upon destroy */
	disableAllInput(): Component {
		return this.disableInput(allInputTypes);
	}

	/** Creates a component which disables user input except the provided ones and enables back upon destroy */
	disableAllInputExcept(except: readonly Enum.KeyCode[]): Component {
		return this.disableInput(allInputTypes.except(except));
	}

	/** Creates a component which waits until {@link func} returns `true`, then calls {@link thenfunc} */
	waitFor(func: () => boolean | undefined, thenfunc: () => void) {
		const component = new Component();
		component.event.loop(0, () => {
			if (!func()) return;
			thenfunc();
		});

		return component;
	}
}
