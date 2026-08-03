import { HostedService } from "engine/shared/di/HostedService";
import { collectDestructibles, destructibleDefaults } from "shared/environment/DestructibleInstanceController";
import { CustomRemotes } from "shared/Remotes";
import type { DestructibleSpec } from "shared/environment/DestructibleInstanceController";

type Registered = {
	readonly spec: DestructibleSpec;
	readonly originalPivot: CFrame;
	/** Anchor state each part started with — some are deliberately loose in the prefab. */
	readonly anchors: ReadonlyMap<BasePart, boolean>;
};

/**
 * Owns every map destructible's state.
 *
 * Clients only report the collisions they see, so the server does no per-contact work — but it makes all the
 * changes itself. A client cannot unanchor a server-owned part: the write does not replicate, so the part
 * renders loose on that client while the server holds it anchored, leaving it frozen in mid-air. Doing it here
 * means the physics replicates normally, every player sees the same fall, and a joining player sees the
 * current world with no catch-up message.
 */
@injectable
export class ServerDestructibleController extends HostedService {
	private readonly registry = new Map<Model, Registered>();
	private readonly broken = new Set<Model>();

	constructor() {
		super();

		this.onEnable(() => {
			for (const [model, spec] of collectDestructibles()) {
				const loose =
					spec.config?.loose?.(model) ??
					model.GetDescendants().filter((p): p is BasePart => p.IsA("BasePart"));

				const anchors = new Map<BasePart, boolean>();
				for (const part of loose) anchors.set(part, part.Anchored);

				this.registry.set(model, { spec, originalPivot: model.GetPivot(), anchors });
			}
		});

		// A raw client payload: anything that is not a registered destructible is refused rather than acted
		// on, so a crafted send cannot knock over an arbitrary model for everyone.
		this.event.subscribe(CustomRemotes.destructibles.hit.invoked, (_, arg) => {
			if (!typeIs(arg, "table")) return;

			const model = arg.model;
			if (!typeIs(model, "Instance") || !model.IsA("Model")) return;

			const entry = this.registry.get(model);
			if (!entry || this.broken.has(model)) return;

			this.knockOver(model, entry);
		});
	}

	private knockOver(model: Model, entry: Registered) {
		this.broken.add(model);

		for (const [part] of entry.anchors) {
			if (part.Parent !== undefined) part.Anchored = false;
		}

		entry.spec.config?.onBreak?.(model);

		task.delay(entry.spec.config?.respawnTime ?? destructibleDefaults.respawnTime, () => {
			if (this.isDestroyed() || !this.broken.delete(model)) return;
			if (model.Parent === undefined) return;

			model.PivotTo(entry.originalPivot);
			for (const [part, anchored] of entry.anchors) {
				if (part.Parent === undefined) continue;

				part.AssemblyLinearVelocity = Vector3.zero;
				part.AssemblyAngularVelocity = Vector3.zero;
				part.Anchored = anchored;
			}

			entry.spec.config?.onRespawn?.(model);
		});
	}
}
