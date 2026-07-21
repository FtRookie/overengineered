import { HttpService, Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { Objects } from "engine/shared/fixes/Objects";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

@injectable
export class CameraController extends HostedService {
	constructor(@inject playerData: PlayerDataStorage) {
		super();

		this.event.readonlyObservableFromInstanceParam(Workspace, "CurrentCamera").subscribe((camera) => {
			if (camera) {
				camera.FieldOfView = playerData.config.get().graphics.camera.fov;
			}
		}, true);
		this.event.subscribeRegistration(() =>
			playerData.config
				.fReadonlyCreateBased((c) => c.graphics.camera)
				.subscribeWithCustomEquality(
					(betterCamera) => {
						$log("better_camera set to " + HttpService.JSONEncode(betterCamera));
						Workspace.SetAttribute("camera_improved", betterCamera?.improved === true);
						Workspace.SetAttribute("camera_playerCentered", betterCamera?.playerCentered === true);
						Workspace.SetAttribute("camera_strictFollow", betterCamera?.strictFollow === true);

						if (Workspace.CurrentCamera) {
							Workspace.CurrentCamera.FieldOfView = betterCamera.fov;
						}
					},
					Objects.deepEquals,
					true,
				),
		);
	}
}
