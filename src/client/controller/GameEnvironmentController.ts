import { RunService, Workspace } from "@rbxts/services";
import { LocalPlayerController } from "client/controller/LocalPlayerController";
import { HostedService } from "engine/shared/di/HostedService";
import { GameEnvironment } from "shared/data/GameEnvironment";
import { Physics } from "shared/Physics";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

@injectable
export class GameEnvironmentController extends HostedService {
	constructor(@inject playerData: PlayerDataStorage) {
		super();

		this.event.subscribe(RunService.Heartbeat, () => {
			const playerHeight = LocalPlayerController.getPlayerRelativeHeight();
			const gravity = Physics.GetGravityOnHeight(playerHeight);
			const wind = playerData.config.get().physics.windVelocity;

			Workspace.AirDensity = Physics.GetAirDensityOnHeight(playerHeight);
			Workspace.Gravity = gravity;
			Workspace.GlobalWind = new Vector3(
				(wind.X * gravity) / GameEnvironment.EarthGravity,
				0,
				(wind.Y * gravity) / GameEnvironment.EarthGravity,
			);
		});
	}
}
