import { t } from "engine/shared/t";

/**
 * Values of a number or color input whose type entry sets `sequence` (`BlockLogicTypes.ConfigSequenceShape`). The
 * config panel stores one value as-is and several as an engine sequence; a wire always delivers the single value.
 */
export namespace ConfigSequences {
	export type NumberValue = number | NumberSequence;
	export type ColorValue = Color3 | ColorSequence;
	export type Row<T> = { readonly time: number; readonly value: T };

	const maxKeypoints = 20; // sequence cannot have more points
	export const maxRows = maxKeypoints - 2; // leaves room for the two ends `toKeypoints` may add

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
	/** The value at time 1; a range input's second color */
	export function lastColor(value: ColorValue): Color3 {
		if (typeIs(value, "Color3")) return value;

		const keypoints = value.Keypoints;
		return keypoints[keypoints.size() - 1].Value;
	}

	/** Linear between keypoints, as Creator Docs' `NumberSequence` evaluation; envelope is never set here */
	export function numberAt(value: NumberValue, time: number): number {
		if (typeIs(value, "number")) return value;

		const keypoints = value.Keypoints;
		for (let i = 0; i < keypoints.size() - 1; i++) {
			const [a, b] = [keypoints[i], keypoints[i + 1]];
			if (time < a.Time || time > b.Time) continue;

			const span = b.Time - a.Time;
			return span <= 0 ? b.Value : a.Value + ((b.Value - a.Value) * (time - a.Time)) / span;
		}

		return keypoints[keypoints.size() - 1].Value;
	}
	export function colorAt(value: ColorValue, time: number): Color3 {
		if (typeIs(value, "Color3")) return value;

		const keypoints = value.Keypoints;
		for (let i = 0; i < keypoints.size() - 1; i++) {
			const [a, b] = [keypoints[i], keypoints[i + 1]];
			if (time < a.Time || time > b.Time) continue;

			const span = b.Time - a.Time;
			return span <= 0 ? b.Value : a.Value.Lerp(b.Value, (time - a.Time) / span);
		}

		return keypoints[keypoints.size() - 1].Value;
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
	 * every sequence. A sequence already at the keypoint cap has its end rows moved to 0 and 1 instead, since the
	 * filled-in ends come back as rows and a full editor would otherwise go past the cap. A single row stays a plain
	 * value; the editor never submits an empty list.
	 */
	function toKeypoints<T>(rows: readonly Row<T>[]): readonly Row<T>[] | T {
		const sorted = [...rows].sort((a, b) => a.time < b.time);
		if (sorted.size() === 1) return sorted[0].value;

		const result = sorted.map((r) => ({ time: math.clamp(r.time, 0, 1), value: r.value }));
		const first = result[0];
		if (first.time > 0) {
			if (result.size() < maxKeypoints) result.unshift({ time: 0, value: first.value });
			else result[0] = { time: 0, value: first.value };
		}
		const lastIndex = result.size() - 1;
		const last = result[lastIndex];
		if (last.time < 1) {
			if (result.size() < maxKeypoints) result.push({ time: 1, value: last.value });
			else result[lastIndex] = { time: 1, value: last.value };
		}

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
