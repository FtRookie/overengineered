import { Players } from "@rbxts/services";
import { Assert } from "engine/shared/Assert";
import { BlockManager } from "shared/building/BlockManager";
import { RemoteEvents } from "shared/RemoteEvents";
import type { SharedPlots } from "shared/building/SharedPlots";

/**
 * Forged calls against the detonation gates. These reach the same remotes any exploiter already can, so they
 * grant nothing; they exist because the gates are unreachable through normal play — the client's own
 * `hasExploded` and `disable()` stop a second detonation ever being sent.
 *
 * Each is observed by eye: the pass condition is what does or does not happen in the world. Every test picks a
 * TNT the server has not already consumed, so they do not depend on the order you run them in.
 */
export namespace Tests.TntValidationTests {
	const ownBlocks = (di: DIContainer): readonly BlockModel[] =>
		di.resolve<SharedPlots>().getPlotComponentByOwnerID(Players.LocalPlayer.UserId).getBlocks();

	const findBlock = (di: DIContainer, wanted: (block: BlockModel) => boolean): BlockModel => {
		const block = ownBlocks(di).find(wanted);
		Assert.notNull(block, "no matching block on your plot — build one and re-run");

		return block;
	};

	const partOf = (block: BlockModel): BasePart => {
		const part = block.PrimaryPart ?? block.FindFirstChildWhichIsA("BasePart");
		Assert.notNull(part, `${block.Name} has no BasePart`);

		return part;
	};

	const isTnt = (block: BlockModel) => (BlockManager.manager.id.get(block) as string).find("tnt")[0] !== undefined;
	/** The server marks a detonated block, and attributes replicate — so a fresh one is pickable from here. */
	const isFreshTnt = (block: BlockModel) => isTnt(block) && block.GetAttribute("detonated") !== true;

	/**
	 * 1.1 — the blast must be the size the block is configured for.
	 *
	 * Set the TNT's radius to its minimum in the config tool first, then run this: a small blast means the
	 * server read the block, since the payload no longer carries a size at all.
	 */
	export function configuredSizeIsUsed(di: DIContainer) {
		const part = partOf(findBlock(di, isFreshTnt));
		RemoteEvents.Explode.send({ part, epicenter: part.Position, affected: [] });
	}

	/** 1.2 — expect nothing at all: ownership is not identity. */
	export function nonTntBlock(di: DIContainer) {
		const part = partOf(findBlock(di, (b) => !isTnt(b)));
		RemoteEvents.Explode.send({ part, epicenter: part.Position, affected: [] });
	}

	/**
	 * Epicenter plausibility — a detonation claimed far from where the server reckons the block is.
	 * Expect nothing: the sender picks where its blast lands, but only within reach of its own TNT.
	 */
	export function spoofedEpicenter(di: DIContainer) {
		const part = partOf(findBlock(di, isFreshTnt));
		RemoteEvents.Explode.send({ part, epicenter: part.Position.add(new Vector3(0, 500, 0)), affected: [] });
	}

	/** 1.3 — two sends, one blast. The second must be dropped server-side. */
	export function reDetonateIsDropped(di: DIContainer) {
		const part = partOf(findBlock(di, isFreshTnt));
		const payload = { part, epicenter: part.Position, affected: [] };
		RemoteEvents.Explode.send(payload);
		RemoteEvents.Explode.send(payload);
	}

	/** Phase 3 — a position no shot of yours could have reached. Expect no blast. */
	export function unboundExplodeAt() {
		RemoteEvents.ExplodeAt.send({ position: new Vector3(0, 5000, 0) });
	}

	/**
	 * Phase 2 — the old payload shape, which is what a stale exploit script would send. The strict checker
	 * rejects the extra keys, so this kicks rather than detonating small. Ends the session by design.
	 */
	export function zzOldPayloadShapeKicks(di: DIContainer) {
		const part = partOf(findBlock(di, isFreshTnt));
		RemoteEvents.Explode.send({ part, radius: 20, pressure: 2500, isFlammable: true } as never);
	}

	/**
	 * Phase 2 — outright wrong types. Ends the session by design: a kick is the pass condition. Keep this last,
	 * and do not run it while iterating on the others.
	 */
	export function zzMalformedPayloadKicks() {
		RemoteEvents.Explode.send({ part: "not a part" } as never);
	}
}
