import type { BidirectionalRemoteEvent, CreatableRemoteEvents } from "engine/shared/event/PERemoteEvent";

export interface EEEffect<T> {
	readonly event: BidirectionalRemoteEvent<T>;

	send(ownerPart: BasePart, arg: T): void;
	/** @server Relays a client's send to the other players only if every check passes */
	addRelayCheck(check: (sender: Player, arg: unknown) => boolean): void;
}

export interface EffectCreator {
	create<T>(name: string, eventType: CreatableRemoteEvents, func?: (arg: T) => void): EEEffect<T>;
}

export abstract class EffectBase<T> {
	private readonly effect;
	readonly event;

	constructor(creator: EffectCreator, name: string, eventType: CreatableRemoteEvents = "UnreliableRemoteEvent") {
		this.effect = creator.create<T>(name, eventType, (arg) => this.justRun(arg));
		this.event = this.effect.event;
	}

	send(ownerPart: BasePart, arg: T) {
		this.effect.send(ownerPart, arg);
	}

	/** @server Relays a client's send to the other players only if every check passes */
	addRelayCheck(check: (sender: Player, arg: unknown) => boolean) {
		this.effect.addRelayCheck(check);
	}

	abstract justRun(arg: T): void;
}
