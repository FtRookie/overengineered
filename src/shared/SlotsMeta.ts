/** Slots storage for a single user */
export namespace SlotsMeta {
	type SpecialSlotInfo = {
		readonly name: string;
		readonly color: string;
	};

	const testSlotStart = 1_000_000;
	const testSlotOffset = testSlotStart + 2;
	export const lastRunSlotIndex = -1;
	export const quitSlotIndex = -2;
	export const autosaveSlotIndex = -3;
	const specialSlots: Readonly<Record<number, SpecialSlotInfo>> = {
		[lastRunSlotIndex]: {
			name: "Last run",
			color: "57dbfa",
		},
		[quitSlotIndex]: {
			name: "Last exit",
			color: "ff1f5a",
		},
		[autosaveSlotIndex]: {
			name: "Autosave",
			color: "e8df64",
		},
	};

	function defaultSlot(index: number): SlotMeta {
		const def: SlotMeta = {
			index,
			name: "Slot " + (index + 1),
			color: "FFFFFF",
			blocks: 0,
			touchControls: {},
			saveTime: undefined,
			order: undefined,
		};

		const slot = specialSlots[index];
		if (slot) {
			return {
				...def,
				...slot,
			};
		}

		return def;
	}

	export function getSpecialNoTest(index: number): SpecialSlotInfo | undefined {
		return specialSlots[index];
	}
	export function getSpecial(index: number): SpecialSlotInfo | undefined {
		index = index >= testSlotStart ? index - testSlotOffset : index;
		return specialSlots[index];
	}
	export function isReadonly(index: number) {
		index = index >= testSlotStart ? index - testSlotOffset : index;
		return index in specialSlots || index >= testSlotStart;
	}
	export function isTestSlot(index: number) {
		return index >= testSlotStart;
	}

	export function indexOf(slots: readonly SlotMeta[], index: number): number | undefined {
		return slots.findIndex((slot) => slot.index === index);
	}
	export function get(slots: readonly SlotMeta[], index: number): SlotMeta {
		const idx = indexOf(slots, index);
		if (idx === undefined) return defaultSlot(index);

		if (index < 0) {
			return {
				...(slots[idx] ?? defaultSlot(index)),
				...specialSlots[index],
			};
		}

		return slots[idx] ?? defaultSlot(index);
	}
	export function set(slots: SlotMeta[], meta: SlotMeta) {
		const idx = indexOf(slots, meta.index);
		if (idx !== undefined) slots.remove(idx);

		slots.push(meta);
	}
	export function withSlot(
		slots: readonly SlotMeta[],
		index: number,
		meta: Readonly<Partial<SlotMeta>>,
	): readonly SlotMeta[] {
		const s = [...slots];
		set(s, {
			...get(s, index),
			...meta,
			index,
		});
		return s;
	}
	export function withRemovedSlot(slots: readonly SlotMeta[], index: number): readonly SlotMeta[] {
		return slots.filter((s) => s.index !== index);
	}

	export function getAll(slots: readonly SlotMeta[]): readonly SlotMeta[] {
		return [...slots].sort((l, r) => l.index < r.index);
	}

	export function toTable(slots: readonly SlotMeta[]): { readonly [k in number]: SlotMeta } {
		return asObject(slots.mapToMap((v) => $tuple(v.index, v)));
	}
}
