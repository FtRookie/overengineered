import { ContextActionService, Players } from "@rbxts/services";
import { InputController } from "engine/client/InputController";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { HostedService } from "engine/shared/di/HostedService";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { Physics } from "shared/Physics";
import { PartUtils } from "shared/utils/PartUtils";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";
import type { LocalHeight } from "shared/Physics";

class PlayerMovementLogic extends HostedService {
	constructor(sprintSpeed: ReadonlyObservableValue<number>, jumpPower: ReadonlyObservableValue<number>) {
		super();

		const isSprinting = new ObservableValue<boolean>(false);
		const updateSprint = () => {
			const humanoid = LocalPlayer.humanoid.get();
			if (!humanoid) return;
			humanoid.WalkSpeed = isSprinting.get() ? sprintSpeed.get() : 20;
		};

		const updateJump = () => {
			const humanoid = LocalPlayer.humanoid.get();
			if (!humanoid) return;
			humanoid.JumpPower = jumpPower.get() ?? 50;
		};

		isSprinting.subscribe(updateSprint);
		this.event.subscribeObservable(sprintSpeed, updateSprint);
		this.event.subscribeObservable(jumpPower, updateJump);

		this.event.subscribeObservable(
			InputController.inputType,
			(inputType) => {
				// Remove old action (if exists)
				ContextActionService.UnbindAction("Sprint");

				// Bind new action
				ContextActionService.BindAction(
					"Sprint",
					(name, inputState) => {
						if (inputType === "Touch") {
							if (inputState !== Enum.UserInputState.Begin) return;

							isSprinting.set(!isSprinting.get());
						} else {
							isSprinting.set(inputState === Enum.UserInputState.Begin);
						}

						ContextActionService.SetTitle("Sprint", isSprinting.get() ? "On" : "");
						return Enum.ContextActionResult.Pass;
					},
					inputType === "Touch",
					Enum.KeyCode.LeftShift,
					Enum.KeyCode.ButtonY,
				);
				ContextActionService.SetDescription("Sprint", "Allows you to move more quickly");
				ContextActionService.SetImage("Sprint", "rbxassetid://9555118706");
				ContextActionService.SetPosition("Sprint", new UDim2(0, 60, 0, 100));
			},
			true,
		);
		this.event.onInputBegin(updateJump); // probably unoptimized but who cares
	}
}

/** By default, character has `EnableFluidForces`, but because of the huge `Workspace.AirDensity`, it just flies like a feather */
class DisableFluidForces extends HostedService {
	constructor() {
		super();

		this.event.subscribeObservable(
			LocalPlayer.character,
			(char) => {
				if (!char) return;

				PartUtils.applyToAllDescendantsOfType("BasePart", char, (part) => (part.EnableFluidForces = false));
				char.DescendantAdded.Connect((child) => {
					if (child.IsA("BasePart")) {
						child.EnableFluidForces = false;
					}
				});
			},
			true,
		);
	}
}

class SetCameraMaxZoomDistance extends HostedService {
	constructor(distance: number) {
		super();

		const defaultDistance = Players.LocalPlayer.CameraMaxZoomDistance;
		this.onEnable(() => (Players.LocalPlayer.CameraMaxZoomDistance = distance));
		this.onDestroy(() => (Players.LocalPlayer.CameraMaxZoomDistance = defaultDistance));
	}
}

export namespace LocalPlayerController {
	export function initializeDisablingFluidForces(host: GameHostBuilder): void {
		host.services.registerService(DisableFluidForces);
	}
	export function initializeMovementLogic(host: GameHostBuilder): void {
		host.services.registerService(PlayerMovementLogic).withArgs((di) => {
			const sprintSpeed = di.resolve<PlayerDataStorage>().config.createBased((c) => c.character.sprintSpeed);
			const jumpPower = di.resolve<PlayerDataStorage>().config.createBased((c) => c.character.jumpPower);
			return [sprintSpeed, jumpPower];
		});
	}
	export function initializeCameraMaxZoomDistance(host: GameHostBuilder, distance: number): void {
		host.services.registerService(SetCameraMaxZoomDistance).withArgs([distance]);
	}

	/** Current player height in studs */
	export function getPlayerRelativeHeight(): LocalHeight {
		return Physics.LocalHeight.fromGlobal(LocalPlayer.rootPart.get()?.Position?.Y ?? GameDefinitions.HEIGHT_OFFSET);
	}
}
