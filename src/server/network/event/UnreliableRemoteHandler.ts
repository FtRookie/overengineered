import { Debris, RunService, Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import { ServerPartUtils } from "server/plots/ServerPartUtils";
import { BlockManager } from "shared/building/BlockManager";
import { RemoteEvents } from "shared/RemoteEvents";
import { CustomRemotes } from "shared/Remotes";
import { PartUtils } from "shared/utils/PartUtils";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { ServerBlockDamageController } from "server/ServerBlockDamageController";
import type { ServerPlayersController } from "server/ServerPlayersController";
import type { SpreadingFireController } from "server/SpreadingFireController";
import type { ExplosionEffect } from "shared/effects/ExplosionEffect";
import type { ImpactSoundEffect } from "shared/effects/ImpactSoundEffect";
import type { ExplodeArgs, ExplodeAtArgs } from "shared/RemoteEvents";

/** Heat a flammable blast deals at the epicenter (scaled by falloff); feeds the ignition system. */
const FLAMMABLE_EXPLOSION_HEAT = 0.6;

@injectable
export class UnreliableRemoteController extends HostedService {
	constructor(
		@inject impactSoundEffect: ImpactSoundEffect,
		@inject spreadingFire: SpreadingFireController,
		@inject explosionEffect: ExplosionEffect,
		@inject playModeController: PlayModeController,
		@inject blockDamageController: ServerBlockDamageController,
		@inject private readonly playersController: ServerPlayersController,
	) {
		super();

		const serverBreakQueue: Set<BasePart> = new Set();

		const impactBreakEvent = (player: Player | undefined, parts: BasePart[]) => {
			if (!player) {
				for (const part of parts) {
					serverBreakQueue.add(part);
				}
				return;
			}

			task.spawn(() => {
				const players = this.playersController.getPlayers().filter((p) => p !== player);
				CustomRemotes.physics.normalizeRootparts.send(players, { parts });

				for (const part of parts) {
					if (!BlockManager.isActiveBlockPart(part)) continue;
					ServerPartUtils.BreakJoints(part);
				}

				impactSoundEffect.send(parts[0], { blocks: parts, index: undefined });
			});
		};

		this.event.subscribe(RunService.PostSimulation, () => {
			if (serverBreakQueue.size() > 0) {
				const copy = [...serverBreakQueue];
				serverBreakQueue.clear();

				task.spawn(() => {
					const toSend = new Map<Player | 0, BasePart[]>();

					for (const block of copy) {
						impactSoundEffect.send(block, { blocks: [block], index: undefined });
						ServerPartUtils.BreakJoints(block);

						const owner = block.IsDescendantOf(Workspace) ? block.GetNetworkOwner() : undefined;
						toSend.getOrSet(owner ?? 0, () => []).push(block);
					}

					const players = this.playersController.getPlayers();
					for (const [player, parts] of toSend) {
						let sendTo = players;
						if (player !== 0) sendTo = players.except([player]);

						CustomRemotes.physics.normalizeRootparts.send(sendTo, { parts });
					}
				});
			}
		});

		const burnEvent = (parts: BasePart[]) => {
			parts.forEach((part) => {
				if (!BlockManager.isActiveBlockPart(part)) return;

				spreadingFire.burn(part, 0.3);
			});
		};

		// One explosion = radial HP damage (server-authoritative, via ServerBlockDamageController)
		// + physics push + fire spread + the visual/sound effect.
		const blastAt = (
			epicenter: Vector3,
			radius: number,
			pressure: number,
			isFlammable: boolean,
			effectHost?: BasePart,
			attacker?: Player,
		) => {
			if (radius <= 0) return;

			// Server owns HP — explosive area damage with quadratic falloff. Flammable blasts also
			// feed heat into the ignition pipeline (per-block, distance-scaled, material-aware)
			// instead of a flat per-part coin flip. `attacker` drives the PvP gate.
			blockDamageController.applyRadialDamage(
				epicenter,
				radius,
				pressure,
				isFlammable ? FLAMMABLE_EXPLOSION_HEAT : 0,
				attacker,
			);

			// Directional push outward from the epicenter with quadratic falloff —
			// matches the damage falloff used by the damage system.
			for (const hitPart of Workspace.GetPartBoundsInRadius(epicenter, radius)) {
				if (!BlockManager.isActiveBlockPart(hitPart)) continue;

				const offset = hitPart.Position.sub(epicenter);
				const distance = offset.Magnitude;
				if (distance >= radius || distance < 0.01) continue;

				const falloff = 1 - distance / radius;
				const pushMagnitude = (pressure / 40) * falloff * falloff;
				hitPart.AssemblyLinearVelocity = hitPart.AssemblyLinearVelocity.add(offset.Unit.mul(pushMagnitude));
			}

			// Prefer an already-replicated, network-ownable host (e.g. the TNT's own part):
			// ServerEffect.send skips anchored parts, and a freshly-created part can arrive nil
			// on clients before replication catches up. Only fall back to a throwaway part when
			// no usable host is given (position-only blasts from projectiles).
			if (effectHost && effectHost.CanSetNetworkOwnership()[0]) {
				explosionEffect.send(effectHost, { part: effectHost, index: undefined, radius });
				return;
			}

			// Throwaway host. Create it UNANCHORED so ServerEffect.send broadcasts it, then
			// anchor it (no physics step runs between these synchronous lines) so it and its
			// replicated copies don't fall and drag the explosion sound downward.
			const fxPart = new Instance("Part");
			fxPart.Anchored = false;
			fxPart.CanCollide = false;
			fxPart.CanQuery = false;
			fxPart.CanTouch = false;
			fxPart.Transparency = 1;
			fxPart.Size = Vector3.one;
			fxPart.Position = epicenter;
			fxPart.Parent = Workspace;
			explosionEffect.send(fxPart, { part: fxPart, index: undefined, radius });
			fxPart.Anchored = true;
			Debris.AddItem(fxPart, 5);
		};

		// Part-based blast (TNT): validated to belong to the firing player, then consumes its
		// own block visually.
		const explode = (player: Player | undefined, { part, isFlammable, pressure, radius }: ExplodeArgs) => {
			if (!ServerBlockLogic.staticIsValidBlock(part, player, playModeController)) return;

			// Pass the TNT's own part as the effect host — it's already replicated and
			// network-ownable, so the visual broadcasts reliably (no replication race).
			blastAt(part.Position, math.clamp(radius, 0, 20), math.clamp(pressure, 0, 2500), isFlammable, part, player);

			part.Transparency = 1;
			PartUtils.applyToAllDescendantsOfType("Decal", part, (decal) => decal.Destroy());
		};

		// Position-based blast (projectiles). Projectiles live client-side only, so there is no
		// block to validate — gate on the sender being in ride mode and hard-clamp the size.
		const explodeAt = (player: Player | undefined, { position, isFlammable, pressure, radius }: ExplodeAtArgs) => {
			if (player && playModeController.getPlayerMode(player) !== "ride") return;

			blastAt(position, math.clamp(radius, 0, 20), math.clamp(pressure, 0, 2500), isFlammable, undefined, player);
		};

		this.event.subscribe(RemoteEvents.ImpactBreak.invoked, impactBreakEvent);
		this.event.subscribe(RemoteEvents.Burn.invoked, (_, parts) => burnEvent(parts));
		this.event.subscribe(RemoteEvents.Explode.invoked, explode);
		this.event.subscribe(RemoteEvents.ExplodeAt.invoked, explodeAt);
	}
}
