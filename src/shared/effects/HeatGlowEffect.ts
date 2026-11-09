import { RunService } from "@rbxts/services";
import { Materials } from "engine/shared/data/Materials";
import { BlockManager } from "shared/building/BlockManager";
import { EffectBase } from "shared/effects/EffectBase";
import { CustomRemotes } from "shared/Remotes";
import { PartUtils } from "shared/utils/PartUtils";
import type { EffectCreator } from "shared/effects/EffectBase";

type Args = {
	readonly block: BlockModel;
	readonly intensity: number; // 0–1, where 1 = ignition threshold
	// Read only at intensity 0: seconds to restore the original colour; absent = ignition.
	readonly fadeTime?: number;
};

/** Part's original look, restored as the block cools below full heat. */
type SavedAppearance = {
	readonly color: Color3;
	readonly material: Enum.Material;
};

/** One glowing block, dropped as a whole by removeBlock. */
type Glow = {
	// Captured once on first encounter; never overwritten so reheat restores true originals.
	readonly appearance: Map<BasePart, SavedAppearance>;
	// Material opts into the molten-Neon look at full heat (thermalProperties.neonGlow).
	readonly neonAllowed: boolean;
	// Switched to Neon at full heat; gates the Material write to the threshold crossing only.
	neon: boolean;
	light?: PointLight;
	target: number;
	current?: number;
	// current's drain rate when target = 0 (intensity units/second).
	cooldownRate?: number;
};

const HOT_COLOR = new Color3(1, 0.2, 0);
const LIGHT_COLOR = new Color3(1, 0.7, 0.2);
const CHAR_COLOR = Color3.fromRGB(25, 25, 25); // burnt-black left behind once a block catches fire
const HEAT_RATE = 3; // intensity units per second when heating up
const FADE_TIME = 0.5; // drain duration when a block has no recorded cooldown rate

@injectable
export class HeatGlowEffect extends EffectBase<Args> {
	private readonly glows = new Map<BlockModel, Glow>();
	// Caught fire: charred and permanently released so the glow stops fighting the fire.
	private readonly burnedBlocks = new Set<BlockModel>();

	private renderConn: RBXScriptConnection | undefined;
	// Reused across frames to avoid a per-frame allocation in step().
	private readonly toRemove: BlockModel[] = [];

	constructor(@inject creator: EffectCreator) {
		// fixme: unreliable channel, so a dropped fade/char strands the glow at its last target forever
		super(creator, "heat_glow_effect");

		if (RunService.IsClient()) {
			CustomRemotes.damageSystem.broken.invoked.Connect((block) => this.removeBlock(block));
		}
	}

	override justRun({ block, intensity, fadeTime }: Args): void {
		if (!RunService.IsClient()) return;
		if (!block || this.burnedBlocks.has(block)) return;

		const material = BlockManager.manager.material.get(block);
		if (!material) return;
		const thermal = Materials.Properties[material.Name]?.thermalProperties;
		if (!(thermal?.heatGlow ?? false)) return;

		let glow = this.glows.get(block);
		if (!glow) {
			const appearance = new Map<BasePart, SavedAppearance>();
			PartUtils.applyToAllDescendantsOfType("BasePart", block, (desc) =>
				appearance.set(desc, { color: desc.Color, material: desc.Material }),
			);
			glow = { appearance, neonAllowed: thermal?.neonGlow ?? false, neon: false, target: 0 };
			this.glows.set(block, glow);
			block.Destroying.Once(() => {
				this.burnedBlocks.delete(block);
				this.removeBlock(block);
			});
		}

		if (intensity <= 0) {
			if (fadeTime === undefined) {
				// Ignition: char parts black and release; fire takes over the visuals.
				this.charAndRelease(block, glow);
				return;
			}
			glow.target = 0;
			const duration = math.max(fadeTime, 0.016);
			glow.cooldownRate = 1 / duration;
		} else {
			glow.target = intensity;
			this.ensureLight(block, glow);
		}

		this.ensureStepLoop();
	}

	private ensureLight(block: BlockModel, glow: Glow): void {
		if (glow.light) return;
		const pp = block.PrimaryPart;
		if (!pp) return;

		// fixme: should be a Studio asset (cloned template), not inline-created
		const light = new Instance("PointLight");
		light.Brightness = 0;
		light.Color = LIGHT_COLOR;
		light.Range = 6;
		light.Parent = pp;
		glow.light = light;
	}

	private ensureStepLoop(): void {
		if (this.renderConn) return;
		this.renderConn = RunService.PreRender.Connect((dt) => this.step(dt));
	}

	private step(dt: number): void {
		if (this.glows.size() === 0) {
			this.renderConn?.Disconnect();
			this.renderConn = undefined;
			return;
		}

		table.clear(this.toRemove);

		for (const [block, glow] of this.glows) {
			if (block.Parent === undefined) {
				this.toRemove.push(block);
				continue;
			}

			// A block that caught fire (spread, kill plane, etc.) gets charred and released so the glow
			// stops overwriting the fire's burnt-black with its orange lerp. Removing the current key
			// mid-`pairs` is safe in Luau.
			if (this.isBlockBurning(glow)) {
				this.charAndRelease(block, glow);
				continue;
			}

			const target = glow.target;
			const current = glow.current ?? 0;
			let nextI: number;

			if (current < target) {
				nextI = math.min(current + HEAT_RATE * dt, target);
			} else if (current > target) {
				// Drain toward target (not 0), so a steady-hot block holds its glow.
				const rate = glow.cooldownRate ?? 1 / FADE_TIME;
				nextI = math.max(current - rate * dt, target);
			} else {
				nextI = current; // settled — hold, skip the redundant re-apply below
			}

			if (nextI !== current) {
				glow.current = nextI;
				this.applyVisuals(glow, nextI);
			}

			if (nextI <= 0 && target <= 0) this.toRemove.push(block);
		}
		for (const block of this.toRemove) this.removeBlock(block);
	}

	private applyVisuals(glow: Glow, intensity: number): void {
		if (glow.light) glow.light.Brightness = intensity * 3;

		// Full saturation reads as molten: switch to Neon so the block self-illuminates; cooler restores
		// the captured material. Material is binary, so write it only on the threshold crossing (Color
		// lerps every frame; material flips at most twice per heat cycle).
		const fullHeat = intensity >= 1;
		const setNeon = fullHeat && !glow.neon && glow.neonAllowed;
		const restore = !fullHeat && glow.neon;

		// fixme: this could lead to blocks being given wrong colors
		for (const [part, saved] of glow.appearance) {
			part.Color = saved.color.Lerp(HOT_COLOR, intensity);
			if (setNeon) part.Material = Enum.Material.Neon;
			else if (restore) part.Material = saved.material;
		}

		if (setNeon) glow.neon = true;
		else if (restore) glow.neon = false;
	}

	/** On fire once FireEffect has parented its tagged instances to it. */
	private isBlockBurning(glow: Glow): boolean {
		for (const [part] of glow.appearance) {
			for (const child of part.GetChildren()) {
				if (child.GetAttribute("_FireEffect") === true) return true;
			}
		}
		return false;
	}

	/** Paint parts burnt-black and permanently release so the fire owns the visuals. */
	private charAndRelease(block: BlockModel, glow: Glow): void {
		// Colour only — material left as-is so a block that ignited at full heat keeps its Neon glow
		// rather than reverting to its original material.
		for (const [part] of glow.appearance) part.Color = CHAR_COLOR;
		this.burnedBlocks.add(block);
		this.removeBlock(block);
	}

	private removeBlock(block: BlockModel): void {
		this.glows.get(block)?.light?.Destroy();
		this.glows.delete(block);
	}
}
