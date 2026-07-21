import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

export class PlayerSettingsCamera extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		this.addCategory("Camera");
		{
			this.addSlider("Field of View", { min: 1, max: 120, inputStep: 1 }) //
				.initToObjectPart(value, ["graphics", "camera", "fov"], "value");

			this.addToggle("Improved") //
				.initToObjectPart(value, ["graphics", "camera", "improved"]);

			this.addToggle("Strict Follow") //
				.initToObjectPart(value, ["graphics", "camera", "strictFollow"])
				.setDescription("Strictly follow the player");

			this.addToggle("Player Centered") //
				.initToObjectPart(value, ["graphics", "camera", "playerCentered"])
				.setDescription("Center camera at the player instead of the vehicle");
		}
	}
}
