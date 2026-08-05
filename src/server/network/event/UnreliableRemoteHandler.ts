import { Debris, Players, RunService, Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { t } from "engine/shared/t";
import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import { ServerPartUtils } from "server/plots/ServerPartUtils";
import { BlockConfig } from "shared/blockLogic/BlockConfig";
import { BlockManager } from "shared/building/BlockManager";
import { RemoteEvents } from "shared/RemoteEvents";
import { CustomRemotes } from "shared/Remotes";
import { PartUtils } from "shared/utils/PartUtils";
import { applyModifiers } from "shared/weaponProjectiles/BaseProjectileLogic";
import { ShellProjectileSpawner } from "shared/weaponProjectiles/ShellProjectileLogic";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { ServerBlockDamageController } from "server/ServerBlockDamageController";
import type { ServerPlayersController } from "server/ServerPlayersController";
import type { SpreadingFireController } from "server/SpreadingFireController";
import type { ExplosionEffect } from "shared/effects/ExplosionEffect";
import type { ImpactSoundEffect } from "shared/effects/ImpactSoundEffect";
import type { ExplodeArgs, ExplodeAtArgs } from "shared/RemoteEvents";

const FLAMMABLE_EXPLOSION_HEAT = 6.0;
/** Set on a detonated TNT model so it cannot be detonated twice; cleared for free by ride->build regeneration. */
const DETONATED = "detonated";

/** Matches the self-destruct time ShellProjectile passes to its base constructor. */
const SHELL_LIFETIME = 15;
/** Generous: the sender simulates the flight, and a rejected legitimate shot is worse than a spoofed one. */
const SHOT_DISTANCE_TOLERANCE = 2;
/** Bounds the ledger for a player firing far faster than they detonate. */
const MAX_TRACKED_SHOTS = 64;
/** Mirrors ShellProjectileLogic's own fallback, for a breech that declares no blast. */
const FALLBACK_SHELL_BLAST = { radius: 8, pressure: 1200 } as const;

/** Block-scale jitter, before anything is scaled by how fast the sender was moving. */
const POSITION_BASE_TOLERANCE = 4;
/** Doubles the window that latency and staleness account for, covering acceleration across it. */
const LAG_SLACK = 2;
// TEMPORARY: the claimed-block radius test is off, so its slack has no reader. Restore it with the check.
// const CLAIMED_RADIUS_SLACK = 1.5;
/** An unbounded list would be a cheap way to make the server damage-check forever. */
const MAX_CLAIMED_BLOCKS = 256;

const explodeType = t.strictInterface({
	part: t.instance("BasePart"),
	epicenter: t.vector3,
	affected: t.array(t.strictInterface({ block: t.instance("Model"), distance: t.number })),
});
const explodeAtType = t.strictInterface({ position: t.vector3 });

@injectable
export class UnreliableRemoteController extends HostedService {
	constructor(
		@inject impactSoundEffect: ImpactSoundEffect,
		@inject spreadingFire: SpreadingFireController,
		@inject explosionEffect: ExplosionEffect,
		@inject playModeController: PlayModeController,
		@inject blockDamageController: ServerBlockDamageController,
		@inject private readonly playersController: ServerPlayersController,
		@inject private readonly blockList: BlockList,
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
			if (serverBreakQueue.isEmpty()) return;

			const copy = [...serverBreakQueue];
			serverBreakQueue.clear();

			task.spawn(() => {
				const toSend = new Map<Player | 0, BasePart[]>();

				for (const block of copy) {
					impactSoundEffect.send(block, { blocks: [block], index: undefined });
					ServerPartUtils.BreakJoints(block);

					const owner =
						block.IsDescendantOf(Workspace) && block.CanSetNetworkOwnership()[0]
							? block.GetNetworkOwner()
							: undefined;
					toSend.getOrSet(owner ?? 0, () => []).push(block);
				}

				const players = this.playersController.getPlayers();
				for (const [player, parts] of toSend) {
					let sendTo = players;
					if (player !== 0) sendTo = players.except([player]);

					CustomRemotes.physics.normalizeRootparts.send(sendTo, { parts });
				}
			});
		});

		const burnEvent = (parts: BasePart[]) => {
			parts.forEach((part) => {
				if (!BlockManager.isActiveBlockPart(part)) return;

				spreadingFire.burn(part, 0.3);
			});
		};

		// One explosion = radial HP damage (server-authoritative, via ServerBlockDamageController)
		// + fire spread + the visual/sound effect. The push is the clients' job.
		const blastAt = (
			epicenter: Vector3,
			radius: number,
			pressure: number,
			isFlammable: boolean,
			effectHost?: BasePart,
			attacker?: Player,
			claimed?: readonly { readonly block: Instance; readonly distance: number }[],
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
				undefined,
				claimed,
			);

			// The push is applied by whichever client owns the blocks — see BlastImpulse. The attacker already
			// pushed their own before sending, so they are left out rather than doing it twice.
			const others = attacker
				? this.playersController.getPlayers().except([attacker])
				: this.playersController.getPlayers();
			CustomRemotes.physics.blast.send(others, { epicenter, radius, pressure });

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

		// Neither A2SRemoteEvent nor C2SRemoteEvent validates anything — both hand the raw payload straight to
		// the handler — so the check has to be here, and a mismatch is a forged call rather than a mistake.
		const checked = <T>(player: Player | undefined, arg: unknown, checker: t.Type<T>, name: string): arg is T => {
			if (t.typeCheck(arg, checker)) return true;
			if (!player) return false;

			player.Kick(`Network error at ${name}`);
			const result = t.newResult();
			t.typeCheck(arg, checker, result);
			$log(`Player ${player.Name} sent a malformed ${name}: ${result.getText()}`);

			return false;
		};

		// A shell's flight is simulated on the sender, so the server keeps what it saw at spawn and matches a
		// claimed impact against it. Consuming the entry is what stops one shot detonating twice.
		type Shot = {
			readonly origin: Vector3;
			readonly speed: number;
			readonly radius: number;
			readonly pressure: number;
			readonly firedAt: number;
		};
		const shots = new Map<Player, Shot[]>();

		const takeShotFor = (player: Player, position: Vector3): Shot | undefined => {
			const owned = shots.get(player);
			if (!owned) return undefined;

			const now = os.clock();
			for (let i = 0; i < owned.size(); i++) {
				const shot = owned[i];
				const elapsed = now - shot.firedAt;
				if (elapsed > SHELL_LIFETIME) continue;
				// Deliberately loose: the client simulates the flight, so latency and frame rate make the
				// server's estimate drift. A shell that sometimes fails to explode is worse than the exploit.
				if (position.sub(shot.origin).Magnitude > shot.speed * elapsed * SHOT_DISTANCE_TOLERANCE) continue;

				owned.remove(i);
				return shot;
			}

			return undefined;
		};

		// TODO: detonation is not rate limited. Any fixed cap is a guess at what a legitimate chain looks
		// like, so this waits on telemetry showing real usage rather than an invented number.

		// Part-based blast (TNT): validated to belong to the firing player, then consumes its
		// own block visually.
		const explode = (player: Player | undefined, { part, epicenter, affected }: ExplodeArgs) => {
			if (!ServerBlockLogic.staticIsValidBlock(part, player, playModeController)) return;

			// staticIsValidBlock proves ownership, not identity, so without this any owned block detonates.
			const model = BlockManager.tryGetBlockModelByPart(part);
			if (!model) return;
			const id = BlockManager.manager.id.get(model);
			const block = this.blockList.blocks[id];
			if (block?.limitFamily !== "tnt") return;

			// Consumed once per model. The attribute needs no cleanup: ride->build regenerates blocks as fresh
			// instances, so a rebuilt TNT arrives without it.
			if (model.GetAttribute(DETONATED) === true) return;
			model.SetAttribute(DETONATED, true);

			// Read off the block rather than the payload: the client only names which block, never how big.
			// addDefaults fills anything the save omitted straight from the block's own definition.
			const definition = block.logic?.definition.input;
			if (!definition) return;
			const config = BlockConfig.addDefaults(BlockManager.manager.config.get(model), definition);
			const radius = config.radius?.config as number | undefined;
			const pressure = config.pressure?.config as number | undefined;
			const isFlammable = config.flammable?.config as boolean | undefined;
			if (radius === undefined || pressure === undefined) return;

			const clampedRadius = math.clamp(radius, 0, 20);

			// The sender's epicenter is used, not part.Position: the latter is replicated, so for a block this
			// client simulates the blast would land where the TNT used to be. It is believed only as far as the
			// two known delays allow. ReceiveAge is how stale the held update is; GetNetworkPing is the one-way
			// trip, so the detonation happened that long before this call — the block's position then is the
			// held one carried forward by the difference, which is negative when the data outruns the message.
			const ping = player ? player.GetNetworkPing() : 0;
			const velocity = part.AssemblyLinearVelocity;
			const expected = part.Position.add(velocity.mul(part.ReceiveAge - ping));
			const drift = POSITION_BASE_TOLERANCE + velocity.Magnitude * (ping + part.ReceiveAge) * LAG_SLACK;

			// TEMPORARY: plausibility is measured and reported but not enforced, so the numbers can be read off
			// a real machine before any of them gate anything.
			print(
				`[blast] ${player?.Name ?? "server"} epicenter=${epicenter} expected=${expected}` +
					` off=${string.format("%.2f", epicenter.sub(expected).Magnitude)} allowed=${string.format("%.2f", drift)}` +
					` ping=${string.format("%.0f", ping * 1000)}ms receiveAge=${string.format("%.0f", part.ReceiveAge * 1000)}ms` +
					` speed=${string.format("%.1f", velocity.Magnitude)}`,
			);

			// TEMPORARY: the sender's list is taken wholesale — no radius test, and applyRadialDamage skips its
			// own query when this is present, so the client alone decides what was hit.
			const claimed: { readonly block: Instance; readonly distance: number }[] = [];
			for (const { block, distance } of affected) {
				if (claimed.size() >= MAX_CLAIMED_BLOCKS) break;
				if (!block.IsDescendantOf(Workspace)) continue;

				claimed.push({ block, distance });
			}
			print(
				`[blast] claimed ${claimed.size()} of ${affected.size()} sent,` +
					` radius=${clampedRadius} pressure=${pressure} flammable=${isFlammable}`,
			);

			// Pass the TNT's own part as the effect host — it's already replicated and
			// network-ownable, so the visual broadcasts reliably (no replication race).
			blastAt(
				epicenter,
				clampedRadius,
				math.clamp(pressure, 0, 2500),
				isFlammable === true,
				part,
				player,
				claimed,
			);

			// Consume the block: hide it and kill collision/query immediately so an invisible solid
			// doesn't linger blocking other blocks and the player. It's the explosion effect host, so
			// it can't be destroyed now — drop the whole model after the effect window so consumed TNT
			// doesn't pile up as inert ghosts (build mode rebuilds it from the save).
			part.Transparency = 1;
			part.CanCollide = false;
			part.CanQuery = false;
			part.CanTouch = false;
			PartUtils.applyToAllDescendantsOfType("Decal", part, (decal) => decal.Destroy());
			if (part.Parent) Debris.AddItem(part.Parent, 5);
		};

		// Position-based blast (projectiles). The projectile itself lives client-side, so the shot recorded
		// when the server relayed the spawn is the only thing that can say whether a claimed impact is real.
		const explodeAt = (player: Player | undefined, { position }: ExplodeAtArgs) => {
			if (!player) return;
			if (playModeController.getPlayerMode(player) !== "ride") return;

			const shot = takeShotFor(player, position);
			if (!shot) return;

			blastAt(
				position,
				math.clamp(shot.radius, 0, 20),
				math.clamp(shot.pressure, 0, 2500),
				false,
				undefined,
				player,
			);
		};

		// Records what it relays. `speed` mirrors BaseProjectileLogic: baseVelocity is the unit direction, so
		// the fired speed is applyModifiers(1, …, "speedModifier") — derived here rather than trusted.
		const spawner = ShellProjectileSpawner.instance;
		if (spawner) {
			this.event.subscribe(spawner.event.c2s.invoked, (player, { originPart, modifiers, blast }) => {
				if (!originPart) return;

				const owned = shots.getOrSet(player, () => []);
				if (owned.size() >= MAX_TRACKED_SHOTS) owned.remove(0);

				owned.push({
					origin: originPart.Position,
					speed: applyModifiers(1, modifiers, "speedModifier"),
					radius: blast?.radius ?? FALLBACK_SHELL_BLAST.radius,
					pressure: blast?.pressure ?? FALLBACK_SHELL_BLAST.pressure,
					firedAt: os.clock(),
				});
			});
		}
		this.event.subscribe(Players.PlayerRemoving, (player) => shots.delete(player));

		this.event.subscribe(RemoteEvents.ImpactBreak.invoked, impactBreakEvent);
		this.event.subscribe(RemoteEvents.Burn.invoked, (_, parts) => burnEvent(parts));
		this.event.subscribe(RemoteEvents.Explode.invoked, (player, arg) => {
			if (!checked(player, arg, explodeType, "explode")) return;
			explode(player, arg);
		});
		this.event.subscribe(RemoteEvents.ExplodeAt.invoked, (player, arg) => {
			if (!checked(player, arg, explodeAtType, "explode_at")) return;
			explodeAt(player, arg);
		});
	}
}
