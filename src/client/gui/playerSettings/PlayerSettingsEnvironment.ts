import { Workspace } from "@rbxts/services";
import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { Colors } from "engine/shared/Colors";
import { Observables } from "engine/shared/event/Observables";
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
				.initToObjectPart(value, ["dayCycle", "automatic"]);

			const manual = this.addSlider("Manual", { min: 0, max: 24, inputStep: 0.1 }) //
				.setDescription("Manual time, hours.")
				.initToObjectPart(value, ["dayCycle", "manual"], "value");

			this.event
				.addObservable(value.fReadonlyCreateBased((c) => c.dayCycle))
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
				.initToObjectPart(value, ["terrain", "kind"]);

			const loadDistance = this.addSlider("Load distance", { min: 1, max: 96, step: 1 }) //
				.initToObjectPart(value, ["terrain", "loadDistance"]);

			const triangleResolution = this.addSlider("Resolution", { min: 1, max: 16, step: 1 }) //
				.initToObjectPart(value, ["terrain", "resolution"]);
			const triangleWater = this.addToggle("Water") //
				.initToObjectPart(value, ["terrain", "water"]);
			const triangleSandBelowSeaLevel = this.addToggle("Sand below sea level") //
				.initToObjectPart(value, ["terrain", "triangleAddSandBelowSeaLevel"]);

			const classicFoliage = this.addToggle("Foliage") //
				.initToObjectPart(value, ["terrain", "foliage"]);

			const terrainSnowOnly = this.addToggle("Snow only") //
				.initToObjectPart(value, ["terrain", "snowOnly"]);

			const terrainOverride = this.addToggle("Override material") //
				.initToObjectPart(value, ["terrain", "override", "enabled"]);

			const terrainOverrideMaterial = this.addMaterial("Material", Enum.Material.Plastic) //
				.initToObservable(
					this.event
						.addObservable(
							Observables.createObservableFromObjectProperty<string>(value, [
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

			const terrainOverrideColor = this.addColor("Color", { alpha: 1, color: Colors.white }, false) //
				.initToObjectPart(value, ["terrain", "override", "color"]);
			const terrainWaterColor = this.addColor(
				"Water Color",
				{ alpha: 1, color: Workspace.Terrain.WaterColor },
				false,
			).initToObjectPart(value, ["terrain", "waterColor"]);

			const callback = this.event
				.addObservable(value.fReadonlyCreateBased((c) => c.terrain)) //
				.subscribe(({ kind, snowOnly, override }) => {
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

					terrainOverride.setVisibleAndEnabled((isTriangle || isFlat) && !snowOnly);
					terrainOverrideMaterial.setVisibleAndEnabled((isTriangle || isFlat) && override.enabled);
					terrainOverrideColor.setVisibleAndEnabled((isTriangle || isFlat) && override.enabled);
					terrainWaterColor.setVisibleAndEnabled(!isFlat);
				}, true);

			this.addCategory("Map Elements");
			{
				this.addButton("Toggle All", () =>
					value.set({
						...value.get(),
						mapUnload: asObject(GetUnloadables().mapToMap((e) => $tuple(e.Name, false))),
					}),
				)
					.setDescription("Toggles all toggleable map objects, reccomended for lower end devices")
					.button.setButtonText("Disable");

				const toggles = GetUnloadables().map((unloadable) =>
					this.addToggle(unloadable.Name)
						.initToObjectPart(value, ["mapUnload", unloadable.Name], "value")
						.setDescription(GetDescription(unloadable)),
				);
			}
		}
	}
}
