import { Players, ReplicatedStorage, RunService, Workspace } from "@rbxts/services";
import { Interface } from "engine/client/gui/Interface";
import { Component } from "engine/shared/component/Component";
import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { PartUtils } from "shared/utils/PartUtils";
import { VectorUtils } from "shared/utils/VectorUtils";

/** Every enabled beacon, rendered by one shared connection that reads the character and camera once per frame */
const rendering = new Set<ManualBeacon>();
let renderConnection: RBXScriptConnection | undefined;

const renderAll = () => {
	const character = Players.LocalPlayer.Character;
	if (!character) return;

	const from = character.GetPivot().Position;
	let camera: Camera | undefined;
	let screenSize: Vector2 | undefined;
	// resolved lazily: a frame where every beacon is fully transparent reads no camera at all, as before
	const view = () => {
		camera ??= Workspace.CurrentCamera!;
		screenSize ??= camera.ViewportSize;
		return $tuple(camera, screenSize);
	};
	for (const beacon of rendering) beacon.render(from, view);
};

/**
 * Beacon with a public position setter
 */
export class ManualBeacon extends Component {
	readonly billboard;
	showUpDistance = 30;

	position = Vector3.zero;
	/** Read each frame before rendering, for a beacon that follows an instance */
	source?: PVInstance;

	// last values written, so an unchanged frame writes nothing; nothing else writes these properties
	private shownTransparency?: number;
	private shownDistance?: string;
	private shownX?: number;
	private shownY?: number;

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

		this.onEnable(() => {
			rendering.add(this);
			renderConnection ??= RunService.PreRender.Connect(renderAll);
		});
		const stop = () => {
			rendering.delete(this);
			if (rendering.size() !== 0) return;

			renderConnection?.Disconnect();
			renderConnection = undefined;
		};
		this.onDisable(stop);
		this.onDestroy(stop);
	}

	private setTransparency(transparency: number) {
		if (transparency === this.shownTransparency) return;

		this.shownTransparency = transparency;
		this.billboard.ImageLabel.ImageTransparency = transparency;
		this.billboard.Title.TextTransparency = transparency;
		this.billboard.Distance.TextTransparency = transparency;
	}

	render(from: Vector3, view: () => LuaTuple<[Camera, Vector2]>) {
		if (this.source) this.position = this.source.GetPivot().Position;

		const distance = this.position.sub(from).Magnitude;
		if (!distance) return;

		const transparencyMultiplier = 0.8;
		const transparency = 1 - math.clamp(distance - this.showUpDistance, 0, 1) * transparencyMultiplier;
		if (transparency >= 1) {
			this.setTransparency(transparency);
			return;
		}

		const distanceText = distance > 1000 ? `${math.floor(distance / 100) / 10} kst` : `${math.floor(distance)} st`;
		if (distanceText !== this.shownDistance) {
			this.shownDistance = distanceText;
			this.billboard.Distance.Text = distanceText;
		}

		const [camera, screenSize] = view();
		const [screenPos, isVisible] = camera.WorldToViewportPoint(this.position);
		const absoluteSize = this.billboard.AbsoluteSize;
		const adjustableOffset = absoluteSize.Y > absoluteSize.X ? absoluteSize.Y / 2 : absoluteSize.X / 2;
		let [pos_x, pos_y] = [screenPos.X, screenPos.Y];
		let finalTransparency = transparency;

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
			vec = vec.Abs().sub(new Vector2(halfScreenX, halfScreenY)).div(new Vector2(d, 1));
			vec = vec.Abs();

			finalTransparency = 1 - (1 - vec.Magnitude / halfScreenX) * (1 - transparency);

			const p1 = adjustableOffset;
			const px1 = screenSize.X - adjustableOffset;
			const py1 = screenSize.Y - adjustableOffset;

			pos_x = math.clamp(pos_x, math.min(p1, px1), math.max(p1, px1));
			pos_y = math.clamp(pos_y, math.min(p1, py1), math.max(p1, py1));
		}

		this.setTransparency(finalTransparency);
		if (pos_x !== this.shownX || pos_y !== this.shownY) {
			this.shownX = pos_x;
			this.shownY = pos_y;
			this.billboard.Position = new UDim2(0, pos_x, 0, pos_y);
		}
	}
}

/**
 * Beacon that gets its position from a PVInstance
 */
export class Beacon extends InstanceComponent<PVInstance> {
	constructor(part: PVInstance, name: string) {
		super(part);

		const beacon = this.parent(new ManualBeacon(name));
		beacon.source = part;
	}
}
