import { Lighting } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

@injectable
export class DayCycleController extends HostedService {
	constructor(@inject playerData: PlayerDataStorage) {
		super();

		Lighting.SetMinutesAfterMidnight(14 * 60);

		const timePerDayCycle = 20 * 60;
		const fadeStart = 19;
		const fadeEnd = 5;
		const peakBright = 3;

		const getMinutesAfterMidnightTime = () => {
			const config = playerData.config.get().dayCycle;
			if (config.automatic) {
				return (((DateTime.now().UnixTimestampMillis / 1000) % timePerDayCycle) / timePerDayCycle) * (60 * 24);
			}

			return config.manual * 60;
		};
		const getBrightnessAtHour = (hour: number) => {
			const A = math.min((fadeStart - hour) / ((24 - fadeStart) / peakBright), 0);
			const B = math.max((fadeEnd - hour) / (fadeStart / peakBright), 0);
			return A + B + peakBright;
		};

		const update = () => {
			Lighting.SetMinutesAfterMidnight(getMinutesAfterMidnightTime());
			Lighting.Brightness = getBrightnessAtHour(Lighting.ClockTime);
		};

		this.event.loop(1 / 4, update);
		this.event.addObservable(playerData.config.fReadonlyCreateBased((c) => c.dayCycle)).subscribe(update);
	}
}
