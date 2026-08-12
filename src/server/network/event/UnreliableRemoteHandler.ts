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
/** set on a detonated TNT so it can't fire twice; cleared free by ride->build regen */
const DETONATED = "detonated";

/** matches ShellProjectile's self-destruct time */
const SHELL_LIFETIME = 15;
/** generous: the sender simulates flight, a rejected legit shot is worse than a spoofed one */
const SHOT_DISTANCE_TOLERANCE = 2;
/** bounds the ledger for a player firing far faster than they detonate */
const MAX_TRACKED_SHOTS = 64;
/** mirrors ShellProjectileLogic's fallback, for a breech that declares no blast */
const FALLBACK_SHELL_BLAST = { radius: 8, pressure: 1200 } as const;

/** block-scale jitter, before anything is scaled by the sender's speed */
const POSITION_BASE_TOLERANCE = 4;
/**
 * Replication cadence + smoothing, no measurable delay. Measured against a real machine: the sender-epicenter
 * vs server-copy offset is a flat ~92ms of travel at 693/1665/3841 studs/s alike — fixed time, not geometric —
 * while the message arrives in 14-19ms and ReceiveAge reads 0. Fitted on a 12-14ms link; `age` carries a worse one.
 */
const REPLICATION_PIPELINE = 0.08;
/** headroom over the worst sample: acceleration across the window, and links not yet measured */
const LAG_SLACK = 1.5;
/** claimed blocks are measured against lagging positions, so the radius test needs room of its own */
const CLAIMED_RADIUS_SLACK = 1.5;
/** unbounded, this list is a cheap way to make the server damage-check forever */
const MAX_CLAIMED_BLOCKS = 256;
/** caps the sender's claimed flight time, so a forged stamp can't buy unlimited extrapolation */
const MAX_BLAST_AGE = 1;
/**
 * How long after a server break a TNT may still detonate. Chains run through this remote: the server broadcasts
 * `damageSystem.broken`, the owner answers by detonating, so a chained TNT is always already broken by the time
 * its request lands — refusing broken blocks would delete chains. One round trip is all that answer can honestly
 * take; past it the block is debris (survives 20-60s before cleanup), the window a modified client would use to
 * bank a destroyed TNT and set it off later elsewhere.
 */
const MAX_BROKEN_DETONATION_DELAY = 1;

const explodeType = t.strictInterface({
	part: t.instance("BasePart"),
	epicenter: t.vector3,
	affected: t.array(t.strictInterface({ block: t.instance("Model"), distance: t.number })),
	at: t.number,
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
				const owned = parts.filter((part) => {
					if (!BlockManager.isActiveBlockPart(part)) return false;
					const model = BlockManager.tryGetBlockModelByPart(part);
					return model?.Parent?.Parent?.GetAttribute("ownerid") === player.UserId;
				});
				if (owned.isEmpty()) return;

				const players = this.playersController.getPlayers().filter((p) => p !== player);
				CustomRemotes.physics.normalizeRootparts.send(players, { parts: owned });

				for (const part of owned) {
					ServerPartUtils.BreakJoints(part);
				}

				impactSoundEffect.send(owned[0], { blocks: owned, index: undefined });
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

				spreadingFire.burn(part);
			});
		};

		// one explosion = radial HP damage (server-authoritative) + fire spread + the effect; the push is the clients' job
		const blastAt = (
			epicenter: Vector3,
			radius: number,
			pressure: number,
			isFlammable: boolean,
			effectHost?: BasePart,
			attacker?: Player,
			claimed?: readonly { readonly block: Instance; readonly distance: number }[],
			selfOnly = false,
		) => {
			if (radius <= 0) return;

			// server owns HP; quadratic falloff. flammable also feeds heat into ignition (per-block,
			// distance-scaled, material-aware) instead of a flat per-part coin flip. attacker drives the PvP gate
			blockDamageController.applyRadialDamage(
				epicenter,
				radius,
				pressure,
				isFlammable ? FLAMMABLE_EXPLOSION_HEAT : 0,
				attacker,
				undefined,
				claimed,
				selfOnly,
			);

			// push is applied by whichever client owns the blocks (BlastImpulse). the attacker already pushed
			// their own before sending, so they are left out. an untrusted blast reaches no other client at all
			if (!selfOnly) {
				const others = attacker
					? this.playersController.getPlayers().except([attacker])
					: this.playersController.getPlayers();
				CustomRemotes.physics.blast.send(others, { epicenter, radius, pressure });
			}

			// prefer an already-replicated, network-ownable host (e.g. the TNT's own part): ServerEffect.send
			// skips anchored parts, and a fresh part can arrive nil before replication catches up. fall back to
			// a throwaway only when no usable host is given (position-only blasts from projectiles)
			if (effectHost && effectHost.CanSetNetworkOwnership()[0]) {
				explosionEffect.send(effectHost, { part: effectHost, index: undefined, radius });
				return;
			}

			// throwaway host: create UNANCHORED so ServerEffect.send broadcasts it, then anchor (no physics step
			// runs between these synchronous lines) so it and its copies don't fall and drag the sound downward
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

		// neither A2S nor C2S validates — both hand the raw payload straight to the handler — so the check is
		// here, and a mismatch is a forged call rather than a mistake
		const checked = <T>(player: Player | undefined, arg: unknown, checker: t.Type<T>, name: string): arg is T => {
			if (t.typeCheck(arg, checker)) return true;
			if (!player) return false;

			player.Kick(`Network error at ${name}`);
			const result = t.newResult();
			t.typeCheck(arg, checker, result);
			$log(`Player ${player.Name} sent a malformed ${name}: ${result.getText()}`);

			return false;
		};

		// a shell flies on the sender, so the server keeps what it saw at spawn and matches a claimed impact to
		// it. consuming the entry stops one shot detonating twice
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
				// loose on purpose: the client simulates flight, so latency and frame rate drift the server's
				// estimate. a shell that sometimes fails to explode beats the exploit
				if (position.sub(shot.origin).Magnitude > shot.speed * elapsed * SHOT_DISTANCE_TOLERANCE) continue;

				owned.remove(i);
				return shot;
			}

			return undefined;
		};

		// TODO: detonation is not rate limited. Any fixed cap is a guess at what a legitimate chain looks
		// like, so this waits on telemetry showing real usage rather than an invented number.

		// part-based blast (TNT): validated to belong to the firing player, then consumes its block
		const explode = (player: Player | undefined, { part, epicenter, affected, at }: ExplodeArgs) => {
			if (!ServerBlockLogic.staticIsValidBlock(part, player, playModeController)) return;

			// staticIsValidBlock proves ownership, not identity, so without this any owned block detonates
			const model = BlockManager.tryGetBlockModelByPart(part);
			if (!model) return;
			const id = BlockManager.manager.id.get(model);
			const block = this.blockList.blocks[id];
			if (block?.limitFamily !== "tnt") return;

			// checked here, marked only once the blast is accepted below: a refusal must not cost the player the block
			if (model.GetAttribute(DETONATED) === true) return;

			// in the workspace is not proof of being alive: a broken block's parts linger as debris
			const brokenAt = blockDamageController.getBrokenAt(model);
			if (brokenAt !== undefined && os.clock() - brokenAt > MAX_BROKEN_DETONATION_DELAY) {
				print(`[blast] REFUSED: ${model.Name} broke ${string.format("%.1f", os.clock() - brokenAt)}s ago`);
				return;
			}

			// read off the block, not the payload: the client names which block, never how big. addDefaults
			// fills anything the save omitted from the block's own definition
			const definition = block.logic?.definition.input;
			if (!definition) return;
			const config = BlockConfig.addDefaults(BlockManager.manager.config.get(model), definition);
			const radius = config.radius?.config as number | undefined;
			const pressure = config.pressure?.config as number | undefined;
			const isFlammable = config.flammable?.config as boolean | undefined;
			if (radius === undefined || pressure === undefined) return;

			const clampedRadius = math.clamp(radius, 0, 20);

			// sender's epicenter, not part.Position (replicated: for a block this client simulates, the blast
			// would land where the TNT used to be). believed only as far as the held position carried forward by
			// the lag below can reach. ping is read for the log alone — a sixth of the divergence, so it gates nothing
			const ping = player ? player.GetNetworkPing() : 0;
			const velocity = part.AssemblyLinearVelocity;
			const speed = velocity.Magnitude;

			// message flight time on the shared clock. bounded because the sender chose it: negative = a clock
			// ahead of the server's, past the cap = stale or forged
			const age = math.clamp(Workspace.GetServerTimeNow() - at, 0, MAX_BLAST_AGE);
			// carried by the measured age and the pipeline the measurements exposed, not by ping
			const lag = age + part.ReceiveAge + REPLICATION_PIPELINE;
			const expected = part.Position.add(velocity.mul(lag));
			const drift = POSITION_BASE_TOLERANCE + speed * lag * LAG_SLACK;

			// printed before the gate so a refusal is visible. implied is the lag the offset actually demands,
			// what REPLICATION_PIPELINE was fitted against
			const off = epicenter.sub(expected).Magnitude;
			const raw = epicenter.sub(part.Position).Magnitude;
			print(
				`[blast] ${player?.Name ?? "server"} off=${string.format("%.2f", off)} allowed=${string.format("%.2f", drift)}` +
					` raw=${string.format("%.2f", raw)} implied=${string.format("%.0f", speed > 0 ? (raw / speed) * 1000 : 0)}ms` +
					` age=${string.format("%.0f", age * 1000)}ms ping=${string.format("%.0f", ping * 1000)}ms` +
					` receiveAge=${string.format("%.0f", part.ReceiveAge * 1000)}ms speed=${string.format("%.1f", speed)}`,
			);

			// an implausible epicenter no longer refuses the blast: the sender owns its own blocks regardless, so
			// it keeps those — what it loses is everything cross-client: damage to other players' blocks and
			// characters, and the push on other clients
			const selfOnly = off > drift;
			if (selfOnly) {
				print(
					`[blast] UNTRUSTED epicenter: off ${string.format("%.2f", off)} over ${string.format("%.2f", drift)}, sender-only`,
				);
			}
			model.SetAttribute(DETONATED, true);

			// sender decides what was hit (applyRadialDamage skips its own query then). its own blocks are taken
			// at its word — the claimed distance is clamped to the radius on the damage side, so a forged
			// self-claim is at most self-harm; other players' blocks additionally have to stand near the epicenter
			// by the server's own reckoning, widened by the same drift, since those positions lag as the TNT's did
			const allowance = clampedRadius * CLAIMED_RADIUS_SLACK + drift;
			const claimed: { readonly block: Instance; readonly distance: number }[] = [];
			let refused = 0;
			for (const { block, distance } of affected) {
				if (claimed.size() >= MAX_CLAIMED_BLOCKS) break;
				if (!block.IsDescendantOf(Workspace)) continue;

				const own = player !== undefined && block.Parent?.Parent?.GetAttribute("ownerid") === player.UserId;
				if (!own) {
					const pos = block.PrimaryPart?.Position ?? block.GetPivot().Position;
					if (pos.sub(epicenter).Magnitude > allowance) {
						refused++;
						continue;
					}
				}

				claimed.push({ block, distance });
			}
			print(
				`[blast] claimed ${claimed.size()} of ${affected.size()} sent (${refused} refused),` +
					` radius=${clampedRadius} pressure=${pressure} flammable=${isFlammable}` +
					` allowance=${string.format("%.1f", allowance)}`,
			);

			// TNT's own part as the effect host: already replicated and network-ownable, so the visual
			// broadcasts reliably (no replication race)
			blastAt(
				epicenter,
				clampedRadius,
				math.clamp(pressure, 0, 2500),
				isFlammable === true,
				part,
				player,
				claimed,
				selfOnly,
			);

			// consume the block: hide it and kill collision/query now so an invisible solid doesn't linger
			// blocking others. it hosts the effect, so it can't be destroyed yet — drop the whole model after the
			// effect window so consumed TNT doesn't pile up as ghosts (build mode rebuilds it from the save)
			part.Transparency = 1;
			part.CanCollide = false;
			part.CanQuery = false;
			part.CanTouch = false;
			PartUtils.applyToAllDescendantsOfType("Decal", part, (decal) => decal.Destroy());
			if (part.Parent) Debris.AddItem(part.Parent, 5);
		};

		// position-based blast (projectiles): the projectile lives client-side, so the shot recorded when the
		// server relayed the spawn is the only thing that can say whether a claimed impact is real
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

		// records what it relays. speed mirrors BaseProjectileLogic: baseVelocity is the unit direction, so the
		// fired speed is applyModifiers(1, …, "speedModifier") — derived here rather than trusted
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
