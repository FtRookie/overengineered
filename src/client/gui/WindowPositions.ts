import { initDragging } from "engine/client/gui/Draggable";
import { initResizing } from "engine/client/gui/Resizable";
import { HostedService } from "engine/shared/di/HostedService";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { ResizeConfig } from "engine/client/gui/Resizable";
import type { ComponentEvents } from "engine/shared/component/ComponentEvents";

type Tracked = {
	readonly target: GuiObject;
	/** Where the template put it, so a reset has something to go back to. */
	readonly original: UDim2;
	/** Likewise for size, for the windows that opted into resizing. */
	readonly originalSize: UDim2;
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

	/**
	 * Drag `target` by `handle`, restoring what was saved for it now and storing it again after every gesture.
	 *
	 * Passing `resize` also makes the window resizable and persists its size. Windows that opt out keep only a
	 * position, which is why a session-only window is simply never attached at all.
	 */
	attach(event: ComponentEvents, handle: GuiObject, target: GuiObject, key: string, resize?: ResizeConfig) {
		const original = target.Position;
		const originalSize = target.Size;
		this.tracked.set(key, { target, original, originalSize });

		const saved = this.playerData.config.get().interface.windowPositions[key];
		if (saved) {
			target.Position = new UDim2(original.X.Scale, saved.x, original.Y.Scale, saved.y);

			// Absent on an entry saved before this window could be resized, and on one that still cannot be.
			if (resize && saved.w !== undefined && saved.h !== undefined) {
				target.Size = new UDim2(originalSize.X.Scale, saved.w, originalSize.Y.Scale, saved.h);
			}
		}

		// Both gestures store the whole entry: a config send merges, so writing only half would leave the other
		// half at whatever the last write happened to say.
		const save = () => {
			const position = target.Position;
			const size = target.Size;
			this.playerData.sendPlayerConfig({
				interface: {
					windowPositions: {
						[key]: {
							x: position.X.Offset,
							y: position.Y.Offset,
							w: resize ? size.X.Offset : undefined,
							h: resize ? size.Y.Offset : undefined,
						},
					},
				},
			});
		};

		initDragging(event, handle, target, save);
		if (resize) initResizing(event, target, { ...resize, onResized: save });
	}

	/** Put every window back to the position and size its template had, for when one ends up unusable. */
	resetAll() {
		const positions: {
			[k in string]: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
		} = {};

		for (const [key, { target, original, originalSize }] of this.tracked) {
			target.Position = original;
			target.Size = originalSize;
			// Written rather than deleted: a config send merges, so a cleared entry would come straight back.
			positions[key] = {
				x: original.X.Offset,
				y: original.Y.Offset,
				w: originalSize.X.Offset,
				h: originalSize.Y.Offset,
			};
		}

		this.playerData.sendPlayerConfig({ interface: { windowPositions: positions } });
	}
}
