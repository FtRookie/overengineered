import { GuiService, Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { BlockSelect } from "client/tools/highlighters/BlockSelect";
import { Interface } from "engine/client/gui/Interface";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { HostedService } from "engine/shared/di/HostedService";
import { ArgsSignal } from "engine/shared/event/Signal";
import { PlayerUtils } from "engine/shared/utils/PlayerUtils";
import { BlockManager } from "shared/building/BlockManager";

type CursorHitResult = {
	block?: BlockModel;
	part?: BasePart;
	position: Vector3;
	normal: Vector3;
};

@injectable
export class CursorService extends HostedService {
	private _cached_ray: CursorHitResult | undefined = undefined;

	/** Generic platform tap/touch/click */
	readonly clicked = new ArgsSignal<[hit: CursorHitResult]>();
	/** PC-specific right mouse button click trigger */
	readonly clicked_RMB = new ArgsSignal<[hit: CursorHitResult]>();

	constructor() {
		super();

		const cast = (): CursorHitResult | undefined => {
			// ignore if ESC menu is open
			if (GuiService.MenuIsOpen) return;

			// ignore if not alive
			if (!PlayerUtils.isAlive(Players.LocalPlayer)) return;

			// ignore if over a GUI element
			if (Interface.isCursorOnVisibleGui()) return;

			const ray = LocalPlayer.mouse.UnitRay;
			const hit = Workspace.Raycast(ray.Origin, ray.Direction.mul(1000), BlockSelect.blockRaycastParams);
			if (!hit) return;
			return {
				position: hit.Position,
				normal: hit.Normal,
				part: hit.Instance,
				block: BlockManager.tryGetBlockModelByPart(hit.Instance),
			};
		};

		this.event.subscribe(RunService.Heartbeat, () => (this._cached_ray = cast()));
		this.event.subscribe(UserInputService.TouchTap, (_, processed) => {
			if (processed) return;

			const hit = this.getHit();
			if (hit === undefined) return;

			this.clicked.Fire(hit);
		});

		this.event.subscribe(UserInputService.InputBegan, (e, processed) => {
			if (processed) return;

			const hit = this.getHit();
			if (hit === undefined) return;

			if (e.UserInputType === Enum.UserInputType.MouseButton1) {
				this.clicked.Fire(hit);
				return;
			}

			if (e.UserInputType === Enum.UserInputType.MouseButton2) {
				this.clicked_RMB.Fire(hit);
				return;
			}
		});
	}

	getHit(): CursorHitResult | undefined {
		if (this._cached_ray === undefined) return;
		return { ...this._cached_ray };
	}
}
