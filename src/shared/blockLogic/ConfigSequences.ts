import { t } from "engine/shared/t";

/**
 * Values of a number or color input whose type entry sets `sequence` (`BlockLogicTypes.ConfigSequenceShape`). The
 * config panel stores one value as-is and several as an engine sequence; a wire always delivers the single value.
 */
export namespace ConfigSequences {
	export type NumberValue = number | NumberSequence;
	export type ColorValue = Color3 | ColorSequence;
	export type Row<T> = { readonly time: number; readonly value: T };

	/** 20 keypoints, the engine's cap on both sequence types (Creator Docs), less the two `toKeypoints` may add */
	export const maxRows = 18;

	/** For a remote payload carrying such a value; the bounds apply to every keypoint */
	export const tNumber = (min = -math.huge, max = math.huge) =>
		t.custom((value): value is NumberValue => {
			if (typeIs(value, "number")) return value >= min && value <= max;
			if (!typeIs(value, "NumberSequence")) return false;

			return value.Keypoints.all((k) => k.Value >= min && k.Value <= max);
		});
	export const tColor = t.union(t.color, t.type("ColorSequence"));

	/** A range input stores its min at time 0 and its max at time 1 */
	export function toNumberRange(value: NumberValue): NumberRange {
		if (typeIs(value, "number")) return new NumberRange(value);

		const keypoints = value.Keypoints;
		const first = keypoints[0].Value;
		const last = keypoints[keypoints.size() - 1].Value;
		return new NumberRange(math.min(first, last), math.max(first, last));
	}
	export function toNumberSequence(value: NumberValue): NumberSequence {
		return typeIs(value, "number") ? new NumberSequence(value) : value;
	}
	export function toColorSequence(value: ColorValue): ColorSequence {
		return typeIs(value, "Color3") ? new ColorSequence(value) : value;
	}

	/** The value at time 0, for showing a sequence where only one value fits */
	export function firstNumber(value: NumberValue): number {
		return typeIs(value, "number") ? value : value.Keypoints[0].Value;
	}
	export function firstColor(value: ColorValue): Color3 {
		return typeIs(value, "Color3") ? value : value.Keypoints[0].Value;
	}

	export function numberRows(value: NumberValue): Row<number>[] {
		if (typeIs(value, "number")) return [{ time: 0, value }];
		return value.Keypoints.map((k) => ({ time: k.Time, value: k.Value }));
	}
	export function colorRows(value: ColorValue): Row<Color3>[] {
		if (typeIs(value, "Color3")) return [{ time: 0, value }];
		return value.Keypoints.map((k) => ({ time: k.Time, value: k.Value }));
	}

	/**
	 * Sorts the rows by time and holds the first and last values out to times 0 and 1, which the engine requires of
	 * every sequence. A single row stays a plain value; the editor never submits an empty list.
	 */
	function toKeypoints<T>(rows: readonly Row<T>[]): readonly Row<T>[] | T {
		const sorted = [...rows].sort((a, b) => a.time < b.time);
		if (sorted.size() === 1) return sorted[0].value;

		const result = sorted.map((r) => ({ time: math.clamp(r.time, 0, 1), value: r.value }));
		if (result[0].time > 0) result.unshift({ time: 0, value: result[0].value });
		if (result[result.size() - 1].time < 1) result.push({ time: 1, value: result[result.size() - 1].value });

		return result;
	}
	export function fromNumberRows(rows: readonly Row<number>[]): NumberValue {
		const keypoints = toKeypoints(rows);
		if (typeIs(keypoints, "number")) return keypoints;

		return new NumberSequence(keypoints.map((k) => new NumberSequenceKeypoint(k.time, k.value)));
	}
	export function fromColorRows(rows: readonly Row<Color3>[]): ColorValue {
		const keypoints = toKeypoints(rows);
		if (typeIs(keypoints, "Color3")) return keypoints;

		return new ColorSequence(keypoints.map((k) => new ColorSequenceKeypoint(k.time, k.value)));
	}
}
