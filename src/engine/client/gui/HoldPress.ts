import { RunService } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";

/** Pixels the held object may move (a list scrolling under the finger) before the hold is dropped */
const slop = 8;

const isPress = (input: InputObject) =>
	input.UserInputType === Enum.UserInputType.MouseButton1 || input.UserInputType === Enum.UserInputType.Touch;

/**
 * Press and hold on a GUI object: `onHold` runs once the press has lasted `duration` seconds. The press is dropped when
 * it ends, the pointer leaves, or the object moves, which is what a list scrolling under a touch drag does without
 * ending the press. Frames are only stepped while a press is held.
 */
export class HoldPress extends Component {
	private fired = false;

	constructor(
		gui: GuiObject,
		duration: number,
		onHold: () => void,
		/** The held fraction 0-1 each frame of a press, then undefined once the press ends either way */
		onProgress?: (fraction: number | undefined) => void,
	) {
		super();

		let stepping: RBXScriptConnection | undefined;
		const stop = () => {
			if (!stepping) return;

			stepping.Disconnect();
			stepping = undefined;
			onProgress?.(undefined);
		};
		this.onDisable(stop);

		this.event.subscribe(gui.InputBegan, (input) => {
			if (!isPress(input)) return;
			stop();
			this.fired = false;

			let held = 0;
			const start = gui.AbsolutePosition;
			onProgress?.(0);
			stepping = RunService.RenderStepped.Connect((dt) => {
				if (gui.AbsolutePosition.sub(start).Magnitude > slop) return stop();

				held += dt;
				onProgress?.(math.min(held / duration, 1));
				if (held < duration) return;

				stop();
				this.fired = true;
				onHold();
			});
		});
		this.event.subscribe(gui.InputEnded, (input) => {
			if (isPress(input)) stop();
		});
		this.event.subscribe(gui.MouseLeave, stop);
	}

	/** Whether the latest press became a hold, so the click that ends it can be skipped; reading it clears it */
	held(): boolean {
		const fired = this.fired;
		this.fired = false;
		return fired;
	}
}
