import { initDragging } from "engine/client/gui/Draggable";
import { HostedService } from "engine/shared/di/HostedService";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { ComponentEvents } from "engine/shared/component/ComponentEvents";

type Tracked = {
	readonly target: GuiObject;
	/** Where the template put it, so a reset has something to go back to. */
	readonly original: UDim2;
};

/**
 * Makes a window draggable and remembers where the player left it. Only the offsets are stored: the scale part
 * comes from the template, so a window keeps following its anchor if the layout is later retuned.
 */
@injectable
export class WindowPositionController extends HostedService {
	private readonly tracked = new Map<string, Tracked>();

	constructor(@inject private readonly playerData: PlayerDataStorage) {
		super();
	}

	/** Drag `target` by `handle`, restoring its saved position now and storing it again after every drag. */
	attach(event: ComponentEvents, handle: GuiObject, target: GuiObject, key: string) {
		const original = target.Position;
		this.tracked.set(key, { target, original });

		const saved = this.playerData.config.get().interface.windowPositions[key];
		if (saved) {
			target.Position = new UDim2(original.X.Scale, saved.x, original.Y.Scale, saved.y);
		}

		initDragging(event, handle, target, (position) => {
			this.playerData.sendPlayerConfig({
				interface: { windowPositions: { [key]: { x: position.X.Offset, y: position.Y.Offset } } },
			});
		});
	}

	/** Put every window back where its template had it, for when one ends up somewhere unusable. */
	resetAll() {
		const positions: { [k in string]: { readonly x: number; readonly y: number } } = {};
		for (const [key, { target, original }] of this.tracked) {
			target.Position = original;
			// Written rather than deleted: a config send merges, so a cleared entry would come straight back.
			positions[key] = { x: original.X.Offset, y: original.Y.Offset };
		}

		this.playerData.sendPlayerConfig({ interface: { windowPositions: positions } });
	}
}
