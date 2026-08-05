const gamepadKeys = {
	ButtonX: true,
	ButtonY: true,
	ButtonA: true,
	ButtonB: true,
	ButtonR1: true,
	ButtonL1: true,
	ButtonR2: true,
	ButtonL2: true,
	ButtonR3: true,
	ButtonL3: true,
	ButtonStart: true,
	ButtonSelect: true,
	DPadLeft: true,
	DPadRight: true,
	DPadUp: true,
	DPadDown: true,
	Thumbstick1: true,
	Thumbstick2: true,
} as const satisfies { readonly [k in KeyCode]?: boolean };
export type GamepadKeyCode = keyof typeof gamepadKeys;

const gamepadDPadKeys = {
	DPadLeft: true,
	DPadRight: true,
	DPadUp: true,
	DPadDown: true,
} as const satisfies { readonly [k in GamepadKeyCode]?: boolean };
export type GamepadDPadKeys = keyof typeof gamepadDPadKeys;

export namespace Keys {
	export const Keys: { readonly [k in KeyCode]: Enum.KeyCode } = asObject(
		Enum.KeyCode.GetEnumItems().mapToMap((e) => $tuple(e.Name, e)),
	);

	export function isKey(key: string): key is KeyCode {
		return key in Keys;
	}
	export function isKeyGamepad(key: string): key is GamepadKeyCode {
		return asSet(gamepadKeys).has(key as GamepadKeyCode);
	}
	export function isKeyGamepadDPad(key: string): key is GamepadDPadKeys {
		return asSet(gamepadDPadKeys).has(key as GamepadDPadKeys);
	}

	const readableKeys: { readonly [k in KeyCode]?: string } = {
		Zero: "0",
		One: "1",
		Two: "2",
		Three: "3",
		Four: "4",
		Five: "5",
		Six: "6",
		Seven: "7",
		Eight: "8",
		Nine: "9",

		KeypadZero: "Num0",
		KeypadOne: "Num1",
		KeypadTwo: "Num2",
		KeypadThree: "Num3",
		KeypadFour: "Num4",
		KeypadFive: "Num5",
		KeypadSix: "Num6",
		KeypadSeven: "Num7",
		KeypadEight: "Num8",
		KeypadNine: "Num9",

		LeftControl: "Left Ctrl",
		LeftShift: "Left Shift",
		LeftAlt: "Left Alt",
		RightControl: "Right Ctrl",
		RightShift: "Right Shift",
		RightAlt: "Right Alt",
	};
	export function toReadable(key: KeyCode): string {
		const named = readableKeys[key];
		if (named !== undefined) return named;

		// LeftBracket -> Left Bracket, ButtonY -> Button Y. Digits are left attached, so F1 and ButtonL1 survive.
		// gsub returns a LuaTuple, hence the index.
		return key.gsub("(%l)(%u)", "%1 %2")[0];
	}
}
