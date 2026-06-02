import { RunService, Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";

@injectable
export class SpacialAudio extends HostedService {
	constructor() {
		super();

		if (!RunService.IsClient()) return;

		// Create an AudioListener for the local user (needed for spacial audio with AudioEmitter's)
		const camera = Workspace.CurrentCamera;
		if (camera && !camera.FindFirstChildOfClass("AudioListener")) {
			const listener = new Instance("AudioListener");
			listener.Parent = camera;

			const deviceOutput = new Instance("AudioDeviceOutput");
			deviceOutput.Parent = listener;

			const listenerWire = new Instance("Wire");
			listenerWire.SourceInstance = listener;
			listenerWire.TargetInstance = deviceOutput;
			listenerWire.Parent = listener;
		}
	}
}
