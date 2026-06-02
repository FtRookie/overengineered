import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";

const list = (a: string[]) => {
	const n = a.map((v) => `- ${v}`);
	return n.join("\n");
};
export class PlayerSettingsCredits extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList) {
		super(gui);

		this.addCategory("");
		this.addCategory("anywaymachines ( Original Developers )");
		{
			this.addLine(
				list([
					//
					"Maks_gaming ( 3QAXM )",
					"i3ym ( i3ymm )",
					"samlovebutter ( samlovebutter )",
				]),
			);
		}
		this.addCategory("");
		this.addCategory("Temporary Interactive ( Maintainer )");
		{
			this.addLine("- FtRookie");
		}
		this.addCategory("");
		this.addCategory("Contributors");
		{
			this.addLine(
				list([
					//
					"ek587290135",
					"cee ( No_2name )",
					"secretnoe",
					"4t4t ( pooandmint )",
					"Nick ( NickZhYT )",
				]),
			);
		}
		this.addCategory("");
		this.addCategory("Music");
		{
			this.addLine("- lookatel ( hiro_br123segundo )");
		}
		this.addCategory("");
		this.addCategory("Translators");
		{
			this.addLine(
				list([
					//
					"PouPeuu [ Finnish ]",
					"jevilgamer13 [ Portuguese BR ]",
				]),
			);
		}
	}
}
