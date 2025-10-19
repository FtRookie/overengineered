import { Lighting, Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { Element } from "engine/shared/Element";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { A2SRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { Objects } from "engine/shared/fixes/Objects";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { Colors } from "shared/Colors";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["enabled", "controllable", "fov", "saturation", "brightness", "contrast", "tint"],
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
		controllable: {
			displayName: "Controllable",
			connectorHidden: true,
			types: { bool: { config: false } },
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
		saturation: {
			displayName: "Saturation",
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

export type { Logic as CameraBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition> {
	static readonly events = {
		update: new A2SRemoteEvent<{ readonly block: BlockModel; readonly enabled: boolean }>("b_camera_update"),
	} as const;

	constructor(block: InstanceBlockLogicArgs, @inject playerData: PlayerDataStorage) {
		super(definition, block);

		if (!RunService.IsClient()) return;
		if (!defaultCamera) return;

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
		this.onDisable(() => effect.Destroy());

		this.onk(["fov"], ({ fov }) => (camera.FieldOfView = fov));
		this.onk(["brightness"], ({ brightness }) => (effect.Brightness = brightness));
		this.onk(["contrast"], ({ contrast }) => (effect.Contrast = contrast));
		this.onk(["saturation"], ({ saturation }) => (effect.Saturation = saturation));
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
		});

		const fovCache = this.initializeInputCache("fov");
		const controllableCache = this.initializeInputCache("controllable");

		let cameraSub: SignalConnection | undefined = undefined;
		this.onDisable(() => cameraSub?.Disconnect());

		const disable = () => {
			cameraSub?.Disconnect();
			cameraModeSub?.Disconnect();
			isFirstPerson.set(false);

			if (controllableCache.tryGet()) {
				defaultCamera!.CameraSubject = Players.LocalPlayer.Character?.FindFirstChild("Humanoid") as
					| Humanoid
					| undefined;
			} else {
				enabledCameras.delete(this);
				Workspace.CurrentCamera =
					(Objects.firstKey(enabledCameras)?.instance.FindFirstChild("Camera") as Camera | undefined) ??
					defaultCamera;
			}
			defaultCamera.FieldOfView = playerData.config.get().betterCamera.fov ?? 70;
		};

		let cameraModeSub: SignalConnection | undefined;
		this.onDisable(() => cameraModeSub?.Disconnect());

		const localTargetPos = this.instance.GetPivot().PointToObjectSpace(target.Position);
		const isFirstPerson = new ObservableValue<boolean>(false);
		isFirstPerson.subscribe((fp) => {
			if (fp) {
				target.Position = this.instance
					.GetPivot()
					.PointToWorldSpace(localTargetPos.add(new Vector3(0, 0.6, 0)));
			} else {
				target.Position = this.instance.GetPivot().PointToWorldSpace(localTargetPos);
			}
		});

		this.onk(["enabled"], ({ enabled }) => {
			if (enabled) {
				if (controllableCache.tryGet()) {
					cameraSub = defaultCamera?.GetPropertyChangedSignal("CameraSubject").Connect(() => {
						const subject = defaultCamera!.CameraSubject;
						if (subject?.Name !== "Target") {
							defaultCamera!.CameraSubject = target;
						}
					});
					cameraModeSub = this.event.loop(0, () =>
						isFirstPerson.set(UserInputService.MouseBehavior === Enum.MouseBehavior.LockCenter),
					);
					defaultCamera!.FieldOfView = fovCache.tryGet() ?? definition.input.fov.types.number.config;
					defaultCamera!.CameraSubject = target;
				} else {
					enabledCameras.add(this);
					Workspace.CurrentCamera = camera;
					camera.FieldOfView = fovCache.tryGet() ?? definition.input.fov.types.number.config;
				}
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

export const CameraBlock = {
	...BlockCreation.defaults,
	id: "camera",
	displayName: "Camera",
	description: "Does camera things",

	logic: { definition, ctor: Logic },
	mirror: {
		behaviour: "offset180",
	},
} as const satisfies BlockBuilder;
