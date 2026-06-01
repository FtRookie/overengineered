import { RunService } from "@rbxts/services";
import { BlockManager } from "shared/building/BlockManager";
import { MaterialData } from "shared/data/MaterialData";
import { EffectBase } from "shared/effects/EffectBase";
import { CustomRemotes } from "shared/Remotes";
import type { EffectCreator } from "shared/effects/EffectBase";

type Args = {
	readonly block: BlockModel;
	readonly intensity: number; // 0–1, where 1 = ignition threshold
	readonly fadeTime?: number; // only present when intensity = 0; seconds to restore original color
};

const HOT_COLOR = new Color3(1, 0.2, 0);
const LIGHT_COLOR = new Color3(1, 0.7, 0.2);
const HEAT_RATE = 3; // intensity units per second when heating up
const FADE_TIME = 0.5; // fallback fade duration if server doesn't supply one

@injectable
export class HeatGlowEffect extends EffectBase<Args> {
	/** Captured once on first encounter — never overwritten so reheat always restores to true originals. */
	private readonly savedColors = new Map<BlockModel, Map<BasePart, Color3>>();
	private readonly activeLight = new Map<BlockModel, PointLight>();
	private readonly targetIntensity = new Map<BlockModel, number>();
	private readonly currentIntensity = new Map<BlockModel, number>();
	/** Rate at which currentIntensity drains to 0 when target = 0 (intensity units / second). */
	private readonly cooldownRate = new Map<BlockModel, number>();

	private heartbeatConn: RBXScriptConnection | undefined;

	constructor(@inject creator: EffectCreator) {
		super(creator, "heat_glow_effect");

		if (RunService.IsClient()) {
			CustomRemotes.damageSystem.broken.invoked.Connect((block) => {
				if (this.targetIntensity.has(block)) this.removeBlock(block);
			});
		}
	}

	override justRun({ block, intensity, fadeTime }: Args): void {
		if (!RunService.IsClient()) return;
		if (!block) return;

		const material = BlockManager.manager.material.get(block);
		if (!material) return;
		if (!(MaterialData.Properties[material.Name]?.heatGlow ?? false)) return;

		if (!this.savedColors.has(block)) {
			const colors = new Map<BasePart, Color3>();
			for (const desc of block.GetDescendants()) {
				if (desc.IsA("BasePart")) colors.set(desc, desc.Color);
			}
			this.savedColors.set(block, colors);
			block.Destroying.Once(() => this.removeBlock(block));
		}

		if (intensity <= 0) {
			this.targetIntensity.set(block, 0);
			const duration = math.max(fadeTime ?? FADE_TIME, 0.016);
			this.cooldownRate.set(block, 1 / duration);
		} else {
			this.targetIntensity.set(block, intensity);
			this.ensureLight(block);
		}

		this.ensureHeartbeat();
	}

	private ensureLight(block: BlockModel): void {
		if (this.activeLight.has(block)) return;
		const pp = block.PrimaryPart;
		if (!pp) return;

		const light = new Instance("PointLight");
		light.Brightness = 0;
		light.Color = LIGHT_COLOR;
		light.Range = 6;
		light.Parent = pp;
		this.activeLight.set(block, light);
	}

	private ensureHeartbeat(): void {
		if (this.heartbeatConn) return;
		this.heartbeatConn = RunService.Heartbeat.Connect((dt) => this.step(dt));
	}

	private step(dt: number): void {
		if (this.targetIntensity.count() === 0) {
			this.heartbeatConn?.Disconnect();
			this.heartbeatConn = undefined;
			return;
		}

		const toRemove: BlockModel[] = [];

		for (const [block, target] of this.targetIntensity) {
			if (block.Parent === undefined) {
				toRemove.push(block);
				continue;
			}

			const current = this.currentIntensity.get(block) ?? 0;
			let nextI: number;

			if (target > current) {
				nextI = math.min(current + HEAT_RATE * dt, target);
			} else {
				const rate = this.cooldownRate.get(block) ?? 1 / FADE_TIME;
				nextI = math.max(current - rate * dt, 0);
			}

			this.currentIntensity.set(block, nextI);
			this.applyVisuals(block, nextI);

			if (nextI <= 0 && target <= 0) toRemove.push(block);
		}

		for (const block of toRemove) this.removeBlock(block);
	}

	private applyVisuals(block: BlockModel, intensity: number): void {
		const light = this.activeLight.get(block);
		if (light) light.Brightness = intensity * 2;

		const origColors = this.savedColors.get(block);
		if (!origColors) return;
		for (const [part, origColor] of origColors) {
			part.Color = origColor.Lerp(HOT_COLOR, intensity);
		}
	}

	private removeBlock(block: BlockModel): void {
		this.targetIntensity.delete(block);
		this.currentIntensity.delete(block);
		this.cooldownRate.delete(block);
		this.savedColors.delete(block);
		this.activeLight.get(block)?.Destroy();
		this.activeLight.delete(block);
	}
}
