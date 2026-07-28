import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { ConfirmPopup } from "client/gui/popup/ConfirmPopup";
import { Observables } from "engine/shared/event/Observables";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { PlayerConfigDefinition } from "shared/config/PlayerConfig";
import { GetDescription, GetUnloadables } from "shared/MapLoadingConfigurator";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { PopupController } from "client/gui/PopupController";

const LOAD_DISTANCE_MAX = 256;
const LOAD_DISTANCE_WARN = 96; // above this, confirm first: very high distances can crash weaker devices

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

			const terrainShape = this.addSwitch("Shape", [
				["Default", { description: "The original terrain" }],
				["Realistic", { description: "Continents, coastlines and mountain ranges" }],
			]) //
				.initToObjectPart(value, ["environment", "terrain", "generator"]);

			const configLoadDistance = this.event.addObservable(
				Observables.createObservableFromObjectProperty<number>(value, [
					"environment",
					"terrain",
					"loadDistance",
				]),
			);
			const localLoadDistance = new ObservableValue<number>(configLoadDistance.get());
			const loadDistance = this.addSlider("Load distance", { min: 1, max: LOAD_DISTANCE_MAX, step: 1 }) //
				.initToObservable(localLoadDistance, "value");

			this.$onInjectAuto((popupController: PopupController) => {
				let confirmOpen = false;
				this.event.subscribeObservable(configLoadDistance, (v) => localLoadDistance.set(v));
				this.event.subscribeObservable(localLoadDistance, (v) => {
					if (v === configLoadDistance.get()) return;
					if (v <= LOAD_DISTANCE_WARN) {
						configLoadDistance.set(v);
						return;
					}
					if (confirmOpen) return;
					confirmOpen = true;
					popupController.showPopup(
						new ConfirmPopup(
							"Very high load distance",
							"This can severely hurt performance and may crash lower-end devices. Apply anyway?",
							() => {
								confirmOpen = false;
								configLoadDistance.set(localLoadDistance.get());
							},
							() => {
								confirmOpen = false;
								localLoadDistance.set(configLoadDistance.get());
							},
						),
					);
				});
			});

			const forwardLoading = this.addToggle("Forward loading") //
				.setDescription(
					"Load only terrain in the camera's forward 180. Much faster when flying in a straight line.",
				)
				.initToObjectPart(value, ["environment", "terrain", "forwardLoading"]);
			const cullTerrain = this.addToggle("Cull distant terrain") //
				.setDescription(
					"Unload far triangle chunks to save memory. Off keeps them loaded: smoother, more memory.",
				)
				.initToObjectPart(value, ["environment", "terrain", "culling"]);

			const triangleResolution = this.addSlider("Resolution", { min: 1, max: 16, step: 1 }) //
				.initToObjectPart(value, ["environment", "terrain", "resolution"]);
			const triangleWater = this.addToggle("Water") //
				.initToObjectPart(value, ["environment", "terrain", "water", "enabled"]);
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
			const cloudDensity = this.addSlider("Cloud Density", { min: 0, max: 1, inputStep: 0.01 }) //
				.setDescription("Thickness of the clouds")
				.initToObjectPart(value, ["environment", "terrain", "cloud", "density"], "value");
			const cloudCover = this.addSlider("Cloud Cover", { min: 0, max: 1, inputStep: 0.01 }) //
				.setDescription("How much of the sky is covered")
				.initToObjectPart(value, ["environment", "terrain", "cloud", "cover"], "value");

			const dfterrain = PlayerConfigDefinition.environment.config.terrain;

			const terrainOverrideColor = this.addColor("Color", dfterrain.override.color, false) //
				.initToObjectPart(value, ["environment", "terrain", "override", "color"]);
			const terrainWaterColor = this.addColor("Water Color", dfterrain.water.color, true) //
				.setDescription("Alpha controls water opacity")
				.initToObjectPart(value, ["environment", "terrain", "water", "color"]);
			this.addSlider("Water Reflectance", { min: 0, max: 1, inputStep: 0.01 }) //
				.setDescription("How reflective the water surface is")
				.initToObjectPart(value, ["environment", "terrain", "water", "reflectance"], "value");
			this.addSlider("Water Wave Size", { min: 0, max: 1, inputStep: 0.01 }) //
				.setDescription("Height of the waves")
				.initToObjectPart(value, ["environment", "terrain", "water", "waveSize"], "value");
			this.addSlider("Water Wave Speed", { min: 0, max: 100, inputStep: 1 }) //
				.setDescription("How fast the waves move")
				.initToObjectPart(value, ["environment", "terrain", "water", "waveSpeed"], "value");

			this.event.subscribeObservable(
				this.event.addObservable(value.fReadonlyCreateBased((c) => c.environment.terrain)),
				({ kind, snowOnly, override, cloud }) => {
					const isTriangle = kind === "Triangle";
					const isFlat = kind === "Flat";
					loadDistance.setVisibleAndEnabled(kind !== "Void");
					forwardLoading.setVisibleAndEnabled(kind !== "Void");
					cullTerrain.setVisibleAndEnabled(isTriangle);
					terrainShape.setVisibleAndEnabled(isTriangle || kind === "Classic");

					cloudDensity.setVisibleAndEnabled(!cloud.auto);
					cloudCover.setVisibleAndEnabled(!cloud.auto);
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
				const unloadables = GetUnloadables();
				const allHidden = (mapUnload: MapUnloadConfiguration) => unloadables.all((e) => !mapUnload[e.Name]);

				const toggleAll = this.addButton("Toggle All", () => {
					const config = value.get();
					const shown = allHidden(config.environment.mapUnload);
					value.set({
						...config,
						environment: {
							...config.environment,
							mapUnload: asObject(unloadables.mapToMap((e) => $tuple(e.Name, shown))),
						},
					});
				}).setDescription("Show/hide all toggleable map objects, hide reccomended for lower end devices");

				this.event.subscribeObservable(
					this.event.addObservable(value.fReadonlyCreateBased((c) => c.environment.mapUnload)),
					(mapUnload) => toggleAll.button.setButtonText(allHidden(mapUnload) ? "Enable" : "Disable"),
					true,
				);

				const toggles = unloadables.map((unloadable) =>
					this.addToggle(unloadable.Name)
						.initToObjectPart(value, ["environment", "mapUnload", unloadable.Name], "value")
						.setDescription(GetDescription(unloadable)),
				);
			}
		}
	}
}
