import { ServiceIntegrityChecker } from "client/integrity/ServiceIntegrityChecker";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { Element } from "engine/shared/Element";
import { ObservableValue } from "engine/shared/event/ObservableValue";

// Only what the class itself touches; a window declares its own header, since not all of them call it TextLabel.
export type FloatingWindowDefinition = GuiObject;
export class FloatingWindow extends Control<FloatingWindowDefinition> {
	/**
	 * Whether the interface as a whole is shown. Every floating window lives on its own ScreenGui parented straight
	 * to PlayerGui, so it is a sibling of the screens {@link HideInterfaceController} toggles and cannot be reached
	 * by hiding those. A window's screen is gated on this as well as on its own state.
	 */
	static readonly interfaceVisible = new ObservableValue(true);

	static newScreen(name?: string): ScreenGui {
		return Element.create("ScreenGui", {
			Name: `${name} Floating`,
			Enabled: false,
			ResetOnSpawn: false,
			Parent: Interface.getPlayerGui(),
		});
	}
	static create(gui: FloatingWindowDefinition): FloatingWindow {
		const guiInstance = this.newScreen(gui.Name);
		ServiceIntegrityChecker.whitelistInstance(guiInstance);

		const control = new FloatingWindow(gui, guiInstance);
		control.add(control);

		return control;
	}

	constructor(gui: FloatingWindowDefinition, screen: ScreenGui) {
		super(gui);

		gui.Parent = screen;

		const refresh = () => (screen.Enabled = this.isEnabled() && FloatingWindow.interfaceVisible.get());
		this.onEnable(refresh);
		this.onDisable(refresh);
		this.event.subscribeObservable(FloatingWindow.interfaceVisible, refresh);
		ComponentInstance.init(this, screen);
	}
}
