import { ContextActionService, UserInputService } from "@rbxts/services";
import { Keybinds, setArrangingTouchButtons } from "engine/client/Keybinds";
import { HostedService } from "engine/shared/di/HostedService";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Objects } from "engine/shared/fixes/Objects";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

/** Fraction of the button's own size the drop snaps to, matching the ride mode control grid. */
const SNAP_DIVISOR = 4;

/**
 * Remembers where the player dragged each on-screen touch button.
 *
 * The buttons belong to ContextActionService rather than to us, so they are reached through `GetButton` and
 * moved by writing back through `SetPosition` — {@link Keybinds} applies the stored position whenever it
 * rebinds. All four UDim2 components are stored, so a drag keeps whatever scale the definition authored.
 */
@injectable
export class TouchButtonController extends HostedService {
	/**
	 * While true the buttons follow a drag instead of firing; the state itself is not persisted.
	 *
	 * Owned here rather than by the settings page so it survives that page being destroyed, and written
	 * directly by the page's toggle — a mirror observable there would start at false on every open.
	 */
	readonly arranging = new ObservableValue(false);
	private dragSubs: SignalConnection[] = [];

	constructor(@inject private readonly playerData: PlayerDataStorage) {
		super();

		// Not this.event: the drag connections below are raw, so an ungated driver keeps both halves in step.
		this.arranging.subscribe((arranging) => {
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

	/** Every action that authored a touch button, whether or not it currently has one on screen. */
	private touchActions(): readonly string[] {
		const actions: string[] = [];
		for (const [, definition] of Keybinds.definitions.getAll()) {
			if (definition.touchButton) actions.push(definition.action);
		}

		return actions;
	}

	/**
	 * Nothing here holds a button instance. ContextActionService rebuilds them whenever an action rebinds —
	 * and {@link InputController.inputType} flips between Desktop and Touch as the player alternates devices,
	 * which re-registers every touch action — so a handler attached to one instance dies after a single drag.
	 * Each event looks the current button up by action name instead.
	 */
	private wireAll() {
		const actions = this.touchActions();
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

				// Snapped on release rather than during the drag, so the button follows the finger smoothly and
				// only lands on the grid once.
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

	/** Back to the position each definition authored, for when one ends up somewhere unreachable. */
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
