import { Lighting } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

@injectable
export class DayCycleController extends HostedService {
	constructor(@inject playerData: PlayerDataStorage) {
		super();

		Lighting.SetMinutesAfterMidnight(14 * 60);

		const timePerDayCycle = 20 * 60;

		const getMinutesAfterMidnightTime = () => {
			const config = playerData.config.get().environment.dayCycle;
			if (config.automatic) {
				return (((DateTime.now().UnixTimestampMillis / 1000) % timePerDayCycle) / timePerDayCycle) * (60 * 24);
			}

			return config.manual * 60;
		};

		const update = () => {
			Lighting.SetMinutesAfterMidnight(getMinutesAfterMidnightTime());
		};

		this.event.loop(1 / 4, update);
		this.event
			.addObservable(playerData.config.fReadonlyCreateBased((c) => c.environment.dayCycle))
			.subscribe(update);
	}
}
