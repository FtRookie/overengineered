import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { Observables } from "engine/shared/event/Observables";
import { GameEnvironment } from "shared/data/GameEnvironment";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

export class PlayerSettingsPhysics extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		this.addCategory("Impact Physics");
		{
			this.addToggle("Impact destruction") //
				.initToObjectPart(value, ["impact_destruction"]);

			this.addSlider("Base block health modifier", {
				min: 100,
				max: 4000,
				inputStep: 0.1,
			}).initToObjectPart(value, ["blockHealthModifier"]);

			this.addSlider("Minimal damage threshold (% from curent health)", {
				min: 0,
				max: 100,
				inputStep: 0.1,
			}).initToObjectPart(value, ["blockMinimalDamageThreshold"]);
		}

		this.addCategory("World Physics");
		{
			this.addSwitch("Gravity Presets", [
				["earth", { name: "Earth", description: `World default of ${GameEnvironment.EarthGravity}` }],
				["realistic", { name: "Realistic Earth", description: "9.81m/s²" }],
				["custom", { name: "Custom", description: "Your configured value" }],
			]).initToObjectPart(value, ["physics", "gravityPreset"]);

			const gslider = this.addSlider("Gravity", {
				min: 0,
				max: 1000,
				inputStep: 0.1,
			}).initToObjectPart(value, ["physics", "customGravity"], "value");
			gslider.setVisibleAndEnabled(value.get().physics.gravityPreset === "custom");

			this.event
				.addObservable(value.fReadonlyCreateBased((c) => c.physics.gravityPreset)) //
				.subscribe((gravityPreset) => {
					gslider.setVisibleAndEnabled(gravityPreset === "custom");
					if (gravityPreset !== "custom") {
						const original = value.get();
						value.set({
							...original,
							physics: {
								...original.physics,
								customGravity: GameEnvironment.PresetToGravity[gravityPreset],
							},
						});
					}
				});

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
