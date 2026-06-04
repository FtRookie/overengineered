import { TextChatService, Players } from "@rbxts/services";
import { PlayerRank } from "engine/shared/PlayerRank";

export namespace ChatController {
	export function initializeAdminPrefix() {
		TextChatService.OnIncomingMessage = function (message: TextChatMessage) {
			const props = new Instance("TextChatMessageProperties");

			if (message.TextSource) {
				const player = Players.GetPlayerByUserId(message.TextSource.UserId);
				props.Text = message.Text;

				if (player && PlayerRank.isDev(player)) {
					props.PrefixText =
						`<font color='#ff5555'>[${PlayerRank.isFounder(player.UserId) ? "Founder" : "Developer"}]</font> ` +
						message.PrefixText;

					props.Text = `<b>` + message.Text + `</b>`;
				} else if (player && PlayerRank.isMod(player)) {
					props.PrefixText = `<font color='#ffff55'>[Moderator]</font> ` + message.PrefixText;

					props.Text = `<b>` + message.Text + `</b>`;
				}

				props.Text = props.Text.gsub("plane crazy", `<font transparency="0.6">plain lazy</font>`)[0];
				props.Text = props.Text.gsub("mechanica ", `<font color="rgb(255,255,0)">mechanica 👑 </font>`)[0];
				props.Text = props.Text.gsub(
					"elite engineering",
					`<font color="rgb(255,127,0)">elite engineering 👑 </font>`,
				)[0];
			}

			return props;
		};
	}
}
