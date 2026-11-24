import { LoadingController } from "client/controller/LoadingController";
import { Keybinds } from "engine/client/Keybinds";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { Component } from "engine/shared/component/Component";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { ComponentDisabler } from "engine/shared/component/ComponentDisabler";
import { ObservableCollectionArr } from "engine/shared/event/ObservableCollection";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { ToolBase } from "client/tools/ToolBase";
import type { KeybindDefinition } from "engine/client/Keybinds";
import type { DebuggableComponent } from "engine/shared/component/Component";

/** Build mode's hotbar order, as saved in `interface.toolOrder`; a reset writes it back */
export const defaultToolOrder = [
	"buildTool",
	"editTool",
	"deleteTool",
	"configTool",
	"paintTool",
	"wireTool",
	"weldTool",
	"polygonTool",
] as const;

const slotKeys: readonly KeyCode[] = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
export const toolKeybinds = {
	slots: slotKeys.map((key, i) =>
		Keybinds.registerDefinition(`tool_slot${i + 1}`, ["Tools", `Tool ${i + 1}`], [[key]]),
	),
	unequip: Keybinds.registerDefinition("tool_unequip", ["Tools", "Unequip"], [["ButtonB"]]),
	next: Keybinds.registerDefinition("tool_next", ["Tools", "Next tool"], [["ButtonR1"]]),
	previous: Keybinds.registerDefinition("tool_previous", ["Tools", "Previous tool"], [["ButtonL1"]]),
};

class ToolInputController extends Component {
	constructor(toolController: ToolController) {
		super();

		const gamepadSelectTool = (isRight: boolean) => {
			if (!toolController.selectedTool.get()) {
				toolController.selectedTool.set(toolController.tools.get()[0]);
				return;
			}

			const currentIndex = toolController.tools.get().indexOf(toolController.selectedTool.get()!);
			const toolsLength = toolController.tools.get().size();
			let newIndex = isRight ? currentIndex + 1 : currentIndex - 1;

			if (newIndex >= toolsLength) {
				newIndex = 0;
			} else if (newIndex < 0) {
				newIndex = toolsLength - 1;
			}

			toolController.selectedTool.set(toolController.tools.get()[newIndex]);
		};
		this.$onInjectAuto((keybinds: Keybinds) => {
			const on = (definition: KeybindDefinition, func: () => void) =>
				this.event.subscribeRegistration(() =>
					keybinds.fromDefinition(definition).onDown(() => {
						func();
						return "Pass";
					}),
				);

			toolController.tools.get().forEach((tool, i) => {
				const slot = toolKeybinds.slots[i];
				if (!slot) return;

				on(slot, () =>
					toolController.selectedTool.set(tool === toolController.selectedTool.get() ? undefined : tool),
				);
			});
			on(toolKeybinds.unequip, () => toolController.selectedTool.set(undefined));
			on(toolKeybinds.next, () => gamepadSelectTool(true));
			on(toolKeybinds.previous, () => gamepadSelectTool(false));
		});
	}
}

@injectable
export class ToolController extends Component {
	readonly selectedTool = new ObservableValue<ToolBase | undefined>(undefined, (value, current) => {
		if (value && LoadingController.isLoading.get()) {
			return current;
		}

		if (!value) return value;

		if (this.enabledTools.isDisabled(value)) {
			return undefined;
		}

		return value;
	});
	readonly enabledTools: ComponentDisabler<ToolBase>;
	readonly tools = new ObservableCollectionArr<ToolBase>();
	private reordering = false;

	constructor() {
		super();

		LocalPlayer.diedEvent.Connect(() => {
			this.selectedTool.set(undefined);
		});

		this.selectedTool.subscribePrev((tool, prev) => {
			prev?.disable();
			tool?.enable();
		});
		this.enabledTools = new ComponentDisabler<ToolBase>();
		this.enabledTools.updated.Connect(() => {
			const selected = this.selectedTool.get();
			if (selected && !this.enabledTools.isEnabled(selected)) {
				this.selectedTool.set(undefined);
			}
		});
		this.tools.subscribe(() => {
			if (this.reordering) return;
			this.selectedTool.set(undefined);
		});

		let prevTool: ToolBase | undefined = undefined;
		let wasSetByLoading = false;
		this.onEnable(() => (wasSetByLoading = false));

		const inputParent = this.parent(new ComponentChild<ToolInputController>());
		this.tools.subscribe(() => inputParent.set(new ToolInputController(this)), true);

		this.event.subscribeObservable(
			LoadingController.isLoading,
			(loading) => {
				if (loading) {
					wasSetByLoading = true;
					prevTool = this.selectedTool.get();
					this.selectedTool.set(undefined);
				} else if (wasSetByLoading) {
					if (prevTool && this.tools.has(prevTool)) {
						this.selectedTool.set(prevTool);
					}

					prevTool = undefined;
				}

				inputParent.get()?.setEnabled(!loading);
			},
			true,
		);
	}

	/** Moves a tool to another hotbar position; slot keys follow positions, so it takes that position's key */
	moveTool(tool: ToolBase, index: number) {
		const order = [...this.tools.get()];
		const from = order.indexOf(tool);
		if (from === -1) return;

		order.remove(from);
		order.insert(math.clamp(index, 0, order.size()), tool);

		this.setOrder(order);
	}

	/** Replaces the tools with the same tools in another order, keeping the selected one equipped throughout */
	setOrder(order: readonly ToolBase[]) {
		this.reordering = true;
		this.tools.set(order);
		this.reordering = false;
	}

	getDebugChildren(): readonly DebuggableComponent[] {
		return [...super.getDebugChildren(), ...this.tools.get()];
	}
}
