import { ContextActionService, Players } from "@rbxts/services";
import { Keybinds } from "engine/client/Keybinds";
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

/** Rebindable, and its touch button is arranged by TouchButtonController like every other one. */
const sprintKeybind = Keybinds.registerDefinition(
	"character_sprint",
	["Character", "Sprint"],
	[["LeftShift"], ["ButtonY"]],
	undefined,
	{
		description: "Allows you to move more quickly",
		image: "rbxassetid://9555118706",
		position: new UDim2(0, 60, 0, 100),
	},
);

class PlayerMovementLogic extends HostedService {
	constructor(
		sprintSpeed: ReadonlyObservableValue<number>,
		jumpPower: ReadonlyObservableValue<number>,
		keybinds: Keybinds,
	) {
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

		const registration = keybinds.fromDefinition(sprintKeybind);
		const showState = () => ContextActionService.SetTitle(sprintKeybind.action, isSprinting.get() ? "On" : "");

		// Latched from the on-screen button, held from a key: nothing to keep held on a touch screen.
		// Decided per press, not the current input type, which flips as the player alternates devices.
		const fromButton = (input: InputObject) =>
			input.UserInputType === Enum.UserInputType.Touch || input.KeyCode === Enum.KeyCode.Unknown;

		this.event.subscribeRegistration(() =>
			registration.onDown((input) => {
				isSprinting.set(fromButton(input) ? !isSprinting.get() : true);
				showState();

				return "Pass";
			}),
		);
		this.event.subscribeRegistration(() =>
			registration.onUp((input) => {
				if (!fromButton(input)) isSprinting.set(false);
				showState();

				return "Pass";
			}),
		);
		this.event.onInputBegin(updateJump);
	}
}

/** Character has `EnableFluidForces` by default; the huge `Workspace.AirDensity` makes it float. */
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
			return [sprintSpeed, jumpPower, di.resolve<Keybinds>()];
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
