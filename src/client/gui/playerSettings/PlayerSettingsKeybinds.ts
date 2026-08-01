import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { InputController } from "engine/client/InputController";
import { Keybinds } from "engine/client/Keybinds";
import { Transforms } from "engine/shared/component/Transforms";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Keys } from "engine/shared/fixes/Keys";
import type { ConfigControlKeyCombination } from "client/gui/configControls/ConfigControlKey";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { KeybindDefinition } from "engine/client/Keybinds";
import type { InstanceComponent } from "engine/shared/component/InstanceComponent";

const UNGROUPED = "General";
/** Held on both keys of a swap, long enough to notice which two moved. */
const SWAP_COLOR = Color3.fromRGB(224, 178, 62);
const SWAP_SECONDS = 4;

type Combos = readonly (readonly KeyCode[])[];
/** Which of an action's alternatives the page edits; only two actions have a gamepad one today. */
type Device = "keyboard" | "gamepad";

const groupOf = (definition: KeybindDefinition) =>
	definition.displayPath.size() > 1 ? definition.displayPath[0] : UNGROUPED;
const labelOf = (definition: KeybindDefinition) =>
	definition.displayPath.size() > 1
		? definition.displayPath.filter((_, i) => i > 0).join(" — ")
		: definition.displayPath[0];

const readable = (combos: Combos) => combos.map((c) => c.map(Keys.toReadable).join(" + ")).join(" / ");
const deviceOf = (combo: readonly KeyCode[]): Device => (combo.any(Keys.isKeyGamepad) ? "gamepad" : "keyboard");
const forDevice = (combos: Combos, device: Device) => combos.filter((c) => deviceOf(c) === device);

/** That device's combination, or nothing when the action has no binding on it. */
const comboOf = (combos: Combos, device: Device): readonly KeyCode[] => forDevice(combos, device)[0] ?? [];
const sameCombo = (l: readonly KeyCode[], r: readonly KeyCode[]) =>
	l.size() === r.size() && l.every((k, i) => k === r[i]);

export class PlayerSettingsKeybinds extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		const rows = new Map<string, ConfigControlKeyCombination>();
		const definitions = new Map<string, KeybindDefinition>();
		const device = new ObservableValue<Device>(
			InputController.inputType.get() === "Gamepad" ? "gamepad" : "keyboard",
		);

		const boundKeys = (definition: KeybindDefinition): Combos =>
			value.get().keybinds.overrides[definition.action] ?? definition.keys;

		const write = (action: string, combos: Combos) => {
			const config = value.get();
			value.set({
				...config,
				keybinds: { ...config.keybinds, overrides: { ...config.keybinds.overrides, [action]: combos } },
			});
		};

		const show = (action: string, combos: Combos) =>
			rows.get(action)?.setValues({ _: comboOf(combos, device.get()) });

		const flash = (action: string) => {
			const key = rows.get(action)?.parts.Control;
			if (!key) return;

			const original = key.BackgroundColor3;
			Transforms.create()
				.transform(key, "BackgroundColor3", SWAP_COLOR)
				.then()
				.wait(SWAP_SECONDS)
				.then()
				.transform(key, "BackgroundColor3", original, { duration: 0.5 })
				.run(key);
		};

		/** Replaces the shown device's binding and leaves the other device's alone. */
		const withCombo = (combos: Combos, combo: readonly KeyCode[], dev: Device): Combos => {
			const others = combos.filter((c) => deviceOf(c) !== dev);
			return combo.isEmpty() ? others : [combo, ...others];
		};

		const rebind = (definition: KeybindDefinition, combo: readonly KeyCode[]) => {
			const dev = device.get();
			const action = definition.action;
			const previous = boundKeys(definition);

			// the chooser listens to both devices; keys from the other one would land in the wrong column
			if (!combo.isEmpty() && deviceOf(combo) !== dev) {
				show(action, previous);
				return;
			}

			// Restoring the default is never a conflict, so it must not swap: several actions share a default
			// on purpose (LeftAlt is the default of three), and swapping them would trade the key back and
			// forth on every reset. Tools are not active at the same time, so those defaults coexist fine.
			if (!combo.isEmpty() && sameCombo(combo, comboOf(definition.keys, dev))) {
				write(action, definition.keys);
				return;
			}

			write(action, withCombo(previous, combo, dev));
			if (combo.isEmpty()) return;

			// nothing to hand over: an action with no binding on this device would blank whoever it swapped with
			const given = comboOf(previous, dev);
			if (given.isEmpty()) return;

			// the combination is taken: hand its old one to whoever had it, not leaving two actions on one key
			for (const [otherAction, otherDefinition] of definitions) {
				if (otherAction === action) continue;

				const otherCombos = boundKeys(otherDefinition);
				if (!sameCombo(comboOf(otherCombos, dev), combo)) continue;

				const swapped = withCombo(otherCombos, given, dev);
				write(otherAction, swapped);
				show(otherAction, swapped);

				flash(action);
				flash(otherAction);
				break;
			}
		};

		this.addDropdown<Device>("Device", [
			["keyboard", { name: "Keyboard" }],
			["gamepad", { name: "Gamepad" }],
		])
			.setDescription("Which set of bindings this page edits")
			.setValues({ _: device.get() })
			.submittedMulti((d) => device.set(d ?? "keyboard"));

		const resetAll = this.addButton("Reset all", () => {
			const dev = device.get();
			for (const [action, definition] of definitions) {
				// the other device keeps whatever it has; only this one goes back to the default
				const kept = boundKeys(definition).filter((c) => deviceOf(c) !== dev);
				write(action, [...forDevice(definition.keys, dev), ...kept]);
			}

			refresh();
		});
		resetAll.button.setButtonText("Reset");

		const search = this.addSearch("Search", "Action or key");

		const groups = new Map<string, KeybindDefinition[]>();
		for (const [, definition] of Keybinds.definitions.getAll()) {
			groups.getOrSet(groupOf(definition), () => []).push(definition);
			definitions.set(definition.action, definition);
		}

		type Row = InstanceComponent<GuiObject>;
		type Section = { readonly divider: Row; readonly entries: readonly KeybindDefinition[] };
		const sections: Section[] = [];

		// pairs() has no order of its own, and a settings list that reshuffles on every open is unusable
		for (const name of [...groups.keys()].sort()) {
			const entries: KeybindDefinition[] = [];
			sections.push({ divider: this.addCategory(name), entries });

			for (const definition of groups.get(name)!.sort((l, r) => labelOf(l) < labelOf(r))) {
				const row = this.addKeyCombination(labelOf(definition), comboOf(definition.keys, device.get())) //
					.submittedMulti((combo) => rebind(definition, combo ?? []));

				rows.set(definition.action, row);
				entries.push(definition);
			}
		}

		const refresh = () => {
			const dev = device.get();
			const query = search.text.get().fullLower();
			resetAll.setDescription(`Restores every ${dev} binding to its default`);

			for (const section of sections) {
				let anyShown = false;

				for (const definition of section.entries) {
					const row = rows.get(definition.action)!;
					const combos = boundKeys(definition);

					row.setValues({ _: comboOf(combos, dev) });
					row.setDescription(`Default: ${readable(forDevice(definition.keys, dev))}`);

					// searched by key too, so "what is on G" is answerable
					const text = `${groupOf(definition)} ${labelOf(definition)} ${readable(combos)}`.fullLower();
					const shown = query === "" || text.contains(query);
					row.setVisibleAndEnabled(shown);
					anyShown ||= shown;
				}

				section.divider.setVisibleAndEnabled(anyShown);
			}
		};

		this.event.subscribeObservable(search.text, refresh);
		this.event.subscribeObservable(device, refresh, true);
	}
}
