import { HostedService } from "engine/shared/di/HostedService";
import { allAchievements } from "server/AchievementList";
import { isNotAdmin_AutoBanned } from "server/BanAdminExploiter";
import { CustomRemotes } from "shared/Remotes";
import type { Achievement } from "server/Achievement";
import type { ServerPlayersController } from "server/ServerPlayersController";
import type { AchievementData } from "shared/AchievementData";

const init = (list: AchievementList, player: Player, data: { readonly [x: string]: AchievementData } | undefined) => {
	const instanced = allAchievements.map((ach) => {
		const instance = list.add(ach);
		instance.setData(data?.[instance.info.id]);

		return instance;
	});
	const adata = asObject(list.list.mapToMap((k, v) => $tuple(k, v.info)));
	CustomRemotes.achievements.loaded.send(player, {
		order: instanced.map((c) => c.info.id),
		data: adata,
	});
	for (const v of instanced) list.parent(v);

	return adata;
};

@injectable
class AchievementList extends HostedService {
	readonly list = new Map<string, Achievement>();

	constructor(private readonly player: Player) {
		super();
	}

	add<T extends Achievement>(achievement: ConstructorOf<T>) {
		const di = this.getDI().beginScope((builder) => builder.registerSingletonValue(this.player));

		const instance = di.resolveForeignClass(achievement);
		this.list.set(instance.info.id, instance);

		return instance;
	}

	disable(): void {}
}

@injectable
export class AchievementController extends HostedService {
	constructor(@inject serverPlayersController: ServerPlayersController) {
		super();

		this.event.subscribe(CustomRemotes.achievements.update.sent, (player, data) => {
			for (const [id, v] of pairs(data)) {
				if (!v.completed) continue;
				CustomRemotes.achievements.ahievementUnlock.send("everyone", { player, id });
			}
		});

		this.event.subscribe(CustomRemotes.playerLoaded.invoked, (player) => {
			const controller = serverPlayersController.controllers.get(player.UserId);
			if (!controller) {
				$warn("Could not initialize achievement controller for " + player.Name);
				return;
			}

			const list = controller.parent(new AchievementList(controller.player));
			task.defer(() => {
				const database = serverPlayersController.players;
				const achdata = database.get(player.UserId).achievements;
				init(list, controller.player, achdata);

				// player update sending loop
				controller.event.loop(1, () => {
					const datas: { [k in string]: AchievementData } = {};
					for (const [id, achievement] of list.list) {
						const d = achievement.getChangesForRemote();
						if (!d) continue;

						datas[id] = d;
					}

					if (asMap(datas).isEmpty()) return;

					// $log(`Sending to ${player.Name} achievement datas: ${Strings.pretty(asMap(datas).keys())}`);
					CustomRemotes.achievements.update.send(player, datas);
				});

				const flushDatabase = () => {
					const datas: { [k in string]: AchievementData } = {};
					for (const [id, achievement] of list.list) {
						const d = achievement.getChangesForDatabase();
						if (!d) continue;

						datas[id] = d;
					}

					if (asMap(datas).isEmpty()) return;

					// $log(`Flushing of ${player.Name} achievement datas: ${Strings.pretty(asMap(datas).keys())}`);
					const pdata = database.get(player.UserId);
					database.set(player.UserId, {
						...pdata,
						achievements: { ...(pdata.achievements ?? {}), ...datas },
					});
				};

				// database flushing loop
				controller.event.loop(60, flushDatabase);
				controller.onDestroy(flushDatabase);

				const p = player;
				controller.event.subscribe(CustomRemotes.achievements.admin_reset.invoked, (player, a_list) => {
					if (player !== p) return;
					if (isNotAdmin_AutoBanned(player, "achievement_set")) {
						return;
					}

					for (const id of a_list) list.list.get(id)?.forceSet({});
				});

				controller.event.subscribe(CustomRemotes.achievements.admin_set.invoked, (player, data) => {
					if (player !== p) return;
					if (isNotAdmin_AutoBanned(player, "achievement_set")) {
						return;
					}

					for (const [k, d] of pairs(data)) {
						list.list.get(k)?.forceSet(d);
					}
				});
			});
		});
	}
}
