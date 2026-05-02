import { RunService } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { BlockManager } from "shared/building/BlockManager";
import { RemoteEvents } from "shared/RemoteEvents";
import { TagUtils } from "shared/utils/TagUtils";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { SparksEffect } from "shared/effects/SparksEffect";

export type damageType = Partial<{
	//ansolute units
	heatDamage: number;
	impactDamage: number;
	explosiveDamage: number;
}>;

type health = number;

const blockMaxHealthList = new Map<BlockModel, health>();
const blockHealthList = new Map<BlockModel, health>();

const checkIfCanBeUnwelded = (damage: number, blockHealth: number) => blockHealth > 0 && damage > blockHealth;
const checkIfCanBeDestroyed = (damage: number, blockHealth: number) => blockHealth > 0 && damage > blockHealth * 2;
const testYourLuck = (num: number): boolean => math.random() < num;
const explode = (part: BasePart, radius: number) =>
	RemoteEvents.Explode.send({
		part,
		radius,
		pressure: 1,
		isFlammable: false,
	});

// // handle block health init here
// if (RunService.IsServer()) {
// 	Players.PlayerAdded.Connect((p) => {
// 		const dmg = blockHealthList.map((block, health) => ({ block, health }));
// 		CustomRemotes.damageSystem.healthInit.send(p, dmg);
// 	});
// }

// if (RunService.IsClient()) {
// 	CustomRemotes.damageSystem.healthInit.invoked.Connect((arr) => {
// 		for (const v of arr) blockHealthList.set(v.block, v.health);
// 	});
// }

/* hi
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

const blockMaterialProperties = new Map<BlockModel, PhysicalProperties>();

//5% of the health
let minimalDamageModifier = 0.05;
let blockStrength = 900;
@injectable
export class BlockDamageController extends HostedService {
	private partBreakQueue: BasePart[] = [];
	private igniteBlocks: Map<BlockModel, number> = new Map();

	constructor(
		@inject private readonly sparksEffect: SparksEffect,
		@inject private readonly blockList: BlockList,
		@inject private readonly playerDataStorage: PlayerDataStorage,
	) {
		super();

		//init values
		this.event.subscribeObservable(
			playerDataStorage.config,
			(config) => {
				blockStrength = config.blockHealthModifier;
				minimalDamageModifier = config.blockMinimalDamageThreshold / 100;
			},
			true,
		);

		this.event.subscribe(RunService.Heartbeat, () => {
			if (this.partBreakQueue.size() === 0) return;
			for (const [block, heatDmage] of this.igniteBlocks) {
				// dunno what to do with the explosions so far
				// each explosion probably destroys welds
				// if (explosiveDamage > 0) explode(pp, explosiveDamage); //explode here
				const properties = blockMaterialProperties.get(block);
				if (!properties) continue; //throw "Trying to get properties for a destroyed block";

				const ignitionChance = //
					//basically density == chance, because density can't be bigger than 100, right? right..?
					// (1 - (density[0.01...100] / 100)) * fireChance
					(1 - properties.Density / 100) * math.clamp(heatDmage, 0, 1);

				if (testYourLuck(ignitionChance)) {
					RemoteEvents.Burn.send(block.GetDescendants().filter((v) => v.IsA("BasePart"))); //put on fire here
				}

				this.igniteBlocks.set(block, 0);
			}

			RemoteEvents.ImpactBreak.send(this.partBreakQueue);
			this.partBreakQueue = [];
		});
	}

	getHealth(block: BlockModel) {
		return blockHealthList.get(block);
	}

	initHealth(block: BlockModel) {
		const pp = block.PrimaryPart;
		if (!pp) throw "Trying to init block health with no PrimaryPart";

		const material = BlockManager.manager.material.get(block);
		const properties = new PhysicalProperties(material);

		blockMaterialProperties.set(block, properties);
		block.DescendantRemoving.Once(() => blockMaterialProperties.delete(block));

		// get smallest because it doesn't make sense for a giant
		// metal sheet to have 50k hp
		// also it doesn't make sense for a thing to get destroyed if it's too small
		// so 0.7 min to balance that
		const sizeModifier = math.max(pp.Size.findMin(), 0.7);

		// even more magic numbers below
		// it's a fine-tuned system

		// SOOO many modifiers
		let blockHealth =
			blockStrength *
			properties.Density * // div by 5 because it's too strong
			(1 - properties.Elasticity) *
			properties.ElasticityWeight *
			sizeModifier;

		if (pp.HasTag(TagUtils.allTags.IMPACT_STRONG)) blockHealth *= 2;

		const blockID = BlockManager.manager.id.get(block);
		const physicsConfig = this.blockList.blocks[blockID]?.physics;
		const impactStrengthModifier = physicsConfig?.impactDamageStrength ?? 1;
		const forcedThresholdModifier = math.max(physicsConfig?.impactDamageStrength ?? 0, minimalDamageModifier);

		const randomHealthPercentMultiplier = 0.15;
		blockHealth *=
			1 +
			(math.random(0, 100) / 100) *
				randomHealthPercentMultiplier *
				impactStrengthModifier *
				forcedThresholdModifier;

		blockHealthList.set(block, blockHealth);
		blockMaxHealthList.set(block, blockHealth);
		this.igniteBlocks.set(block, 0);
	}

	forceBreakBlock(block: BlockModel) {
		for (const p of block.GetDescendants()) {
			if (!(p.IsA("BasePart") || p.IsA("UnionOperation") || p.IsA("MeshPart"))) continue;
			this.partBreakQueue.push(p);
		}
	}

	forceBreakParts(...parts: BasePart[]) {
		for (const p of parts) this.partBreakQueue.push(p);
	}

	isBroken(block: BlockModel) {
		const health = this.getHealth(block);
		if (!health) return;
		return health <= 0;
	}

	applyDamage(block: BlockModel, damage: damageType) {
		const { explosiveDamage = 0, impactDamage = 0, heatDamage = 0 } = damage;

		// check if it's not destroyed
		const currentHealth = blockHealthList.get(block);
		if (!currentHealth || currentHealth <= 0) return;

		// also check if it's not destroyed
		const pp = block.PrimaryPart;
		if (!pp) return; //throw "Trying to apply damage to a block with no PrimaryPart";

		// do effect if damage is lower than treshold
		const minMod = currentHealth * minimalDamageModifier;
		if (impactDamage < minMod && impactDamage > minMod * 0.5) {
			this.sparksEffect.send(pp, { part: pp });
			return;
		}

		const totalDamage = heatDamage + impactDamage + explosiveDamage;
		const newHealth = currentHealth - totalDamage;
		blockHealthList.set(block, newHealth);

		// if (checkIfCanBeDestroyed(totalDamage, currentHealth)) {
		// 	blockHealthList.delete(block);
		// 	block.Destroy(); //destroy here
		// 	// the only case when else if is useful
		// } else
		if (newHealth <= 0) {
			//unweld here
			this.forceBreakBlock(block);
			this.igniteBlocks.set(block, heatDamage);
		}
	}
}
