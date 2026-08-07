import { WordTextBoxControl } from "client/gui/controls/WordTextBoxControl";
import { ConfirmPopup } from "client/gui/popup/ConfirmPopup";
import { TextPopup } from "client/gui/popup/TextPopup";
import { LogControl } from "client/gui/static/LogControl";
import { AutoUIScaledComponent } from "engine/client/gui/AutoUIScaledControl";
import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { TextBoxControl } from "engine/client/gui/TextBoxControl";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { Colors } from "shared/Colors";
import { VectorUtils } from "shared/utils/VectorUtils";
import type { Popup, PopupController } from "client/gui/PopupController";

type WordMemoryEditorPopupDefinition = GuiObject & {
	readonly Heading: Frame & {
		readonly CloseButton: TextButton;
		readonly TitleLabel: TextLabel;
	};
	readonly AddressTextBox: TextBox;
	readonly ImportButton: TextButton;
	readonly ClearButton: TextButton;
	readonly Content: MemoryEditorRecordsDefinition;
};

type MemoryEditorRecordDefinition = Frame & {
	readonly b0: TextBox;
	readonly b1: TextBox;
	readonly b2: TextBox;
	readonly b3: TextBox;
	readonly b4: TextBox;
	readonly b5: TextBox;
	readonly b6: TextBox;
	readonly b7: TextBox;
	readonly b8: TextBox;
	readonly b9: TextBox;
	readonly b10: TextBox;
	readonly b11: TextBox;
	readonly b12: TextBox;
	readonly b13: TextBox;
	readonly b14: TextBox;
	readonly b15: TextBox;
	readonly AddressLabel: TextLabel;
	readonly AsciiLabel: TextLabel;
};

type MemoryEditorRecordsDefinition = ScrollingFrame & {
	Template: MemoryEditorRecordDefinition;
};

class WordMemoryEditorRow extends Control<MemoryEditorRecordDefinition> {
	private readonly columns;

	constructor(
		gui: MemoryEditorRecordDefinition,
		private readonly popup: MemoryEditor16Popup,
		private readonly row: number,
		recolorPreviousUntil: (cellIndex: number) => void,
	) {
		super(gui);

		this.columns = this.parent(new ComponentChildren<WordTextBoxControl>().withParentInstance(gui));

		this.onEnable(() => {
			this.gui.AddressLabel.Text = string.format("0x%04X", this.row * 16);

			this.updateAsciiLabel();

			for (let i = 0; i < 16; i++) {
				const tb = this.gui.WaitForChild(`b${i}`) as TextBox;

				tb.MaxVisibleGraphemes = 5;

				const cellIndex = this.row * 16 + i;

				const currentVal = this.popup.data[cellIndex];

				tb.TextColor3 = currentVal !== undefined ? Colors.white : Color3.fromRGB(180, 180, 180);

				const control = this.columns.add(new WordTextBoxControl(tb));

				if (currentVal !== undefined) {
					control.value.set(currentVal);
				} else {
					tb.Text = "0000";
				}

				control.submitted.Connect((value) => {
					for (let j = 0; j < cellIndex; j++) {
						this.popup.data[j] ??= 0;
					}

					this.popup.data[cellIndex] = value;

					tb.TextColor3 = Colors.white;

					recolorPreviousUntil(cellIndex);
					this.updateAsciiLabel();
				});
			}
		});
	}

	private updateAsciiLabel() {
		let str = "";

		for (let i = 0; i < 16; i++) {
			const word = this.popup.data[this.row * 16 + i] ?? 0;

			const charCode = word & 0xff;

			if (charCode >= 32 && charCode <= 126) {
				str += string.char(charCode);
			} else {
				str += ".";
			}
		}

		this.gui.AsciiLabel.Text = str;
	}

	updateColor(columnIndex: number) {
		const controls = this.columns.getAll();

		if (controls[columnIndex]) {
			const cellIndex = this.row * 16 + columnIndex;

			controls[columnIndex].instance.TextColor3 =
				this.popup.data[cellIndex] !== undefined ? Colors.white : Color3.fromRGB(180, 180, 180);
		}
	}
}

class WordMemoryEditorRows extends Control<MemoryEditorRecordsDefinition> {
	private readonly template;
	private readonly rows;

	rowCursor = 0;
	readonly contentSize = 128;

	getContentSection() {
		return this.contentSize / 4;
	}

	constructor(
		gui: MemoryEditorRecordsDefinition,
		readonly popup: MemoryEditor16Popup,
	) {
		super(gui);

		this.template = this.asTemplate(this.gui.Template, false);
		this.gui.Template.Visible = false;

		this.rows = this.parent(new ComponentChildren<WordMemoryEditorRow>().withParentInstance(this.gui));

		this.gui.GetPropertyChangedSignal("CanvasPosition").Connect(() => {
			const onStart = VectorUtils.roundVector2(this.gui.CanvasPosition).Y === 0;

			const onEnd =
				VectorUtils.roundVector2(this.gui.AbsoluteCanvasSize.sub(this.gui.CanvasPosition)).Y ===
				VectorUtils.roundVector2(this.gui.AbsoluteSize).Y;

			if (onStart) {
				loadBehind();
			} else if (onEnd) {
				loadBelow();
			}
		});

		const loadBehind = () => {
			if (this.rowCursor <= 0) return;

			this.rowCursor -= this.getContentSection();

			if (this.rowCursor < 0) {
				this.rowCursor = 0;
			}

			this.spawnRows();

			this.gui.CanvasPosition = this.gui.CanvasPosition.add(
				new Vector2(0, this.gui.Template.Size.Y.Offset * this.getContentSection() * popup.getScale()),
			);
		};

		const loadBelow = () => {
			const maxRows = math.floor(this.popup.wordsLimit / 16);

			if (this.rowCursor >= maxRows - this.contentSize) return;

			if (this.rows.getAll().size() < this.contentSize) return;

			this.rowCursor += this.getContentSection();

			this.spawnRows();

			this.gui.CanvasPosition = this.gui.CanvasPosition.sub(
				new Vector2(0, this.gui.Template.Size.Y.Offset * this.getContentSection() * popup.getScale()),
			);
		};

		this.spawnRows();
	}

	spawnRows() {
		this.rows.clear();

		for (let i = 0; i < this.contentSize; i++) {
			const row = i + this.rowCursor;

			if (row >= this.popup.wordsLimit / 16) {
				break;
			}

			const rowControl = new WordMemoryEditorRow(this.template(), this.popup, row, (targetCellIndex) => {
				const spawned = this.rows.getAll();
				const lastRow = math.min(math.floor(targetCellIndex / 16) - this.rowCursor, spawned.size() - 1);

				for (let i = 0; i <= lastRow; i++) {
					for (let col = 0; col < 16; col++) {
						spawned[i].updateColor(col);
					}
				}
			});

			this.rows.add(rowControl);
		}
	}
}

@injectable
export class MemoryEditor16Popup extends Control<WordMemoryEditorPopupDefinition> {
	@inject private readonly parentScreen: Popup = undefined!;
	@inject private readonly popupController: PopupController = undefined!;

	constructor(
		readonly wordsLimit: number,
		readonly data: number[],
		callback: (data: number[]) => void,
	) {
		const gui = Interface.getInterface<{
			Popups: {
				MemoryEditor: WordMemoryEditorPopupDefinition;
			};
		}>().Popups.MemoryEditor.Clone();

		super(gui);

		if (wordsLimit % 128 !== 0) {
			$err(`Words limit must be a multiple of 128 (got ${wordsLimit})`);
			this.hide();
			callback(data);
			return;
		}

		const rows = this.parent(new WordMemoryEditorRows(gui.Content, this));

		this.parent(
			new ButtonControl(gui.ClearButton, () => {
				this.popupController.showPopup(
					new ConfirmPopup(
						"Clear memory store?",
						"It will be impossible to undo this action",
						() => {
							data.clear();
							rows.spawnRows();
						},
						() => {},
					),
				);
			}),
		);

		gui.Content.GetPropertyChangedSignal("CanvasPosition").Connect(() => {
			const rowHeight = gui.Content.Template.Size.Y.Offset * this.getScale();

			if (rowHeight === 0) return;

			const currentRow = rows.rowCursor + math.round(gui.Content.CanvasPosition.Y / rowHeight);

			gui.AddressTextBox.Text = string.format("0x%04X", currentRow * 16);
		});

		this.parent(
			new ButtonControl(gui.Heading.CloseButton, () => {
				this.hide();
				callback(data);
			}),
		);

		this.parent(
			new ButtonControl(gui.ImportButton, () => {
				this.popupController.showPopup(
					new TextPopup(
						"IMPORT 16-BIT HEX",
						"0000 00FF 1234 FFFF ...",
						(text) => {
							const words: number[] = [];

							for (const [tokenRaw] of text.gmatch("%S+")) {
								const token = tostring(tokenRaw);

								const [withoutPrefix] = token.gsub("^0[xX]", "");

								const [cleanHex] = withoutPrefix.match("^%x+$");

								const parsed = tonumber(cleanHex, 16);

								if (parsed === undefined || parsed < 0 || parsed > 0xffff) {
									LogControl.instance.addLine(
										"Invalid 16-bit HEX number format (0000..FFFF)!",
										Colors.red,
									);
									return;
								}

								words.push(math.floor(parsed));
							}

							if (words.size() === 0 || words.size() > this.wordsLimit) {
								LogControl.instance.addLine("Invalid data size for import!", Colors.red);
								return;
							}

							data.clear();

							for (const value of words) {
								data.push(value);
							}

							rows.spawnRows();

							LogControl.instance.addLine("Import successful!");
						},
						() => {},
					),
				);
			}),
		);

		const addressTextBox = new TextBoxControl(gui.AddressTextBox);

		addressTextBox.text.set("0x0000");

		addressTextBox.submitted.Connect((value) => {
			if (value === "") {
				rows.rowCursor = 0;
				rows.spawnRows();

				addressTextBox.text.set("0x0000");

				return;
			}

			const raw = tostring(value);

			const [withoutPrefix] = raw.gsub("^0[xX]", "");

			const [sanitized] = withoutPrefix.match("^%x+$");

			const targetAddress = tonumber(sanitized, 16);

			if (targetAddress !== undefined) {
				const totalRows = math.floor(this.wordsLimit / 16);

				const targetRow = math.floor(targetAddress / 16);

				const clampedRow = math.clamp(targetRow, 0, totalRows - 1);

				const maxCursor = math.max(0, totalRows - rows.contentSize);

				const cursorRow = math.clamp(clampedRow, 0, maxCursor);

				rows.rowCursor = cursorRow;
				rows.spawnRows();

				const scale = this.getScale();

				const rowHeight = gui.Content.Template.Size.Y.Offset;

				const visualRowOffset = clampedRow - rows.rowCursor;

				gui.Content.CanvasPosition = new Vector2(0, math.max(0, visualRowOffset * rowHeight * scale));

				return;
			}

			LogControl.instance.addLine("Invalid HEX address format!", Colors.red);
		});

		this.parent(addressTextBox);
	}

	getScale() {
		return this.parentScreen.getComponent(AutoUIScaledComponent).getScale();
	}
}
