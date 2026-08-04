import { A2SRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { ExplosionEffect } from "shared/effects/ExplosionEffect";
import { FireEffect } from "shared/effects/FireEffect";
import { HeatGlowEffect } from "shared/effects/HeatGlowEffect";
import { ImpactSoundEffect } from "shared/effects/ImpactSoundEffect";
import { ParticleEffect } from "shared/effects/ParticleEffect";
import { SoundEffect } from "shared/effects/SoundEffect";
import { SparksEffect } from "shared/effects/SparksEffect";
import { VaporConeEffect } from "shared/effects/VaporConeEffect";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";

/** Only which block. Size and flammability are read off the block server-side, never sent. */
export type ExplodeArgs = {
	readonly part: BasePart;
};

/** Only where. Size comes from the shot the server recorded when it relayed the spawn. */
export type ExplodeAtArgs = {
	readonly position: Vector3;
};

export type ExtinguishArgs = {
	readonly part: BasePart;
	readonly radius: number;
	readonly sound?: Sound;
	readonly particle?: ParticleEmitter;
};

export namespace RemoteEvents {
	export function initializeVisualEffects(host: GameHostBuilder) {
		host.services.registerSingletonClass(SparksEffect).autoInit();
		host.services.registerSingletonClass(ImpactSoundEffect).autoInit();
		host.services.registerSingletonClass(ExplosionEffect).autoInit();
		host.services.registerSingletonClass(FireEffect).autoInit();
		host.services.registerSingletonClass(HeatGlowEffect).autoInit();
		host.services.registerSingletonClass(SoundEffect).autoInit();
		host.services.registerSingletonClass(ParticleEffect).autoInit();
		host.services.registerSingletonClass(VaporConeEffect).autoInit();
	}

	export const Burn = new A2SRemoteEvent<BasePart[]>("burn");
	export const ImpactBreak = new A2SRemoteEvent<BasePart[]>("impact_break");
	export const Explode = new A2SRemoteEvent<ExplodeArgs>("explode");
	export const ExplodeAt = new A2SRemoteEvent<ExplodeAtArgs>("explode_at");
	export const Extinguish = new A2SRemoteEvent<ExtinguishArgs>("extinguish");

	// empty method just to trigger the constructors
	export function initialize() {}
}
