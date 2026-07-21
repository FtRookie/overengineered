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
				.initToObjectPart(value, ["plot", "autoLoad"])
				.setDescription("Automatically load 'Last Exit' slot on join");

			this.addToggle("Automatic teleport to plot") //
				.initToObjectPart(value, ["plot", "autoPlotTeleport"])
				.setDescription("Automatically teleport to plot after despawning your vehicle");
			this.addToggle("Center of Plot")
				.initToObjectPart(value, ["plot", "autoPlotTeleportCenter"])
				.setDescription("Teleport to the center of the plot, otherwise at the back");

			this.addToggle("Public speakers") //
				.initToObjectPart(value, ["replication", "publicSpeakers"])
				.setDescription("Allow others to hear your speaker block and hear speakers of others");
			this.addToggle("Public Text-To-Speech") //
				.initToObjectPart(value, ["replication", "publicTTS"])
				.setDescription("Allows others to hear your TTS blocks and hear TTS of others");

			this.addToggle("Public particles") //
				.initToObjectPart(value, ["replication", "publicParticles"])
				.setDescription("Allow others to see your particles and see particles of others (Particle Block only)");
			this.addToggle("Public tracers") //
				.initToObjectPart(value, ["replication", "publicTracers"])
				.setDescription("Allow others to see your tracers and see tracers of others (Tracer Block only)");

			this.addToggle("Enable projectiles") //
				.initToObjectPart(value, ["replication", "enableProjectiles"])
				.setDescription(
					"Enable weapon projectiles. Disabling this option will lead to projectiles not being spawned at all.",
				);

			// this.addToggle("PvP") //
			// 	.initToObjectPart(value, ["replication", "pvp"])
			// 	.setDescription(
			// 		"Allow combat with other players. Damage between players only happens when both have PvP on",
			// 	);
		}
	}
}
