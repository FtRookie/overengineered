import { Players, Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { ArgsSignal } from "engine/shared/event/Signal";
import { LocalInstanceData } from "engine/shared/LocalInstanceData";
import { ExtinguisherBombBlock, SMOKE_SECONDS } from "shared/blocks/blocks/ExtinguisherBombBlock";
import { BlockManager } from "shared/building/BlockManager";
import { RemoteEvents } from "shared/RemoteEvents";
import { CustomDebrisService } from "shared/service/CustomDebrisService";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { ServerBlockDamageController } from "server/ServerBlockDamageController";
import type { FireEffect } from "shared/effects/FireEffect";

const overlapParams = new OverlapParams();
overlapParams.CollisionGroup = "Blocks"; // todo: change checks for colboxes in fire controller and use "ColBoxExclusive" here

const MAX_EXTINGUISH_RADIUS = ExtinguisherBombBlock.logic.definition.input.radius.types.number.clamp.max;

const PlayerIgnite = {
	radius: 4, // studs
	interval: 1, // seconds between sweeps
} as const;

@injectable
export class SpreadingFireController extends HostedService {
	static instance?: SpreadingFireController;

	readonly extinguished = new ArgsSignal<
		[extinguisher: Player | undefined, blocks: readonly BlockModel[], players: readonly Player[]]
	>();

	private readonly clouds: { readonly position: Vector3; readonly radius: number; readonly until: number }[] = [];

	constructor(
		@inject private readonly fireEffect: FireEffect,
		@inject private readonly playModeController: PlayModeController,
		@inject private readonly blockDamageController: ServerBlockDamageController,
	) {
		super();

		SpreadingFireController.instance = this;

		this.event.subscribe(RemoteEvents.Extinguish.invoked, (player, { part, radius }) => {
			if (!part) return;

			const clamped = math.clamp(radius, 0, MAX_EXTINGUISH_RADIUS);
			this.clouds.push({ position: part.Position, radius: clamped, until: time() + SMOKE_SECONDS });

			const [blocks, players] = this.extinguishArea(part.Position, clamped);
			if (!blocks.isEmpty() || !players.isEmpty()) this.extinguished.Fire(player, blocks, players);
		});

		this.event.subscribe(this.blockDamageController.blockBurnedOut, (block) => {
			const clear = (part: BasePart) => {
				LocalInstanceData.RemoveLocalTag(part, "Burn");
				this.fireEffect.extinguish(part);
			};

			if (block.IsA("BasePart")) clear(block);
			for (const part of block.GetDescendants()) {
				if (part.IsA("BasePart")) clear(part);
			}
		});

		this.event.loop(PlayerIgnite.interval, () => {
			for (const plr of Players.GetPlayers()) {
				const character = plr.Character;
				const root = character?.PrimaryPart;
				if (!root) continue;

				if (this.blockDamageController.getHealth(root) === undefined) continue;
				if (!this.blockDamageController.isPvpEnabled(plr.UserId)) continue;

				for (const p of Workspace.GetPartBoundsInRadius(root.Position, PlayerIgnite.radius, overlapParams)) {
					if (!LocalInstanceData.HasLocalTag(p, "Burn")) continue;
					for (const limb of character.GetChildren()) {
						if (limb.IsA("BasePart")) this.burn(limb);
					}
					break;
				}
			}
		});
	}

	/** Returns the affected blocks and players (deduped). */
	extinguishArea(position: Vector3, radius: number): LuaTuple<[blocks: BlockModel[], players: Player[]]> {
		const players: Player[] = [];
		for (const plr of Players.GetPlayers()) {
			const char = plr.Character;
			if (!char) continue;
			const root = char.PrimaryPart;
			if (!root || root.Position.sub(position).Magnitude > radius) continue;

			if (this.extinguishPlayer(plr)) players.push(plr);
		}

		const blocks: BlockModel[] = [];
		for (const p of Workspace.GetPartBoundsInRadius(position, radius, overlapParams)) {
			if (!LocalInstanceData.HasLocalTag(p, "Burn")) continue;
			const block = this.extinguish(p);
			if (block && !blocks.contains(block)) blocks.push(block);
		}

		return $tuple(blocks, players);
	}
	/** Puts out every burning limb on a character. Returns whether anything was alight to begin with. */
	extinguishPlayer(player: Player): boolean {
		const character = player.Character;
		if (!character) return false;

		let wasBurning = false;
		for (const limb of character.GetDescendants()) {
			if (!limb.IsA("BasePart")) continue;
			if (!LocalInstanceData.HasLocalTag(limb, "Burn")) continue;

			this.extinguish(limb);
			wasBurning = true;
		}

		return wasBurning;
	}

	/** Whether a cloud still covers this point; expired ones are dropped on the way past. */
	private isSuppressed(position: Vector3): boolean {
		const now = time();
		let suppressed = false;

		for (let i = this.clouds.size() - 1; i >= 0; i--) {
			const cloud = this.clouds[i];
			if (now >= cloud.until) {
				this.clouds.remove(i);
				continue;
			}

			if (!suppressed && position.sub(cloud.position).Magnitude <= cloud.radius) suppressed = true;
		}

		return suppressed;
	}

	/** Ignites the one part; spreading is the heat the burning block conducts into its welded neighbours. */
	burn(part: BasePart) {
		if (part.Anchored) return;
		if (LocalInstanceData.HasLocalTag(part, "Burn")) return;
		if (this.isSuppressed(part.Position)) return;
		LocalInstanceData.AddLocalTag(part, "Burn");
		if (CustomDebrisService.exists(part)) CustomDebrisService.remove(part);

		const darkness = math.random(0, 50);
		part.Color = Color3.fromRGB(darkness, darkness, darkness);
		this.fireEffect.send(part, { part });

		const block = BlockManager.tryGetBlockModelByPart(part);
		this.blockDamageController.markBurning(block ?? part);
	}

	extinguish(part: BasePart): BlockModel | undefined {
		LocalInstanceData.RemoveLocalTag(part, "Burn");
		this.fireEffect.extinguish(part);

		const block = BlockManager.tryGetBlockModelByPart(part);
		this.blockDamageController.unmarkBurning(block ?? part);
		return block;
	}
}
