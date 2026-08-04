import { ContextActionService, UserInputService } from "@rbxts/services";
import { Keybinds, setArrangingTouchButtons } from "engine/client/Keybinds";
import { HostedService } from "engine/shared/di/HostedService";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Objects } from "engine/shared/fixes/Objects";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

/** Fraction of the button's own size the drop snaps to, matching the ride mode control grid. */
const SNAP_DIVISOR = 4;

/**
 * Remembers where the player dragged each on-screen touch button. The buttons belong to ContextActionService,
 * so they are reached through `GetButton` and moved through `SetPosition`, and {@link Keybinds} reapplies the
 * stored position on every rebind.
 */
@injectable
export class TouchButtonController extends HostedService {
	/** Owned here rather than by the settings page, which is destroyed every time the menu closes. */
	readonly arranging = new ObservableValue(false);
	private dragSubs: SignalConnection[] = [];

	constructor(@inject private readonly playerData: PlayerDataStorage) {
		super();

		this.event.subscribeObservable(this.arranging, (arranging) => {
			setArrangingTouchButtons(arranging);

			for (const sub of this.dragSubs) {
				sub.Disconnect();
			}
			this.dragSubs = [];

			if (arranging) this.wireAll();
		});

		let keybinds: Keybinds | undefined;
		this.$onInjectAuto((binds: Keybinds) => {
			keybinds = binds;
			apply();
		});

		const apply = () => {
			if (!keybinds) return;

			const saved = this.playerData.config.get().interface.touchButtonPositions;
			keybinds.setTouchButtonPositions(
				Objects.mapValues(saved, (_, p) => new UDim2(p.xScale, p.xOffset, p.yScale, p.yOffset)),
			);
		};
		this.event.subscribe(this.playerData.config.changed, apply);
	}

	/**
	 * Buttons are looked up by action name per event rather than held: ContextActionService destroys and
	 * rebuilds them on every rebind, and the input type flipping between Desktop and Touch rebinds them all.
	 */
	private wireAll() {
		const actions: string[] = [];
		for (const [, definition] of Keybinds.definitions.getAll()) {
			if (definition.touchButton) actions.push(definition.action);
		}

		let dragging: { readonly action: string; readonly start: UDim2; readonly from: Vector2 } | undefined;

		const isDragInput = (input: InputObject) =>
			input.UserInputType === Enum.UserInputType.MouseButton1 || input.UserInputType === Enum.UserInputType.Touch;
		const positionOf = (input: InputObject) => new Vector2(input.Position.X, input.Position.Y);

		this.dragSubs.push(
			UserInputService.InputBegan.Connect((input) => {
				if (!isDragInput(input)) return;

				// No GetGuiInset correction: an InputObject's position is already below the topbar, the same
				// space AbsolutePosition is in. Subtracting the inset moved the hit test up by its height.
				const at = positionOf(input);

				for (const action of actions) {
					const button = ContextActionService.GetButton(action);
					if (!button) continue;

					const min = button.AbsolutePosition;
					const max = min.add(button.AbsoluteSize);
					if (at.X < min.X || at.X > max.X || at.Y < min.Y || at.Y > max.Y) continue;

					dragging = { action, start: button.Position, from: positionOf(input) };
					break;
				}
			}),
		);

		this.dragSubs.push(
			UserInputService.InputChanged.Connect((input) => {
				if (!dragging) return;
				if (
					input.UserInputType !== Enum.UserInputType.MouseMovement &&
					input.UserInputType !== Enum.UserInputType.Touch
				) {
					return;
				}

				const button = ContextActionService.GetButton(dragging.action);
				if (!button) return;

				const { start } = dragging;
				const delta = positionOf(input).sub(dragging.from);
				button.Position = new UDim2(
					start.X.Scale,
					start.X.Offset + delta.X,
					start.Y.Scale,
					start.Y.Offset + delta.Y,
				);
			}),
		);

		this.dragSubs.push(
			UserInputService.InputEnded.Connect((input) => {
				if (!dragging || !isDragInput(input)) return;

				const { action, start } = dragging;
				dragging = undefined;

				const button = ContextActionService.GetButton(action);
				if (!button) return;

				// snapped on release, not during the drag, so the button follows the finger smoothly
				const grid = button.AbsoluteSize.div(SNAP_DIVISOR);
				const position = button.Position;
				const xOffset = math.round(position.X.Offset / grid.X) * grid.X;
				const yOffset = math.round(position.Y.Offset / grid.Y) * grid.Y;

				button.Position = new UDim2(start.X.Scale, xOffset, start.Y.Scale, yOffset);
				this.playerData.sendPlayerConfig({
					interface: {
						touchButtonPositions: {
							[action]: { xScale: start.X.Scale, xOffset, yScale: start.Y.Scale, yOffset },
						},
					},
				});
			}),
		);
	}

	/** For when a button ends up somewhere unreachable. */
	resetAll() {
		const positions: { [k in string]: TouchButtonPositionsConfiguration[string] } = {};
		for (const [, definition] of Keybinds.definitions.getAll()) {
			const authored = definition.touchButton?.position;
			if (!authored) continue;

			// Written rather than deleted: a config send merges, so a cleared entry would come straight back.
			positions[definition.action] = {
				xScale: authored.X.Scale,
				xOffset: authored.X.Offset,
				yScale: authored.Y.Scale,
				yOffset: authored.Y.Offset,
			};
		}

		this.playerData.sendPlayerConfig({ interface: { touchButtonPositions: positions } });
	}
}
