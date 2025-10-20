import { LoadingController } from "client/controller/LoadingController";
import { SoundController } from "client/controller/SoundController";
import { LogControl } from "client/gui/static/LogControl";
import { Colors } from "shared/Colors";
import { CustomRemotes } from "shared/Remotes";
import type { SpawnPosition } from "shared/SpawnPositions";

let changing = false;
export const requestMode = (mode: PlayModes, spawnPosition?: SpawnPosition) => {
	if (changing) return;

	LoadingController.run(`Changing play mode to ${mode}...`, () => {
		try {
			changing = true;
			const response = CustomRemotes.modes.set.send({ mode, pos: spawnPosition });
			if (!response.success) {
				$warn(response.message);
				LogControl.instance.addLine(response.message!, Colors.red);
				SoundController.getUISounds().Build.BlockPlaceError.Play();

				return;
			}
		} finally {
			changing = false;
		}
	});
};
