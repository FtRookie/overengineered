import { MathExpression } from "client/gui/math/MathExpression";
import { MathRenderer } from "client/gui/math/MathRenderer";
import { TextButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { ancestry } from "engine/client/gui/WindowGeometry";
import { EventHandler } from "engine/shared/event/EventHandler";
import { Colors } from "shared/Colors";

type ExpressionEditorPopupDefinition = GuiObject & {
	readonly Heading: Frame & {
		readonly TitleLabel: TextLabel;
		readonly CloseButton: TextButton;
	};
	readonly Content: Frame & {
		readonly Content: Frame & {
			readonly TextBox: TextBox;
			readonly Preview: ScrollingFrame & {
				readonly RowTemplate: Frame;
				readonly StackTemplate: Frame;
				readonly GlyphTemplate: TextLabel;
				readonly RuleTemplate: Frame;
			};
			readonly Warning: TextLabel;
		};
		readonly Buttons: Frame & {
			readonly SaveButton: TextButton;
			readonly CancelButton: TextButton;
		};
	};
};

/** Applied to the standing preview while the text does not parse, so it reads as stale rather than current. */
const staleTransparency = 0.55;

export class ExpressionEditorPopup extends Control<ExpressionEditorPopupDefinition> {
	private readonly templates: MathRenderer.Templates;
	private readonly baseTextSize: number;
	/** Cleared on every redraw; the tracked bars belong to the tree being replaced. */
	private readonly bars = new EventHandler();
	private rendered?: GuiObject;

	constructor(code: string, callback: (data: string) => void) {
		const gui = Interface.getInterface<{
			Popups: { Crossplatform: { Expression: ExpressionEditorPopupDefinition } };
		}>().Popups.Crossplatform.Expression.Clone();
		super(gui);

		const preview = gui.Content.Content.Preview;
		// read before templating, which destroys the originals
		this.baseTextSize = preview.GlyphTemplate.TextSize;
		this.templates = {
			row: this.asTemplate(preview.RowTemplate),
			stack: this.asTemplate(preview.StackTemplate),
			glyph: this.asTemplate(preview.GlyphTemplate),
			rule: this.asTemplate(preview.RuleTemplate),
		};

		const box = gui.Content.Content.TextBox;
		box.Text = code;

		const save = this.parent(new TextButtonControl(gui.Content.Buttons.SaveButton));
		save.addButtonAction(() => {
			callback(box.Text);
			this.hideThenDestroy();
		});

		this.parent(new Control(gui.Content.Buttons.CancelButton)).addButtonAction(() => this.hideThenDestroy());
		this.parent(new Control(gui.Heading.CloseButton)).addButtonAction(() => this.hideThenDestroy());

		// EventHandler is not tied to a component, so the bars outlive the popup unless dropped explicitly
		this.onDestroy(() => this.bars.unsubscribeAll());

		this.event.subscribe(box.GetPropertyChangedSignal("Text"), () => this.refresh(save));
		this.refresh(save);
	}

	private refresh(save: TextButtonControl) {
		const box = this.gui.Content.Content.TextBox;
		const warning = this.gui.Content.Content.Warning;

		const parsed = MathExpression.parse(box.Text);
		save.buttonInteractabilityComponent().setInteractable(parsed.success);

		if (!parsed.success) {
			warning.Visible = true;
			warning.TextColor3 = Colors.orange;
			warning.Text = `⚠️ ${parsed.message}`;

			// the last drawing that did parse is kept rather than cleared, so the preview does not flicker
			// between math and nothing on the way through every half-typed expression
			this.setStale();
			return;
		}

		warning.Visible = false;

		this.rendered?.Destroy();
		this.bars.unsubscribeAll();

		const built = MathRenderer.build(this.templates, parsed.node, this.baseTextSize);
		this.rendered = built.root;
		built.root.Parent = this.gui.Content.Content.Preview;

		for (const { bar, of } of built.bars) {
			// tracked rather than set once: the popup's own UIScale settles a frame late, and changes again
			// whenever the viewport does
			const fit = () => {
				const [scale] = ancestry(of);
				bar.Size = UDim2.fromOffset(of.AbsoluteSize.X / math.max(scale, 0.001), bar.Size.Y.Offset);
			};

			this.bars.subscribe(of.GetPropertyChangedSignal("AbsoluteSize"), fit);
			fit();
		}
	}

	/** Only ever applied to a tree that is about to be replaced, so there is nothing to restore. */
	private setStale() {
		if (!this.rendered) return;

		for (const child of this.rendered.GetDescendants()) {
			if (child.IsA("TextLabel")) {
				child.TextTransparency = staleTransparency;
			} else if (child.IsA("Frame") && child.BackgroundTransparency === 0) {
				child.BackgroundTransparency = staleTransparency;
			}
		}
	}
}
