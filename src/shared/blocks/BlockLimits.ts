import { BlockManager } from "shared/building/BlockManager";

export type BlockLimitFamily = keyof typeof families;

// TypeScript has no integer type, and a `number` property cannot be narrowed to whole values without a
// generic the block definitions do not pass through. Enumerating the scale is what rejects a decimal.
/** Do not use decimals in cost or family definitions */
export type BlockCost = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** Per-player overrides keyed by family, structural so shared code need not reach into the server's row type. */
type Limits = { readonly [family in string]: number } | undefined;

/**
 * How many of a block a plot may hold. Resolved in one place because the placement check, the block list
 * counter and the locked-block gate all have to agree — when they drifted, a granted block showed `0/0`
 * while the server was happily accepting it.
 */
export namespace BlockLimits {
	/** The pool a block draws from. Without a `limitFamily` a block is its own family, keyed by its id. */
	export function familyOf(block: Block): string {
		return block.limitFamily ?? block.id;
	}

	/** The player's override for this block's family, falling back to the family pool or the block's own limit. */
	export function limitOf(block: Block, limits: Limits): number {
		const base = block.limitFamily === undefined ? block.limit : families[block.limitFamily];
		return limits?.[familyOf(block)] ?? base;
	}

	/** What one placed block draws from its pool, so a costlier block fills it faster. */
	export function costOf(block: Block): number {
		return block.cost ?? 1;
	}

	/** How much of `family` the plot already holds. Sums cost over every member, not just the id being placed. */
	export function countPlaced(placed: readonly BlockModel[], blockList: BlockList, family: string): number {
		let used = 0;
		for (const model of placed) {
			const block = blockList.blocks[BlockManager.manager.id.get(model)];
			if (block !== undefined && familyOf(block) === family) {
				used += costOf(block);
			}
		}

		return used;
	}
}

const families = {
	// structure
	basic: 15000,

	// drivetrain; the PBR set is capped harder because those models are far heavier
	wheel: 400,
	pbrwheel: 200,
	gear: 300,

	// joints and actuators, the expensive part being the physics constraint each one creates
	hinge: 1000,
	slider: 300,

	// propulsion and flight
	engine: 400,
	propellant: 200,
	wing: 500,

	// ordnance
	tnt: 200,

	// interaction
	button: 250,
	seat: 100,

	// utility
	lamp: 400,
	rope: 100,

	//memory
	memory: 1
	
} as const;
