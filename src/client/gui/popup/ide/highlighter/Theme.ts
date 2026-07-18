// Syntax token colors for the in-game IDE — edit these to change the editor palette.
export namespace Theme {
	export const colors: { readonly [token: string]: Color3 | undefined } = {
		background: Color3.fromHex("#0d1117"),
		iden: Color3.fromHex("#c9d1d9"),
		keyword: Color3.fromHex("#f85149"),
		builtin: Color3.fromHex("#58a6ff"),
		field: Color3.fromHex("#79c0ff"),
		method: Color3.fromHex("#dcdcaa"),
		string: Color3.fromHex("#a5d6ff"),
		number: Color3.fromHex("#58a6ff"),
		comment: Color3.fromHex("#8b949e"),
		operator: Color3.fromHex("#c9d1d9"),
		custom: Color3.fromHex("#7ee787"),
		unknown: Color3.fromHex("#ff0000"), // non-keyword non-variable
	};

	export function getColoredRichText(color: Color3, text: string): string {
		return `<font color="#${color.ToHex()}">${text}</font>`;
	}
}
