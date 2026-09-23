import { GuiService, Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { BlockSelect } from "client/tools/highlighters/BlockSelect";
import { Interface } from "engine/client/gui/Interface";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { HostedService } from "engine/shared/di/HostedService";
import { ArgsSignal } from "engine/shared/event/Signal";
import { PlayerUtils } from "engine/shared/utils/PlayerUtils";
import { BlockManager } from "shared/building/BlockManager";

export type CursorHit = {
	readonly part: BasePart;
	readonly block: BlockModel | undefined;
	readonly position: Vector3;
	readonly normal: Vector3;
};

const RAY_LENGTH = 1000;

const isLMB = (input: InputObject) =>
	input.UserInputType === Enum.UserInputType.MouseButton1 || input.UserInputType === Enum.UserInputType.Touch;

const isRMB = (input: InputObject) => input.UserInputType === Enum.UserInputType.MouseButton2;

@injectable
export class CursorService extends HostedService {
	/** Generic platform tap/touch/click start */
	readonly pressed = new ArgsSignal<[hit: CursorHit]>();
	/** Fires every frame while any button or finger is down */
	readonly held = new ArgsSignal<[hit: CursorHit]>();
	/** Fires once the last button or finger is released */
	readonly released = new ArgsSignal();
	/** PC-specific right mouse button click trigger */
	readonly rightPressed = new ArgsSignal<[hit: CursorHit]>();

	constructor() {
		super();

		let holding = false;
		this.event.subscribe(UserInputService.InputBegan, (input, processed) => {
			if (processed) return;

			if (isRMB(input)) {
				const hit = this.getHit();
				if (hit) this.rightPressed.Fire(hit);
				return;
			}

			if (!holding && isLMB(input)) {
				holding = true;
				const hit = this.getHit();
				if (hit) this.pressed.Fire(hit);
				return;
			}
		});

		this.event.subscribe(UserInputService.InputEnded, (input) => {
			if (!isLMB(input)) return;
			if (!holding) return;

			holding = false;
			this.released.Fire();
		});

		this.event.subscribe(RunService.PostSimulation, () => {
			if (!holding) return;
			const hit = this.getHit();
			if (hit) this.held.Fire(hit);
		});
	}

	/** Raycast from the camera through the cursor onto the current plot */
	getHit(): CursorHit | undefined {
		// ignore if ESC menu is open
		if (GuiService.MenuIsOpen) return;

		// ignore if not alive
		if (!PlayerUtils.isAlive(Players.LocalPlayer)) return;

		// ignore if over a GUI element
		if (Interface.isCursorOnVisibleGui()) return;

		const ray = LocalPlayer.mouse.UnitRay;
		const hit = Workspace.Raycast(ray.Origin, ray.Direction.mul(RAY_LENGTH), BlockSelect.blockRaycastParams);
		if (!hit) return;

		return {
			part: hit.Instance,
			block: BlockManager.tryGetBlockModelByPart(hit.Instance),
			position: hit.Position,
			normal: hit.Normal,
		};
	}
}
