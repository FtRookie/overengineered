import { RunService } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { ArgsSignal } from "engine/shared/event/Signal";
import { CustomRemotes } from "shared/Remotes";

/* 
                0   0
                |   |
            ____|___|____
         0  |~ ~ ~ ~ ~ ~|   0
         |  |           |   |
      ___|__|___________|___|__
      |/\/\/\/\/\/\/\/\/\/\/\/|
  0   |       H a p p y       |   0
  |   |/\/\/\/\/\/\/\/\/\/\/\/|   |
 _|___|_______________________|___|__
|/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/|
|                                   |
|      B i r t h d a y @i3ym !      |
| ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ |
|___________________________________|

18.11.2025
- @samlovebutter
*/

export type damageType = Partial<{
	//absolute units
	heatDamage: number;
	impactDamage: number;
	explosiveDamage: number;
}>;

type AccumulatedDamage = { heatDamage: number; impactDamage: number; explosiveDamage: number };

/**
 * Client-side entry point for dealing block damage. The server owns all health and breaking
 * (see ServerBlockDamageController) — this only forwards damage requests and surfaces the
 * server's "block broke" notifications.
 *
 * Damage is accumulated per block and flushed once per frame, so high-frequency sources (a laser
 * hitting every tick) cost one batched remote per frame rather than one remote per hit.
 */

@injectable
export class BlockDamageController extends HostedService {
	static instance?: BlockDamageController;

	/** Fires when the server reports a block was destroyed. Drives client reactions like TNT chains. */
	readonly blockBroken = new ArgsSignal<[BlockModel]>();

	private pendingDamage = new Map<BlockModel, AccumulatedDamage>();

	constructor() {
		super();
		BlockDamageController.instance = this;

		this.event.subscribe(CustomRemotes.damageSystem.broken.invoked, (block) => this.blockBroken.Fire(block));

		this.event.subscribe(RunService.Heartbeat, () => this.flush());
	}

	/** Request damage on a block. Accumulated and sent to the server on the next frame. */
	applyDamage(block: BlockModel, damage: damageType) {
		const acc = this.pendingDamage.getOrSet(block, () => ({ heatDamage: 0, impactDamage: 0, explosiveDamage: 0 }));
		acc.heatDamage += damage.heatDamage ?? 0;
		acc.impactDamage += damage.impactDamage ?? 0;
		acc.explosiveDamage += damage.explosiveDamage ?? 0;
	}

	private flush() {
		if (this.pendingDamage.size() === 0) return;

		const batch: { readonly block: BlockModel; readonly damage: damageType }[] = [];
		for (const [block, damage] of this.pendingDamage) batch.push({ block, damage });
		this.pendingDamage = new Map();

		CustomRemotes.damageSystem.damage.send(batch);
	}
}
