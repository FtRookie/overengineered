import { RunService, Workspace } from "@rbxts/services";
import { LocalPlayerController } from "client/controller/LocalPlayerController";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { HostedService } from "engine/shared/di/HostedService";
import { Physics } from "shared/Physics";
import type { PlayModeController } from "client/modes/PlayModeController";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { SharedPlot } from "shared/building/SharedPlot";

@injectable
export class GameEnvironmentController extends HostedService {
	constructor(@inject playerData: PlayerDataStorage, @inject plot: SharedPlot, @inject mode: PlayModeController) {
		super();

		this.event.subscribe(RunService.PostSimulation, (dt) => {
			const playerHeight = LocalPlayerController.getPlayerRelativeHeight();
			const gravity = Physics.GetGravityOnHeight(
				playerHeight,
				playerData.config.get().environment.physics.customGravity,
			);

			Workspace.AirDensity = Physics.GetAirDensityOnHeight(playerHeight);
			Workspace.Gravity = gravity;

			let wind = playerData.config.get().environment.physics.windVelocity;
			if ((wind.X !== 0 || wind.Z !== 0) && mode.get() === "ride") {
				wind = wind.apply((c) => math.clamp(c, -10000, 10000));
				const max = wind.div(10);
				Workspace.GlobalWind = max;

				const apply = (part: BasePart, wind: Vector3) => {
					let delta = wind.sub(part.AssemblyLinearVelocity);
					delta = new Vector3(delta.X, 0, delta.Z) //
						.apply(math.abs)
						.Min(max)
						.mul(delta.apply(math.sign))
						.mul(wind.apply(math.sign));

					delta = new Vector3(
						math.sign(delta.X) === math.sign(wind.X) ? delta.X : 0,
						0,
						math.sign(delta.Z) === math.sign(wind.Z) ? delta.Z : 0,
					);

					part.ApplyImpulse(delta);
				};

				const config = playerData.config.get().environment.physics;
				const vel = new Vector3(
					wind.X * (gravity / config.customGravity) * dt,
					0,
					wind.Z * (gravity / config.customGravity) * dt,
				);

				for (const block of plot.getBlocks()) {
					for (const part of block.GetDescendants()) {
						if (!part.IsA("BasePart")) continue;
						apply(part, vel);
					}
				}

				const playerPart = LocalPlayer.humanoid.get()?.RootPart;
				if (playerPart) {
					apply(
						playerPart,
						new Vector3(
							wind.X * (gravity / config.customGravity) * dt,
							0,
							wind.Z * (gravity / config.customGravity) * dt,
						),
					);
				}
			}
		});
	}
}
