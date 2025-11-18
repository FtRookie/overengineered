import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { Observables } from "engine/shared/event/Observables";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

export class PlayerSettingsPhysics extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		this.addCategory("General");
		{
			this.addToggle("Impact destruction") //
				.initToObjectPart(value, ["impact_destruction"]);

			const aerov = this.event.addObservable(
				Observables.createObservableSwitchFromObject(value, {
					simplified: { physics: { advanced_aerodynamics: false, simplified_aerodynamics: true } },
					realistic: { physics: { advanced_aerodynamics: false, simplified_aerodynamics: false } },
					fullRealistic: { physics: { advanced_aerodynamics: true, simplified_aerodynamics: false } },
				}),
			);

			this.addSwitch("Aerodynamics", [
				["simplified", { name: "Simplified", description: "Simple custom wings script" }],
				["realistic", { name: "Realistic", description: "Roblox Fluid Forces, working on wings only" }],
				["fullRealistic", { name: "Full realistic", description: "Roblox Fluid Forces on every single block" }],
			]).initToObservable(aerov);

			this.addVector3("Wind velocity") //
				.setDescription("A bad wind simulation. Only X and Z are used. Maximum is 10000")
				.initToObjectPart(value, ["physics", "windVelocity"]);
		}
	}
}
