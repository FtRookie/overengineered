import { Players, RunService } from "@rbxts/services";
import { Interface } from "engine/client/gui/Interface";
import { Component } from "engine/shared/component/Component";
import { HostedService } from "engine/shared/di/HostedService";
import { Colors } from "shared/Colors";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

@injectable
export class FpsCounterController extends HostedService {
	constructor(@inject playerData: PlayerDataStorage) {
		super();

		const gui = Interface.getInterface<{ Fps: TextLabel }>().Fps;

		const pingGui = gui.Clone();
		pingGui.Name = "Ping";
		pingGui.Position = gui.Position.sub(UDim2.fromOffset(gui.Size.X.Offset, 0));
		pingGui.Parent = gui.Parent;
		const textColor = gui.TextColor3;

		const counter = this.parent(new Component());
		let fps = 0;

		// GetNetworkPing is already the round trip, the same value the Ping Sensor block outputs
		const updatePing = () => {
			const ms = math.round(Players.LocalPlayer.GetNetworkPing() * 1000);
			pingGui.Text = `${ms} ms`;
			pingGui.TextColor3 = ms > 200 ? Colors.red : textColor;
		};

		counter.onEnable(() => {
			fps = 0;
			gui.Visible = true;
			pingGui.Visible = true;
			updatePing();
		});
		counter.onDisable(() => {
			gui.Visible = false;
			pingGui.Visible = false;
		});

		counter.event.subscribe(RunService.PreRender, (dt) => {
			if (fps === math.huge) fps = 0;
			fps = (fps + 1 / dt) / 2;
		});
		counter.event.loop(0.5, () => (gui.Text = math.round(fps) + " FPS"));
		counter.event.loop(1, updatePing);

		this.event.subscribeObservable(
			playerData.config.createBased((c) => c.interface.fpsCounter),
			(enabled) => counter.setEnabled(enabled),
			true,
		);
	}
}
