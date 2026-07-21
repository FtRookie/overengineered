import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { Observables } from "engine/shared/event/Observables";
import { GameDefinitions } from "shared/data/GameDefinitions";
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
				.initToObjectPart(value, ["environment", "physics", "impactDestruction", "enabled"]);

			this.addSlider("Base block health modifier", {
				min: 100,
				max: 4000,
				inputStep: 0.1,
			}).initToObjectPart(value, ["environment", "physics", "impactDestruction", "blockHealthModifier"]);

			this.addSlider("Minimal damage threshold (% from curent health)", {
				min: 0,
				max: 100,
				inputStep: 0.1,
			}).initToObjectPart(value, ["environment", "physics", "impactDestruction", "blockMinimalDamageThreshold"]);
		}

		this.addCategory("World Physics");
		{
			const gsetsv = this.event.addObservable(
				Observables.createObservableSwitchFromObject(value, {
					earth: { environment: { physics: { customGravity: 180 } } },
					moon: { environment: { physics: { customGravity: 180 * (1.62 / 9.81) } } },
					jupiter: { environment: { physics: { customGravity: 180 * (24.79 / 9.81) } } },
					realistic: { environment: { physics: { customGravity: 9.81 * GameDefinitions.METERS_TO_STUDS } } },
				}),
			);

			const gsets = this.addSwitch("Gravity Presets", [
				["earth", { name: "Earth", description: `World default of ${GameEnvironment.EarthGravity}st/s²` }],
				["moon", { name: "Moon", description: "Our closest friend in the universe" }],
				["jupiter", { name: "Jupiter", description: "Gas giant means giant gravitational forces" }],
				["realistic", { name: `"Realistic" Earth`, description: "9.81m/s²" }],
			]).initToObservable(gsetsv);

			this.addSlider("Gravity", {
				min: 0,
				max: 1000,
				inputStep: 0.1,
			}).initToObjectPart(value, ["environment", "physics", "customGravity"], "value");

			const aerov = this.event.addObservable(
				Observables.createObservableSwitchFromObject(value, {
					simplified: {
						environment: { physics: { advanced_aerodynamics: false, simplified_aerodynamics: true } },
					},
					realistic: {
						environment: { physics: { advanced_aerodynamics: false, simplified_aerodynamics: false } },
					},
					fullRealistic: {
						environment: { physics: { advanced_aerodynamics: true, simplified_aerodynamics: false } },
					},
				}),
			);

			this.addSwitch("Aerodynamics", [
				["simplified", { name: "Simplified", description: "Simple custom wings script" }],
				["realistic", { name: "Realistic", description: "Roblox Fluid Forces, working on wings only" }],
				["fullRealistic", { name: "Full realistic", description: "Roblox Fluid Forces on every single block" }],
			]).initToObservable(aerov);

			this.addVector3("Wind velocity") //
				.setDescription("A bad wind simulation. Only X and Z are used. Maximum is 10000")
				.initToObjectPart(value, ["environment", "physics", "windVelocity"]);
		}
	}
}
