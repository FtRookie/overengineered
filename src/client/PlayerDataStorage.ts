import { HttpService } from "@rbxts/services";
import { LoadingController } from "client/controller/LoadingController";
import { LogControl } from "client/gui/static/LogControl";
import { Observables } from "engine/shared/event/Observables";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { ArgsSignal } from "engine/shared/event/Signal";
import { JSON } from "engine/shared/fixes/Json";
import { Objects } from "engine/shared/fixes/Objects";
import { Strings } from "engine/shared/fixes/String.propmacro";
import { Colors } from "shared/Colors";
import { Config } from "shared/config/Config";
import { PlayerConfigDefinition } from "shared/config/PlayerConfig";
import { CustomRemotes } from "shared/Remotes";
import { PlayerDataRemotes } from "shared/remotes/PlayerDataRemotes";
import { SlotsMeta } from "shared/SlotsMeta";
import type { PlayerDataStorageRemotesPlayer, PlayerDataStorageRemotesSlots } from "shared/remotes/PlayerDataRemotes";

type NonNullableFields<T> = {
	[P in keyof T]-?: NonNullable<T[P]>;
};

type PD = NonNullableFields<PlayerDataResponse> & {
	readonly settings: NonNullableFields<PlayerDataResponse["settings"]>;
};

@injectable
export class PlayerDataStorage {
	static forPlayer(playerId: number) {
		const result = CustomRemotes.adminDataFor.send(playerId);
		if (!result.success) {
			throw `Error while initializing the game: ${result.message}`;
		}

		const playerRemotes = PlayerDataRemotes.createPlayer(result.remotes);
		const slotRemotes = PlayerDataRemotes.createSlots(result.remotes);
		return new PlayerDataStorage(PlayerDataStorage.convertData(result.data), playerRemotes, slotRemotes);
	}

	static convertData(data: PlayerDataResponse): PD {
		return {
			purchasedSlots: data.purchasedSlots ?? 0,
			settings: Config.addDefaults(data.settings ?? {}, PlayerConfigDefinition),
			slots: data.slots ?? Objects.empty,
			data: data.data ?? {},
			features: data.features ?? [],
			achievements: data.achievements ?? {},
		};
	}

	private readonly _slotLoading = new ArgsSignal();
	readonly slotLoading = this._slotLoading.asReadonly();

	private readonly _slotLoaded = new ArgsSignal();
	readonly slotLoaded = this._slotLoaded.asReadonly();

	private readonly _data;
	readonly data;

	readonly config;
	readonly slots: ObservableValue<{ readonly [k in number]: SlotMeta }>;
	readonly achievements;

	readonly loadedSlot = new ObservableValue<number | undefined>(undefined);

	constructor(
		data: PD,
		@inject private readonly playerRemotes: PlayerDataStorageRemotesPlayer,
		@inject private readonly slotRemotes: PlayerDataStorageRemotesSlots,
	) {
		this._data = new ObservableValue(data);
		this.data = this._data.asReadonly();

		this.config = Observables.createObservableFromObjectPropertyTyped(this._data, ["settings"]);
		this.achievements = Observables.createObservableFromObjectPropertyTyped(this._data, ["achievements"]);
		this.slots = Observables.createObservableFromObjectPropertyTyped(this._data, ["slots"]) //
			.fCreateBased(
				(c) => SlotsMeta.toTable(c),
				(c) => Objects.values(c),
				Objects.deepEquals,
			);

		// const slots = new ObservableValue<{ readonly [k in number]: SlotMeta }>(Objects.empty);
		// this.data.subscribe((data) => slots.set(SlotsMeta.toTable(data.slots)), true);
		// this.slots = slots;

		CustomRemotes.updateSaves.invoked.Connect((slots) => this._data.set({ ...this._data.get(), slots }));
		CustomRemotes.achievements.update.invoked.Connect((data) => {
			this._data.set({ ...this._data.get(), achievements: { ...this._data.get().achievements, ...data } });
		});
	}

	async sendPlayerConfig(config: PartialThrough<PlayerConfig>) {
		$log(`Updating player config: ${Strings.pretty(config)}`);
		this.playerRemotes.updateSettings.send(config);

		this._data.set({
			...this.data.get(),
			settings: Objects.deepCombine(this.data.get().settings, config),
		});
	}
	async sendPlayerDataValue<TKey extends keyof OePlayerData>(key: TKey, value: OePlayerData[TKey] & defined) {
		$log(`Setting player data value ${key} to ${JSON.serialize(value)}`);
		this.playerRemotes.updateData.send({ key, value });

		this._data.set({
			...this.data.get(),
			settings: {
				...this.data.get().settings,
				[key]: value,
			},
		});
	}

	sendPlayerSlot(req: PlayerSaveSlotRequest) {
		$log("Setting slot " + req.index + " to " + HttpService.JSONEncode(req));
		this.loadedSlot.set(req.index);

		let d = this.data.get();
		if (d) {
			this._data.set({
				...d,
				slots: SlotsMeta.withSlot(d.slots, req.index, { ...req, saveTime: DateTime.now().UnixTimestampMillis }),
			});
		}

		const response = this.slotRemotes.save.send(req);
		if (!response.success) {
			$err(response.message);
			return response;
		}

		d = this.data.get();
		if (d) {
			this._data.set({
				...this.data.get()!,
				slots: SlotsMeta.withSlot(d.slots, req.index, {
					blocks: response.blocks ?? SlotsMeta.get(d.slots, req.index).blocks,
				}),
			});
		}

		return response;
	}
	deletePlayerSlot(req: PlayerDeleteSlotRequest) {
		$log("Deleting slot " + req.index);

		const copy = { ...this.slots.get() };
		delete copy[req.index];
		this.slots.set(copy);

		const response = this.slotRemotes.delete.send(req);
		if (!response.success) {
			$err(response.message);
			return response;
		}

		return response;
	}

	loadPlayerSlot(index: number, message?: string) {
		$log(`Loading slot ${index}`);
		this._slotLoading.Fire();

		return LoadingController.run(message ?? `Loading slot ${index}`, () => {
			const response = this.slotRemotes.load.send({ index });
			if (response.success && !response.isEmpty) {
				this.loadedSlot.set(index);
				this._slotLoaded.Fire();
			} else if (!response.success) {
				LogControl.instance.addLine("Error while loading a slot", Colors.red);
				$warn(response.message);
			}

			return response;
		});
	}

	loadPlayerSlotHistory(index: number) {
		return this.slotRemotes.loadHistory.send({ index });
	}
	loadPlayerSlotFromHistory(databaseSlotId: string, historyId: string, message?: string) {
		$log(`Loading slot D${databaseSlotId} H${historyId}`);
		this._slotLoading.Fire();

		return LoadingController.run(message ?? `Loading slot D${databaseSlotId} H${historyId}`, () => {
			const response = this.slotRemotes.loadFromHistory.send({ databaseId: databaseSlotId, historyId });
			if (response.success && !response.isEmpty) {
				this.loadedSlot.set(undefined);
				this._slotLoaded.Fire();
			} else if (!response.success) {
				LogControl.instance.addLine("Error while loading a slot", Colors.red);
				$warn(response.message);
			}

			return response;
		});
	}
}
