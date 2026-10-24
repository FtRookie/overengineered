import { HostedService } from "engine/shared/di/HostedService";
import { BidirectionalRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { ArgsSignal } from "engine/shared/event/Signal";
import type { CreatableRemoteEvents } from "engine/shared/event/PERemoteEvent";
import type { EEEffect, EffectCreator } from "shared/effects/EffectBase";

@injectable
class ClientEffect<T> implements EEEffect<T> {
	readonly event: BidirectionalRemoteEvent<T>;
	private readonly _ran = new ArgsSignal<[arg: T]>();
	readonly ran: ReadonlyArgsSignal<[arg: T]> = this._ran;

	constructor(name: string, eventType: CreatableRemoteEvents) {
		this.event = new BidirectionalRemoteEvent<T>(name, eventType);
		this.event.s2c.invoked.Connect((arg) => this._ran.Fire(arg));
	}

	send(ownerPart: BasePart, arg: T): void {
		this._ran.Fire(arg);
		this.event.c2s.send(arg);
	}

	addRelayCheck(): void {}
}

@injectable
export class ClientEffectCreator extends HostedService implements EffectCreator {
	constructor(@inject private readonly di: DIContainer) {
		super();
	}

	create<T>(name: string, eventType: CreatableRemoteEvents, func?: (arg: T) => void): EEEffect<T> {
		const effect = this.di.resolveForeignClass(ClientEffect<T>, [name, eventType]);
		if (func) {
			effect.ran.Connect(func);
		}

		return effect;
	}
}
