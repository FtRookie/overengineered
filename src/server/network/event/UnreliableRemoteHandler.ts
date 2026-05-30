import { Players, RunService, Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import { ServerPartUtils } from "server/plots/ServerPartUtils";
import { BlockManager } from "shared/building/BlockManager";
import { RemoteEvents } from "shared/RemoteEvents";
import { CustomRemotes } from "shared/Remotes";
import { PartUtils } from "shared/utils/PartUtils";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { ServerPlayersController } from "server/ServerPlayersController";
import type { SpreadingFireController } from "server/SpreadingFireController";
import type { ExplosionEffect } from "shared/effects/ExplosionEffect";
import type { ImpactSoundEffect } from "shared/effects/ImpactSoundEffect";
import type { ExplodeArgs } from "shared/RemoteEvents";

@injectable
export class UnreliableRemoteController extends HostedService {
	constructor(
		@inject impactSoundEffect: ImpactSoundEffect,
		@inject spreadingFire: SpreadingFireController,
		@inject explosionEffect: ExplosionEffect,
		@inject playModeController: PlayModeController,
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

		this.event.subscribe(RunService.Heartbeat, () => {
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

		// Damage and breaking are handled client-side via BlockDamageController, driven by
		// the TNT block's own logic. Here we deal with the physics blast, fire spread, and
		// visual/audio — everything that's authoritative to the server.
		const explode = (player: Player | undefined, { part, isFlammable, pressure, radius }: ExplodeArgs) => {
			if (!ServerBlockLogic.staticIsValidBlock(part, player, playModeController)) {
				return;
			}

			radius = math.clamp(radius, 0, 20);
			pressure = math.clamp(pressure, 0, 2500);

			const epicenter = part.Position;
			const hitParts = Workspace.GetPartBoundsInRadius(epicenter, radius);

			if (isFlammable) {
				const flameHitParts = Workspace.GetPartBoundsInRadius(epicenter, radius * 1.5);

				flameHitParts.forEach((flamePart) => {
					if (math.random(1, 8) === 1) {
						spreadingFire.burn(flamePart, 0.5);
					}
				});
			}

			// Directional push outward from the epicenter with quadratic falloff —
			// matches the damage falloff used in TNTBlocks.ts.
			hitParts.forEach((hitPart) => {
				if (!BlockManager.isActiveBlockPart(hitPart)) return;

				const offset = hitPart.Position.sub(epicenter);
				const distance = offset.Magnitude;
				if (distance >= radius || distance < 0.01) return;

				const falloff = 1 - distance / radius;
				const pushMagnitude = (pressure / 40) * falloff * falloff;
				hitPart.AssemblyLinearVelocity = hitPart.AssemblyLinearVelocity.add(
					offset.Unit.mul(pushMagnitude),
				);
			});

			part.Transparency = 1;
			PartUtils.applyToAllDescendantsOfType("Decal", part, (decal) => decal.Destroy());

			// Explosion sound + particles (radius drives the particle scale)
			explosionEffect.send(part, { part, index: undefined, radius });
		};

		this.event.subscribe(RemoteEvents.ImpactBreak.invoked, impactBreakEvent);
		this.event.subscribe(RemoteEvents.Burn.invoked, (_, parts) => burnEvent(parts));
		this.event.subscribe(RemoteEvents.Explode.invoked, explode);
	}
}
