import { UserInputService } from "@rbxts/services";
import { Control } from "engine/client/gui/Control";
import { Element } from "engine/shared/Element";

/** One picture in a parallax preview, placed in front of the viewer in the same units as its size */
export type HelpParallaxLayer = {
	readonly image: number;
	/** X right, Y up, Z away from the viewer; Z must be above 0 */
	readonly position: Vector3;
	readonly size: Vector2;
};
export type HelpParallaxConfig = {
	/** Fills the preview and stays still, as if infinitely far away */
	readonly background: number;
	/** Vertical field of view in degrees */
	readonly fov: number;
	readonly layers: readonly HelpParallaxLayer[];
	/** How far the viewer moves, in layer units, with the cursor at the preview's edge */
	readonly sway?: number;
};

const defaultSway = 0.15;

/**
 * A picture made of layers at different depths, projected through a pinhole camera with the given field of view. The
 * camera moves with the cursor over the preview, so near layers shift further than far ones.
 *
 * A layer at depth Z and height H fills `H / (2 Z tan(fov / 2))` of the preview's height.
 */
export class HelpParallax extends Control<ImageLabel> {
	constructor(gui: ImageLabel, config: HelpParallaxConfig) {
		super(gui);

		gui.Image = `rbxassetid://${config.background}`;
		gui.ClipsDescendants = true;

		const focal = 1 / math.tan(math.rad(config.fov) / 2);
		const sway = config.sway ?? defaultSway;

		// far to near, so nearer layers draw on top
		const sorted = [...config.layers].sort((a, b) => a.position.Z > b.position.Z);
		const layers = sorted.map((layer, i) => ({
			layer,
			label: Element.create("ImageLabel", {
				Image: `rbxassetid://${layer.image}`,
				BackgroundTransparency: 1,
				AnchorPoint: new Vector2(0.5, 0.5),
				ZIndex: gui.ZIndex + 1 + i,
				Parent: gui,
			}),
		}));

		let eye = Vector2.zero;
		const place = () => {
			const size = gui.AbsoluteSize;
			if (size.X <= 0) return;

			// projected coordinates are in half-heights of the preview; X is converted to its width
			const heightPerWidth = size.Y / size.X;
			for (const { layer, label } of layers) {
				const perUnit = focal / layer.position.Z;
				const x = (layer.position.X - eye.X) * perUnit;
				const y = (layer.position.Y - eye.Y) * perUnit;

				label.Position = UDim2.fromScale(0.5 + (x * heightPerWidth) / 2, 0.5 - y / 2);
				label.Size = UDim2.fromScale(
					(layer.size.X * perUnit * heightPerWidth) / 2,
					(layer.size.Y * perUnit) / 2,
				);
			}
		};

		const follow = (input: InputObject) => {
			if (
				input.UserInputType !== Enum.UserInputType.MouseMovement &&
				input.UserInputType !== Enum.UserInputType.Touch
			) {
				return;
			}

			const half = gui.AbsoluteSize.div(2);
			if (half.X <= 0 || half.Y <= 0) return;

			const centre = gui.AbsolutePosition.add(half);
			const x = math.clamp((input.Position.X - centre.X) / half.X, -1, 1);
			const y = math.clamp((input.Position.Y - centre.Y) / half.Y, -1, 1);
			eye = new Vector2(x * sway, -y * sway);
			place();
		};

		// only while the preview is on screen; a hidden page's preview has nothing to follow
		let following: RBXScriptConnection | undefined;
		const stop = () => {
			following?.Disconnect();
			following = undefined;
		};
		const watch = () => {
			stop();
			eye = Vector2.zero;
			place();
			if (gui.Visible) following = UserInputService.InputChanged.Connect(follow);
		};

		this.event.subscribe(gui.GetPropertyChangedSignal("Visible"), watch);
		this.event.subscribe(gui.GetPropertyChangedSignal("AbsoluteSize"), place);
		this.onEnable(watch);
		this.onDisable(stop);
	}
}
