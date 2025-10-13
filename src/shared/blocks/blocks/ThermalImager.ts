import { Lighting, RunService, Workspace } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { Element } from "engine/shared/Element";
import { A2SRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { Objects } from "engine/shared/fixes/Objects";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { Colors } from "shared/Colors";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["enabled", "fov", "brightness", "contrast", "tint"],
	input: {
		enabled: {
			displayName: "Enabled",
			types: {
				bool: {
					config: false,
					control: {
						config: {
							enabled: true,
							key: "F",
							reversed: false,
							switch: true,
						},
						canBeReversed: true,
						canBeSwitch: true,
					},
				},
			},
		},
		fov: {
			displayName: "Field Of View",
			types: {
				number: {
					config: 70,
					clamp: {
						showAsSlider: true,
						min: 1,
						max: 120,
					},
				},
			},
		},
		brightness: {
			displayName: "Brightness",
			types: {
				number: {
					config: 0,
					clamp: {
						showAsSlider: true,
						min: -1,
						max: 1,
					},
				},
			},
		},
		contrast: {
			displayName: "Contrast",
			types: {
				number: {
					config: 0,
					clamp: {
						showAsSlider: true,
						min: -1,
						max: 1,
					},
				},
			},
		},
		tint: {
			displayName: "Tint",
			types: {
				color: {
					config: Colors.white,
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

const defaultCamera = Workspace.CurrentCamera;
if (RunService.IsClient() && defaultCamera) {
	// Upon setting the Workspace.CurrentCamera, all cameras that are children of Workspace get deleted, so we create a nested folder for the camera
	defaultCamera.Parent = Element.create("Folder", { Name: "Camera", Parent: Workspace });
}

const enabledCameras = new Set<Logic>();

export type { Logic as ThermalCameraBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	static readonly events = {
		update: new A2SRemoteEvent<{ readonly block: BlockModel; readonly enabled: boolean }>("b_thermalimager_update"),
	} as const;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		if (!RunService.IsClient()) return;

		const target = this.instance.WaitForChild("Target") as BasePart;
		const camera = Element.create("Camera", {
			CFrame: target.CFrame,
			CameraSubject: target,
			CameraType: Enum.CameraType.Scriptable,
			Parent: this.instance,
		});

		const effect = Element.create("ColorCorrectionEffect", {
			Enabled: false,
			Name: `ColorCorrectionCamera_${block.instance}`,
			Parent: Lighting,
		});
		const blur = Element.create("BlurEffect", {
			Enabled: false,
			Name: `BlurEffectCamera_${block.instance}`,
			Parent: Lighting,
		});

		effect.Saturation = -1;
		blur.Size = 24;
		this.onDisable(() => effect.Destroy());
		this.onDisable(() => blur.Destroy());

		this.onk(["fov"], ({ fov }) => (camera.FieldOfView = fov));
		this.onk(["brightness"], ({ brightness }) => (effect.Brightness = brightness));
		this.onk(["contrast"], ({ contrast }) => (effect.Contrast = contrast));
		this.onk(["tint"], ({ tint }) => (effect.TintColor = tint));

		const ticker = new Component();
		ticker.onDisable(() => disable());
		ticker.event.subscribe(RunService.RenderStepped, () => (camera.CFrame = target.CFrame));
		this.onDisable(() => ticker.disable());
		this.onDescendantDestroyed(() => ticker.destroy());

		this.event.readonlyObservableFromInstanceParam(Workspace, "CurrentCamera").subscribe((wcamera) => {
			const thisCamera = wcamera === camera;

			ticker.setEnabled(thisCamera);
			effect.Enabled = thisCamera;
			blur.Enabled = thisCamera;
		});

		const fovCache = this.initializeInputCache("fov");

		const disable = () => {
			enabledCameras.delete(this);
			Workspace.CurrentCamera =
				(Objects.firstKey(enabledCameras)?.instance.FindFirstChild("Camera") as Camera | undefined) ??
				defaultCamera;
		};

		const localTargetPos = this.instance.GetPivot().PointToObjectSpace(target.Position);

		this.onk(["enabled"], ({ enabled }) => {
			if (enabled) {
				enabledCameras.add(this);
				Workspace.CurrentCamera = camera;
				camera.FieldOfView = fovCache.tryGet() ?? definition.input.fov.types.number.config;
			} else {
				disable();
			}

			Logic.events.update.send({ block: this.instance, enabled });
			Logic.update(this.instance, enabled);
		});

		this.onDisable(disable);
	}

	static update(block: BlockModel, enabled: boolean) {
		const led = block.FindFirstChild("LED") as BasePart | undefined;
		if (!led) return;

		led.Color = enabled ? Colors.green : Colors.red;
	}
}

export const ThermalImagerBlock = {
	...BlockCreation.defaults,
	id: "thermalimager",
	displayName: "Thermal Imager",
	description: "Player builds glow",

	logic: { definition, ctor: Logic },
	mirror: {
		behaviour: "offset180",
	},
} as const satisfies BlockBuilder;
