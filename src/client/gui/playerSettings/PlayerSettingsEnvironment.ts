import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { Observables } from "engine/shared/event/Observables";
import { PlayerConfigDefinition } from "shared/config/PlayerConfig";
import { GetDescription, GetUnloadables } from "shared/MapLoadingConfigurator";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

export class PlayerSettingsEnvironment extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		this.addCategory("Day cycle");
		{
			this.addToggle("Automatic") //
				.setDescription("Automatic time, synced with all players. 20 minutes per in-game day.")
				.initToObjectPart(value, ["environment", "dayCycle", "automatic"]);

			const manual = this.addSlider("Manual", { min: 0, max: 24, inputStep: 0.1 }) //
				.setDescription("Manual time, hours.")
				.initToObjectPart(value, ["environment", "dayCycle", "manual"], "value");

			this.event
				.addObservable(value.fReadonlyCreateBased((c) => c.environment.dayCycle))
				.subscribe(({ automatic }) => manual.setVisibleAndEnabled(!automatic), true);
		}

		this.addCategory("Terrain");
		{
			this.addSwitch("Type", [
				["Classic", { description: "Default Roblox terrain" }],
				["Triangle", { description: "Custom triangle part terrain" }],
				["Flat", { description: "Flat terrain" }],
				["Water", { description: "Water only terrain" }],
				["Lava", { description: "Flat terrain with lava" }],
				["Void", { description: "EMPTY NOTHINGNESS" }],
			]) //
				.initToObjectPart(value, ["environment", "terrain", "kind"]);

			this.addSwitch("Shape", [
				["Default", { description: "The original terrain" }],
				["Realistic", { description: "Continents, coastlines and mountain ranges" }],
			]) //
				.initToObjectPart(value, ["environment", "terrain", "generator"]);

			const loadDistance = this.addSlider("Load distance", { min: 1, max: 96, step: 1 }) //
				.initToObjectPart(value, ["environment", "terrain", "loadDistance"]);

			const triangleResolution = this.addSlider("Resolution", { min: 1, max: 16, step: 1 }) //
				.initToObjectPart(value, ["environment", "terrain", "resolution"]);
			const triangleWater = this.addToggle("Water") //
				.initToObjectPart(value, ["environment", "terrain", "water"]);
			const triangleSandBelowSeaLevel = this.addToggle("Sand below sea level") //
				.initToObjectPart(value, ["environment", "terrain", "triangleAddSandBelowSeaLevel"]);

			const classicFoliage = this.addToggle("Foliage") //
				.initToObjectPart(value, ["environment", "terrain", "foliage"]);

			const terrainSnowOnly = this.addToggle("Snow only") //
				.initToObjectPart(value, ["environment", "terrain", "snowOnly"]);

			const terrainOverride = this.addToggle("Override material") //
				.initToObjectPart(value, ["environment", "terrain", "override", "enabled"]);

			const terrainOverrideMaterial = this.addMaterial("Material", Enum.Material.Plastic) //
				.initToObservable(
					this.event
						.addObservable(
							Observables.createObservableFromObjectProperty<string>(value, [
								"environment",
								"terrain",
								"override",
								"material",
							]),
						)
						.fCreateBased(
							(c) => Enum.Material[c as never] as Enum.Material,
							(c) => c.Name,
						),
				);
			this.addToggle("Sync Clouds") //
				.setDescription("Synchronize clouds with other clients")
				.initToObjectPart(value, ["environment", "terrain", "cloud", "auto"]);
			this.addSlider("Cloud Density", { min: 0, max: 1, inputStep: 0.01 }) //
				.setDescription("Thickness of the clouds")
				.initToObjectPart(value, ["environment", "terrain", "cloud", "density"]);
			this.addSlider("Cloud Cover", { min: 0, max: 1, inputStep: 0.01 }) //
				.setDescription("How much of the sky is covered")
				.initToObjectPart(value, ["environment", "terrain", "cloud", "cover"]);

			const dfterrain = PlayerConfigDefinition.environment.config.terrain;

			const terrainOverrideColor = this.addColor("Color", dfterrain.override.color, false) //
				.initToObjectPart(value, ["environment", "terrain", "override", "color"]);
			const terrainWaterColor = this.addColor("Water Color", dfterrain.waterColor, false) //
				.initToObjectPart(value, ["environment", "terrain", "waterColor"]);

			this.event.subscribeObservable(
				this.event.addObservable(value.fReadonlyCreateBased((c) => c.environment.terrain)),
				({ kind, snowOnly, override }) => {
					const isTriangle = kind === "Triangle";
					const isFlat = kind === "Flat";
					loadDistance.setVisibleAndEnabled(kind !== "Void");
					triangleResolution.setVisibleAndEnabled(isTriangle);
					triangleWater.setVisibleAndEnabled(isTriangle);
					triangleSandBelowSeaLevel.setVisibleAndEnabled(isTriangle && !snowOnly);

					classicFoliage.setVisibleAndEnabled(kind === "Classic");

					terrainSnowOnly.setVisibleAndEnabled(
						kind !== "Water" && kind !== "Lava" && kind !== "Void" && !override.enabled,
					);

					terrainOverride.setVisibleAndEnabled(isTriangle || isFlat);
					terrainOverrideMaterial.setVisibleAndEnabled((isTriangle || isFlat) && override.enabled);
					terrainOverrideColor.setVisibleAndEnabled((isTriangle || isFlat) && override.enabled);
					terrainWaterColor.setVisibleAndEnabled(!isFlat);
				},
				true,
			);

			this.addCategory("Map Elements");
			{
				this.addButton("Toggle All", () =>
					value.set({
						...value.get(),
						environment: {
							...value.get().environment,
							mapUnload: asObject(GetUnloadables().mapToMap((e) => $tuple(e.Name, false))),
						},
					}),
				)
					.setDescription("Toggles all toggleable map objects, reccomended for lower end devices")
					.button.setButtonText("Disable");

				const toggles = GetUnloadables().map((unloadable) =>
					this.addToggle(unloadable.Name)
						.initToObjectPart(value, ["environment", "mapUnload", unloadable.Name], "value")
						.setDescription(GetDescription(unloadable)),
				);
			}
		}
	}
}
