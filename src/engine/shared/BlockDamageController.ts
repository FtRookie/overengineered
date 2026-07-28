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

export type BlockDamage = Partial<{
	heatDamage: number;
	impactDamage: number;
	explosiveDamage: number;
	impulseHeat: boolean;
}>;

type AccumulatedDamage = {
	heatDamage: number;
	impactDamage: number;
	explosiveDamage: number;
	impulseHeat: boolean;
};

/** Handles Client side damage requests
 *
 * Damage is accumulated per block and flushed once per frame
 * @client
 */
@injectable
export class BlockDamageController extends HostedService {
	static instance?: BlockDamageController;

	readonly blockBroken = new ArgsSignal<[BlockModel]>();

	private pendingDamage = new Map<Instance, AccumulatedDamage>();

	constructor() {
		super();
		BlockDamageController.instance = this;
		this.event.subscribe(CustomRemotes.damageSystem.broken.invoked, (block) => this.blockBroken.Fire(block));
		this.event.subscribe(RunService.PostSimulation, () => this.flush());
	}

	/** Accumulated and sent to the server next frame. */
	applyDamage(block: Instance, damage: BlockDamage) {
		const acc = this.pendingDamage.getOrSet(block, () => ({
			heatDamage: 0,
			impactDamage: 0,
			explosiveDamage: 0,
			impulseHeat: false,
		}));
		acc.heatDamage += damage.heatDamage ?? 0;
		acc.impulseHeat ||= damage.impulseHeat ?? false;
		acc.impactDamage += damage.impactDamage ?? 0;
		acc.explosiveDamage += damage.explosiveDamage ?? 0;
	}

	private flush() {
		if (this.pendingDamage.size() === 0) return;

		const batch: { readonly block: Instance; readonly damage: BlockDamage }[] = [];
		for (const [block, damage] of this.pendingDamage) batch.push({ block, damage });
		this.pendingDamage = new Map();

		CustomRemotes.damageSystem.damage.send(batch);
	}
}
