// Syntax token colors for the in-game IDE. Defaults live in PlayerConfigDefinition.visuals.ide;
// these are the fallback used before a config has been applied.
export namespace Theme {
	export const colors: { [token: string]: Color3 | undefined } = {
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
		unknown: Color3.fromHex("#ff0000"), // non-keyword non-variable
	};

	export function apply(config: { readonly [token: string]: Color4 }) {
		for (const [token, color] of pairs(config)) {
			colors[token as string] = color.color;
		}
	}

	export function getColoredRichText(color: Color3, text: string): string {
		return `<font color="#${color.ToHex()}">${text}</font>`;
	}
}
