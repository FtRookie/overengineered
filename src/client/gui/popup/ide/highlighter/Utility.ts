// all control chars except \t and \n
const controlChars = (() => {
	let chars = "";
	for (let code = 0; code <= 31; code++) {
		if (code !== 9 && code !== 10) {
			chars += string.char(code);
		}
	}
	return chars;
})();
const controlCharsPattern = `[${controlChars}]+`;

export namespace Utility {
	export function sanitizeRichText(s: string): string {
		return s
			.gsub("&", "&amp;")[0]
			.gsub("<", "&lt;")[0]
			.gsub(">", "&gt;")[0]
			.gsub('"', "&quot;")[0]
			.gsub("'", "&apos;")[0];
	}

	export function convertTabsToSpaces(s: string): string {
		return s.gsub("\t", "    ")[0];
	}

	export function removeControlChars(s: string): string {
		return s.gsub(controlCharsPattern, "")[0];
	}

	export function getInnerAbsoluteSize(textObject: TextBox): Vector2 {
		const fullSize = textObject.AbsoluteSize;

		const padding = textObject.FindFirstChildWhichIsA("UIPadding");
		if (padding) {
			const offsetX = padding.PaddingLeft.Offset + padding.PaddingRight.Offset;
			const scaleX = fullSize.X * padding.PaddingLeft.Scale + fullSize.X * padding.PaddingRight.Scale;
			const offsetY = padding.PaddingTop.Offset + padding.PaddingBottom.Offset;
			const scaleY = fullSize.Y * padding.PaddingTop.Scale + fullSize.Y * padding.PaddingBottom.Scale;
			return new Vector2(fullSize.X - (scaleX + offsetX), fullSize.Y - (scaleY + offsetY));
		}
		return fullSize;
	}

	export function getTextBounds(textObject: TextBox): Vector2 {
		if (textObject.ContentText === "") return Vector2.zero;

		// TextBounds is computed lazily and can still reflect the previous text; wait until plausible
		const numLines = textObject.ContentText.split("\n").size();
		const minHeight = numLines * textObject.TextSize * 0.5;
		let textBounds = textObject.TextBounds;

		let attempts = 0;
		while (textBounds.Y !== textBounds.Y || textBounds.Y < minHeight) {
			attempts++;
			if (attempts > 120) {
				// layout never settled
				if (textBounds.Y !== textBounds.Y) return Vector2.zero;
				break;
			}
			task.wait();
			textBounds = textObject.TextBounds;
		}
		return textBounds;
	}
}
