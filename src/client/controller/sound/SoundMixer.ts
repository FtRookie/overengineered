import { ReplicatedStorage, SoundService } from "@rbxts/services";
import { Interface } from "engine/client/gui/Interface";
import { HostedService } from "engine/shared/di/HostedService";
import { BlockManager } from "shared/building/BlockManager";
import { SoundCategories } from "shared/SoundCategories";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { SharedPlots } from "shared/building/SharedPlots";

/** One controllable sound, as the settings menu sees it. */
export type SoundEntry = {
	/** The config key and SoundGroup name, e.g. "machines/jetengine/Idle". */
	readonly address: string;
	readonly source: SoundCategories.Id;
	/** The block this belongs to, for `machines` entries. */
	readonly blockId?: string;
	/** The folder holding the sound, for everything else — "Metal", "Supersonic". Titles its group. */
	readonly group?: string;
	/** The Sound instance's own name, e.g. "Idle". */
	readonly name: string;
	/** What this answered to before it was grouped, so a saved level can follow it across. */
	readonly legacy?: string;
};

/** One slider row in the menu: a sound's own name and the address it writes to. */
export type SoundMixerSlider = {
	readonly name: string;
	readonly address: string;
};

/** A titled group of sliders — one block's sounds, or one non-block source. */
export type SoundMixerGroup = {
	/** `blockId` for machines, otherwise the source; stable, used only as a layout key. */
	readonly key: string;
	readonly title: string;
	readonly source: SoundCategories.Id;
	readonly sliders: readonly SoundMixerSlider[];
};

/** Placeholder for a future per-category level. Multiplied in so the level exists before the config does. */
const categoryVolume = (_source: SoundCategories.Id) => 1;

/** Folder names are the group titles now, and "RagdollImpact" reads better split. */
const prettyGroup = (name: string) => name.gsub("(%l)(%u)", "%1 %2")[0];

/**
 * The sound-effects mixer.
 *
 * A per-address SoundGroup holds the volume for each distinct sound (e.g. "machines/jetenginecivil/Idle").
 * The mixer only ever writes SoundGroup.Volume, never Sound.Volume, so the code that drives a sound's own
 * volume (a jet's throttle, impact loudness, the height falloff) is untouched and simply multiplied by the
 * group.
 *
 * Two passes feed the groups:
 *  - Templates (block registry, UI, effect assets) are walked once to build the group list the menu shows.
 *  - Every placed block, on every plot — not just the local player's, since you hear other players' machines
 *    too — has its sounds assigned to the matching group. Cloning does not reliably carry a SoundGroup
 *    reference that points outside the cloned model, so this is done explicitly per live instance rather than
 *    relying on the template's assignment surviving the clone.
 *
 * Groups are flat, one per address; master / category / per-sound levels are multiplied in code, and a
 * recompute (apply) only runs when a slider moves.
 */
@injectable
export class SoundMixer extends HostedService {
	private readonly container: Folder;
	private readonly groups = new Map<string, SoundGroup>();
	private readonly discovered: SoundEntry[] = [];
	private readonly entriesByAddress = new Map<string, SoundEntry>();
	private groupsView?: readonly SoundMixerGroup[];
	private readonly soundfulBlocks = new Set<string>();
	private readonly observedFolders = new Set<Instance>();

	constructor(
		@inject private readonly playerData: PlayerDataStorage,
		@inject private readonly blockList: BlockList,
		@inject private readonly di: DIContainer,
	) {
		super();

		this.container = new Instance("Folder");
		this.container.Name = "MixerGroups";
		this.container.Parent = SoundService;
		this.onDestroy(() => this.container.Destroy());

		this.discover();
		this.migrateVolumes();
		this.apply();
		this.event.subscribe(this.playerData.config.changed, () => this.apply());

		task.spawn(() => this.observePlots());
	}

	/**
	 * Discovered sounds grouped for the settings menu — one group per block (titled by its display name)
	 * and one per non-block source. Order follows discovery, so machines come first in block order. Cached;
	 * the set of sounds is fixed for the session.
	 */
	getGroups(): readonly SoundMixerGroup[] {
		if (this.groupsView !== undefined) return this.groupsView;

		const displayNames = new Map<string, string>();
		for (const block of this.blockList.sorted) {
			displayNames.set(block.id, block.displayName);
		}

		const order: string[] = [];
		const byKey = new Map<string, { title: string; source: SoundCategories.Id; sliders: SoundMixerSlider[] }>();
		for (const entry of this.discovered) {
			const key = entry.blockId ?? entry.group ?? entry.source;

			let group = byKey.get(key);
			if (group === undefined) {
				const title =
					entry.blockId !== undefined
						? (displayNames.get(entry.blockId) ?? entry.blockId)
						: entry.group !== undefined
							? prettyGroup(entry.group)
							: SoundCategories.labels[entry.source];
				group = { title, source: entry.source, sliders: [] };
				byKey.set(key, group);
				order.push(key);
			}

			group.sliders.push({ name: entry.name, address: entry.address });
		}

		this.groupsView = order.map((key) => {
			const group = byKey.get(key)!;
			return { key, title: group.title, source: group.source, sliders: group.sliders };
		});
		return this.groupsView;
	}

	/** Walks every place a sound TEMPLATE can live and routes each one to a group named by its address. */
	private discover() {
		for (const block of this.blockList.sorted) {
			this.routeTree(block.model, "machines", block.id);
		}

		// Only the Sounds folder, not the whole PlayerGui: the UI tree is enormous and its sounds all live here.
		// Music (Sounds.Music) is skipped — it has its own Playlist tab and config.
		const uiSounds = Interface.getPlayerGui().FindFirstChild("Sounds");
		if (uiSounds) this.routeTree(uiSounds, "ui", undefined, uiSounds.FindFirstChild("Music"));

		const assets = ReplicatedStorage.FindFirstChild("Assets");
		const soundAssets = assets?.FindFirstChild("Sounds");
		if (soundAssets) {
			// Impact/Explosion sounds are server-triggered effects; ambient sits under the Effects folder.
			// Split by the top folder so a menu can tell an explosion from wind.
			for (const child of soundAssets.GetChildren()) {
				this.routeTree(child, child.Name === "Effects" ? "world" : "effects", undefined, undefined, child.Name);
			}
		}

		// Some effect sounds (fire) live under Assets.Effects, mixed with particles and lights, not Sounds.
		const effectAssets = assets?.FindFirstChild("Effects");
		if (effectAssets) this.routeTree(effectAssets, "effects", undefined);
	}

	private routeTree(
		root: Instance,
		source: SoundCategories.Id,
		blockId: string | undefined,
		skip?: Instance,
		group?: string,
	) {
		for (const instance of root.GetDescendants()) {
			if (!instance.IsA("Sound")) continue;
			if (skip !== undefined && instance.IsDescendantOf(skip)) continue;

			// A sound nested below the root is titled by the folder holding it, which is what splits the
			// impact materials apart. One sitting directly on the root takes the name the caller gave.
			const parent = instance.Parent;
			this.route(instance, source, blockId, parent === root || !parent ? group : parent.Name);
		}
	}

	private route(sound: Sound, source: SoundCategories.Id, blockId: string | undefined, group?: string) {
		const segment = blockId ?? group?.lower();
		const address = segment !== undefined ? `${source}/${segment}/${sound.Name}` : `${source}/${sound.Name}`;
		if (blockId !== undefined) this.soundfulBlocks.add(blockId);

		let soundGroup = this.groups.get(address);
		if (soundGroup === undefined) {
			soundGroup = new Instance("SoundGroup");
			soundGroup.Name = address;
			soundGroup.Parent = this.container;
			this.groups.set(address, soundGroup);

			const entry: SoundEntry = {
				address,
				source,
				blockId,
				group,
				name: sound.Name,
				legacy: blockId === undefined && segment !== undefined ? `${source}/${sound.Name}` : undefined,
			};
			this.discovered.push(entry);
			this.entriesByAddress.set(address, entry);
		}

		sound.SoundGroup = soundGroup;
	}

	/**
	 * Carries a level saved under the old ungrouped address onto its new one. This cannot be a config
	 * upgrader: only the asset tree knows which folder a sound sits in, and the old key does not say.
	 */
	private migrateVolumes() {
		const config = this.playerData.config.get();
		const volumes = config.sound.volumes;

		let moved: { [address: string]: number | undefined } | undefined;
		for (const entry of this.discovered) {
			if (entry.legacy === undefined) continue;
			if (volumes[entry.address] !== undefined) continue;

			const saved = volumes[entry.legacy];
			if (saved === undefined) continue;

			moved ??= { ...volumes };
			moved[entry.address] = saved;
			moved[entry.legacy] = undefined;
		}
		if (moved === undefined) return;

		this.playerData.config.set({
			...config,
			sound: { ...config.sound, volumes: moved as { readonly [address: string]: number } },
		});
	}

	/**
	 * Assigns the sounds of every placed block, on every plot, to their groups — so a slider reaches every
	 * machine in the world, the local player's and everyone else's. An initial pass over what's already placed
	 * plus a per-folder watch; a block replicates part by part, so a model that isn't ready waits for its
	 * PrimaryPart before its sounds are read.
	 */
	private observePlots() {
		const plots = this.di.resolve<SharedPlots>();
		for (const plot of plots.plots) {
			const plotInstance = plot.instance;

			const existing = plotInstance.FindFirstChild("Blocks");
			if (existing !== undefined) this.observeBlocksFolder(existing);

			// An unclaimed plot has no Blocks folder yet — never WaitForChild it (that would yield forever
			// on empty plots and stall the rest); catch the folder when the plot is taken.
			this.event.subscribe(plotInstance.ChildAdded, (child) => {
				if (child.Name === "Blocks") this.observeBlocksFolder(child);
			});
		}
	}

	private observeBlocksFolder(blocks: Instance) {
		if (this.observedFolders.has(blocks)) return;
		this.observedFolders.add(blocks);

		for (const model of blocks.GetChildren()) {
			this.routeBlockModel(model);
		}
		this.event.subscribe(blocks.ChildAdded, (model) => this.routeBlockModel(model));
	}

	private routeBlockModel(model: Instance) {
		if (!model.IsA("Model")) return;

		// Skips structural blocks with no sounds, and anything without a known block id.
		const blockId = BlockManager.manager.id.get(model as BlockModel);
		if (!this.soundfulBlocks.has(blockId)) return;

		this.routeTree(model, "machines", blockId);
		if (model.PrimaryPart !== undefined) return;

		// A fresh placement replicates part by part, so a sound may arrive after this pass. Catch the
		// stragglers, then stop — replication is long done within the grace window.
		const connection = model.DescendantAdded.Connect((descendant) => {
			if (descendant.IsA("Sound")) this.route(descendant, "machines", blockId);
		});
		task.delay(10, () => connection.Disconnect());
	}

	/** Group volume from 0-100 percentages: master × per-sound × category. */
	private groupVolume(entry: SoundEntry, masterPercent: number, ownPercent: number): number {
		return (masterPercent / 100) * (ownPercent / 100) * categoryVolume(entry.source);
	}

	/** Live preview of one sound while its slider is dragged — sets the group directly, no config write. */
	previewSound(address: string, ownPercent: number) {
		const entry = this.entriesByAddress.get(address);
		const group = this.groups.get(address);
		if (entry === undefined || group === undefined) return;

		group.Volume = this.groupVolume(entry, this.playerData.config.get().sound.master, ownPercent);
	}

	/** Recomputes every group's volume from the config. Cheap, and only runs when a slider moves. */
	private apply() {
		const config = this.playerData.config.get().sound;
		for (const entry of this.discovered) {
			const group = this.groups.get(entry.address);
			if (group === undefined) continue;

			group.Volume = this.groupVolume(entry, config.master, config.volumes[entry.address] ?? 100);
		}
	}
}
