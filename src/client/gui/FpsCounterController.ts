import { RunService } from "@rbxts/services";
import { Interface } from "engine/client/gui/Interface";
import { Component } from "engine/shared/component/Component";
import { HostedService } from "engine/shared/di/HostedService";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

@injectable
export class FpsCounterController extends HostedService {
	constructor(@inject playerData: PlayerDataStorage) {
		super();

		const gui = Interface.getInterface<{ Fps: TextLabel }>().Fps;

		const counter = this.parent(new Component());
		let fps = 0;

		counter.onEnable(() => {
			fps = 0;
			gui.Visible = true;
		});
		counter.onDisable(() => (gui.Visible = false));

		counter.event.subscribe(RunService.PreRender, (dt) => {
			if (fps === math.huge) fps = 0;
			fps = (fps + 1 / dt) / 2;
		});
		counter.event.loop(0.5, () => (gui.Text = math.round(fps) + " FPS"));

		this.event.subscribeObservable(
			playerData.config.createBased((c) => c.interface.fpsCounter),
			(enabled) => counter.setEnabled(enabled),
			true,
		);
	}
}
