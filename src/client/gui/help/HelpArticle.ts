import { HelpParallax } from "client/gui/help/HelpParallax";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { ancestry } from "engine/client/gui/WindowGeometry";
import { InputController } from "engine/client/InputController";
import { Keybinds } from "engine/client/Keybinds";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { Element } from "engine/shared/Element";
import { Keys } from "engine/shared/fixes/Keys";
import type { HelpParallaxConfig } from "client/gui/help/HelpParallax";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { KeyCombination } from "engine/client/Keybinds";

/**
 * Text for every input type, or one text when it reads the same on all of them. `{key:action}` anywhere in it becomes
 * the player's current binding for that keybind action on the device they are using, and `{ui:Area.Name}` a copy of
 * that live interface button, e.g. `{ui:Top.Save}` or `{ui:TopRight.Grid}`.
 */
export type HelpText = string | Readonly<Record<InputType, string>>;
const textFor = (text: HelpText, inputType: InputType) => (typeIs(text, "string") ? text : text[inputType]);
const hasTokens = (text: HelpText): boolean =>
	typeIs(text, "string")
		? text.find("{key:", 1, true)[0] !== undefined || text.find("{ui:", 1, true)[0] !== undefined
		: asMap(text).any((_, t) => hasTokens(t));

/** The live button a `{ui:Area.Name}` token names, looked up under that area of the main screen */
const liveButton = (path: string): GuiObject | undefined => {
	const [area, name] = path.match("^(%w+)%.(.+)$");
	if (area === undefined || name === undefined) return undefined;

	const root = Interface.getInterface<{ Main: Folder }>().Main.FindFirstChild(tostring(area));
	if (!root) return undefined;

	// a name can repeat across modes (build and ride both have a Freecam), so the one on screen is preferred
	let found: GuiObject | undefined;
	for (const child of root.GetDescendants()) {
		if (child.Name !== tostring(name) || !child.IsA("GuiObject")) continue;
		if (child.Visible) return child;
		found ??= child;
	}
	return found;
};
const uiName = (path: string) => tostring(path.match("([^%.]+)$")[0] ?? path);

/** Height of a button copy in a line, in Size offset units */
const chipHeight = 30;
/** Same as the key blocks, so a button as dark as the page still shows its edge */
const chipOutline = Color3.fromRGB(33, 43, 58);
/** A copy of a live button shrunk to line height, wearing its current icon and theme colours, that can't be clicked */
const chipOf = (button: GuiObject): GuiObject | undefined => {
	const [scale] = ancestry(button);
	// a button hidden until its mode is active measures zero on screen, so a fixed Size is read instead
	const fixed = button.Size.X.Scale === 0 && button.Size.Y.Scale === 0;
	const size = fixed
		? new Vector2(button.Size.X.Offset, button.Size.Y.Offset)
		: button.AbsoluteSize.div(math.max(scale, 0.001));
	if (size.Y <= 0) return undefined;

	const chip = button.Clone();
	chip.Visible = true;
	chip.Position = new UDim2();
	chip.AnchorPoint = Vector2.zero;
	chip.Size = UDim2.fromOffset(size.X, size.Y);
	chip.Interactable = false;
	chip.FindFirstChildOfClass("UIScale")?.Destroy();
	Element.create("UIScale", { Scale: chipHeight / size.Y, Parent: chip });
	if (!chip.FindFirstChildOfClass("UIStroke")) {
		Element.create("UIStroke", {
			Color: chipOutline,
			Thickness: 2,
			ApplyStrokeMode: Enum.ApplyStrokeMode.Border,
			Parent: chip,
		});
	}

	return chip;
};

// fixme: a plot screenshot standing in until each article has its own picture
export const helpPlaceholderImage = 125269302587862;

/** A row that sizes to its contents and lays them out left to right */
const newRow = (layoutOrder: number, gap: number) => {
	const row = Element.create("Frame", {
		AutomaticSize: Enum.AutomaticSize.XY,
		BackgroundTransparency: 1,
		LayoutOrder: layoutOrder,
	});
	Element.create("UIListLayout", {
		FillDirection: Enum.FillDirection.Horizontal,
		VerticalAlignment: Enum.VerticalAlignment.Center,
		SortOrder: Enum.SortOrder.LayoutOrder,
		Padding: new UDim(0, gap),
		Parent: row,
	});
	return row;
};

const isGamepadCombo = (combo: KeyCombination) => combo.any(Keys.isKeyGamepad);
// fixme: gamepad buttons are spelled out (X, L1) until there are button icons to show instead
const keyName = (key: KeyCode) => (Keys.isKeyGamepad(key) ? key.gsub("^Button", "")[0] : Keys.toReadable(key));
/** The keys of the binding for the player's device, one entry per key of a chord */
const comboKeys = (combos: readonly KeyCombination[], inputType: InputType): readonly string[] => {
	const combo = combos.find((c) => isGamepadCombo(c) === (inputType === "Gamepad")) ?? combos[0];
	if (!combo || combo.isEmpty()) return ["unbound"];

	return combo.map(keyName);
};
/** Where rounded key blocks cannot be laid out (headers, captions), highlighted inline spans stand in */
const inlineKeys = (keys: readonly string[]) =>
	keys
		.map((key) => `<mark color="#212B3A" transparency="0"><font face="RobotoMono"><b> ${key} </b></font></mark>`)
		.join(" + ");

type KeyBlockDefinition = Frame & {
	readonly TextLabel: TextLabel;
};
type FlowDefinition = Frame & {
	readonly WordTemplate: TextLabel;
	readonly KeyTemplate: KeyBlockDefinition;
};
export type HelpArticleDefinition = ScrollingFrame & {
	readonly StepLabel: TextLabel;
	readonly PageTitle: TextLabel;
	readonly HeaderTemplate: TextLabel;
	readonly BodyTemplate: TextLabel;
	readonly ImageTemplate: ImageLabel & {
		readonly Caption: TextLabel;
	};
	readonly ButtonTemplate: TextButton;
	/** A body line laid out word by word, so each key can be its own rounded block */
	readonly FlowTemplate: FlowDefinition;
};

/**
 * Sets a block's height from its content measured on screen. AutomaticSize wraps at a width shrunk by the interface
 * UIScale a second time, so wrapped text and wrapped rows come out taller than they are.
 */
const fitHeight = (block: GuiObject, pixels: number) => {
	const [scale] = ancestry(block);
	const padding = block.FindFirstChildOfClass("UIPadding");
	const pad = padding ? padding.PaddingTop.Offset + padding.PaddingBottom.Offset : 0;
	const size = block.Size;

	block.AutomaticSize = Enum.AutomaticSize.None;
	block.Size = new UDim2(size.X.Scale, size.X.Offset, 0, pixels / math.max(scale, 0.001) + pad);
};

const clone = <T extends GuiObject>(instance: T): T => {
	const clone = instance.Clone();
	clone.Visible = true;
	clone.Parent = instance.Parent;

	return clone;
};

/** Above the StepLabel and PageTitle, which keep their own orders from the template */
const firstBlockOrder = 100;

type Page = {
	readonly title: string;
	readonly blocks: GuiObject[];
};
type Binding = { readonly keys: readonly string[]; readonly label: string };
type TextBlock =
	| { readonly kind: "label"; readonly label: Control<TextLabel>; readonly text: HelpText }
	| {
			readonly kind: "flow";
			readonly text: HelpText;
			readonly newWord: () => TextLabel;
			readonly newKey: () => KeyBlockDefinition;
			readonly items: ComponentChildren<Control>;
	  };

/**
 * A help article: one or more pages, written in the subclass constructor with {@link addPage} followed by that page's
 * {@link addHeader}, {@link addBody} and {@link addImage} calls, the way a settings page is written with `addCategory`
 * and `addLine`. Every block is built up front; showing a page only changes which blocks are visible.
 */
export class HelpArticle extends Control<HelpArticleDefinition> {
	private readonly pages: Page[] = [];
	private readonly texts: TextBlock[] = [];
	private order = firstBlockOrder;
	private shown?: number;

	constructor(gui: HelpArticleDefinition) {
		super(gui);

		this.$onInjectAuto((playerData: PlayerDataStorage) => {
			const render = () => {
				const inputType = InputController.inputType.get();
				const overrides = playerData.config.get().keybinds.overrides;
				const bindingOf = (action: string): Binding | undefined => {
					const definition = Keybinds.definitions.get(action);
					const keys = overrides[action] ?? definition?.keys;
					if (!keys) return undefined;

					const shown = comboKeys(keys, inputType);
					return {
						keys: shown,
						label: `${shown.join(" + ")}: ${definition?.displayPath.join(" › ") ?? action}`,
					};
				};

				for (const block of this.texts) {
					const text = textFor(block.text, inputType);
					if (block.kind === "flow") {
						this.renderFlow(block, text, bindingOf);
						continue;
					}

					const tooltip: string[] = [];
					block.label.instance.Text = text
						.gsub("{key:([%w_]+)}", (action: string) => {
							const binding = bindingOf(action);
							if (!binding) return `{key:${action}}`;

							tooltip.push(binding.label);
							return inlineKeys(binding.keys);
						})[0]
						.gsub("{ui:([%w_%. ]+)}", (path: string) => `<b>${uiName(path)}</b>`)[0];
					block.label.setTooltipText(tooltip.isEmpty() ? undefined : tooltip.join("\n"));
				}
			};

			this.event.subscribeObservable(InputController.inputType, render);
			this.event.subscribeObservable(playerData.config, render, true);
		});
	}

	pageCount(): number {
		return this.pages.size();
	}

	showPage(index: number) {
		const page = this.pages[index];
		if (!page) return;

		if (this.shown !== undefined) {
			for (const block of this.pages[this.shown]?.blocks ?? []) block.Visible = false;
		}
		for (const block of page.blocks) block.Visible = true;
		this.shown = index;

		this.gui.CanvasPosition = Vector2.zero;
		this.gui.StepLabel.Text = `STEP ${index + 1} OF ${this.pages.size()}`;
		this.gui.PageTitle.Text = page.title;
	}

	protected addPage(title: string) {
		this.pages.push({ title, blocks: [] });
	}
	protected addHeader(text: HelpText) {
		const header = this.addWrapped(clone(this.gui.HeaderTemplate));
		this.texts.push({ kind: "label", label: this.parent(new Control(header)), text });
		return header;
	}
	/** Rich text. A line naming keybinds is laid out word by word, with each key in its own rounded block. */
	protected addBody(text: HelpText) {
		if (!hasTokens(text)) {
			const body = this.addWrapped(clone(this.gui.BodyTemplate));
			this.texts.push({ kind: "label", label: this.parent(new Control(body)), text });
			return body;
		}

		const flow = this.addBlock(clone(this.gui.FlowTemplate));
		const layout = flow.FindFirstChildOfClass("UIListLayout");
		if (layout) {
			const fit = () => fitHeight(flow, layout.AbsoluteContentSize.Y);
			this.event.subscribe(layout.GetPropertyChangedSignal("AbsoluteContentSize"), fit);
			fit();
		}
		const control = this.parent(new Control(flow));
		this.texts.push({
			kind: "flow",
			text,
			newWord: control.asTemplate(flow.WordTemplate),
			newKey: control.asTemplate(flow.KeyTemplate),
			items: control.parent(new ComponentChildren<Control>().withParentInstance(flow)),
		});
		return flow;
	}
	protected addButton(text: string, action: () => void) {
		const button = this.addBlock(clone(this.gui.ButtonTemplate));
		button.Text = text.upper();
		return this.parent(new Control(button)).addButtonAction(action);
	}
	/** A picture built from layers at different depths that shift with the cursor; see {@link HelpParallax} */
	protected addPreview(config: HelpParallaxConfig, caption?: HelpText) {
		const picture = this.addImage(config.background, caption);
		picture.Caption.ZIndex = picture.ZIndex + config.layers.size() + 1;
		this.parent(new HelpParallax(picture, config));
		return picture;
	}
	protected addImage(image: number, caption?: HelpText) {
		const picture = this.addBlock(clone(this.gui.ImageTemplate));
		picture.Image = `rbxassetid://${image}`;
		picture.Caption.Visible = caption !== undefined;
		if (caption !== undefined) {
			this.texts.push({ kind: "label", label: this.parent(new Control(picture.Caption)), text: caption });
		}
		return picture;
	}

	/** Rebuilds a flow line: one label per word, carrying any rich text tags open across it, and one block per key. */
	private renderFlow(
		block: TextBlock & { readonly kind: "flow" },
		text: string,
		bindingOf: (action: string) => Binding | undefined,
	) {
		block.items.clear();
		let order = 1;
		const open: string[] = [];

		const newWord = (word: string) => {
			const prefix = open.join("");
			for (const [found] of word.gmatch("<[^>]+>")) {
				const tag = tostring(found);
				if (tag.sub(2, 2) === "/") open.pop();
				else open.push(tag);
			}
			const suffix = open.map((tag) => `</${tag.match("^<(%a+)")[0]}>`).join("");

			const label = block.newWord();
			label.Text = prefix + word + suffix;
			return label;
		};
		const addWords = (segment: string) => {
			for (const [match] of segment.gmatch("%S+")) {
				const label = newWord(tostring(match));
				label.LayoutOrder = order++;
				block.items.add(new Control(label));
			}
		};

		let rest = text;
		while (true as boolean) {
			const [start, finish, kind, value] = string.find(rest, "{(%a+):([%w_%. ]+)}");
			if (start === undefined || finish === undefined) {
				addWords(rest);
				break;
			}

			addWords(rest.sub(1, start - 1));
			rest = rest.sub(finish + 1);

			// punctuation written straight after a token stays against it rather than taking a word gap, and the
			// whole group wraps as one piece
			const group = newRow(order++, 0);
			const groupControl = block.items.add(new Control(group));

			if (tostring(kind) === "ui") {
				const button = liveButton(tostring(value));
				const chip = button && chipOf(button);
				if (chip) {
					chip.LayoutOrder = 1;
					chip.Parent = group;
				} else {
					const name = newWord(`<b>${uiName(tostring(value))}</b>`);
					name.LayoutOrder = 1;
					name.Parent = group;
				}
			} else {
				const action = tostring(value);
				const binding = bindingOf(action);

				// a chord is one block per key with a "+" between
				const chord = newRow(1, 3);
				chord.Parent = group;
				const keys = binding?.keys ?? [action];
				for (let i = 0; i < keys.size(); i++) {
					if (i > 0) {
						const plus = block.newWord();
						plus.Text = "+";
						plus.LayoutOrder = i * 2;
						plus.Parent = chord;
					}

					const key = block.newKey();
					key.TextLabel.Text = keys[i];
					key.LayoutOrder = i * 2 + 1;
					key.Parent = chord;
					groupControl.add(new Control(key)).setTooltipText(binding?.label);
				}
			}

			const [attached] = rest.match("^[^%s{]+");
			if (attached === undefined) continue;

			const attachedText = tostring(attached);
			rest = rest.sub(attachedText.size() + 1);
			const tail = newWord(attachedText);
			tail.LayoutOrder = 2;
			tail.Parent = group;
		}
	}

	private addWrapped(label: TextLabel): TextLabel {
		const fit = () => fitHeight(label, label.TextBounds.Y);
		this.event.subscribe(label.GetPropertyChangedSignal("TextBounds"), fit);
		fit();

		return this.addBlock(label);
	}
	private addBlock<T extends GuiObject>(block: T): T {
		if (this.pages.isEmpty()) this.addPage("");

		block.Visible = false;
		block.LayoutOrder = this.order++;
		this.pages[this.pages.size() - 1].blocks.push(block);
		return block;
	}
}
