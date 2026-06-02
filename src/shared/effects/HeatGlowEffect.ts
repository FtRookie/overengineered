import { RunService } from "@rbxts/services";
import { Materials } from "engine/shared/data/Materials";
import { BlockManager } from "shared/building/BlockManager";
import { EffectBase } from "shared/effects/EffectBase";
import { CustomRemotes } from "shared/Remotes";
import type { EffectCreator } from "shared/effects/EffectBase";

type Args = {
	readonly block: BlockModel;
	readonly intensity: number; // 0–1, where 1 = ignition threshold
	readonly fadeTime?: number; // only present when intensity = 0; seconds to restore original color
};

/** Captured original look of a part, restored as the block cools below full heat. */
type SavedAppearance = {
	readonly color: Color3;
	readonly material: Enum.Material;
};

const HOT_COLOR = new Color3(1, 0.2, 0);
const LIGHT_COLOR = new Color3(1, 0.7, 0.2);
const CHAR_COLOR = Color3.fromRGB(25, 25, 25); // burnt-black left behind once a block catches fire
const HEAT_RATE = 3; // intensity units per second when heating up
const FADE_TIME = 0.5; // fallback fade duration if server doesn't supply one

@injectable
export class HeatGlowEffect extends EffectBase<Args> {
	/** Captured once on first encounter — never overwritten so reheat always restores to true originals. */
	private readonly savedAppearance = new Map<BlockModel, Map<BasePart, SavedAppearance>>();
	private readonly activeLight = new Map<BlockModel, PointLight>();
	private readonly targetIntensity = new Map<BlockModel, number>();
	private readonly currentIntensity = new Map<BlockModel, number>();
	/** Rate at which currentIntensity drains to 0 when target = 0 (intensity units / second). */
	private readonly cooldownRate = new Map<BlockModel, number>();
	/** Blocks that have caught fire — charred and permanently released so the glow stops fighting the fire. */
	private readonly burnedBlocks = new Set<BlockModel>();
	/** Blocks currently switched to Neon at full heat — gates the Material write to the threshold crossing only. */
	private readonly neonBlocks = new Set<BlockModel>();

	private renderConn: RBXScriptConnection | undefined;
	/** Reused across frames to avoid a per-frame allocation in step(). */
	private readonly toRemove: BlockModel[] = [];

	constructor(@inject creator: EffectCreator) {
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
		if (!(Materials.Properties[material.Name]?.heatGlow ?? false)) return;

		if (!this.savedAppearance.has(block)) {
			const appearance = new Map<BasePart, SavedAppearance>();
			for (const desc of block.GetDescendants()) {
				if (desc.IsA("BasePart")) appearance.set(desc, { color: desc.Color, material: desc.Material });
			}
			this.savedAppearance.set(block, appearance);
			block.Destroying.Once(() => {
				this.burnedBlocks.delete(block);
				this.removeBlock(block);
			});
		}

		if (intensity <= 0) {
			if (fadeTime === 0) {
				// Ignition — char the parts black and release; fire takes over the visuals.
				this.charAndRelease(block);
				return;
			}
			this.targetIntensity.set(block, 0);
			const duration = math.max(fadeTime ?? FADE_TIME, 0.016);
			this.cooldownRate.set(block, 1 / duration);
		} else {
			this.targetIntensity.set(block, intensity);
			this.ensureLight(block);
		}

		this.ensureStepLoop();
	}

	private ensureLight(block: BlockModel): void {
		if (this.activeLight.has(block)) return;
		const pp = block.PrimaryPart;
		if (!pp) return;

		// fixme: should be a Studio asset (cloned template), not inline-created
		const light = new Instance("PointLight");
		light.Brightness = 0;
		light.Color = LIGHT_COLOR;
		light.Range = 6;
		light.Parent = pp;
		this.activeLight.set(block, light);
	}

	private ensureStepLoop(): void {
		if (this.renderConn) return;
		this.renderConn = RunService.PreRender.Connect((dt) => this.step(dt));
	}

	private step(dt: number): void {
		if (this.targetIntensity.count() === 0) {
			this.renderConn?.Disconnect();
			this.renderConn = undefined;
			return;
		}

		table.clear(this.toRemove);

		for (const [block, target] of this.targetIntensity) {
			if (block.Parent === undefined) {
				this.toRemove.push(block);
				continue;
			}

			// A block that has caught fire (spread, kill plane, etc.) gets charred and released so
			// the glow stops overwriting the fire's burnt-black with its orange lerp. Removing the
			// current key mid-`pairs` is safe in Luau.
			if (this.isBlockBurning(block)) {
				this.charAndRelease(block);
				continue;
			}

			const current = this.currentIntensity.get(block) ?? 0;
			let nextI: number;

			if (current < target) {
				nextI = math.min(current + HEAT_RATE * dt, target);
			} else if (current > target) {
				// Drain toward the target (not to 0), so a steady-hot block holds its glow.
				const rate = this.cooldownRate.get(block) ?? 1 / FADE_TIME;
				nextI = math.max(current - rate * dt, target);
			} else {
				nextI = current; // settled — hold, skip the redundant re-apply below
			}

			if (nextI !== current) {
				this.currentIntensity.set(block, nextI);
				this.applyVisuals(block, nextI);
			}

			if (nextI <= 0 && target <= 0) this.toRemove.push(block);
		}
		for (const block of this.toRemove) this.removeBlock(block);
	}

	private applyVisuals(block: BlockModel, intensity: number): void {
		const light = this.activeLight.get(block);
		if (light) light.Brightness = intensity * 3;

		// fixme: this could lead to blocks being given wrong colors
		const appearance = this.savedAppearance.get(block);
		if (!appearance) return;

		// Full saturation reads as molten — switch to Neon so the block self-illuminates; anything cooler
		// restores the captured material. Material is binary, so write it only on the threshold crossing
		// (Color must lerp every frame, but the material flips at most twice per heat cycle).
		const fullHeat = intensity >= 1;
		const isNeon = this.neonBlocks.has(block);
		const setNeon = fullHeat && !isNeon;
		const restore = !fullHeat && isNeon;

		for (const [part, saved] of appearance) {
			part.Color = saved.color.Lerp(HOT_COLOR, intensity);
			if (setNeon) part.Material = Enum.Material.Neon;
			else if (restore) part.Material = saved.material;
		}

		if (setNeon) this.neonBlocks.add(block);
		else if (restore) this.neonBlocks.delete(block);
	}

	/** A part is on fire once FireEffect has parented its tagged instances to it. */
	private isBlockBurning(block: BlockModel): boolean {
		const appearance = this.savedAppearance.get(block);
		if (!appearance) return false;
		for (const [part] of appearance) {
			for (const child of part.GetChildren()) {
				if (child.GetAttribute("_FireEffect") === true) return true;
			}
		}
		return false;
	}

	/** Paint the block's parts burnt-black and permanently release it so the fire owns the visuals. */
	private charAndRelease(block: BlockModel): void {
		const appearance = this.savedAppearance.get(block);
		if (appearance) {
			// Char the colour only — the material is left as-is so a block that ignited at full heat keeps its
			// Neon glow rather than reverting to its original material.
			for (const [part] of appearance) part.Color = CHAR_COLOR;
		}
		this.burnedBlocks.add(block);
		this.removeBlock(block);
	}

	private removeBlock(block: BlockModel): void {
		this.targetIntensity.delete(block);
		this.currentIntensity.delete(block);
		this.cooldownRate.delete(block);
		this.savedAppearance.delete(block);
		this.neonBlocks.delete(block);
		this.activeLight.get(block)?.Destroy();
		this.activeLight.delete(block);
	}
}
