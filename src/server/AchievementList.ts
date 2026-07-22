import { Players, RunService, Workspace } from "@rbxts/services";
import { MathUtils } from "engine/shared/fixes/MathUtils";
import { Achievement } from "server/Achievement";
import { WingBlocks } from "shared/blocks/blocks/grouped/WingsBlocks";
import { LogicOverclockBlock } from "shared/blocks/blocks/LogicOverclockBlock";
import { LuaCircuitBlock } from "shared/blocks/blocks/LuaCircuitBlock";
import { MassSensorBlock } from "shared/blocks/blocks/MassSensorBlock";
import { BlockManager } from "shared/building/BlockManager";
import { BuildingManager } from "shared/building/BuildingManager";
import { SharedPlots } from "shared/building/SharedPlots";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { CustomRemotes } from "shared/Remotes";
import type { baseAchievementStats } from "server/Achievement";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { ServerPlayerController } from "server/ServerPlayerController";
import type { SpreadingFireController } from "server/SpreadingFireController";
import type { FireEffect } from "shared/effects/FireEffect";
import type { PlayerDataStorageRemotesBuilding } from "shared/remotes/PlayerDataRemotes";

type triggerInstances = Folder & Record<`trigger${number}`, BasePart>;

const ws = Workspace as Workspace & {
	Triggers: {
		Centrifuge: triggerInstances;
		AmogusTrack: triggerInstances;
		AirRingsEasy: triggerInstances;
		AirRingsMedium: triggerInstances;
		AirRingsHard: triggerInstances;
		OvalTrack: triggerInstances;
	};
	Map: Folder & {
		Unloadables: Folder & {
			"Space Objects": {
				Banana: Model;
				UFO: Model;
			};
			Destructibles: Folder;
		};
	};
};

const _triggers = ws.Triggers;

//make triggers invisible on run
for (const f of Workspace.FindFirstChild("Triggers")!.GetChildren()) {
	f.GetChildren().forEach((v) => ((v as BasePart).Transparency = 1));
}

// DO NOT CHANGE! RETURNS SORTED ARRAY!
const getTriggerList = (n: keyof typeof _triggers) => {
	const tgs = _triggers[n];
	const rawlist = tgs.GetChildren() as (BasePart | UnionOperation)[];
	const list = [];
	for (let i = 0; i < rawlist.size(); i++) {
		const v = tgs.FindFirstChild(`trigger${i}`);
		if (!v) throw `Trigger init error: "trigger${i}" not found in triggers of ${n}`;
		list[i] = v as BasePart | UnionOperation;
	}

	const record = {} as triggerInstances;
	list.forEach((v) => (record[v.Name as `trigger${number}`] = v));
	return $tuple(list, record);
};

/*
	PLEASE DO NOT SPOIL THE ACHIEVEMENTS FOR OTHER PLAYERS!!!
	PLEASE DO NOT SPOIL THE ACHIEVEMENTS FOR OTHER PLAYERS!!!
	PLEASE DO NOT SPOIL THE ACHIEVEMENTS FOR OTHER PLAYERS!!!
	PLEASE DO NOT SPOIL THE ACHIEVEMENTS FOR OTHER PLAYERS!!!
	PLEASE DO NOT SPOIL THE ACHIEVEMENTS FOR OTHER PLAYERS!!!
	PLEASE DO NOT SPOIL THE ACHIEVEMENTS FOR OTHER PLAYERS!!!
	PLEASE DO NOT SPOIL THE ACHIEVEMENTS FOR OTHER PLAYERS!!!
	PLEASE DO NOT SPOIL THE ACHIEVEMENTS FOR OTHER PLAYERS!!!
	PLEASE DO NOT SPOIL THE ACHIEVEMENTS FOR OTHER PLAYERS!!!
	PLEASE DO NOT SPOIL THE ACHIEVEMENTS FOR OTHER PLAYERS!!!
	PLEASE DO NOT SPOIL THE ACHIEVEMENTS FOR OTHER PLAYERS!!!
	PLEASE DO NOT SPOIL THE ACHIEVEMENTS FOR OTHER PLAYERS!!!
	PLEASE DO NOT SPOIL THE ACHIEVEMENTS FOR OTHER PLAYERS!!!
*/

@injectable
class AchievementWelcome extends Achievement {
	constructor(@inject player: Player) {
		super(player, {
			id: "WELCOME",
			name: `Hello World!`,
			description: `Welcome to OverEngineered!`,
			imageID: "78364064019512",
		});

		this.onEnable(() => this.set({ completed: true }));
	}
}

@injectable
class AchievementTheIssue extends Achievement {
	constructor(@inject player: Player) {
		super(player, {
			id: "THE_ISSUE",
			name: "DMCA abuse",
			description: "Now go to our community server and read #the-issue channel",
			hidden: true,
			imageID: "76517691012059",
		});

		this.event.subscribe(player.Chatted, (msg, recv) => {
			if (recv) return;
			this.set({ completed: msg.fullLower().contains("plane crazy") });
		});
	}
}

@injectable
class AchievementLuaCircuitObtained extends Achievement {
	constructor(@inject player: Player, @inject playerDatabase: PlayerDatabase) {
		super(player, {
			id: "LUA_CIRCUIT",
			name: "Oh yeah, it's big brain time",
			description: `Obtain ${LuaCircuitBlock.displayName} by joining our community server and following instructions there.`,
			imageID: "93831558669845",
		});

		// fixme: auto-completes for everyone — revisit once the community poll on whether it should require
		// actually obtaining the block comes back
		this.onEnable(() => {
			this.set({ completed: true });
		});
	}
}

abstract class AchievementPlaytime extends Achievement<{ seconds_spent: number }> {
	constructor(player: Player, data: Partial<baseAchievementStats>, target_seconds: number) {
		//1 hour
		const target_hours = target_seconds / 60 / 60;
		super(player, {
			id: "SPEND_1_HOUR",
			name: `Spare time`,
			description: `Play for over ${target_hours} ${target_hours > 1 ? "hours" : "hour"} in total`,
			max: target_seconds,
			units: "time",
			imageID: "100755497882706",
			...data,
		});

		this.onEnable(() => {
			// getData will return 0 or undefined if run before enable
			let seconds_spent = this.getData()?.seconds_spent ?? 0;
			this.event.subscribe(RunService.PostSimulation, (delta) => {
				seconds_spent += delta;
				this.set({ progress: seconds_spent, seconds_spent });
			});
		});
	}
}

@injectable
class AchievementPlaytime1H extends AchievementPlaytime {
	constructor(@inject player: Player) {
		super(
			player,
			{
				id: "SPEND_1_HOUR",
				name: `Spare time`,
			},
			1 * 60 * 60,
		);
	}
}

@injectable
class AchievementPlaytime4H extends AchievementPlaytime {
	constructor(@inject player: Player) {
		super(
			player,
			{
				id: "SPEND_4_HOUR",
				name: `Time well spent`,
			},
			4 * 60 * 60,
		);
	}
}

@injectable
class AchievementPlaytime12H extends AchievementPlaytime {
	constructor(@inject player: Player) {
		super(
			player,
			{
				id: "SPEND_12_HOUR",
				name: `Master Engineer`,
			},
			12 * 60 * 60,
		);
	}
}

@injectable
class AchievementPlaytime36H extends AchievementPlaytime {
	constructor(@inject player: Player) {
		super(
			player,
			{
				id: "SPEND_36_HOUR",
				name: `Get a Life`,
				hidden: true,
			},
			36 * 60 * 60,
		);
	}
}

@injectable
class AchievementPlaytime72H extends AchievementPlaytime {
	constructor(@inject player: Player) {
		super(
			player,
			{
				id: "SPEND_72_HOUR",
				name: `Get More Life`,
				hidden: true,
			},
			72 * 60 * 60,
		);
	}
}

@injectable
class AchievementPlaytime120H extends AchievementPlaytime {
	constructor(@inject player: Player) {
		super(
			player,
			{
				id: "SPEND_120_HOUR",
				name: `Unemployed Amount of Gaming`,
				hidden: true,
			},
			120 * 60 * 60,
		);
	}
}

@injectable
class AchievementAfkTime extends Achievement {
	constructor(@inject player: Player) {
		//15 minutes
		const target_seconds = 15 * 60;
		const target_minutes = target_seconds / 60;
		super(player, {
			id: "BE_AFK_15_MINUTES",
			name: `DON'T TOUCH ANYTHING!`,
			description: `Be AFK for ${target_minutes} consecutive minutes`,
			hidden: true,
			max: target_seconds,
			units: "time",
			imageID: "100755497882706",
		});

		this.onEnable(() => {
			let seconds_record = 0;
			let isAfk = false;

			this.event.loop(1, () => {
				if (!isAfk) return;
				seconds_record++;
				this.set({ progress: seconds_record });
			});

			this.event.subscribe(CustomRemotes.achievements.isAfk.invoked, (invoker, afk) => {
				if (invoker !== player) return;
				isAfk = afk;

				if (!afk) {
					seconds_record = 0;
					this.set({ progress: seconds_record });
				}
			});
		});
	}
}

@injectable
class AchievementWingScale extends Achievement<{}> {
	constructor(@inject player: Player, @inject plots: SharedPlots, @inject plot: PlayerDataStorageRemotesBuilding) {
		super(player, {
			id: "WING_SCALE",
			name: `Must've been the wind...`,
			description: `Scale a wing block to be 0.05 studs in thickness`,
			hidden: true,
			units: "precise",
			imageID: "76517691012059",
		});

		this.event.subscribe(plot.editBlocks.processed, (player, a) => {
			const id = plots.getPlotComponent(a.plot).ownerId.get();
			if (!id) return;

			const p = Players.GetPlayerByUserId(id);
			if (p !== player) return;

			const wingIDs = [];
			for (const block of WingBlocks) {
				wingIDs.push(block.id);
			}
			for (const ebr of a.blocks) {
				const blockId = BlockManager.getBlockDataByBlockModel(ebr.instance).id;
				if (wingIDs.contains(blockId)) {
					if (MathUtils.round(ebr.scale?.Y ?? 0, 0.01) === 0.17) {
						this.set({ completed: true });
					}
				}
			}
		});
	}
}

@injectable
class AchievementScaleAnything extends Achievement {
	constructor(@inject player: Player, @inject plots: SharedPlots, @inject plot: PlayerDataStorageRemotesBuilding) {
		super(player, {
			id: "SCALE_ANYTHING",
			name: `A whole new world of possibilities!`,
			description: `Think outside of the box? Why not just resize the box!`,
			imageID: "92568083216760",
		});

		if (!plot) return;
		this.event.subscribe(plot.editBlocks.processed, (player, a) => {
			const id = plots.getPlotComponent(a.plot).ownerId.get();
			if (!id) return;

			const p = Players.GetPlayerByUserId(id);
			if (p !== player) return;

			let scaled = false;
			for (const block of a.blocks) {
				const scl = BlockManager.getBlockDataByBlockModel(block.instance).scale ?? Vector3.one;
				if (scl !== Vector3.one) {
					scaled = true;
					break;
				}
			}
			this.set({ completed: scaled });
		});
	}
}

@injectable
class AchievementClearPlot extends Achievement {
	constructor(@inject player: Player, @inject plots: SharedPlots, @inject plot: PlayerDataStorageRemotesBuilding) {
		super(player, {
			id: "CLEAR_PLOT",
			name: `Back to the Drawing Board`,
			description: `A monkey cannot reach space by climbing progressively taller trees`,
			imageID: "12539349041",
		});

		if (!plot) return;
		this.event.subscribe(plot.deleteBlocks.processed, (player, a) => {
			const id = plots.getPlotComponent(a.plot).ownerId.get();
			if (!id) return;

			const p = Players.GetPlayerByUserId(id);
			if (p !== player) return;

			if (a.blocks === "all") this.set({ completed: true });
		});
	}
}

@injectable
class AchievementColliderTool extends Achievement {
	constructor(@inject player: Player, @inject plots: SharedPlots, @inject plot: PlayerDataStorageRemotesBuilding) {
		super(player, {
			id: "COLLIDER_TOOL",
			name: `Collision Engineers`,
			description: `All the atoms perfectly aligned to phase through one other.`,
			imageID: "120643910113970",
		});

		if (!plot) return;
		this.event.subscribe(plot.recollide.processed, (player, a) => {
			const id = plots.getPlotComponent(a.plot).ownerId.get();
			if (!id) return;

			const p = Players.GetPlayerByUserId(id);
			if (p !== player) return;

			for (const block of a.datas) {
				if (!block.enabled) {
					this.set({ completed: true });
					break;
				}
			}
		});
	}
}

@injectable
class AchievementInvisible extends Achievement {
	constructor(@inject player: Player, @inject plots: SharedPlots, @inject plot: PlayerDataStorageRemotesBuilding) {
		super(player, {
			id: "INVISIBLE_BLOCK",
			name: `Where'd it go?`,
			description: `Set the alpha of any block to 0`,
			imageID: "124389001568242",
		});

		if (!plot) return;
		this.event.subscribe(plot.paintBlocks.processed, (player, a) => {
			const id = plots.getPlotComponent(a.plot).ownerId.get();
			if (!id) return;

			const p = Players.GetPlayerByUserId(id);
			if (p !== player) return;

			if (a.color?.alpha === 0) {
				this.set({ completed: true });
			}
		});
	}
}

@injectable
class AchievementInvisibleBox extends Achievement {
	constructor(@inject player: Player, @inject plots: SharedPlots, @inject plot: PlayerDataStorageRemotesBuilding) {
		super(player, {
			id: "INVISIBLE_BOX",
			name: `INVISIBLE... INVISIBLE...`,
			description: `Will you say my name, has the memory gone? are you feeling numb? Or have I become INVISIBLE?`,
			hidden: true,
			imageID: "134462992139717",
		});

		if (!plot) return;
		this.event.subscribe(plot.paintBlocks.processed, (player, a) => {
			const id = plots.getPlotComponent(a.plot).ownerId.get();
			if (!id) return;

			const p = Players.GetPlayerByUserId(id);
			if (p !== player) return;

			if (a.color?.alpha !== 0) return;
			if (a.material !== Enum.Material.Cardboard) return;
			this.set({ completed: true });
		});
	}
}

abstract class AchievementHeightRecord extends Achievement<{ height_record: number }> {
	constructor(player: Player, name: string, description: string, targetHeight: number, hidden: boolean = false) {
		super(player, {
			id: `HEIGHT_TARGET_${targetHeight}`,
			name,
			description: `${description} (${targetHeight} studs traveled)`,
			max: targetHeight,
			hidden,
			imageID: "105060915517150",
		});

		this.onEnable(() => {
			let height_record = this.getData()?.height_record ?? 0;
			this.event.subscribe(RunService.PostSimulation, () => {
				const character = player.Character?.PrimaryPart;
				if (!character) return;

				height_record = math.max(character.Position.Y - GameDefinitions.HEIGHT_OFFSET, height_record);
				this.set({ progress: height_record, height_record });
			});
		});
	}
}

@injectable
class AchievementHeightRecord25k extends AchievementHeightRecord {
	constructor(@inject player: Player) {
		super(player, `Space tourism`, `Leave the atmosphere`, 25_000);
	}
}

@injectable
class AchievementHeightRecord75k extends AchievementHeightRecord {
	constructor(@inject player: Player) {
		super(player, `SPAAAAACE`, `Deeper into the void!`, 75_000);
	}
}

@injectable
class AchievementHeightRecord150k extends AchievementHeightRecord {
	constructor(@inject player: Player) {
		super(player, `Deepfried space`, `Things are wobbly over here`, 150_000);
	}
}

@injectable
class AchievementHeightRecord500k extends AchievementHeightRecord {
	constructor(@inject player: Player) {
		super(player, `Outer Spaced`, `Long trip home`, 500_000, true);
	}
}

abstract class AchievementSpeedRecord extends Achievement<{ time_record: number }> {
	constructor(player: Player, name: string, targetSpeed: number, hidden = false) {
		super(player, {
			id: `SPEED_TARGET_${targetSpeed}`,
			name: name,
			description: `Reach speed over ${targetSpeed} studs/second in horizontal axis for 3 seconds`,
			hidden,
			max: 3,
			units: "time",
			imageID: "84161963549773",
		});

		this.onEnable(() => {
			let counter = 0;
			let time_record = this.getData()?.time_record ?? 0;
			this.event.subscribe(RunService.PostSimulation, (delta) => {
				const character = player.Character?.PrimaryPart;
				if (!character) return (counter = 0);

				//exclude Y axis becuase it can be abused by helium and other things
				// should angular velocity really be included? No.
				const speed = character.AssemblyLinearVelocity.apply((v, a) => (a === "Y" ? 0 : v)).Magnitude;

				if (speed < targetSpeed) return (counter = 0);

				time_record = math.max((counter += delta), time_record);
				this.set({ progress: counter, time_record });
			});
		});
	}
}

@injectable
class AchievementSpeedRecord1k extends AchievementSpeedRecord {
	constructor(@inject player: Player) {
		super(player, `A bit fast, eh?`, 1000);
	}
}

@injectable
class AchievementSpeedRecord5k extends AchievementSpeedRecord {
	constructor(@inject player: Player) {
		super(player, `4.114 Machs doesn't sound like a lot`, 5000);
	}
}

@injectable
class AchievementSpeedRecord15k extends AchievementSpeedRecord {
	constructor(@inject player: Player) {
		super(player, `BRO WHERE ARE WE GOING?!`, 15_000, true);
	}
}

@injectable
class AchievementSpeedRecord50k extends AchievementSpeedRecord {
	constructor(@inject player: Player) {
		super(player, `Typical High Speed Fan`, 50_000, true);
	}
}

@injectable
class AchievementSpeedRecord100k extends AchievementSpeedRecord {
	constructor(@inject player: Player) {
		super(player, `Lightspeed Enjoyer`, 150_000, true);
	}
}

abstract class AchievementRotationalSpeedRecord extends Achievement<{ time_record: number }> {
	constructor(player: Player, name: string, targetSpeed: number, hidden = false) {
		super(player, {
			id: `SPEED_TARGET_${targetSpeed}`,
			name: name,
			description: `Reach rotational speed over ${targetSpeed} radians/second for 5 seconds`,
			hidden,
			max: 5,
			units: "time",
			imageID: "92339654002947",
		});

		this.onEnable(() => {
			let counter = 0;
			let time_record = this.getData()?.time_record ?? 0;
			this.event.subscribe(RunService.PostSimulation, (delta) => {
				const character = player.Character?.PrimaryPart;
				if (!character) return (counter = 0);
				const speed = character.AssemblyAngularVelocity.Magnitude;

				if (speed < targetSpeed) return (counter = 0);

				time_record = math.max((counter += delta), time_record);
				this.set({ progress: counter, time_record });
			});
		});
	}
}

@injectable
class AchievementRotationalSpeedRecord50 extends AchievementRotationalSpeedRecord {
	constructor(@inject player: Player) {
		super(player, `A little woozy`, 50);
	}
}

@injectable
class AchievementRotationalSpeedRecord150 extends AchievementRotationalSpeedRecord {
	constructor(@inject player: Player) {
		super(player, `Getting dizzy`, 150);
	}
}

@injectable
class AchievementRotationalSpeedRecord1500 extends AchievementRotationalSpeedRecord {
	constructor(@inject player: Player) {
		super(player, `I think I'm gonna vomit`, 1500, true);
	}
}

@injectable
class AchievementRotationalSpeedRecord9K extends AchievementRotationalSpeedRecord {
	constructor(@inject player: Player) {
		super(player, `IT'S OVER 9000!!!`, 9000, true);
	}
}

@injectable
class AchievementCatchOnFire extends Achievement {
	constructor(@inject player: Player, @inject fireffect: FireEffect, @inject plots: SharedPlots) {
		super(player, {
			id: "CATCH_ON_FIRE",
			name: "OverCooked!",
			description: "Better call the fire department! (We don't have one)",
			imageID: "89747760666734",
		});

		this.event.subscribe(fireffect.event.s2c.sent, (_, args) => {
			const owner = plots.plots.find((c) => args.part.IsDescendantOf(c.instance))?.ownerId?.get();
			if (!owner) return;

			this.set({ completed: owner === player.UserId });
		});
	}
}

abstract class AchievementMassSensor extends Achievement<{ target_mass: number }> {
	constructor(player: Player, name: string, desc: string, targetMass: number) {
		super(player, {
			id: `MASS_GAMING${desc}`,
			name,
			description: `Measure a mass of ${desc} RMU with a mass sensor`,
			max: targetMass,
			imageID: "107937705270413",
			hidden: true,
		});
		this.$onInjectAuto((playModeController: PlayModeController) => {
			this.event.subscribe(CustomRemotes.modes.setOnClient.sent, () => {
				const mode = playModeController.getPlayerMode(player);
				if (mode !== "ride") return;

				const allBlocks = SharedPlots.instance.getPlotComponentByOwnerID(player.UserId).getBlocks();

				for (const model of allBlocks) {
					if (BlockManager.getBlockDataByBlockModel(model).id === MassSensorBlock.id) {
						let mass = 0;
						for (const block of BuildingManager.getMachineBlocks(model)) {
							for (const desc of block.GetDescendants()) {
								if (!desc.IsA("BasePart")) continue;
								mass += desc.Mass;
							}
						}
						this.set({ progress: mass, target_mass: targetMass });
					}
				}
			});
		});
	}
}

@injectable
class AchievementMassSensor100K extends AchievementMassSensor {
	constructor(@inject player: Player) {
		super(player, "Lighter than your mom lol", "100K", 100_000);
	}
}

@injectable
class AchievementMassSensor1M extends AchievementMassSensor {
	constructor(@inject player: Player) {
		super(player, "Mass Gaming, samyy moshnyy", "1M", 1_000_000);
	}
}

@injectable
class AchievementOverclock extends Achievement {
	constructor(@inject player: Player, @inject playModeController: PlayModeController, @inject plots: SharedPlots) {
		super(player, {
			id: "USE_OVERCLOCK",
			name: "OverClocked!",
			description: "What's that noise? OHHH MY PC",
			imageID: "75746597939007",
		});

		// Rescan the plot on ride entry rather than tracking place/delete — this also catches an overclock
		// block that arrived via a slot load, which fires no placeBlocks event.
		this.event.subscribe(CustomRemotes.modes.setOnClient.sent, () => {
			if (playModeController.getPlayerMode(player) !== "ride") return;

			const blocks = plots.getPlotComponentByOwnerID(player.UserId).getBlocks();
			const hasOverClock = blocks.any((m) => BlockManager.manager.id.get(m) === LogicOverclockBlock.id);
			this.set({ completed: hasOverClock });
		});
	}
}

abstract class AchievementCheckpoints extends Achievement<{ checkpoints_finished: string[] }> {
	constructor(
		player: Player,
		playModeController: PlayModeController,
		data: baseAchievementStats,
		triggerGroup: keyof typeof _triggers,
	) {
		super(player, data);

		this.onEnable(() => {
			const checkpoints_finished = new Set(this.getData()?.checkpoints_finished ?? []);
			const hitSequence: (BasePart | undefined)[] = [];
			const [triggersList, triggersRecord] = getTriggerList(triggerGroup);
			const listLen = triggersList.size();
			for (let i = 0; i < listLen; i++) {
				const t = triggersList[i];

				this.event.subscribe(t.Touched, (inst) => {
					//get player's mode
					// yes it DOESN'T actually check if player is in their own vehicle
					// but it doesn't matter because player doesn't know it
					if (playModeController.getPlayerMode(player) !== "ride") return;

					//check if part touched is player's
					if (inst.Parent !== player.Character) return;

					//add timeout to the trigger
					hitSequence[i] = t;
					checkpoints_finished.add(t.Name);

					//check if all triggered
					let allTriggered = true;
					for (let j = 0; j < listLen; j++) {
						const tr = hitSequence[j];

						if (tr === undefined) {
							allTriggered = false;
							break;
						}
					}

					this.set({ completed: allTriggered, checkpoints_finished: [...checkpoints_finished] });
				});
			}
		});
	}
}

//may be will be used some day
const getExtremesOfArray = (arr: number[]): LuaTuple<[number, number]> => $tuple(math.min(...arr), math.max(...arr));

abstract class AchievementCheckpointsWithTimeout extends Achievement {
	constructor(
		player: Player,
		playModeController: PlayModeController,
		data: baseAchievementStats,
		timeout_seconds: number,
		triggerGroup: keyof typeof _triggers,
	) {
		super(player, data);

		const hitSequence: (BasePart | undefined)[] = [];
		const [triggersList, triggersRecord] = getTriggerList(triggerGroup);
		const listLen = triggersList.size();
		for (let i = 0; i < listLen; i++) {
			const t = triggersList[i];

			//I believe it to be kinda clever actually
			let thread: thread;
			this.event.subscribe(t.Touched, (inst) => {
				//get player's mode
				// yes it DOESN'T actually check if player is in their own vehicle
				// but it doesn't matter because player doesn't know it
				if (playModeController.getPlayerMode(player) !== "ride") return;

				//check if part touched is player's
				if (inst.Parent !== player.Character) return;

				//add timeout to the trigger
				hitSequence[i] = t;
				if (thread) task.cancel(thread);
				thread = task.delay(timeout_seconds, () => (hitSequence[i] = undefined));

				//check if all triggered
				let allTriggered = true;
				for (let j = 0; j < listLen; j++) {
					const tr = hitSequence[j];
					if (tr === undefined) {
						allTriggered = false;
						break;
					}
				}

				this.set({ completed: allTriggered });
			});
		}
	}
}

abstract class AchievementCentrifuge extends AchievementCheckpointsWithTimeout {
	constructor(
		player: Player,
		playModeController: PlayModeController,
		name: string,
		timeout_seconds: number,
		hidden = false,
	) {
		super(
			player,
			playModeController,
			{
				id: `CENTRIFUGE_TARGET_${timeout_seconds}`,
				name,
				description: `Make a lap in the Centrifuge in ${timeout_seconds} seconds or less`,
				hidden,
				imageID: "109486075173347",
			},
			timeout_seconds,
			"Centrifuge",
		);
	}
}

@injectable
class AchievementCentrifuge30seconds extends AchievementCentrifuge {
	constructor(@inject player: Player, @inject playModeController: PlayModeController) {
		super(player, playModeController, `30 Seconds or Less`, 30);
	}
}

@injectable
class AchievementCentrifuge20seconds extends AchievementCentrifuge {
	constructor(@inject player: Player, @inject playModeController: PlayModeController) {
		super(player, playModeController, `Now We're Cooking with Gas!`, 20);
	}
}

@injectable
class AchievementCentrifuge10seconds extends AchievementCentrifuge {
	constructor(@inject player: Player, @inject playModeController: PlayModeController) {
		super(player, playModeController, `Right round like a record, baby`, 10);
	}
}

@injectable
class AchievementCentrifuge5seconds extends AchievementCentrifuge {
	constructor(@inject player: Player, @inject playModeController: PlayModeController) {
		super(player, playModeController, `KA-CHOW`, 5, true);
	}
}

abstract class AchievementAmogusTrack extends AchievementCheckpointsWithTimeout {
	constructor(
		player: Player,
		playModeController: PlayModeController,
		timeout_seconds: number,
		name: string,
		hidden = false,
		description = `Make a lap on the race track in ${timeout_seconds} seconds or less. No shortcuts.`,
	) {
		super(
			player,
			playModeController,
			{
				id: `RACE_TRACK_TARGET_${timeout_seconds}`,
				name,
				description,
				hidden,
				imageID: "103876818849553",
			},
			timeout_seconds,
			"AmogusTrack",
		);
	}
}

@injectable
class AchievementAmogusTrack20seconds extends AchievementAmogusTrack {
	constructor(@inject player: Player, @inject playModeController: PlayModeController) {
		super(player, playModeController, 20, `Minimum Viable Product`, false, `Just running a lap is a solution too`);
	}
}

@injectable
class AchievementAmogusTrack15seconds extends AchievementAmogusTrack {
	constructor(@inject player: Player, @inject playModeController: PlayModeController) {
		super(player, playModeController, 15, `Circuit Breaker`);
	}
}

@injectable
class AchievementAmogusTrack10seconds extends AchievementAmogusTrack {
	constructor(@inject player: Player, @inject playModeController: PlayModeController) {
		super(player, playModeController, 10, `TAS Bot Approved`);
	}
}

abstract class AchievementOvalTrack extends AchievementCheckpointsWithTimeout {
	constructor(
		player: Player,
		playModeController: PlayModeController,
		timeout_seconds: number,
		name: string,
		description = `Make a lap on the Oval race track in ${timeout_seconds} seconds or less. No shortcuts.`,
	) {
		super(
			player,
			playModeController,
			{
				id: `RACE_TRACK_OVALS_TARGET_${timeout_seconds}`,
				name,
				description,
				imageID: "127597860492025",
			},
			timeout_seconds,
			"OvalTrack",
		);
	}
}

@injectable
class AchievementOvalTrack20seconds extends AchievementOvalTrack {
	constructor(@inject player: Player, @inject playModeController: PlayModeController) {
		super(player, playModeController, 20, `First Lap`);
	}
}

@injectable
class AchievementOvalTrack15seconds extends AchievementOvalTrack {
	constructor(@inject player: Player, @inject playModeController: PlayModeController) {
		super(player, playModeController, 15, `Qualifying Lap`);
	}
}

@injectable
class AchievementOvalTrack10seconds extends AchievementOvalTrack {
	constructor(@inject player: Player, @inject playModeController: PlayModeController) {
		super(player, playModeController, 10, `Grind Prix`);
	}
}

@injectable
class AchievementAirRingsEasy extends AchievementCheckpoints {
	constructor(@inject player: Player, @inject playModeController: PlayModeController) {
		super(
			player,
			playModeController,
			{
				id: `AIR_COURSE_EASY`,
				name: "Flight School Graduate",
				description: `Finish easy difficulty air course`,
				imageID: "101267722343574",
			},
			"AirRingsEasy",
		);
	}
}

@injectable
class AchievementAirRingsMedium extends AchievementCheckpointsWithTimeout {
	constructor(@inject player: Player, @inject playModeController: PlayModeController) {
		super(
			player,
			playModeController,
			{
				id: `AIR_COURSE_MEDIUM`,
				name: "Through John's Heart",
				description: `Finish medium difficulty air course in 25 seconds or less`,
				imageID: "101267722343574",
			},
			25,
			"AirRingsMedium",
		);
	}
}

@injectable
class AchievementAirRingsHard extends AchievementCheckpointsWithTimeout {
	constructor(@inject player: Player, @inject playModeController: PlayModeController) {
		super(
			player,
			playModeController,
			{
				id: `AIR_COURSE_HARD`,
				name: "No Room for Error",
				description: `Finish intentionally hard air course in 60 seconds or less.. Designed to test player's skills in engineering and piloting.`,
				imageID: "101267722343574",
			},
			60,
			"AirRingsHard",
		);
	}
}

abstract class AchievementFindGetNearObject extends Achievement {
	constructor(
		player: Player,
		data: baseAchievementStats,
		targetObject: BasePart | UnionOperation | undefined,
		activationDistance: number,
	) {
		super(player, data);

		let counter = 0;
		this.event.subscribe(RunService.PostSimulation, (delta) => {
			const character = player.Character?.PrimaryPart;

			if (!character || !targetObject) {
				counter = 0;
				return;
			}

			// same result, purposefully separated conditions
			if (character.Position.sub(targetObject.Position).Magnitude > activationDistance) {
				counter = 0;
				return;
			}

			counter += delta;

			this.set({ progress: counter });
		});
	}
}

@injectable
class AchievementFindBanana extends AchievementFindGetNearObject {
	constructor(@inject player: Player) {
		super(
			player,
			{
				id: "FIND_BANANA",
				name: "Completely bananas!",
				description: "Find the banana!",
				hidden: true,
				max: 4,
				imageID: "132805406903978",
			},
			ws.Map.Unloadables["Space Objects"].Banana.PrimaryPart,
			40,
		);
	}
}

@injectable
class AchievementFindUFO extends AchievementFindGetNearObject {
	constructor(@inject player: Player) {
		super(
			player,
			{
				id: "FIND_UFO",
				name: "I Want to Believe!",
				description: "Find the UFO!",
				hidden: true,
				max: 4,
				imageID: "110520480308001",
			},
			ws.Map.Unloadables["Space Objects"].UFO.PrimaryPart,
			150,
		);
	}
}

// I would not be surprised if the name gets changed (I couldent think of anything else that fits)
@injectable
class BonkBonkByeBye extends Achievement {
	constructor(@inject player: Player) {
		super(player, {
			id: "MAXWELL_BONK",
			name: "Cat-astrophe",
			description: "Knock Maxwell off Big John, how rude >:(",
			imageID: "136757634650350",
			hidden: true,
		});

		// Maxwell not important enough for a capital name???
		const maxwell = ws.Map.Unloadables.FindFirstChild("Big John")?.FindFirstChild("maxwell") as MeshPart;
		if (!maxwell) return;

		// keep track of the last player that touched maxwell
		let maxtag = maxwell.FindFirstChild("MaxwellPlayerTag") as IntValue;
		if (!maxtag) {
			// create it
			maxtag = new Instance("IntValue", maxwell);
		}

		maxwell.Touched.Connect((hitPart) => {
			const character = hitPart.FindFirstAncestorWhichIsA("Model");
			if (!character) return;
			const plr = Players.GetPlayerFromCharacter(character);
			// check if player exists
			if (plr && plr.UserId === player.UserId) {
				maxtag.Value = plr.UserId;
			}
		});

		this.event.subscribe(RunService.PostSimulation, () => {
			if (!maxwell) return;

			// this is how the game triggers *the screaming*
			// (slightly increased to make sure its falling)
			if (maxwell.AssemblyLinearVelocity.Magnitude > 20) {
				if (maxtag.Value !== player.UserId) return;
				this.set({ completed: true });
			}
		});
	}
}

@injectable
class AchievementBreakSomething extends Achievement {
	constructor(@inject player: Player) {
		super(player, {
			id: "BREAK_MAP_DESTRUCTABLE",
			name: "Breaking Change",
			description: "Break a hydrant or something, or be near when it happens",
			imageID: "79485719904367",
		});

		const activationDistance = 15;
		for (const o of ws.Map.Unloadables.Destructibles.GetChildren()) {
			if (o.Name !== "Fire Hydrant") continue;
			const obj = o as Model & {
				Main: BasePart & {
					TriggeredSound: Sound;
				};
			};

			this.event.subscribe(obj.Main.TriggeredSound.Played, () => {
				const character = player.Character?.PrimaryPart;
				if (!character) return;
				this.set({ completed: character.Position.sub(obj.Main.Position).Magnitude < activationDistance });
			});
		}
	}
}

@injectable
class AchievementFOVMax extends Achievement {
	constructor(@inject player: Player, @inject serverPlayerController: ServerPlayerController) {
		super(player, {
			id: "FOV_MAX",
			name: "Quake pro",
			description: "Set your FOV to the maximum value",
			hidden: true,
			max: 120,
			imageID: "129519370592474",
		});

		this.event.subscribe(serverPlayerController.remotes.player.updateSettings.invoked, (p, s) => {
			if (p !== player) return;
			if (!s.graphics?.camera?.fov) return;
			this.set({ progress: s.graphics.camera.fov });
		});
	}
}

@injectable
class AchievementFOVMin extends Achievement {
	constructor(@inject player: Player, @inject serverPlayerController: ServerPlayerController) {
		super(player, {
			id: "FOV_MIN",
			name: "Eye Spy!",
			description: "Set your FOV to the minimum value",
			hidden: true,
			max: 100,
			imageID: "80192428651955",
		});

		this.event.subscribe(serverPlayerController.remotes.player.updateSettings.invoked, (p, s) => {
			if (p !== player) return;
			if (!s.graphics?.camera?.fov) return;
			this.set({ progress: math.max(0, 100 / s.graphics.camera.fov) });
		});
	}
}

abstract class AchievementBlocksPlacedPlaceholder extends Achievement<{ placedBlocks: number }> {
	constructor(player: Player, plot: PlayerDataStorageRemotesBuilding, info: Partial<baseAchievementStats>) {
		super(player, {
			id: "PLACED_BLOCKS_PLACEHOLDER",
			name: "Placed Blocks Achievement Placeholder",
			description: `Place ${info.max} blocks in total`,
			hidden: false,
			max: 0,
			imageID: "80735728329955",
			units: "precise",
			...info,
		});

		this.onEnable(() => {
			let placedBlocks = this.getData()?.placedBlocks ?? 0;
			this.event.subscribe(plot.placeBlocks.processed, (p, _, models) => {
				if (p !== player) return;
				placedBlocks += models.models.size();
				this.set({ progress: placedBlocks, placedBlocks });
			});
		});
	}
}

@injectable
class AchievementTutorial extends Achievement {
	constructor(@inject player: Player) {
		super(player, {
			id: "TUTORIAL_FINISHED",
			name: "So it begins..",
			description: "Finish the basic tutorial.",
		});

		this.event.subscribe(CustomRemotes.tutorial.finished.invoked, (sender) => {
			if (sender !== player) return;
			this.set({ completed: true });
		});
	}
}

@injectable
class AchievementBlocksPlaced_100 extends AchievementBlocksPlacedPlaceholder {
	constructor(@inject player: Player, @inject plot: PlayerDataStorageRemotesBuilding) {
		super(player, plot, {
			id: "PLACED_BLOCKS_100",
			name: "Playing with bricks",
			max: 100,
		});
	}
}

@injectable
class AchievementBlocksPlaced_1K extends AchievementBlocksPlacedPlaceholder {
	constructor(@inject player: Player, @inject plot: PlayerDataStorageRemotesBuilding) {
		super(player, plot, {
			id: "PLACED_BLOCKS_1K",
			name: "Builder",
			max: 1000,
		});
	}
}

@injectable
class AchievementBlocksPlaced_10K extends AchievementBlocksPlacedPlaceholder {
	constructor(@inject player: Player, @inject plot: PlayerDataStorageRemotesBuilding) {
		super(player, plot, {
			id: "PLACED_BLOCKS_10K",
			name: "Mason Worker",
			max: 10_000,
			hidden: true,
		});
	}
}

@injectable
class AchievementBlocksPlaced_100K extends AchievementBlocksPlacedPlaceholder {
	constructor(@inject player: Player, @inject plot: PlayerDataStorageRemotesBuilding) {
		super(player, plot, {
			id: "PLACED_BLOCKS_100K",
			name: "Bricklayer",
			max: 100_000,
			hidden: true,
		});
	}
}

@injectable
class AchievementFireExtinguished extends Achievement {
	constructor(@inject player: Player, @inject spreadingFire: SpreadingFireController) {
		super(player, {
			id: "FIRE_EXTINGUISH",
			name: "Wee woo!",
			description: "Put out a fire",
			hidden: false,
			imageID: "95009037532190",
		});

		// Fired by the server fire controller only when a detonation actually put out a burning part.
		this.event.subscribe(spreadingFire.extinguished, (extinguisher) => {
			if (extinguisher !== player) return;
			this.set({ completed: true });
		});
	}
}

@injectable
class AchievementPlayerExtinguished extends Achievement {
	constructor(@inject player: Player, @inject spreadingFire: SpreadingFireController) {
		super(player, {
			id: "PLAYER_EXTINGUISH",
			name: "Stop, Drop and Roll",
			description: "Extinguish a burning player",
			hidden: true,
			imageID: "95009037532190",
		});

		// granted to the extinguisher; only worked once players could actually catch fire
		this.event.subscribe(spreadingFire.extinguished, (extinguisher, _blocks, playersExtinguished) => {
			if (extinguisher !== player) return;
			if (playersExtinguished.isEmpty()) return;
			this.set({ completed: true });
		});
	}
}

@injectable
class AchievementEveryMaterial extends Achievement {
	constructor(
		@inject player: Player,
		@inject plots: SharedPlots,
		@inject building: PlayerDataStorageRemotesBuilding,
		@inject serverPlayerController: ServerPlayerController,
	) {
		super(player, {
			id: "EVERY_MATERIAL",
			name: "How did we get here?",
			description: "Have a block of every material on your plot at the same time",
			hidden: true,
			max: BuildingManager.AllowedMaterials.size(),
			units: "precise",
			imageID: "92371646247437",
		});

		// remove() can't read a destroyed/repainted instance — it finds the owner set via Set.delete
		const materialBlocks = new Map<Enum.Material, Set<BlockModel>>();

		const add = (block: BlockModel) => {
			const mat = BlockManager.manager.material.get(block) ?? Enum.Material.Plastic;
			// only count materials the target set (AllowedMaterials) includes, so an out-of-set material
			// can't inflate the distinct count to the max without genuinely having every allowed material
			if (!BuildingManager.AllowedMaterials.includes(mat)) return;
			materialBlocks.getOrSet(mat, () => new Set()).add(block);
		};
		const remove = (block: BlockModel) => {
			for (const [mat, blocks] of materialBlocks) {
				if (!blocks.delete(block)) continue;
				if (blocks.size() === 0) materialBlocks.delete(mat);
				break;
			}
		};
		const check = () => this.set({ progress: materialBlocks.size() });
		const rescan = () => {
			materialBlocks.clear();
			const blocks = plots.getPlotComponentByOwnerID(player.UserId).getBlocks();
			for (const block of blocks) add(block);
			check();
		};

		const isOwnPlot = (plot: PlotModel) => plots.getPlotComponent(plot).ownerId.get() === player.UserId;

		this.event.subscribe(building.placeBlocks.processed, (_, arg, response) => {
			if (!isOwnPlot(arg.plot)) return;
			for (const model of response.models) add(model);
			check();
		});

		this.event.subscribe(building.deleteBlocks.processed, (_, arg) => {
			if (!isOwnPlot(arg.plot)) return;
			if (arg.blocks === "all") {
				materialBlocks.clear();
				check();
				return;
			}

			for (const block of arg.blocks) remove(block);
			check();
		});

		this.event.subscribe(building.paintBlocks.processed, (_, arg) => {
			if (arg.material === undefined) return; // colour-only repaint
			if (!isOwnPlot(arg.plot)) return;
			if (arg.blocks === "all") return rescan();

			for (const block of arg.blocks) {
				remove(block);
				add(block);
			}
			check();
		});

		// Bulk events replace block instances wholesale — recount from the live plot.
		const slots = serverPlayerController.remotes.slots;
		this.event.subscribe(slots.load.processed, (p) => {
			if (p === player) rescan();
		});

		this.event.subscribe(slots.loadFromHistory.processed, (p) => {
			if (p === player) rescan();
		});

		this.$onInjectAuto((playModeController: PlayModeController) => {
			// ride→build regenerates every block instance, leaving stale instances in materialBlocks.
			this.event.subscribe(CustomRemotes.modes.setOnClient.sent, () => {
				if (playModeController.getPlayerMode(player) !== "build") return;
				rescan();
			});
		});

		this.onEnable(() => rescan());
	}
}

@injectable
class AchievementCartographer extends Achievement<{ chunks_generated: number }> {
	constructor(@inject player: Player) {
		const target = 5_000;
		super(player, {
			id: "CARTOGRAPHER",
			name: "Cartographer",
			description: `Generate ${target} unique terrain chunks`,
			max: target,
			units: "precise",
			imageID: "111212518009456",
		});

		this.onEnable(() => {
			// getData will return 0 or undefined if run before enable
			let generated = this.getData()?.chunks_generated ?? 0;
			this.event.subscribe(CustomRemotes.achievements.reportChunks.invoked, (p, delta) => {
				if (p !== player) return;
				// clamp: one spoofed packet can't finish it
				generated += math.clamp(math.floor(delta), 0, 100);
				this.set({ progress: generated, chunks_generated: generated });
			});
		});
	}
}

export const allAchievements: readonly ConstructorOf<Achievement>[] = [
	AchievementWelcome,
	AchievementLuaCircuitObtained,
	AchievementPlaytime1H,
	AchievementPlaytime4H,
	AchievementPlaytime12H,
	AchievementPlaytime36H,
	AchievementPlaytime72H,
	AchievementPlaytime120H,
	AchievementAfkTime,

	AchievementHeightRecord25k,
	AchievementHeightRecord75k,
	AchievementHeightRecord150k,
	AchievementHeightRecord500k,

	AchievementSpeedRecord1k,
	AchievementSpeedRecord5k,
	AchievementSpeedRecord15k,
	AchievementSpeedRecord50k,
	AchievementSpeedRecord100k,

	AchievementRotationalSpeedRecord50,
	AchievementRotationalSpeedRecord150,
	AchievementRotationalSpeedRecord1500,
	AchievementRotationalSpeedRecord9K,

	AchievementCatchOnFire,
	AchievementFireExtinguished,
	AchievementPlayerExtinguished,
	AchievementEveryMaterial,
	AchievementCartographer,
	AchievementScaleAnything,
	AchievementClearPlot,
	AchievementColliderTool,
	AchievementInvisible,
	AchievementInvisibleBox, // duran duran

	AchievementMassSensor100K,
	AchievementMassSensor1M,

	AchievementTutorial,
	AchievementBlocksPlaced_100,
	AchievementBlocksPlaced_1K,
	AchievementBlocksPlaced_10K,
	AchievementBlocksPlaced_100K,

	AchievementTheIssue,
	AchievementWingScale,
	AchievementOverclock,
	AchievementFOVMax,
	AchievementFOVMin,

	// map-specific ones
	AchievementBreakSomething,
	AchievementFindBanana,
	AchievementFindUFO,
	BonkBonkByeBye,

	AchievementCentrifuge30seconds,
	AchievementCentrifuge20seconds,
	AchievementCentrifuge10seconds,
	AchievementCentrifuge5seconds,

	AchievementAmogusTrack20seconds,
	AchievementAmogusTrack15seconds,
	AchievementAmogusTrack10seconds,

	AchievementOvalTrack20seconds,
	AchievementOvalTrack15seconds,
	AchievementOvalTrack10seconds,

	AchievementAirRingsEasy,
	AchievementAirRingsMedium,
	AchievementAirRingsHard,
];
