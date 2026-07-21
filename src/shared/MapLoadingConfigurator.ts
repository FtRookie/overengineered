import { Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { Objects } from "engine/shared/fixes/Objects";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

let cache: Instance[] | undefined = undefined;

const path = Workspace.WaitForChild("Map").WaitForChild("Unloadables");

export const GetUnloadables = (): Instance[] => {
	const get = cache ?? path.GetChildren();
	table.sort(get, (a: Instance, b: Instance) => a.Name.lower() < b.Name.lower());
	return get;
};

export function GetDescription(unloadable: Instance): string {
	return unloadable.GetAttribute("description")! as string;
}

cache = GetUnloadables();

@injectable
export class MapLoadingConfigurator extends HostedService {
	constructor(@inject playerData: PlayerDataStorage) {
		super();

		const unloadables = GetUnloadables();
		const update = (mapUnload: MapUnloadConfiguration) => {
			unloadables.forEach((i) => {
				i.Parent = mapUnload[i.Name] ? path : undefined;
			});
		};

		const obv = this.event.addObservable(playerData.config.fReadonlyCreateBased((c) => c.environment.mapUnload));
		this.event.subscribeRegistration(() => obv.subscribeWithCustomEquality(update, Objects.deepEquals, true));
	}
}
