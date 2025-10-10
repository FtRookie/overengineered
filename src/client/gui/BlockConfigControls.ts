import { RunService } from "@rbxts/services";
import { ColorChooser } from "client/gui/ColorChooser";
import { ConfigControlButton } from "client/gui/configControls/ConfigControlButton";
import { ConfigControlByte } from "client/gui/configControls/ConfigControlByte";
import { ConfigControlByteArray } from "client/gui/configControls/ConfigControlByteArray";
import { ConfigControlCheckbox } from "client/gui/configControls/ConfigControlCheckbox";
import { ConfigControlCode } from "client/gui/configControls/ConfigControlCode";
import { ConfigControlColor3 } from "client/gui/configControls/ConfigControlColor";
import { ConfigControlEmpty } from "client/gui/configControls/ConfigControlEmpty";
import { ConfigControlKeyOrString } from "client/gui/configControls/ConfigControlKey";
import { ConfigControlMulti } from "client/gui/configControls/ConfigControlMulti";
import { ConfigControlMultiKeys } from "client/gui/configControls/ConfigControlMultiKeys";
import { ConfigControlNumber } from "client/gui/configControls/ConfigControlNumber";
import { ConfigControlParticle } from "client/gui/configControls/ConfigControlParticle";
import { ConfigControlSlider } from "client/gui/configControls/ConfigControlSlider";
import { ConfigControlSound } from "client/gui/configControls/ConfigControlSound";
import { ConfigControlString } from "client/gui/configControls/ConfigControlString";
import { ConfigControlSwitch } from "client/gui/configControls/ConfigControlSwitch";
import { ConfigControlVector3 } from "client/gui/configControls/ConfigControlVector3";
import { ByteEditor } from "client/gui/controls/ByteEditorControl";
import { CheckBoxControl } from "client/gui/controls/CheckBoxControl";
import { DropdownList } from "client/gui/controls/DropdownList";
import { KeyOrStringChooserControl } from "client/gui/controls/KeyChooserControl";
import { NumberTextBoxControlNullable } from "client/gui/controls/NumberTextBoxControl";
import { SliderControlNullable } from "client/gui/controls/SliderControl";
import { Interface } from "client/gui/Interface";
import { MultiKeyNumberControl } from "client/gui/MultiKeyNumberControl";
import IDEPopup from "client/gui/popup/IDEPopup";
import { MemoryEditorPopup } from "client/gui/popup/MemoryEditorPopup";
import { Control } from "engine/client/gui/Control";
import { TextBoxControl } from "engine/client/gui/TextBoxControl";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { Observables } from "engine/shared/event/Observables";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { ArgsSignal } from "engine/shared/event/Signal";
import { Objects } from "engine/shared/fixes/Objects";
import { BlockConfig } from "shared/blockLogic/BlockConfig";
import { BlockWireManager } from "shared/blockLogic/BlockWireManager";
import { Colors } from "shared/Colors";
import type { ColorChooserDefinition } from "client/gui/ColorChooser";
import type { ConfigControlMultiDefinition } from "client/gui/configControls/ConfigControlMulti";
import type { ConfigControlTemplateList } from "client/gui/configControls/ConfigControlsList";
import type { ByteEditorDefinitionParts } from "client/gui/controls/ByteEditorControl";
import type { CheckBoxControlDefinition } from "client/gui/controls/CheckBoxControl";
import type { DropdownListDefinition } from "client/gui/controls/DropdownList";
import type { KeyChooserControlDefinition } from "client/gui/controls/KeyChooserControl";
import type { NumberTextBoxControlDefinition } from "client/gui/controls/NumberTextBoxControl";
import type { SwitchControlItem } from "client/gui/controls/SwitchControl";
import type { MultiKeyNumberControlDefinition, MultiKeyPart } from "client/gui/MultiKeyNumberControl";
import type { PopupController } from "client/gui/PopupController";
import type { TextBoxControlDefinition } from "engine/client/gui/TextBoxControl";
import type { BlockConfigPart } from "shared/blockLogic/BlockConfig";
import type { BlockLogicWithConfigDefinitionTypes } from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";

type Primitives = BlockLogicTypes.Primitives;
type PrimitiveKeys = keyof Primitives;

type Controls = BlockLogicTypes.Controls;
type ControlKeys = keyof Controls;

type MiniPrimitives = { readonly [k in PrimitiveKeys]: Omit<Primitives[k], "default"> };
type WithoutDefaultPrimitives = { readonly [k in PrimitiveKeys]: Omit<Primitives[k], "default"> };
type WithoutDefaultControls = { readonly [k in ControlKeys]: WithoutDefaultPrimitives[k] };

type OfBlocks<T> = object & { readonly [k in BlockUuid]: T };

export type VisualBlockConfigDefinition = {
	readonly displayName: string;
	readonly tooltip?: string;
	readonly unit?: string;
	readonly types: Partial<BlockLogicWithConfigDefinitionTypes<PrimitiveKeys>>;
	readonly connectorHidden?: boolean;
	readonly configHidden?: boolean;
	readonly group?: string;
};
export type VisualBlockConfigDefinitions = {
	readonly [k in string]: VisualBlockConfigDefinition;
};

type ConfigPart<TKey extends PrimitiveKeys> = Primitives[TKey]["config"];
type ConfigParts<TKey extends PrimitiveKeys> = OfBlocks<ConfigPart<TKey>>;

type ControlDefinition<TKey extends PrimitiveKeys> = Primitives[TKey & keyof BlockLogicTypes.Controls]["control"] &
	defined;
type ControlConfigPart<TKey extends PrimitiveKeys> = ControlDefinition<TKey>["config"];
type ControlConfigParts<TKey extends PrimitiveKeys> = OfBlocks<ControlConfigPart<TKey>>;

type TypedConfigPart<K extends PrimitiveKeys = PrimitiveKeys> = BlockConfigPart<K>;
type BlocksConfigPart<K extends PrimitiveKeys = PrimitiveKeys> = OfBlocks<TypedConfigPart<K>>;
type BlocksConfig = OfBlocks<{ readonly [k in string]: TypedConfigPart }>;

/** Return the value if all of them are the same; Returns undefined otherwise */
const sameOrUndefined = <T>(configs: OfBlocks<T>, comparer?: (left: T, right: T) => boolean) => {
	let value: T | undefined;
	for (const [_, config] of pairs(configs)) {
		if (value !== undefined && !(comparer?.(value, config) ?? value === config)) {
			value = undefined;
			break;
		}

		value = config;
	}

	return value;
};
const sameOrUndefinedBy = <T, U>(config: OfBlocks<T>, func: (value: T) => U) => {
	if (Objects.size(config) === 1) {
		const first = firstValue(config)!;
		return func(first);
	}

	const mapped: Writable<OfBlocks<U>> = {};
	for (const [uuid, v] of pairs(config)) {
		const value = func(v);
		if (value === undefined) {
			return undefined;
		}

		mapped[uuid] = value;
	}

	const same = sameOrUndefined(mapped);
	return same;
};

/** Map the config values, leaving the keys as is */
const map = <T, TOut extends defined>(
	configs: OfBlocks<T>,
	mapfunc: (value: T, key: BlockUuid) => TOut,
): OfBlocks<TOut> => {
	return asObject(asMap(configs).mapToMap((k, v) => $tuple(k, mapfunc(v, k))));
};

//

const template = Interface.getInterface<{
	Main: { Left: { Config: { Content: { ScrollingFrame: { Template: ConfigValueWrapperDefinition } } } } };
}>().Main.Left.Config.Content.ScrollingFrame.Template;
template.Visible = false;

const setWrapperColor = (wrapper: ConfigValueWrapper, valueType: PrimitiveKeys) => {
	wrapper.typeColor.set(BlockWireManager.types[valueType].color);
};
const setWrapperName = (control: Control<GuiObject & { readonly HeadingLabel: TextLabel }>, name: string) => {
	control.instance.Name = name;
	control.instance.HeadingLabel.Text = name;
};
const initTooltip = (
	control: Control<GuiObject & { readonly HeadingLabel: TextLabel }>,
	definition: Pick<VisualBlockConfigDefinition, "tooltip" | "unit">,
) => {
	if (!definition.tooltip) return;

	let tooltip = definition.tooltip;
	if (definition.unit) tooltip += ` (${definition.unit})`;

	control.parent(new Control(control.instance.HeadingLabel)).setTooltipText(tooltip);
};
// ihatelegacycode
const initTooltip2 = (
	control: Control<GuiObject>,
	definition: Pick<VisualBlockConfigDefinition, "tooltip" | "unit">,
) => {
	if (!definition.tooltip) return;

	let tooltip = definition.tooltip;
	if (definition.unit) tooltip += ` (${definition.unit})`;

	control
		.parent(new Control(control.instance.FindFirstChild("TitleLabel", true) as GuiObject))
		.setTooltipText(tooltip);
};

namespace Controls {
	type SliderControlDefinition = GuiObject & {
		readonly TextBox: TextBox;
		readonly Control: GuiObject & {
			readonly Filled: GuiObject;
			readonly Knob: GuiObject;
		};
	};
	type ByteControlDefinition = GuiObject & {
		readonly Bottom: GuiObject & {
			readonly Buttons: ByteEditorDefinitionParts["Buttons"] & defined;
		};
		readonly Top: GuiObject & {
			readonly TextBox: ByteEditorDefinitionParts["TextBox"] & defined;
		};
	};

	export type Templates = {
		readonly Unset: ConfigValueDefinition<GuiObject>;
		readonly Redirect: ConfigValueDefinition<GuiButton>;

		readonly Checkbox: ConfigValueDefinition<CheckBoxControlDefinition>;
		readonly Number: ConfigValueDefinition<NumberTextBoxControlDefinition>;
		readonly Text: ConfigValueDefinition<TextBoxControlDefinition>;
		readonly Slider: ConfigValueDefinition<SliderControlDefinition>;
		readonly Byte: ConfigValueDefinition<ByteControlDefinition>;
		readonly ByteArray: ConfigValueDefinition<GuiButton>;
		readonly Code: ConfigValueDefinition<GuiButton>;
		readonly Key: ConfigValueDefinition<KeyChooserControlDefinition>;
		readonly Color: ConfigValueDefinition<ColorChooserDefinition>;
		readonly Dropdown: ConfigValueDefinition<DropdownListDefinition>;
		readonly Multi: ConfigValueDefinition<GuiObject>;

		readonly MultiKeys: MultiKeyNumberControlDefinition;
	};
	type templates = {
		readonly [k in keyof Templates]: () => Templates[k];
	};
	export const templates: templates = {
		Unset: Control.asTemplateWithMemoryLeak(template.Content.Unset, true),
		Redirect: Control.asTemplateWithMemoryLeak(template.Content.Redirect, true),

		Checkbox: Control.asTemplateWithMemoryLeak(template.Content.Checkbox, true),
		Number: Control.asTemplateWithMemoryLeak(template.Content.Number, true),
		Text: Control.asTemplateWithMemoryLeak(template.Content.Text, true),
		Slider: Control.asTemplateWithMemoryLeak(template.Content.Slider, true),
		Byte: Control.asTemplateWithMemoryLeak(template.Content.Byte, true),
		ByteArray: Control.asTemplateWithMemoryLeak(template.Content.ByteArray, true),
		Code: Control.asTemplateWithMemoryLeak(template.Content.Code, true),
		Key: Control.asTemplateWithMemoryLeak(template.Content.Key, true),
		Color: Control.asTemplateWithMemoryLeak(template.Content.Color, true),
		Dropdown: Control.asTemplateWithMemoryLeak(template.Content.Dropdown, true),
		Multi: Control.asTemplateWithMemoryLeak(template.Content.Multi, true),

		MultiKeys: Control.asTemplateWithMemoryLeak(template.Content.MultiKeys, true),
	};

	namespace Controls {
		const addSingleTypeWrapper = <T extends Control>(
			parent: Control<GuiObject> & { readonly control: GuiObject },
			control: T,
			parentTo?: Control,
		) => {
			const wrapper = new ConfigValueWrapper(template.Clone());
			wrapper.dropdown.hide();
			wrapper.controls.hide();
			wrapper.content.set(control);

			wrapper.instance.Parent = parent.control;
			(parentTo ?? parent).parent(wrapper);
			return $tuple(wrapper, control);
		};
		const addSingleTypeWrapperAuto = <TKey extends PrimitiveKeys>(
			parent: Control<GuiObject> & { readonly control: GuiObject },
			displayName: string,
			def: MiniPrimitives[TKey] & { readonly type: TKey } & Pick<VisualBlockConfigDefinition, "tooltip" | "unit">,
			configs: ConfigParts<TKey>,
			args: Args,
			parentTo?: Control,
		) => {
			const ctor = controls[def.type];
			if (!ctor) throw `No ctor for block config visual type ${def.type}`;

			const control = ctor(templates, def as WithoutDefaultPrimitives[PrimitiveKeys], configs, args, undefined!);
			setWrapperName(control, displayName);

			const [wrapper] = addSingleTypeWrapper(parent, control, parentTo);
			setWrapperColor(wrapper, def.type);

			initTooltip(control, def);

			return $tuple(wrapper, control as Control as Control & Submittable<TKey>);
		};

		type Submittable<TKey extends PrimitiveKeys> = {
			readonly submitted: ReadonlyArgsSignal<[value: ConfigParts<TKey>]>;
		};
		export abstract class Base<T extends GuiObject, TKey extends PrimitiveKeys> extends Control<
			ConfigValueDefinition<T>
		> {
			readonly submitted = new ArgsSignal<[value: ConfigParts<TKey>]>();
			readonly submittedControl = new ArgsSignal<[value: ControlConfigParts<TKey>]>();
			readonly control: T;

			constructor(gui: ConfigValueDefinition<T>) {
				super(gui);
				this.control = gui.Control;
			}
		}

		export class unset extends Base<GuiObject, "unset"> {
			constructor(templates: templates) {
				super(templates.Unset());
			}
		}
		export class wire extends Base<GuiButton, "wire"> {
			constructor(
				templates: templates,
				definition: MiniPrimitives["wire"],
				config: ConfigParts<"wire">,
				args: Args,
			) {
				super(templates.Redirect());

				const btn = this.parent(new Control(this.gui.Control)).addButtonAction(() =>
					args.travelTo(firstValue(config)!.blockUuid),
				);

				if (asMap(config).size() !== 1) {
					btn.setButtonInteractable(false);
				}
			}
		}

		export class bool extends Base<CheckBoxControlDefinition, "bool"> {
			constructor(templates: templates, definition: MiniPrimitives["bool"], config: ConfigParts<"bool">) {
				super(templates.Checkbox());

				const control = this.parent(new CheckBoxControl(this.control));
				control.value.set(sameOrUndefined(config));

				control.submitted.Connect((v) => this.submitted.Fire((config = map(config, (_) => v))));
			}
		}

		export class Number extends Base<NumberTextBoxControlDefinition, "number"> {
			constructor(templates: templates, definition: MiniPrimitives["number"], config: ConfigParts<"number">) {
				super(templates.Number());

				const gui = this.control as NumberTextBoxControlDefinition;

				const control = this.parent(
					definition.clamp
						? new NumberTextBoxControlNullable(
								gui,
								definition.clamp.min,
								definition.clamp.max,
								definition.clamp.step,
							)
						: new NumberTextBoxControlNullable(gui),
				);
				control.value.set(sameOrUndefined(config));

				control.submitted.Connect((v) => this.submitted.Fire((config = map(config, (_) => v))));
			}
		}
		export class ClampedNumber extends Base<SliderControlDefinition, "number"> {
			constructor(
				templates: templates,
				definition: MakeRequired<MiniPrimitives["number"], "clamp">,
				config: ConfigParts<"number">,
			) {
				super(templates.Slider());

				const gui = this.control as SliderControlDefinition;
				const clamp = definition.clamp;

				const control = this.parent(
					new SliderControlNullable(gui, clamp, {
						Knob: gui.Control.Knob,
						Filled: gui.Control.Filled,
						Hitbox: gui.Control,
					}),
				);
				control.value.set(sameOrUndefined(config));

				control.submitted.Connect((v) => this.submitted.Fire((config = map(config, (_) => v))));
			}
		}

		export class _string extends Base<TextBoxControlDefinition, "string"> {
			constructor(templates: templates, definition: MiniPrimitives["string"], config: ConfigParts<"string">) {
				super(templates.Text());

				const control = this.parent(new TextBoxControl(this.control));
				control.text.set(sameOrUndefined(config) ?? "");

				control.submitted.Connect((v) => this.submitted.Fire((config = map(config, (_) => v))));
			}
		}
		export class byte extends Base<ByteControlDefinition, "byte"> {
			constructor(templates: templates, definition: MiniPrimitives["byte"], config: ConfigParts<"byte">) {
				super(templates.Byte());

				const control = this.parent(new ByteEditor(this.control));
				control.value.set(sameOrUndefined(config) ?? 0);

				control.submitted.Connect((v) => this.submitted.Fire((config = map(config, (_) => v))));
			}
		}
		export class key extends Base<KeyChooserControlDefinition, "key"> {
			readonly keyChooser;

			constructor(templates: templates, definition: MiniPrimitives["key"], config: ConfigParts<"key">) {
				super(templates.Key());

				this.keyChooser = this.parent(new KeyOrStringChooserControl(this.control));
				this.keyChooser.value.set(sameOrUndefined(config) ?? "");

				this.keyChooser.submitted.Connect((v) => this.submitted.Fire((config = map(config, (_) => v))));
			}
		}
		export class code extends Base<GuiButton, "code"> {
			constructor(templates: templates, definition: MiniPrimitives["code"], config: ConfigParts<"code">) {
				super(templates.Code());

				this.onInject((di) => {
					const popupController = di.resolve<PopupController>();

					const control = this.parent(new Control(this.control)).addButtonAction(() => {
						popupController.showPopup(
							new IDEPopup(definition.lengthLimit, sameOrUndefined(config) ?? "", (v) =>
								this.submitted.Fire((config = map(config, (_) => v))),
							),
						);
					});

					if (!sameOrUndefined(config)) {
						control.setButtonInteractable(false);
					}
				});
			}
		}
		export class bytearray extends Base<GuiButton, "bytearray"> {
			constructor(
				templates: templates,
				definition: MiniPrimitives["bytearray"],
				config: ConfigParts<"bytearray">,
			) {
				super(templates.ByteArray());

				const value = () =>
					sameOrUndefined(config, (left, right) => {
						if (left.size() !== right.size()) {
							return false;
						}

						for (let i = 0; i < left.size(); i++) {
							if (left[i] !== right[i]) {
								return false;
							}
						}

						return true;
					});

				this.onInject((di) => {
					const popupController = di.resolve<PopupController>();

					const control = this.parent(new Control(this.control)).addButtonAction(() => {
						popupController.showPopup(
							new MemoryEditorPopup(definition.lengthLimit, [...(value() ?? [])], (v) =>
								this.submitted.Fire((config = map(config, (_) => v))),
							),
						);
					});

					if (!value()) {
						control.setButtonInteractable(false);
					}
				});
			}
		}
		export class color extends Base<ColorChooserDefinition, "color"> {
			constructor(templates: templates, definition: MiniPrimitives["color"], config: ConfigParts<"color">) {
				super(templates.Color());

				const control = this.parent(new ColorChooser(this.control));
				control.value.set(sameOrUndefined(config) ?? Colors.white);

				control.value.submitted.Connect((v) => this.submitted.Fire((config = map(config, (_) => v))));
			}
		}

		export class vector3 extends Base<GuiObject, "vector3"> {
			constructor(
				templates: templates,
				definition: MiniPrimitives["vector3"],
				config: ConfigParts<"vector3">,
				args: Args,
			) {
				super(templates.Multi());

				const [, cx] = addSingleTypeWrapperAuto(
					this,
					"X",
					{ type: "number", config: 0 },
					map(config, (c) => c.X),
					args,
				);
				const [, cy] = addSingleTypeWrapperAuto(
					this,
					"Y",
					{ type: "number", config: 0 },
					map(config, (c) => c.Y),
					args,
				);
				const [, cz] = addSingleTypeWrapperAuto(
					this,
					"Z",
					{ type: "number", config: 0 },
					map(config, (c) => c.Z),
					args,
				);

				const vec = (parts: OfBlocks<number>, axis: "X" | "Y" | "Z") => {
					if (axis === "X") return map(config, (c, uuid) => new Vector3(parts[uuid], c.Y, c.Z));
					if (axis === "Y") return map(config, (c, uuid) => new Vector3(c.X, parts[uuid], c.Z));
					if (axis === "Z") return map(config, (c, uuid) => new Vector3(c.X, c.Y, parts[uuid]));

					throw "what";
				};

				cx.submitted.Connect((n) => this.submitted.Fire((config = vec(n, "X"))));
				cy.submitted.Connect((n) => this.submitted.Fire((config = vec(n, "Y"))));
				cz.submitted.Connect((n) => this.submitted.Fire((config = vec(n, "Z"))));
			}
		}

		export class _enum extends Base<DropdownListDefinition, "enum"> {
			constructor(templates: templates, definition: MiniPrimitives["enum"], config: ConfigParts<"enum">) {
				super(templates.Dropdown());

				const control = this.parent(new DropdownList<string>(this.control));
				for (const value of definition.elementOrder) {
					const { displayName, tooltip } = definition.elements[value];

					const item = control.addItem(value, displayName);
					if (tooltip) {
						item.setTooltipText(tooltip);
					}
				}

				control.selectedItem.set(sameOrUndefined(config));
				control.submitted.Connect((v) => this.submitted.Fire((config = map(config, (_) => v))));
			}
		}

		export class sound extends Base<TextBoxControlDefinition, "sound"> {
			constructor(
				templates: templates,
				definition: MiniPrimitives["sound"],
				config: ConfigParts<"sound">,
				args: Args,
			) {
				super(templates.Text());

				const control = this.parent(new TextBoxControl(this.control));
				control.text.set(sameOrUndefined(config)?.id ?? "");

				control.submitted.Connect((v) => this.submitted.Fire((config = map(config, (_) => ({ id: v })))));
			}
		}

		export class particle extends Base<TextBoxControlDefinition, "particle"> {
			constructor(
				templates: templates,
				definition: MiniPrimitives["particle"],
				config: ConfigParts<"particle">,
				args: Args,
			) {
				super(templates.Text());

				const control = this.parent(new TextBoxControl(this.control));
				control.text.set(sameOrUndefined(config)?.particleID ?? "");

				control.submitted.Connect((v) =>
					this.submitted.Fire((config = map(config, (_) => ({ particleID: v })))),
				);
			}
		}

		//

		export class KeyBool extends Base<GuiObject, "bool"> {
			constructor(
				templates: templates,
				definition: ControlDefinition<"bool">,
				config: ControlConfigParts<"bool">,
				args: Args,
			) {
				super(templates.Multi());

				const defcfg = definition.config;

				const [, ckey] = addSingleTypeWrapperAuto(
					this,
					"Key",
					{ type: "key", config: defcfg.key },
					map(config, (c) => c.key),
					args,
				);
				ckey.submitted.Connect((v) =>
					this.submittedControl.Fire((config = map(config, (c, uuid) => ({ ...c, key: v[uuid] })))),
				);

				if (definition.canBeSwitch) {
					const [, cswitch] = addSingleTypeWrapperAuto(
						this,
						"Switch",
						{ type: "bool", config: defcfg.switch },
						map(config, (c) => c.switch),
						args,
					);
					cswitch.submitted.Connect((v) =>
						this.submittedControl.Fire((config = map(config, (c, uuid) => ({ ...c, switch: v[uuid] })))),
					);
				}

				if (definition.canBeReversed) {
					const [, creversed] = addSingleTypeWrapperAuto(
						this,
						"Reversed",
						{ type: "bool", config: defcfg.reversed },
						map(config, (c) => c.reversed),
						args,
					);
					creversed.submitted.Connect((v) =>
						this.submittedControl.Fire((config = map(config, (c, uuid) => ({ ...c, reversed: v[uuid] })))),
					);
				}
			}
		}
		export class NumberExtendedControl extends Base<GuiObject, "number"> {
			constructor(
				templates: templates,
				definition: MakeRequired<MiniPrimitives["number"], "control">,
				config: BlocksConfigPart<"number">,
				args: Args,
			) {
				super(templates.Multi());

				let controlConfig = map(config, (c) => c.controlConfig!);

				const keysConfig = map(controlConfig, (c) => c.keys);
				const firstval = firstValue(keysConfig);

				let keys: readonly MultiKeyPart[];
				if (!firstval) {
					keys = [];
				} else {
					const allEquals = asMap(keysConfig).all((k, v) => Objects.deepEquals(firstval, v));
					if (!allEquals) keys = [];
					else keys = firstval;
				}

				const [wKeys, cKeys] = addSingleTypeWrapper(
					this,
					new MultiKeyNumberControl(
						templates.MultiKeys(),
						keys,
						definition.config,
						definition.clamp?.min,
						definition.clamp?.max,
					),
				);
				wKeys.typeColor.set(Colors.red);
				cKeys.submitted.Connect((v) =>
					this.submittedControl.Fire((controlConfig = map(controlConfig, (c) => ({ ...c, keys: v })))),
				);

				const createSmoothStuff = (redrawMode: () => void) => {
					const def = definition.control.config.mode.smooth;

					const [wMode, cMode] = addSingleTypeWrapperAuto(
						this,
						"Mode",
						{
							type: "enum",
							config: def.mode,
							elementOrder: [
								"stopOnRelease",
								"instantResetOnDoublePress",
								"stopOnDoublePress",
								"resetOnRelease",
								"instantResetOnRelease",
								"resetOnDoublePress",
								"never",
							],
							elements: {
								stopOnRelease: {
									displayName: "Stop on release",
									tooltip: "Stops upon releasing the key",
								},
								stopOnDoublePress: {
									displayName: "Stop on double press",
									tooltip: "Stops upon pressing the same key twice",
								},
								resetOnRelease: {
									displayName: "Reset on release",
									tooltip: "Smoothly resets upon releasing the key",
								},
								instantResetOnRelease: {
									displayName: "Instant reset on release",
									tooltip: "Resets upon releasing the key",
								},
								resetOnDoublePress: {
									displayName: "Reset on double press",
									tooltip: "Smoothly resets upon pressing the same key twice",
								},
								instantResetOnDoublePress: {
									displayName: "Instant reset on double press",
									tooltip: "Resets upon pressing the same key twice",
								},
								never: {
									displayName: "Never",
									tooltip: "Never stops or resets",
								},
							},
							tooltip: "Mode of stopping",
						} satisfies Omit<
							BlockLogicTypes.Enum<BlockLogicTypes.NumberControlModesSmoothMode>,
							"default"
						> & {
							readonly type: "enum";
						} & Pick<VisualBlockConfigDefinition, "tooltip" | "unit">,
						map(controlConfig, (c) => c.mode.smooth.mode),
						args,
					);
					dropdownContent.push(wMode);
					cMode.submitted.Connect((v) => {
						this.submittedControl.Fire(
							(controlConfig = map(controlConfig, (c, uuid): BlockLogicTypes.NumberControl["config"] => ({
								...c,
								mode: {
									...c.mode,
									smooth: {
										...c.mode.smooth,
										mode: v[uuid] as BlockLogicTypes.NumberControlModesSmoothMode,
									},
								},
							}))),
						);

						redrawMode();
					});

					const [wSpeed, cSpeed] = addSingleTypeWrapperAuto(
						this,
						"Speed",
						{
							type: "number",
							config: def.speed,
							clamp: !definition.clamp
								? undefined
								: {
										showAsSlider: true,
										min: 0,
										max: definition.clamp.max - definition.clamp.min,
									},
						},
						map(controlConfig, (c) => c.mode.smooth.speed),
						args,
					);
					dropdownContent.push(wSpeed);
					cSpeed.submitted.Connect((v) =>
						this.submittedControl.Fire(
							(controlConfig = map(controlConfig, (c, uuid): BlockLogicTypes.NumberControl["config"] => ({
								...c,
								mode: {
									...c.mode,
									smooth: { ...c.mode.smooth, speed: v[uuid] },
								},
							}))),
						),
					);
				};
				const createInstantStuff = (redrawMode: () => void) => {
					const def = definition.control.config.mode.instant;

					const [wStopMode, cStopMode] = addSingleTypeWrapperAuto(
						this,
						"Reset mode",
						{
							type: "enum",
							config: def.mode,
							elementOrder: ["onRelease", "onDoublePress", "never"],
							elements: {
								onRelease: {
									displayName: "On release",
									tooltip: "Resets upon releasing the key",
								},
								onDoublePress: {
									displayName: "On double press",
									tooltip: "Resets upon pressing the same key twice",
								},
								never: {
									displayName: "Never",
									tooltip: "Does not reset",
								},
							},
							tooltip: "Mode of stopping",
						} satisfies Omit<
							BlockLogicTypes.Enum<BlockLogicTypes.NumberControlModesResetMode>,
							"default"
						> & {
							readonly type: "enum";
						} & Pick<VisualBlockConfigDefinition, "tooltip" | "unit">,
						map(controlConfig, (c) => c.mode.instant.mode),
						args,
					);
					dropdownContent.push(wStopMode);
					cStopMode.submitted.Connect((v) => {
						this.submittedControl.Fire(
							(controlConfig = map(controlConfig, (c, uuid): BlockLogicTypes.NumberControl["config"] => ({
								...c,
								mode: {
									...c.mode,
									instant: {
										...c.mode.instant,
										mode: v[uuid] as BlockLogicTypes.NumberControlModesResetMode,
									},
								},
							}))),
						);

						redrawMode();
					});
				};

				const dropdownContent: Control[] = [];
				const createModeDropdown = () => {
					const redrawMode = () => {
						for (const control of dropdownContent) {
							control.destroy();
						}
						dropdownContent.clear();

						const mode = sameOrUndefinedBy(controlConfig, (c) => c.mode.type);
						if (mode === "smooth") {
							createSmoothStuff(redrawMode);
						} else if (mode === "instant") {
							createInstantStuff(redrawMode);
						}
					};

					const [wSmooth, cSmooth] = addSingleTypeWrapperAuto(
						this,
						"Smooth change",
						{
							type: "bool",
							config: definition.control.config.mode.type === "smooth",
							tooltip: "Slowly changed the value to the target instead of an instantaneous change",
						},
						map(controlConfig, (c) => c.mode.type === "smooth"),
						args,
					);
					cSmooth.submitted.Connect((v) => {
						this.submittedControl.Fire(
							(controlConfig = map(controlConfig, (c, uuid): BlockLogicTypes.NumberControl["config"] => ({
								...c,
								mode: { ...c.mode, type: v[uuid] ? "smooth" : "instant" },
							}))),
						);

						redrawMode();
					});

					redrawMode();
				};
				createModeDropdown();
			}
		}

		export type controls = {
			readonly [k in PrimitiveKeys]: (
				templates: templates,
				definition: WithoutDefaultPrimitives[k],
				config: ConfigParts<k>,
				parent: Args,
				fullConfig: BlocksConfigPart<k>,
			) => Base<GuiObject, k>;
		};
		export type genericControls = {
			readonly [k in PrimitiveKeys]: (
				templates: templates,
				definition: WithoutDefaultPrimitives[PrimitiveKeys],
				config: ConfigParts<PrimitiveKeys>,
				parent: Args,
				fullConfig: BlocksConfigPart<PrimitiveKeys>,
			) => Base<GuiObject, PrimitiveKeys>;
		};

		export type extendedControls = {
			readonly [k in ControlKeys]?: (
				templates: templates,
				definition: MakeRequired<WithoutDefaultControls[k] & { control?: unknown }, "control">,
				config: BlocksConfigPart<k>,
				parent: Args,
			) => Base<GuiObject, k>;
		};
		export type extendedGenericControls = {
			readonly [k in ControlKeys]?: (
				templates: templates,
				definition: MakeRequired<WithoutDefaultControls[ControlKeys], "control">,
				config: BlocksConfigPart<PrimitiveKeys>,
				parent: Args,
			) => Base<GuiObject, ControlKeys>;
		};
	}

	export type Base<T extends GuiObject = GuiObject, TKey extends PrimitiveKeys = PrimitiveKeys> = Controls.Base<
		T,
		TKey
	>;
	export type Args = {
		travelTo(uuid: BlockUuid): void;
	};

	export const controls = {
		unset: (templates, definition, config, parent) => new Controls.unset(templates),
		wire: (templates, definition, config, parent) => new Controls.wire(templates, definition, config, parent),
		bool: (templates, definition, config, parent) => new Controls.bool(templates, definition, config),
		number: (templates, definition, config) => {
			if (definition.clamp?.showAsSlider) {
				return new Controls.ClampedNumber(
					templates,
					definition as MakeRequired<typeof definition, "clamp">,
					config,
				);
			}

			return new Controls.Number(templates, definition, config);
		},
		string: (templates, definition, config, parent) => new Controls._string(templates, definition, config),
		byte: (templates, definition, config, parent) => new Controls.byte(templates, definition, config),
		key: (templates, definition, config, parent) => new Controls.key(templates, definition, config),
		bytearray: (templates, definition, config, parent) => new Controls.bytearray(templates, definition, config),
		code: (templates, definition, config, parent) => new Controls.code(templates, definition, config),
		color: (templates, definition, config, parent) => new Controls.color(templates, definition, config),
		vector3: (templates, definition, config, parent) => new Controls.vector3(templates, definition, config, parent),
		enum: (templates, definition, config, parent) => new Controls._enum(templates, definition, config),
		sound: (templates, definition, config, parent) => new Controls.sound(templates, definition, config, parent),
		particle: (templates, definition, config, parent) =>
			new Controls.particle(templates, definition, config, parent),
	} satisfies Controls.controls as Controls.genericControls;

	export const extendedControls = {
		bool: (templates, definition, config, parent) =>
			new Controls.KeyBool(
				templates,
				definition.control,
				map(config, (c) => c.controlConfig!),
				parent,
			),
		number: (templates, definition, config, parent) =>
			new Controls.NumberExtendedControl(templates, definition, config, parent),
	} satisfies Controls.extendedControls as Controls.extendedGenericControls;
}

type ConfigValueDefinition<T> = GuiObject & {
	readonly HeadingLabel: TextLabel;
	readonly Control: T;
};

type ConfigValueWrapperDefinition = GuiObject & {
	readonly TypeLine: Frame;
	readonly Content: GuiObject &
		Controls.Templates & {
			readonly TypeDropdown: DropdownListDefinition;
			readonly TypeControllable: GuiObject & {
				readonly Controllable: GuiObject & {
					readonly Control: CheckBoxControlDefinition;
				};
			};
		};
	readonly ContentNew: GuiObject &
		Controls.Templates & {
			readonly TypeDropdown: DropdownListDefinition;
			readonly TypeControllable: GuiObject & {
				readonly Controllable: GuiObject & {
					readonly Control: CheckBoxControlDefinition;
				};
			};
		};
};
type m = "[multi]";
type mk = PrimitiveKeys | m;

class ConfigValueWrapper extends Control<ConfigValueWrapperDefinition> {
	readonly typeColor = new ObservableValue<Color3>(Colors.white);
	readonly dropdown;

	readonly controls;
	readonly controllable;

	readonly content;

	constructor(gui: ConfigValueWrapperDefinition) {
		super(gui);

		this.event.subscribeObservable(this.typeColor, (color) => (gui.TypeLine.BackgroundColor3 = color), true);
		this.dropdown = this.parent(new DropdownList<mk>(gui.ContentNew.TypeDropdown));

		gui.Visible = true;
		this.content = this.parent(new ComponentChild<Control>()).withParentInstance(gui.ContentNew);

		this.controls = this.parent(new Control(gui.ContentNew.TypeControllable));
		this.controllable = this.controls.parent(new CheckBoxControl(this.controls.instance.Controllable.Control));
	}
}

const clone = <T extends GuiObject>(instance: T): T => {
	const clone = instance.Clone();
	clone.Visible = true;

	return clone;
};
namespace ControllableControls {
	type args<k extends ControlKeys> = [
		values: OfBlocks<Controls[k]["config"]>,
		blockdef: VisualBlockConfigDefinition,
		def: Omit<Primitives[k], "default">,
	];

	export class Number extends ConfigControlMulti<Controls["number"]["config"]> {
		constructor(
			gui: ConfigControlMultiDefinition,
			name: string,
			templates: ConfigControlTemplateList,
			...[values, blockdef, def]: args<"number">
		) {
			type t = Controls["number"]["config"];
			super(gui, name);
			this.setValues(values);

			const ov = Objects.mapValues(values, (k, v) => new ObservableValue(v));
			for (const [, observable] of pairs(ov)) {
				observable.subscribe(() => {
					this.submit(map(ov, (v, k) => v.get()));
					update();
				});
			}

			const fromPath = <const TPath extends Objects.PathsOf<t>>(...path: TPath) => {
				return Objects.mapValues(ov, (k, ov) => Observables.createObservableFromObjectPropertyTyped(ov, path));
			};
			const fromPathNoDeepCombine = <const TPath extends Objects.PathsOf<t>>(...path: TPath) => {
				return Objects.mapValues(ov, (k, ov) =>
					ov.fCreateBased(
						(c) => Objects.getValueByPathTyped(c, path),
						(c) => Objects.withValueByPath(ov.get(), c, path),
					),
				);
			};

			this.parent(
				new ConfigControlMultiKeys(
					clone(templates.MultiKeys),
					"Keys",
					def.config,
					def.clamp?.min,
					def.clamp?.max,
				),
			).initToObservables(fromPathNoDeepCombine("keys"));

			this.parent(
				new ConfigControlSwitch(clone(templates.Switch), "Type", [
					["smooth", { name: "Smooth" }],
					["instant", { name: "Instant" }],
				]),
			).initToObservables(fromPath("mode", "type"));

			const createSmoothMode = () => {
				const modeParent = this.parent(new ComponentChildren<Control>()).withParentInstance(gui);

				const modes: readonly (readonly [BlockLogicTypes.NumberControlModesSmoothMode, SwitchControlItem])[] = [
					[
						"stopOnRelease",
						{
							name: "Stop on release",
							description: "Stops upon releasing the key",
						},
					],
					[
						"stopOnDoublePress",
						{
							name: "Stop on double press",
							description: "Stops upon pressing the same key twice",
						},
					],
					[
						"resetOnRelease",
						{
							name: "Reset on release",
							description: "Smoothly resets upon releasing the key",
						},
					],
					[
						"instantResetOnRelease",
						{
							name: "Instant reset on release",
							description: "Resets upon releasing the key",
						},
					],
					[
						"resetOnDoublePress",
						{
							name: "Reset on double press",
							description: "Smoothly resets upon pressing the same key twice",
						},
					],
					[
						"instantResetOnDoublePress",
						{
							name: "Instant reset on double press",
							description: "Resets upon pressing the same key twice",
						},
					],
					[
						"never",
						{
							name: "Never",
							description: "Never stops or resets",
						},
					],
				];

				modeParent
					.add(new ConfigControlSwitch(clone(templates.Switch), "Smooth mode", modes))
					.initToObservables(fromPath("mode", "smooth", "mode"));

				modeParent
					.add(
						new ConfigControlSlider(clone(templates.Slider), "Speed", {
							min: 0,
							max: (def.clamp?.max ?? 200) - (def.clamp?.min ?? 0),
						}),
					)
					.initToObservables(fromPath("mode", "smooth", "speed"));

				return modeParent;
			};
			const createInstantMode = () => {
				const modeParent = this.parent(new ComponentChildren<Control>()).withParentInstance(gui);

				const modes: readonly (readonly [BlockLogicTypes.NumberControlModesResetMode, SwitchControlItem])[] = [
					[
						"onRelease",
						{
							name: "On release",
							description: "Resets upon releasing the key",
						},
					],
					[
						"onDoublePress",
						{
							name: "On double press",
							description: "Resets upon pressing the same key twice",
						},
					],
					[
						"never",
						{
							name: "Never",
							description: "Does not reset",
						},
					],
				];

				modeParent
					.add(new ConfigControlSwitch(clone(templates.Switch), "Instant mode", modes))
					.initToObservables(fromPath("mode", "instant", "mode"));
				return modeParent;
			};

			const modes = {
				smooth: createSmoothMode(),
				instant: createInstantMode(),
			};

			const update = () => {
				for (const [, container] of pairs(modes)) {
					for (const child of container.getAll()) {
						child.hide();
					}
				}

				const mode = this.multiOf(this.multiMap((k, v) => v.mode.type));
				if (mode) {
					for (const child of modes[mode].getAll()) {
						child.show();
					}
				}
			};
			this.onEnable(update);
		}
	}
}

class ConfigAutoValueWrapper extends Control<ConfigValueWrapperDefinition> {
	private readonly _submitted = new ArgsSignal<[config: BlocksConfigPart]>();
	readonly submitted = this._submitted.asReadonly();

	constructor(
		gui: ConfigValueWrapperDefinition,
		definition: VisualBlockConfigDefinition,
		configs: BlocksConfigPart,
		args: Controls.Args,
		key: string,
		wireTypes: WireTypes,
	) {
		super(gui);
		gui.Name = key;

		const control = this.parent(new ConfigValueWrapper(gui));

		// without a connector we can only configure the value with the config tool; thus, "unset" makes zero sense
		if (!definition.connectorHidden) {
			control.dropdown.addItem("unset");
		}

		const selectedType = new ObservableValue<mk>("unset");
		selectedType.subscribe((t) => control.dropdown.selectedItem.set(t), true);
		control.dropdown.selectedItem.subscribe((t) => t && selectedType.set(t));

		// all the possible types of every block
		const availableBlockTypes = asMap(configs).map((k) => {
			const marker = wireTypes.get(k)?.findValue((k, t) => t.data.id === key);
			if (!marker) return [];

			const intersectWithSameGroup = (types: readonly (keyof BlockLogicTypes.Primitives)[]) => {
				return BlockWireManager.intersectTypes([
					types,
					...(marker.sameGroupMarkers?.map((m) => m.availableTypes.get()) ?? []),
				]);
			};

			if (marker instanceof BlockWireManager.Markers.Input) {
				const connected = marker.connected.get();
				if (connected) {
					return intersectWithSameGroup(
						BlockWireManager.intersectTypes([marker.data.dataTypes, connected.availableTypes.get()]),
					);
				} else {
					return intersectWithSameGroup(marker.data.dataTypes);
				}
			} else {
				const connected = marker.getConnected();
				const intersected = BlockWireManager.intersectTypes(connected.map((c) => c.availableTypes.get()));
				return intersectWithSameGroup(intersected);
			}
		});
		// only types that every block has
		const availableTypes = new Set(availableBlockTypes.flatmap((t) => t)).filter((t) =>
			availableBlockTypes.all((at) => at.includes(t)),
		);

		for (const k of availableTypes) {
			control.dropdown.addItem(k);
		}

		if (asMap(configs).any((k, v) => v.type === "wire")) {
			// if any of the configs is a wire connection

			selectedType.set("wire");
			control.dropdown.hide();
		} else if (asMap(definition.types).size() === 1) {
			// if there is only one definition type

			const key = firstKey(definition.types)!;
			selectedType.set(key);
			control.dropdown.hide();
		} else {
			// if there is multiple definition types

			const types = asSet(asMap(configs).mapToMap((k, v) => $tuple(v.type, true as const)));
			if (types.size() === 1) {
				// if every config has the same type set
				selectedType.set(firstKey(types)!);
			} else {
				// if configs have different types set
				selectedType.set("[multi]");
			}
		}

		this.event.subscribe(control.dropdown.submitted, (selectedType) => {
			if (selectedType === "[multi]" || selectedType === "wire") {
				return;
			}

			configs = map(
				configs,
				(_): TypedConfigPart => ({
					type: selectedType,
					config: selectedType === "unset" ? undefined! : definition.types[selectedType]!.config,
				}),
			);
			this._submitted.Fire(configs);
		});

		const reload = () => {
			let stype = selectedType.get();
			control.content.set(undefined);

			if (!stype) return;
			if (stype === "[multi]") stype = "unset";
			if (stype !== "unset" && stype !== "wire" && !(stype in definition.types)) return;

			setWrapperColor(control, stype);

			// initializing the top `Controllable` bar
			const initControls = () => {
				control.controls.hide();

				const def = definition.types[stype];
				if (!def) return;

				if (!("control" in def) || !def.control) {
					return;
				}

				control.controls.show();

				// controlConfig should never be null if `control` is present in the definition, BlockConfig handles that.
				const controlConfigs = map(configs, (c) => c.controlConfig!);

				const initControllable = () => {
					const first = firstValue(controlConfigs);
					if (first) {
						control.controllable.value.set(first.enabled);
						return;
					}

					const enableds = new Set(asMap(map(controlConfigs, (c) => c.enabled)).values());
					if (enableds.size() === 1) {
						if (firstKey(enableds)) {
							// all configs are true
							control.controllable.value.set(true);
						} else {
							// all configs are false
							control.controllable.value.set(false);
						}
					} else {
						// configs have both true and false
						control.controllable.value.set(undefined);
					}
				};
				initControllable();
			};
			initControls();

			if (true as boolean) {
				const templates: ConfigControlTemplateList = Interface.getInterface<{
					Popups: {
						Crossplatform: {
							Settings: {
								Content: { Content: { ScrollingFrame: GuiObject & ConfigControlTemplateList } };
							};
						};
					};
				}>().Popups.Crossplatform.Settings.Content.Content.ScrollingFrame.Clone();

				interface ConfigControl extends Control {
					submitted(func: (value: OfBlocks<prims[keys]["config"]>) => void): void;
				}

				type prims = BlockLogicTypes.Primitives;
				type keys = keyof prims;

				type retf<k extends keys> = (
					values: OfBlocks<prims[k]["config"]>,
					blockdef: VisualBlockConfigDefinition,
					stype: k,
				) => ConfigControl | undefined;
				const controls = {
					unset: (values, blockdef) => {
						return new ConfigControlEmpty(clone(templates.Empty), blockdef.displayName);
					},
					wire: (values, blockdef) => {
						const size = Objects.size(values);
						if (size === 1) {
							const { blockUuid } = firstValue(values)!;

							return new ConfigControlButton(clone(templates.Button), blockdef.displayName, () => {
								args.travelTo(blockUuid);
							}).with((b) => b.button.setButtonText("→"));
						}

						return new ConfigControlButton(clone(templates.Button), blockdef.displayName, () => {}) //
							.with((b) => b.button.setButtonText("→"))
							.with((b) => b.button.setButtonInteractable(false));
					},

					number: (values, blockdef, stype) => {
						const def = definition.types[stype];
						if (!def) return;

						if (def.clamp?.showAsSlider) {
							return new ConfigControlSlider(clone(templates.Slider), blockdef.displayName, {
								min: def.clamp.min,
								max: def.clamp.max,
								step: def.clamp.step,
							}).setValues(values);
						}

						return new ConfigControlNumber(
							clone(templates.Number),
							blockdef.displayName,
							def.clamp?.min,
							def.clamp?.max,
							def.clamp?.step,
						).setValues(values);
					},
					string: (values, blockdef) => {
						return new ConfigControlString(clone(templates.String), blockdef.displayName) //
							.setValues(values);
					},
					bool: (values, blockdef) => {
						return new ConfigControlCheckbox(clone(templates.Checkbox), blockdef.displayName) //
							.setValues(values);
					},
					color: (values, blockdef) => {
						return new ConfigControlColor3(clone(templates.Color), blockdef.displayName, Colors.white) //
							.setValues(values);
					},
					key: (values, blockdef) => {
						return new ConfigControlKeyOrString(clone(templates.Key), blockdef.displayName) //
							.setValues(values);
					},
					vector3: (values, blockdef) => {
						return new ConfigControlVector3(clone(templates.Vector3), blockdef.displayName) //
							.setValues(values);
					},
					enum: (values, blockdef, stype) => {
						const def = definition.types[stype];
						if (!def) return;

						const items = def.elementOrder.map((k) => {
							const e = def.elements[k];
							const item = { name: e.displayName, description: e.tooltip } satisfies SwitchControlItem;

							return [k, item] as const;
						});

						return new ConfigControlSwitch(clone(templates.Switch), blockdef.displayName, items) //
							.setValues(values);
					},
					byte: (values, blockdef) => {
						return new ConfigControlByte(clone(templates.Byte), blockdef.displayName) //
							.setValues(values);
					},
					bytearray: (values, blockdef, stype) => {
						const def = definition.types[stype];
						if (!def) return;

						return new ConfigControlByteArray(clone(templates.Edit), blockdef.displayName, def.lengthLimit) //
							.setValues(values);
					},
					code: (values, blockdef, stype) => {
						const def = definition.types[stype];
						if (!def) return;

						return new ConfigControlCode(clone(templates.Edit), blockdef.displayName, def.lengthLimit) //
							.setValues(values);
					},
					sound: (values, blockdef, stype) => {
						const def = definition.types[stype];
						if (!def) return;

						return new ConfigControlSound(clone(templates.Sound), blockdef.displayName) //
							.setValues(values);
					},
					particle: (values, blockdef, stype) => {
						const def = definition.types[stype];
						if (!def) return;

						return new ConfigControlParticle(clone(templates.Particle), blockdef.displayName) //
							.setValues(values);
					},
				} satisfies {
					readonly [k in keys]: retf<k> | undefined;
				} as {
					readonly [k in keys]: retf<keys> | undefined;
				};

				interface controlConfigControl extends Control {
					submitted(func: (value: OfBlocks<controlPrims[controlKeys]["config"]>) => void): void;
				}

				type controlPrims = Controls;
				type controlKeys = keyof controlPrims;
				type controlRetf<k extends controlKeys> = (
					values: OfBlocks<controlPrims[k]["config"]>,
					blockdef: VisualBlockConfigDefinition,
					def: Omit<prims[k], "default">,
				) => controlConfigControl | undefined;

				const controlsControl = {
					bool: undefined,
					number: (values, blockdef, def) => {
						return new ControllableControls.Number(
							clone(templates.Multi),
							blockdef.displayName,
							templates,
							values,
							blockdef,
							def,
						);
					},
				} satisfies {
					readonly [k in controlKeys]: controlRetf<k> | undefined;
				} as {
					readonly [k in controlKeys]: controlRetf<controlKeys> | undefined;
				};

				//

				const cg = () => {
					const isControllable = control.controllable.value.get();
					if (isControllable === undefined) {
						// TODO: [mixed] message or somethin
						return;
					}

					if (!isControllable) {
						const ctor = controls[stype];
						if (!ctor) return;

						const control = ctor(
							map(configs, (c) => c.config),
							definition,
							stype,
						);
						if (!control) return;

						initTooltip2(control, definition);

						control.submitted((values) => {
							this._submitted.Fire(
								(configs = map(configs, (c, uuid) => ({
									...c,
									type: stype,
									config: values[uuid],
								}))),
							);
						});
						return control;
					} else if ((false as boolean) && RunService.IsStudio()) {
						const ctor = controlsControl[stype as controlKeys];
						if (!ctor) return;

						const def = definition.types[stype as controlKeys];
						if (!def) return;

						const control = ctor(
							map(configs, (c) => c.controlConfig!),
							definition,
							def,
						);
						if (!control) return;

						control.submitted((values) => {
							this._submitted.Fire(
								(configs = map(configs, (c, uuid) => ({
									...c,
									type: stype,
									controlConfig: values[uuid],
								}))),
							);
						});
						return control;
					}
				};

				const cfgcontrol = cg();
				if (cfgcontrol) {
					control.content.set(cfgcontrol);
					return;
				}
			}

			const createGui = (): Controls.Base | undefined => {
				const def = definition.types[stype];
				if (!def) return;

				const isControllable = control.controllable.value.get();

				if (isControllable === undefined) {
					// TODO: [mixed] message or somethin
					return;
				}

				if (!isControllable) return;

				if (!(stype in Controls.extendedControls)) return;

				const ctor = Controls.extendedControls[stype as ControlKeys];
				if (!ctor) return;

				return ctor(
					Controls.templates,
					def as MakeRequired<MiniPrimitives["number"], "control">,
					configs,
					args,
				);
			};
			const cfgcontrol = createGui();
			if (!cfgcontrol) return;

			setWrapperName(cfgcontrol, definition.displayName);
			initTooltip(cfgcontrol, definition);

			cfgcontrol.submitted.Connect((v) =>
				this._submitted.Fire((configs = map(configs, (c, uuid) => ({ ...c, type: stype, config: v[uuid] })))),
			);
			cfgcontrol.submittedControl.Connect((v) =>
				this._submitted.Fire(
					(configs = map(configs, (c, uuid) => ({
						...c,
						type: stype,
						controlConfig: v[uuid],
					}))),
				),
			);

			control.content.set(cfgcontrol);
		};

		this.event.subscribe(control.controllable.submitted, (enabled) => {
			// controlConfig will not be undefined if the controls are visible so we don't need to check that
			this._submitted.Fire(
				(configs = map(configs, (c) => ({ ...c, controlConfig: { ...c.controlConfig!, enabled } }))),
			);
			reload();
		});

		this.event.subscribeObservable(selectedType, reload);
		this.onEnable(reload);
	}
}

type WireTypes = ReadonlyMap<
	BlockUuid,
	ReadonlyMap<string, BlockWireManager.Markers.Input | BlockWireManager.Markers.Output>
>;
@injectable
export class MultiBlockConfigControl extends Control implements Controls.Args {
	private readonly _travelledTo = new ArgsSignal<[uuid: BlockUuid]>();
	readonly travelledTo = this._travelledTo.asReadonly();

	private readonly _submitted = new ArgsSignal<[config: BlocksConfig]>();
	readonly submitted = this._submitted.asReadonly();

	private readonly children;

	constructor(
		gui: GuiObject,
		definitions: VisualBlockConfigDefinitions,
		configs: BlocksConfig,
		order: readonly string[] | undefined,
		wireTypes: WireTypes,
		@inject di: DIContainer,
	) {
		super(gui);

		this.children = this.parent(new ComponentChildren().withParentInstance(gui));

		if (order) {
			const nonexistent = asMap(definitions)
				.keys()
				.filter((k) => !order.includes(k));
			if (nonexistent.size() > 0) {
				throw `Some definition keys were not present in the order (${nonexistent.join()})`;
			}

			const wrong = order.filter((k) => !(k in definitions));
			if (wrong.size() > 0) {
				throw `Some order keys were not present in the definitions (${wrong.join()})`;
			}
		}

		const create = () => {
			const grouped = new Map<ConfigAutoValueWrapper, string>();
			const grouped2 = new Map<string, { readonly wrapper: ConfigAutoValueWrapper; readonly key: string }[]>();

			for (const k of order ?? asMap(definitions).keys()) {
				const definition = definitions[k];
				if (definition.configHidden && !asMap(configs).any((uuid, c) => c[k].type === "wire")) continue;

				const lconfigs = map(configs, (c) => c[k]);
				const wrapper = this.children.add(
					di.resolveForeignClass(ConfigAutoValueWrapper, [
						template.Clone(),
						definition,
						lconfigs,
						this,
						k,
						wireTypes,
					]),
				);

				if (definition.group) {
					grouped.set(wrapper, definition.group);
					grouped2.getOrSet(definition.group, () => []).push({ wrapper, key: k });
				}

				wrapper.submitted.Connect((v) => {
					let needsClearing = false;

					try {
						configs = map(configs, (c, uuid) => ({ ...c, [k]: v[uuid] }));

						if (!definition.group) return;
						const setType = firstValue(v)!.type;
						if (setType === "unset") return;

						const grouped = grouped2.get(definition.group) ?? [];
						if (grouped.size() === 1) return;

						configs = map(configs, (c) => {
							const ret = { ...c };

							for (const { key } of grouped) {
								const t = c[key];
								if (t.type === "unset") continue;
								if (t.type === "wire") continue;
								if (t.type === setType) continue;

								needsClearing = true;
								ret[key] = BlockConfig.addDefaults({ [key]: { type: setType } } as never, definitions)[
									key
								];
							}

							return ret;
						});
					} finally {
						this._submitted.Fire(configs);
					}

					if (needsClearing) {
						this.children.clear();
						create();
					}
				});
			}
		};
		create();
	}

	travelTo(uuid: BlockUuid): void {
		this._travelledTo.Fire(uuid);
	}
}
