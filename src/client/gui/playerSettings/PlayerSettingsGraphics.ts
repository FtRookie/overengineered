import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

export class PlayerSettingsGraphics extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		this.addCategory("General");
		{
			this.addToggle("Local shadows") //
				.initToObjectPart(value, ["graphics", "localShadows"])
				.setDescription("Shadows of your build");

			this.addToggle("Others shadows") //
				.initToObjectPart(value, ["graphics", "othersShadows"])
				.setDescription("Shadows of other builds");

			this.addToggle("Others effects") //
				.initToObjectPart(value, ["graphics", "othersEffects"])
				.setDescription("Effects of other players (e.g. fire of the rocket engine)");
		}

		this.addCategory("Logic");
		{
			this.addToggle("Logic Effects") //
				.initToObjectPart(value, ["graphics", "logicEffects"])
				.setDescription("Extra effects of logic blocks (e.g. flickering lights and other fancy stuff)");
		}
	}
}
