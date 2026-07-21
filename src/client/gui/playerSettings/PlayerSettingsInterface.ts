import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { Observables } from "engine/shared/event/Observables";
import { PlayerConfigDefinition } from "shared/config/PlayerConfig";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

export class PlayerSettingsInterface extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		this.addCategory("Interface");
		{
			this.addSlider("UI Scale", { min: 0.5, max: 2, inputStep: 0.01 }) //
				.initToObjectPart(value, ["interface", "uiScale"]);

			const searchv = this.event.addObservable(
				Observables.createObservableSwitchFromObject(value, {
					changed: { interface: { searchBehaviour: { onSubmit: false } } },
					submit: { interface: { searchBehaviour: { onSubmit: true } } },
				}),
			);

			this.addSwitch("Search Behaviour", [
				["changed", { name: "Changed", description: "Searches when searchbar text changes" }],
				["submit", { name: "Submit", description: "Searches when searchbar focus is lost" }],
			]).initToObservable(searchv);
			this.addNumber("Search Delay", 0, 10, 0.1)
				.setDescription("Time in seconds after input to begin the search")
				.initToObjectPart(value, ["interface", "searchBehaviour", "delay"]);
		}

		this.addCategory("Beacons") //
			.setTooltipText("On-screen position indicators");
		{
			this.addToggle("Players") //
				.initToObjectPart(value, ["interface", "beacons", "players"]);
			this.addToggle("Plot") //
				.initToObjectPart(value, ["interface", "beacons", "plot"]);
		}

		this.addCategory("Units");
		{
			const speedv = this.event.addObservable(
				Observables.createObservableSwitchFromObject(value, {
					"Studs/s": { interface: { units: { speed: "Studs/s" } } },
					"m/s": { interface: { units: { speed: "m/s" } } },
					"km/h": { interface: { units: { speed: "km/h" } } },
					MPH: { interface: { units: { speed: "MPH" } } },
					Mach: { interface: { units: { speed: "Mach" } } },
				}),
			);
			const altitudev = this.event.addObservable(
				Observables.createObservableSwitchFromObject(value, {
					Studs: { interface: { units: { altitude: "Studs" } } },
					Meters: { interface: { units: { altitude: "Meters" } } },
					Kilometers: { interface: { units: { altitude: "Kilometers" } } },
					Feet: { interface: { units: { altitude: "Feet" } } },
				}),
			);
			const positionv = this.event.addObservable(
				Observables.createObservableSwitchFromObject(value, {
					Studs: { interface: { units: { position: "Studs" } } },
					Meters: { interface: { units: { position: "Meters" } } },
					Kilometers: { interface: { units: { position: "Kilometers" } } },
					Miles: { interface: { units: { position: "Miles" } } },
				}),
			);
			const gravityv = this.event.addObservable(
				Observables.createObservableSwitchFromObject(value, {
					"Studs/s²": { interface: { units: { gravity: "Studs/s²" } } },
					"Meters/s²": { interface: { units: { gravity: "Meters/s²" } } },
				}),
			);

			this.addNumber("Target Speed", 0, undefined, undefined) //
				.initToObjectPart(value, ["interface", "units", "targetSpeed"])
				.setDescription("Speedometer progress bar visual (studs/s)");

			this.addSwitch("Speedometer", [
				["Studs/s", { description: "Default Roblox measurement" }],
				["m/s", { description: "meters per second, unit of science" }],
				["km/h", { description: "kilometers per hour, the sensible unit" }],
				["MPH", { description: "miles per hour, MURICA" }],
				["Mach", { description: "The speed of sound" }],
			]).initToObservable(speedv);
			//
			this.addSwitch("Altimeter", [
				["Studs", { description: "Default Roblox measurement" }],
				["Meters", { description: "Unit of science" }],
				["Kilometers", { description: "When you are really up there" }],
				["Feet", { description: "Free bird" }],
			]).initToObservable(altitudev);
			//
			this.addSwitch("Position", [
				["Studs", { description: "Default Roblox measurement" }],
				["Meters", { description: "Unit of science" }],
				["Kilometers", { description: "When you are really out there" }],
				["Miles", { description: "Murica" }],
			]).initToObservable(positionv);
			//
			this.addSwitch("Gravity", [
				["Studs/s²", { description: "Default Roblox measurement" }],
				["Meters/s²", { description: "Unit of science" }],
			]).initToObservable(gravityv);
			//
		}

		this.addCategory("Wire/Weld tool");
		{
			this.addSlider("Marker transparency", { min: 0, max: 1 }) //
				.initToObjectPart(value, ["visuals", "wires", "markerTransparency"]);

			this.addSlider("Marker size multiplier", { min: 0.01, max: 4 }) //
				.initToObjectPart(value, ["visuals", "wires", "markerSizeMultiplier"]);

			this.addSlider("Wire transparency", { min: 0, max: 1 }) //
				.initToObjectPart(value, ["visuals", "wires", "wireTransparency"]);

			this.addSlider("Wire thickness multiplier", { min: 0.01, max: 4 }) //
				.initToObjectPart(value, ["visuals", "wires", "wireThicknessMultiplier"]);
		}

		this.addCategory("Luau");
		{
			this.addToggle("Syntax highlight in code editor") //
				.initToObjectPart(value, ["interface", "syntaxHighlight"]);
		}

		this.addCategory("Code editor colors");
		{
			const dfide = PlayerConfigDefinition.visuals.config.ide;
			const color = (name: string, token: keyof typeof dfide & string) =>
				this.addColor(name, dfide[token], false) //
					.initToObjectPart(value, ["visuals", "ide", token]);

			color("Background", "background");
			color("Identifier", "iden");
			color("Keyword", "keyword");
			color("Built-in", "builtin");
			color("Field", "field");
			color("Method", "method");
			color("String", "string");
			color("Number", "number");
			color("Comment", "comment");
			color("Operator", "operator");
			color("Unrecognised", "unknown");
		}
	}
}
