// function to force hoisting of the macros, because it does not but still tries to use them
// do NOT remove and should ALWAYS be before any other code
const _ = () => [Color3Macros];

declare global {
	interface Color3 {
		/** Return a Color3 with all its components processed through {@link func} */
		apply(this: Color3, func: (value: number, channel: "R" | "G" | "B") => number): Color3;

		/** Return a new Color3 with selective channel overrides */
		with(this: Color3, r?: number, g?: number, b?: number): Color3;

		/** Convert to a Vector3 with components scaled to 0–255 */
		toVector3(this: Color3): Vector3;

		/** Multiply each channel by a scalar */
		mul(this: Color3, n: number): Color3;
	}
}
export namespace Color3s {
	/** Create a Color3 with all channels set to the this value */
	export const fromValue = (v: number): Color3 => new Color3(v, v, v);

	export const toTuple = (color: Color3): LuaTuple<[number, number, number]> => {
		return $tuple(color.R, color.G, color.B);
	};
}

export const Color3Macros: PropertyMacros<Color3> = {
	apply: (color: Color3, func): Color3 => {
		return new Color3(func(color.R, "R"), func(color.G, "G"), func(color.B, "B"));
	},
	with: (color: Color3, r?: number, g?: number, b?: number): Color3 => {
		return new Color3(r ?? color.R, g ?? color.G, b ?? color.B);
	},
	toVector3: (color: Color3): Vector3 => {
		return new Vector3(color.R * 255, color.G * 255, color.B * 255);
	},
	mul: (color: Color3, n: number): Color3 => {
		return new Color3(color.R * n, color.G * n, color.B * n);
	},
};
