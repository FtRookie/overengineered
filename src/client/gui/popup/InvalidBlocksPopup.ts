import { ButtonControl } from "engine/client/gui/Button";
import { Interface } from "engine/client/gui/Interface";
import { PartialControl } from "engine/client/gui/PartialControl";

const template = Interface.getInterface<{
	Popups: { Crossplatform: { InvalidBlocks: GuiObject } };
}>().Popups.Crossplatform.InvalidBlocks;
template.Visible = false;

type BlockItemTemplate = Frame & {
	readonly TextButton: GuiButton & {
		readonly Texts: Frame & {
			readonly BlockId: TextLabel;
			readonly Description: TextLabel;
		};
		readonly ImageLabel: ImageLabel;
		readonly BlockCount: TextLabel;
	};
};

type InvalidBlocksParts = {
	readonly CloseButton: GuiButton;

	readonly LoadAButton: GuiButton; // (Load Anyway)
	readonly CancelButton: GuiButton;

	readonly BlockContainer: ScrollingFrame;
	readonly ItemTemplate: BlockItemTemplate;
};

@injectable
export class InvalidBlocksPopup extends PartialControl<InvalidBlocksParts> {
	readonly blockItemTemplate;

	constructor(
		readonly blocks: BlockList,
		blockList: Record<string, number>,
		onCancel: () => void,
		onConfirm: () => void,
	) {
		super(template.Clone());

		this.blockItemTemplate = this.parts.ItemTemplate;
		this.blockItemTemplate.Visible = false;

		this.parent(
			new ButtonControl(this.parts.CancelButton, () => {
				onCancel();
				this.destroy();
			}),
		);
		this.parent(
			new ButtonControl(this.parts.CloseButton, () => {
				onCancel();
				this.destroy();
			}),
		);

		this.parent(
			new ButtonControl(this.parts.LoadAButton, () => {
				onConfirm();
				this.destroy();
			}),
		);

		this.populate(blockList);
	}

	private populate(items: Record<string, number>) {
		const container = this.parts.BlockContainer;

		for (const c of container.GetChildren()) {
			if (c.IsA("Frame") && c.Name === "BlockItem") c.Destroy();
		}

		for (const [blockid, count] of pairs(items)) {
			const copy = this.blockItemTemplate.Clone();
			copy.Name = "BlockItem";
			copy.TextButton.Texts.BlockId.Text = tostring(blockid);
			// If the block actually does exist, for some reason
			if (this.blocks.blocks[blockid] !== undefined) {
				copy.TextButton.Texts.Description.Text = "block found";
			}
			copy.TextButton.BlockCount.Text = `x${count}`;
			copy.Visible = true;
			copy.Parent = container;
		}
	}
}
