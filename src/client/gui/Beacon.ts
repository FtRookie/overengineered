import { Players, ReplicatedStorage, RunService, Workspace } from "@rbxts/services";
import { Interface } from "engine/client/gui/Interface";
import { Component } from "engine/shared/component/Component";
import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { PartUtils } from "shared/utils/PartUtils";
import { VectorUtils } from "shared/utils/VectorUtils";

/**
 * Beacon with a public position setter
 */
export class ManualBeacon extends Component {
	readonly billboard;
	showUpDistance = 30;

	position = Vector3.zero;

	constructor(name: string) {
		super();

		this.billboard = ReplicatedStorage.Assets.Guis.BeaconBillboardGui.Clone();

		PartUtils.applyToAllDescendantsOfType("GuiObject", this.billboard, (gui) => {
			gui.ZIndex = -1;
		});

		this.billboard.Visible = false;
		this.billboard.Position = new UDim2(0, 1, 0, 1);
		this.billboard.Parent = Interface.getUnscaled();
		this.billboard.Title.Text = name;
		this.onEnabledStateChange((enabled) => (this.billboard.Visible = enabled), true);

		this.event.subscribe(RunService.RenderStepped, () => {
			const character = Players.LocalPlayer.Character;
			if (!character) return;

			const distance = this.position.sub(character.GetPivot().Position).Magnitude;
			if (!distance) return;

			const transparencyMultiplier = 0.8;
			const transparency = 1 - math.clamp(distance - this.showUpDistance, 0, 1) * transparencyMultiplier;

			this.billboard.ImageLabel.ImageTransparency = transparency;
			this.billboard.Title.TextTransparency = transparency;
			this.billboard.Distance.TextTransparency = transparency;

			if (transparency >= 1) return;

			this.billboard.Distance.Text =
				distance > 1000 ? `${math.floor(distance / 100) / 10} kst` : `${math.floor(distance)} st`;
			const [screenPos, isVisible] = Workspace.CurrentCamera!.WorldToViewportPoint(this.position);
			const screenSize = Workspace.CurrentCamera!.ViewportSize;
			const adjustableOffset =
				this.billboard.AbsoluteSize.Y > this.billboard.AbsoluteSize.X
					? this.billboard.AbsoluteSize.Y / 2
					: this.billboard.AbsoluteSize.X / 2;
			let [pos_x, pos_y] = [screenPos.X, screenPos.Y];

			const halfScreenX = screenSize.X / 2;
			const halfScreenY = screenSize.Y / 2;

			if (!isVisible || pos_x > screenSize.X || pos_y > screenSize.Y || pos_x < 0 || pos_y < 0) {
				const vector = new Vector2(pos_x - halfScreenX, pos_y - halfScreenY);
				const normalizedVector = VectorUtils.normalizeVector2(vector)
					.mul(new Vector2(screenSize.X, screenSize.Y))
					.add(new Vector2(halfScreenX, halfScreenY));

				[pos_x, pos_y] = [normalizedVector.X, normalizedVector.Y];

				if (screenPos.Z < 0) {
					pos_x = screenSize.X - pos_x;
					pos_y = screenSize.Y - pos_y;
				}

				const d = halfScreenX / halfScreenY;
				let vec = new Vector2(pos_x, pos_y).sub(new Vector2(halfScreenX, halfScreenY));
				vec = new Vector2(math.abs(vec.X), math.abs(vec.Y))
					.sub(new Vector2(halfScreenX, halfScreenY))
					.div(new Vector2(d, 1));
				vec = new Vector2(math.abs(vec.X), math.abs(vec.Y));

				const newTransparency = 1 - (1 - vec.Magnitude / halfScreenX) * (1 - transparency);
				this.billboard.ImageLabel.ImageTransparency = newTransparency;
				this.billboard.Title.TextTransparency = newTransparency;
				this.billboard.Distance.TextTransparency = newTransparency;

				const p1 = adjustableOffset;
				const px1 = screenSize.X - adjustableOffset;
				const py1 = screenSize.Y - adjustableOffset;

				pos_x = math.clamp(pos_x, math.min(p1, px1), math.max(p1, px1));
				pos_y = math.clamp(pos_y, math.min(p1, py1), math.max(p1, py1));
			}

			this.billboard.Position = new UDim2(0, pos_x, 0, pos_y);
		});
	}
}

/**
 * Beacon that gets its position from a PVInstance
 */
export class Beacon extends InstanceComponent<PVInstance> {
	constructor(part: PVInstance, name: string) {
		super(part);

		const beacon = this.parent(new ManualBeacon(name));
		this.event.subscribe(RunService.RenderStepped, () => {
			beacon.position = part.GetPivot().Position;
		});
	}
}
