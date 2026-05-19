import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

export class PlayerSettingsControls extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		this.addCategory("General");
		{
			this.addSlider("Sprint speed", { min: 20, max: 1000, inputStep: 0.01 }) //
				.initToObjectPart(value, ["sprintSpeed"]);
			this.addSlider("Jump power", { min: 0, max: 200, inputStep: 0.01 }) //
				.initToObjectPart(value, ["jumpPower"]);
		}

		this.addCategory("Ragdoll");
		{
			this.addToggle("Automatic trigger") //
				.initToObjectPart(value, ["ragdoll", "autoFall"]);

			this.addToggle("Automatic recovery after 4 seconds") //
				.initToObjectPart(value, ["ragdoll", "autoRecovery"]);

			this.addToggle("Automatic recovery when trying to move") //
				.initToObjectPart(value, ["ragdoll", "autoRecoveryByMoving"]);

			this.addKey("Trigger key") //
				.initToObjectPart(value, ["ragdoll", "triggerKey"]);
		}
	}
}
