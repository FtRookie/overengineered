import { Players, RunService } from "@rbxts/services";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { C2S2CRemoteFunction } from "engine/shared/event/PERemoteEvent";
import { PlayerRank } from "engine/shared/PlayerRank";

@injectable
export class Switches {
	private readonly setSwitch = new C2S2CRemoteFunction<{ readonly name: string; readonly value: boolean }>(
		"adm_setsw",
	);

	private readonly _registered: { [k in string]: ObservableValue<boolean> } = {};
	readonly registered: { readonly [k in string]: ObservableValue<boolean> } = this._registered;

	constructor() {
		if (RunService.IsServer()) {
			this.setSwitch.subscribe((player, { name, value }) => {
				if (!PlayerRank.isDev(player)) {
					return {
						success: false,
						message: "Not enough permissions",
					};
				}

				this.registered[name]?.set(value);
				return { success: true };
			});
		}
	}

	registerOrGet(name: string, defaultValue: boolean) {
		const existing = this.registered[name];
		if (existing) return existing;

		const value = new ObservableValue<boolean>(defaultValue);
		this.register(name, value);

		return value;
	}
	register(name: string, value: ObservableValue<boolean>) {
		this._registered[name] = value;

		if (RunService.IsClient() && PlayerRank.isDev(Players.LocalPlayer)) {
			value.subscribe((value) => this.setSwitch.send({ name, value }));
		}
	}
}
