// Syntax token colors for the in-game IDE — edit these to change the editor palette.
const tokenColors: { readonly [token: string]: Color3 | undefined } = {
	background: Color3.fromHex("#0d1117"),
	iden: Color3.fromHex("#c9d1d9"),
	keyword: Color3.fromHex("#f85149"),
	builtin: Color3.fromHex("#58a6ff"),
	field: Color3.fromHex("#79c0ff"),
	method: Color3.fromHex("#dcdcaa"),
	variable: Color3.fromHex("#c9d1d9"), // same as iden: variables render like plain text
	string: Color3.fromHex("#a5d6ff"),
	number: Color3.fromHex("#58a6ff"),
	comment: Color3.fromHex("#8b949e"),
	operator: Color3.fromHex("#c9d1d9"),
	custom: Color3.fromHex("#7ee787"),
};

export namespace Theme {
	export function getColor(tokenName: string): Color3 | undefined {
		return tokenColors[tokenName];
	}

	export function getColoredRichText(color: Color3, text: string): string {
		return `<font color="#${color.ToHex()}">${text}</font>`;
	}
}
