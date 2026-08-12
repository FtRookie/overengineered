import { Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { destructibleSpecs } from "shared/environment/Destructibles";
import { CustomRemotes } from "shared/Remotes";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

export type DestructibleConfig = {
	readonly respawnTime?: number; // seconds before the model is put back
	readonly minimumSpeed?: number; // speed a part must be travelling to knock this over
	// Part whose `Touched` drives the break. Defaults to the model's `PrimaryPart`.
	readonly trigger?: (model: Model) => BasePart | undefined;
	// Parts unanchored on break. Defaults to every `BasePart` in the model.
	readonly loose?: (model: Model) => readonly BasePart[];
	// Extra work when it goes over — particles, sound, lights out. Runs on the server.
	readonly onBreak?: (model: Model) => void;
	// Extra work when it comes back; the pivot and anchoring are already restored. Runs on the server.
	readonly onRespawn?: (model: Model) => void;
};

export type DestructibleSpec = {
	// Save key for this type's toggle. Renaming it resets that toggle for every player.
	readonly id: string;
	readonly displayName: string; // row label in the environment settings
	readonly names: string | readonly string[];
	readonly config?: DestructibleConfig;
};

export const destructibleDefaults = {
	respawnTime: 35,
	minimumSpeed: 50,
} as const;

/** Every `Model` under Workspace matching a spec's names. Both sides build this from the same specs. */
export const collectDestructibles = (): Map<Model, DestructibleSpec> => {
	const byName = new Map<string, DestructibleSpec>();
	for (const spec of destructibleSpecs) {
		const names = typeIs(spec.names, "string") ? [spec.names] : spec.names;
		for (const name of names) byName.set(name.lower(), spec);
	}

	const found = new Map<Model, DestructibleSpec>();
	for (const model of Workspace.GetDescendants()) {
		if (!model.IsA("Model")) continue;

		const spec = byName.get(model.Name.lower());
		if (spec) found.set(model, spec);
	}

	return found;
};

/**
 * Detects hits on map destructibles and reports them. Detection only — every state change is the server's,
 * because a client unanchoring a server-owned part does not replicate: it renders loose here while the server
 * holds it anchored and hangs frozen in mid-air.
 *
 * Turning a type off in settings stops this client reporting, not seeing — the server's changes replicate
 * either way.
 */
@injectable
export class DestructibleInstanceController extends HostedService {
	constructor(@tryInject private readonly playerData?: PlayerDataStorage) {
		super();

		this.onEnable(() => {
			for (const [model, spec] of collectDestructibles()) this.watch(model, spec);
		});
	}

	/** Read per contact rather than cached, so toggling a type off stops the next hit, not the next join. */
	private isTypeEnabled(id: string): boolean {
		return this.playerData?.config.get().environment.destructibles[id] ?? true;
	}

	private watch(model: Model, spec: DestructibleSpec): void {
		const trigger = spec.config?.trigger?.(model) ?? model.PrimaryPart;
		if (!trigger) return;

		const minimumSpeed = spec.config?.minimumSpeed ?? destructibleDefaults.minimumSpeed;

		this.event.subscribe(trigger.Touched, (hit) => {
			if (!hit.IsA("BasePart")) return;
			if (!this.isTypeEnabled(spec.id)) return;
			if (hit.AssemblyLinearVelocity.Magnitude < minimumSpeed) return;

			// Server ignores a repeat while the model is already down, so no local debounce needed.
			CustomRemotes.destructibles.hit.send({ model });
		});
	}
}
