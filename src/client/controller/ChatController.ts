import { TextChatService, Players, TeleportService } from "@rbxts/services";
import { PlayerTitles } from "shared/PlayerTitles";

export namespace ChatController {
	export function initializeRejoinCommand() {
		const command = new Instance("TextChatCommand");
		command.Name = "Rejoin";
		command.PrimaryAlias = "/rejoin";
		command.Parent = TextChatService;

		command.Triggered.Connect(() => {
			const [ok, err] = pcall(() =>
				TeleportService.TeleportToPlaceInstance(game.PlaceId, game.JobId, Players.LocalPlayer),
			);
			if (!ok) $warn(`Rejoin teleport failed: ${err}`);
		});
	}

	export function initializeAdminPrefix() {
		TextChatService.OnIncomingMessage = function (message: TextChatMessage) {
			const props = new Instance("TextChatMessageProperties");

			if (message.TextSource) {
				const player = Players.GetPlayerByUserId(message.TextSource.UserId);
				if (!player) return;
				props.Text = PlayerTitles.isChatBold(player) ? `<b>${message.Text}</b>` : message.Text;
				props.PrefixText = PlayerTitles.getPrefixFor(player) + message.PrefixText;

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
