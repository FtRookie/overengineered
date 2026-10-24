import { Component } from "engine/shared/component/Component";
import { Objects } from "engine/shared/fixes/Objects";
import { t } from "engine/shared/t";
import { Config } from "shared/config/Config";
import { PlayerConfigDefinition } from "shared/config/PlayerConfig";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { PlayerDatabaseData } from "server/database/PlayerDatabase";
import type { PlayerDataStorageRemotesPlayer } from "shared/remotes/PlayerDataRemotes";

/** The only keys a client writes; whatever passes is persisted in the player's row as-is */
const clientDataTypes: { readonly [k in string]?: t.Type<unknown> } = {
	lastJoin: t.number,
	lastSeenLog: t.string,
};
/** lastSeenLog holds an update log header, far shorter than this */
const MAX_DATA_STRING_LENGTH = 200;

@injectable
export class PlayerDataController extends Component {
	constructor(
		private readonly playerId: number,
		playerRemotes: PlayerDataStorageRemotesPlayer,
		@inject private readonly players: PlayerDatabase,
	) {
		super();

		this.event.subscribe(playerRemotes.updateSettings.invoked, (p, arg) => this.updateSetting(arg));
		this.event.subscribe(playerRemotes.updateData.invoked, (p, arg) => this.updateData(arg));
		playerRemotes.fetchData.subscribe(() => this.fetchSettings());
	}

	private updateSetting(config: PlayerUpdateSettingsRequest): Response {
		// ignore if the client sent something other than a settings table
		if (!typeIs(config, "table")) return { success: false, message: "Invalid settings" };

		const playerData = this.players.get(this.playerId);

		const newPlayerData: PlayerDatabaseData = {
			...playerData,
			settings: Objects.deepCombine(
				playerData.settings ?? {},
				Config.stripMisplacedScalars(config, PlayerConfigDefinition),
			),
		};

		this.players.set(this.playerId, newPlayerData);
		return { success: true };
	}
	private updateData(request: PlayerUpdateDataRequest): Response {
		// ignore keys the client never sends and values of the wrong type or size
		if (!typeIs(request, "table")) return { success: false, message: "Invalid data" };
		const { key, value } = request;
		const valueType = typeIs(key, "string") ? clientDataTypes[key] : undefined;
		if (!valueType || !t.typeCheck(value, valueType)) return { success: false, message: "Invalid data" };
		if (typeIs(value, "string") && value.size() > MAX_DATA_STRING_LENGTH) {
			return { success: false, message: "Invalid data" };
		}

		const playerData = this.players.get(this.playerId);
		// a corrupt/legacy save can leave `data` as a non-table; spreading that crashes table.clone
		const existingData = typeIs(playerData.data, "table") ? playerData.data : {};

		const newPlayerData: PlayerDatabaseData = {
			...playerData,
			data: {
				...existingData,
				[key]: value,
			},
		};

		this.players.set(this.playerId, newPlayerData);
		return { success: true };
	}
	private fetchSettings(): Response<PlayerDataResponse> {
		const data = this.players.get(this.playerId) ?? {};

		return {
			success: true,
			purchasedSlots: data.purchasedSlots,
			settings: data.settings,
			slots: data.slots,
			data: data.data,
			blocks: data.blocks,
			achievements: data.achievements,
		};
	}
}
