import { HexTextBoxControl } from "client/gui/controls/HexTextBoxControl";
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

type MemoryEditorPopupDefinition = GuiObject & {
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

const COLUMNS = 16;
/** A cell the player has never written. */
const unsetColor = Color3.fromRGB(180, 180, 180);

class MemoryEditorRow extends Control<MemoryEditorRecordDefinition> {
	private readonly columns;

	constructor(
		gui: MemoryEditorRecordDefinition,
		private readonly popup: MemoryEditorPopup,
		private readonly row: number,
		recolorPreviousUntil: (index: number) => void,
	) {
		super(gui);

		this.columns = this.parent(new ComponentChildren<HexTextBoxControl>().withParentInstance(gui));

		this.onEnable(() => {
			this.gui.AddressLabel.Text = popup.numberToHex(row * COLUMNS);

			this.updateAsciiLabel();

			for (let i = 0; i < COLUMNS; i++) {
				const tb = this.gui.WaitForChild(`b${i}`) as TextBox;

				const cellIndex = row * COLUMNS + i;
				const current = popup.data[cellIndex];
				tb.TextColor3 = current !== undefined ? Colors.white : unsetColor;

				const control = this.columns.add(new HexTextBoxControl(tb, popup.digits));
				control.value.set(current ?? 0);
				control.submitted.Connect((value) => {
					tb.TextColor3 = Colors.white;

					popup.fill(cellIndex, value);
					recolorPreviousUntil(cellIndex);
					this.updateAsciiLabel();
				});
			}
		});
	}

	private updateAsciiLabel() {
		let str = "";
		for (let i = 0; i < COLUMNS; i++) {
			// low byte, so a word renders as the character it would store in its byte half
			const c = (this.popup.data[this.row * COLUMNS + i] ?? 0) & 0xff;
			str += c >= 32 && c <= 126 ? string.char(c) : ".";
		}

		this.gui.AsciiLabel.Text = str;
	}

	updateColor(index: number) {
		const control = this.columns.getAll()[index];
		if (!control) return;

		control.instance.TextColor3 =
			this.popup.data[this.row * COLUMNS + index] !== undefined ? Colors.white : unsetColor;
	}
}

class MemoryEditorRows extends Control<MemoryEditorRecordsDefinition> {
	private readonly template;
	private readonly rows;

	rowCursor = 0;
	readonly contentSize = 128;

	getContentSection() {
		return this.contentSize / 4;
	}

	constructor(
		gui: MemoryEditorRecordsDefinition,
		readonly popup: MemoryEditorPopup,
	) {
		super(gui);

		this.template = this.asTemplate(this.gui.Template, false);
		this.gui.Template.Visible = false;

		this.rows = this.parent(new ComponentChildren<MemoryEditorRow>().withParentInstance(this.gui));

		// Dynamic scroll
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
			if (this.rowCursor < 0) this.rowCursor = 0;

			this.spawnRows();

			// Scroll
			this.gui.CanvasPosition = this.gui.CanvasPosition.add(
				new Vector2(0, this.gui.Template.Size.Y.Offset * this.getContentSection() * popup.getScale()),
			);
		};

		const loadBelow = () => {
			if (this.rowCursor >= this.popup.totalRows() - this.contentSize) return;
			if (this.rows.getAll().size() < this.contentSize) return;
			this.rowCursor += this.getContentSection();

			this.spawnRows();

			// Scroll
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
			if (row >= this.popup.totalRows()) break;

			this.rows.add(
				new MemoryEditorRow(this.template(), this.popup, row, (index) => {
					// the commit filled every cell before `index`, so only rows up to its own need repainting;
					// clamped because indexing past the spawned rows would throw
					const spawned = this.rows.getAll();
					const lastRow = math.min(math.floor(index / COLUMNS) - this.rowCursor, spawned.size() - 1);

					for (let i = 0; i <= lastRow; i++) {
						for (let j = 0; j < COLUMNS; j++) {
							spawned[i].updateColor(j);
						}
					}
				}),
			);
		}
	}
}

@injectable
export class MemoryEditorPopup extends Control<MemoryEditorPopupDefinition> {
	@inject private readonly parentScreen: Popup = undefined!;
	@inject private readonly popupController: PopupController = undefined!;

	/** How far the contiguous written prefix reaches, so a commit only fills what it has to. */
	private filledUntil = 0;

	constructor(
		readonly cellLimit: number,
		readonly data: number[],
		callback: (data: number[]) => void,
		/** Hex digits per cell: 2 for a byte editor, 4 for a word one. */
		readonly digits: number = 2,
	) {
		const gui = Interface.getInterface<{
			Popups: { MemoryEditor: MemoryEditorPopupDefinition };
		}>().Popups.MemoryEditor.Clone();
		super(gui);

		if (cellLimit % 128 !== 0) {
			$err(`Cell limit must be a multiple of 128 (got ${cellLimit})`);
			this.hide();
			callback(data);
			return;
		}

		this.filledUntil = data.size();
		gui.Heading.TitleLabel.Text = `MEMORY EDITOR (${digits * 4}-BIT)`;

		const rows = this.parent(new MemoryEditorRows(gui.Content, this));

		// Clear data button
		this.parent(
			new ButtonControl(gui.ClearButton, () => {
				this.popupController.showPopup(
					new ConfirmPopup(
						"Clear memory store?",
						"It will be impossible to undo this action",
						() => {
							data.clear();
							this.filledUntil = 0;
							rows.spawnRows();
						},
						() => {},
					),
				);
			}),
		);

		// Update AddressTextBox on scroll; fires per scroll pixel, so skip the write while the row is unchanged
		let lastLabelRow = -1;
		gui.Content.GetPropertyChangedSignal("CanvasPosition").Connect(() => {
			const rowHeight = gui.Content.Template.Size.Y.Offset * this.getScale();
			if (rowHeight === 0) return;

			const currentRow = rows.rowCursor + math.round(gui.Content.CanvasPosition.Y / rowHeight);
			if (currentRow === lastLabelRow) return;
			lastLabelRow = currentRow;

			gui.AddressTextBox.Text = this.numberToHex(currentRow * COLUMNS);
		});

		// Close button
		this.parent(
			new ButtonControl(gui.Heading.CloseButton, () => {
				this.hide();
				callback(data);
			}),
		);

		// Import hex button
		this.parent(
			new ButtonControl(gui.ImportButton, () => {
				this.popupController.showPopup(
					new TextPopup(
						`IMPORT ${digits * 4}-BIT HEX`,
						digits === 2 ? "00 01 02 03 04 ..." : "0000 00FF 1234 FFFF ...",
						(text) => {
							const values = this.parseImport(text);
							if (!values) {
								LogControl.instance.addLine("Invalid data format!", Colors.red);
								return;
							}

							if (values.isEmpty() || values.size() > cellLimit) {
								LogControl.instance.addLine("Invalid data size for import!", Colors.red);
								return;
							}

							data.clear();
							for (const value of values) {
								data.push(value);
							}
							this.filledUntil = data.size();

							rows.spawnRows();
							LogControl.instance.addLine("Import successful!");
						},
						() => {},
					),
				);
			}),
		);

		const addressTextBox = new TextBoxControl(gui.AddressTextBox);
		addressTextBox.text.set(this.numberToHex(0));
		addressTextBox.submitted.Connect((value) => {
			if (value === "") {
				rows.rowCursor = 0;
				rows.spawnRows();
				addressTextBox.text.set(this.numberToHex(0));
				return;
			}

			const [withoutPrefix] = tostring(value).gsub("^0[xX]", "");
			const [hex] = withoutPrefix.match("^%x+$");
			// tonumber throws on nil once a base is given, so a rejected address must not reach it
			const address = hex === undefined ? undefined : tonumber(hex, 16);

			if (address === undefined) {
				LogControl.instance.addLine("Invalid address format!", Colors.red);
				return;
			}

			const targetRow = math.clamp(math.floor(address / COLUMNS), 0, this.totalRows() - 1);
			// unclamped, an out-of-range address put the cursor past the last page and emptied the view
			rows.rowCursor = math.clamp(targetRow, 0, math.max(0, this.totalRows() - rows.contentSize));
			rows.spawnRows();

			gui.Content.CanvasPosition = new Vector2(
				0,
				math.max(0, (targetRow - rows.rowCursor) * gui.Content.Template.Size.Y.Offset * this.getScale()),
			);
		});
		this.parent(addressTextBox);
	}

	totalRows() {
		return math.floor(this.cellLimit / COLUMNS);
	}

	/**
	 * Writes one cell, zero-filling only the gap the write opens. The array has to stay dense because it is
	 * saved by index, and the editor renders anything past the end as unwritten.
	 */
	fill(index: number, value: number) {
		for (let i = this.filledUntil; i < index; i++) {
			this.data[i] ??= 0;
		}

		this.data[index] = value;
		this.filledUntil = math.max(this.filledUntil, index + 1);
	}

	/**
	 * Whitespace splits values; a token longer than one cell is read as consecutive cells, so both a spaced
	 * list and one contiguous dump import the same way. Undefined means the text was not hex at all.
	 */
	private parseImport(text: string): number[] | undefined {
		const values: number[] = [];

		for (const [tokenRaw] of text.gmatch("%S+")) {
			const [withoutPrefix] = tostring(tokenRaw).gsub("^0[xX]", "");
			const [hex] = withoutPrefix.match("^%x+$");
			if (hex === undefined) return undefined;

			const token = tostring(hex);
			if (token.size() % this.digits !== 0) return undefined;

			for (let i = 0; i < token.size(); i += this.digits) {
				const parsed = tonumber(token.sub(i + 1, i + this.digits), 16);
				if (parsed === undefined) return undefined;

				values.push(parsed);
			}
		}

		return values;
	}

	getScale() {
		return this.parentScreen.getComponent(AutoUIScaledComponent).getScale();
	}

	numberToHex(value: number) {
		return string.format(`0x%0${string.format("%X", this.cellLimit).size()}X`, value);
	}
}
