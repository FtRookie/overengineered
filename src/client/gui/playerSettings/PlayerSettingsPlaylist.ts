import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import type { MusicController } from "client/controller/sound/MusicController";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

@injectable
export class PlayerSettingsPlaylist extends ConfigControlList {
	constructor(
		gui: ConfigControlListDefinition & ConfigControlTemplateList,
		value: ObservableValue<PlayerConfig>,
		@inject musticController: MusicController,
	) {
		super(gui);

		musticController.events.trackChanged.changed.Connect(({ nowPlaying, previousTrack }) => {
			// show now playing tab probably
		});
	}
}
