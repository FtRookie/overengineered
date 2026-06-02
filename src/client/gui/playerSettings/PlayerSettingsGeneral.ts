import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

export class PlayerSettingsGeneral extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		this.addCategory("General");
		{
			this.addLine(`Music volume is changed in the "Playlist" tab`);

			this.addToggle("Automatic slot loading") //
				.initToObjectPart(value, ["autoLoad"])
				.setDescription("Automatically load 'Last Exit' slot on join");

			this.addToggle("Automatic teleport to plot") //
				.initToObjectPart(value, ["autoPlotTeleport"])
				.setDescription("Automatically teleport to plot after despawning your vehicle");

			this.addToggle("Public speakers") //
				.initToObjectPart(value, ["publicSpeakers"])
				.setDescription("Allow others to hear your speaker block and hear speakers of others");
			this.addToggle("Public Text-To-Speech") //
				.initToObjectPart(value, ["publicTTS"])
				.setDescription("Allows others to hear your TTS blocks and hear TTS of others");

			this.addToggle("Public particles") //
				.initToObjectPart(value, ["publicParticles"])
				.setDescription("Allow others to see your particles and see particles of others (Particle Block only)");
			this.addToggle("Public tracers") //
				.initToObjectPart(value, ["publicTracers"])
				.setDescription("Allow others to see your tracers and see tracers of others (Tracer Block only)");

			// this.addToggle("PvP") //
			// 	.initToObjectPart(value, ["pvp"])
			// 	.setDescription(
			// 		"Allow combat with other players. Damage between players only happens when both have PvP on",
			// 	);
		}
	}
}
