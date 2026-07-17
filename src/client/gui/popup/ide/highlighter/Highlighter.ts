// Syntax highlighting for a TextBox: the box's text is dimmed and per-line RichText labels are
// overlaid with the colored code. Ported from the vendored 'boatbomber' Highlighter.
import { Lexer } from "client/gui/popup/ide/highlighter/Lexer";
import { Theme } from "client/gui/popup/ide/highlighter/Theme";
import { Utility } from "client/gui/popup/ide/highlighter/Utility";

interface ObjectData {
	text: string;
	labels: TextLabel[]; // [lineNumber - 1]
	lines: string[]; // [lineNumber - 1]
	unknownTokens: ReadonlySet<string>; // identifiers not defined anywhere in the file — flagged red
}

const textObjectData = new Map<TextBox, ObjectData>();
const cleanups = new Map<TextBox, () => void>();

function getLabelingInfo(textObject: TextBox) {
	const data = textObjectData.get(textObject);
	if (data === undefined) return undefined;

	const src = Utility.convertTabsToSpaces(Utility.removeControlChars(textObject.Text));
	const numLines = src.split("\n").size();

	const textBounds = Utility.getTextBounds(textObject);
	const textHeight = textBounds.Y / numLines;

	return {
		data,
		textHeight,
		innerAbsoluteSize: Utility.getInnerAbsoluteSize(textObject),
		textColor: Theme.colors.iden!,
		textFont: textObject.FontFace,
		textSize: textObject.TextSize,
		labelSize: new UDim2(1, 0, 0, math.ceil(textHeight)),
	};
}

function alignLabels(textObject: TextBox) {
	const info = getLabelingInfo(textObject);
	if (info === undefined) return;

	for (let lineNumber = 1; lineNumber <= info.data.labels.size(); lineNumber++) {
		const lineLabel = info.data.labels[lineNumber - 1];
		lineLabel.TextColor3 = info.textColor;
		lineLabel.FontFace = info.textFont;
		lineLabel.TextSize = info.textSize;
		lineLabel.Size = info.labelSize;
		lineLabel.Position = UDim2.fromScale(0, (info.textHeight * (lineNumber - 1)) / info.innerAbsoluteSize.Y);
	}
}

function populateLabels(textObject: TextBox) {
	const src = Utility.convertTabsToSpaces(Utility.removeControlChars(textObject.Text));

	const data = textObjectData.get(textObject);
	if (data === undefined || data.text === src) return;

	textObject.Text = src;

	const lineLabels = data.labels;
	const previousLines = data.lines;
	const lines = src.split("\n");

	data.lines = lines;
	data.text = src;

	// shortcut empty textObjects
	if (src === "") {
		for (const label of lineLabels) {
			// a comparison is faster than a wasteful property write
			if (label.Text !== "") {
				label.Text = "";
			}
		}
		return;
	}

	const idenColor = Theme.colors.iden!;
	const unknownColor = Theme.colors.unknown ?? idenColor;
	const unknownTokens = data.unknownTokens;
	const labelingInfo = getLabelingInfo(textObject)!;

	const richTextBuffer: string[] = [];
	let lineNumber = 1;
	for (const [token, content] of Lexer.scan(src)) {
		let color: Color3;
		if (token === "iden") {
			// bare identifiers render plain unless the last syntax check flagged this exact name
			color = unknownTokens.has(content.gsub("%s", "")[0]) ? unknownColor : idenColor;
		} else {
			color = Theme.colors[token] ?? idenColor;
		}

		const tokenLines = Utility.sanitizeRichText(content).split("\n");

		for (let l = 0; l < tokenLines.size(); l++) {
			const tokenLine = tokenLines[l];

			// find the line label
			let lineLabel = lineLabels[lineNumber - 1];
			if (lineLabel === undefined) {
				const newLabel = new Instance("TextLabel");
				newLabel.Name = `Line_${lineNumber}`;
				newLabel.AutoLocalize = false;
				newLabel.RichText = true;
				newLabel.BackgroundTransparency = 1;
				newLabel.Text = "";
				newLabel.TextXAlignment = Enum.TextXAlignment.Left;
				newLabel.TextYAlignment = Enum.TextYAlignment.Top;
				newLabel.TextColor3 = labelingInfo.textColor;
				newLabel.FontFace = labelingInfo.textFont;
				newLabel.TextSize = labelingInfo.textSize;
				newLabel.Size = labelingInfo.labelSize;
				newLabel.Position = UDim2.fromScale(
					0,
					(labelingInfo.textHeight * (lineNumber - 1)) / labelingInfo.innerAbsoluteSize.Y,
				);

				newLabel.Parent = textObject.FindFirstChild("SyntaxHighlights");
				lineLabels[lineNumber - 1] = newLabel;
				lineLabel = newLabel;
			}

			// multiline token: flush the current line and move to the next
			if (l > 0) {
				if (lines[lineNumber - 1] !== previousLines[lineNumber - 1]) {
					lineLabels[lineNumber - 1].Text = richTextBuffer.join("");
				}
				lineNumber += 1;
				table.clear(richTextBuffer);
			}

			// if changed, add the token to the line
			if (lines[lineNumber - 1] !== previousLines[lineNumber - 1]) {
				// only add RichText tags when the color is non-default and the characters are non-whitespace
				const [visible] = string.find(tokenLine, "[%S%C]");
				if (color !== idenColor && visible !== undefined) {
					richTextBuffer.push(Theme.getColoredRichText(color, tokenLine));
				} else {
					richTextBuffer.push(tokenLine);
				}
			}
		}
	}

	// set the final line
	if (richTextBuffer.size() > 0 && lineLabels[lineNumber - 1] !== undefined) {
		lineLabels[lineNumber - 1].Text = richTextBuffer.join("");
	}

	// clear unused line labels
	for (let l = lineNumber; l < lineLabels.size(); l++) {
		if (lineLabels[l].Text !== "") {
			lineLabels[l].Text = "";
		}
	}
}

/**
 * Highlights a given TextBox and keeps it updated on text/layout changes.
 * Returns a cleanup function; also cleans itself up when the TextBox is unparented.
 */
export namespace Highlighter {
	/** Set the identifiers to flag red and re-colour only the affected lines. No-op if the box isn't highlighted. */
	export function setUnknownTokens(textObject: TextBox, tokens: ReadonlySet<string>): void {
		const data = textObjectData.get(textObject);
		if (data === undefined) return;

		const changed = new Set<string>();
		for (const name of tokens) {
			if (!data.unknownTokens.has(name)) changed.add(name);
		}
		for (const name of data.unknownTokens) {
			if (!tokens.has(name)) changed.add(name);
		}
		data.unknownTokens = tokens;
		if (changed.size() === 0) return;

		// invalidate only the cached lines mentioning a flipped name (substring may over-include, harmless)
		for (let i = 0; i < data.lines.size(); i++) {
			for (const name of changed) {
				if (string.find(data.lines[i], name, 1, true)[0] !== undefined) {
					data.lines[i] = "\0";
					break;
				}
			}
		}
		data.text = "\0"; // differ from the current text so populateLabels doesn't early-return
		populateLabels(textObject);
	}

	export function highlight(textObject: TextBox): () => void {
		const existing = cleanups.get(textObject);
		if (existing !== undefined) {
			populateLabels(textObject);
			alignLabels(textObject);
			return existing;
		}

		const src = Utility.convertTabsToSpaces(Utility.removeControlChars(textObject.Text));

		// ensure valid object properties
		textObject.RichText = false;
		textObject.Text = src;
		textObject.TextXAlignment = Enum.TextXAlignment.Left;
		textObject.TextYAlignment = Enum.TextYAlignment.Top;
		textObject.BackgroundColor3 = Theme.colors.background!;
		textObject.TextColor3 = Theme.colors.iden!;
		textObject.TextTransparency = 0.5;

		let lineFolder = textObject.FindFirstChild("SyntaxHighlights");
		if (lineFolder === undefined) {
			const newFolder = new Instance("Folder");
			newFolder.Name = "SyntaxHighlights";
			newFolder.Parent = textObject;
			lineFolder = newFolder;
		}

		textObjectData.set(textObject, { text: "", labels: [], lines: [], unknownTokens: new Set() });

		const connections: RBXScriptConnection[] = [];
		const cleanup = () => {
			lineFolder.Destroy();
			textObjectData.delete(textObject);
			cleanups.delete(textObject);

			for (const connection of connections) {
				connection.Disconnect();
			}
			connections.clear();
		};
		cleanups.set(textObject, cleanup);

		connections.push(
			textObject.AncestryChanged.Connect(() => {
				if (textObject.Parent) return;
				cleanup();
			}),
		);
		connections.push(textObject.GetPropertyChangedSignal("Text").Connect(() => populateLabels(textObject)));
		connections.push(textObject.GetPropertyChangedSignal("TextBounds").Connect(() => alignLabels(textObject)));
		connections.push(textObject.GetPropertyChangedSignal("AbsoluteSize").Connect(() => alignLabels(textObject)));
		connections.push(textObject.GetPropertyChangedSignal("FontFace").Connect(() => alignLabels(textObject)));

		populateLabels(textObject);
		alignLabels(textObject);

		return cleanup;
	}
}
