/**
 * Where a sound comes from — the first segment of its mixer address ("machines/jetengine/Idle").
 *
 * The runtime pass derives this from where a sound template sits: inside a block model, under the UI, in the
 * effects assets, and so on. Labels are here so the settings menu can head each group without hardcoding
 * them. Music is deliberately absent; it has its own controls and its own config.
 */
export namespace SoundCategories {
	export type Id = "machines" | "ui" | "world" | "effects";

	export const labels: { readonly [k in Id]: string } = {
		machines: "Machines",
		ui: "Interface",
		world: "World",
		effects: "Effects",
	};
}
