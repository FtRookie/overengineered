import { RunService, TextChatService, UserInputService } from "@rbxts/services";
import { CheckBoxControl } from "client/gui/controls/CheckBoxControl";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { PartialControl } from "engine/client/gui/PartialControl";
import { Component } from "engine/shared/component/Component";
import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { Transforms } from "engine/shared/component/Transforms";
import { HostedService } from "engine/shared/di/HostedService";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Strings } from "engine/shared/fixes/String.propmacro";
import { CustomRemotes } from "shared/Remotes";
import { ReplicatedAssets } from "shared/ReplicatedAssets";
import type { CheckBoxControlDefinition } from "client/gui/controls/CheckBoxControl";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";
import type { baseAchievementStats } from "server/Achievement";
import type { AchievementData } from "shared/AchievementData";

const defaultAchievementId = 18887954146;

type AchievementNotificationParts = {
	readonly NameLabel: TextLabel;
	readonly DescriptionLabel: TextLabel;
	readonly IconImage: ImageLabel;
	readonly RareGradient: UIGradient;
};
class AchievementNotification extends PartialControl<AchievementNotificationParts> {
	constructor(gui: GuiObject, info: baseAchievementStats) {
		super(gui);

		this.parts.NameLabel.Text = info.name;
		this.parts.DescriptionLabel.Text = info.description;
		this.parts.IconImage.Image = `rbxassetid://${info.imageID ?? defaultAchievementId}`;

		if (info.hidden) {
			this.parts.RareGradient.Enabled = true;
			this.gui.BackgroundColor3 = Color3.fromRGB(129, 0, 129);
		} else {
			this.parts.RareGradient.Enabled = false;
			this.gui.BackgroundColor3 = Color3.fromRGB(1, 4, 9);
		}
	}
}
class NotificationController extends Component {
	constructor(
		achievements: ReadonlyObservableValue<{
			readonly order: readonly string[];
			readonly data: { readonly [x: string]: baseAchievementStats };
		}>,
	) {
		super();

		const template = this.asTemplate(
			Interface.getInterface<{ Floating: { AchievementNotification: GuiObject } }>().Floating
				.AchievementNotification,
		);

		const parent = this.parent(new InstanceComponent(Interface.getInterface<{ Floating: GuiObject }>().Floating));

		let isShowing = false;
		const show = (info: baseAchievementStats) => {
			if (isShowing) {
				task.spawn(() => {
					while (isShowing) {
						task.wait();
					}

					show(info);
				});
				return;
			}

			const notif = parent.parent(new AchievementNotification(template(), info));
			notif.setVisibleAndEnabled(true);

			isShowing = true;
			Transforms.create() //
				.transform(notif.instance, "AnchorPoint", new Vector2(0, 0))
				.move(notif.instance, new UDim2(1, 20, 0, 180))
				.then()
				.transform(notif.instance, "AnchorPoint", new Vector2(1, 0), { duration: 1, style: "Exponential" })
				.move(notif.instance, new UDim2(1, -20, 0, 180), { duration: 1, style: "Exponential" })
				.then()
				.wait(5)
				.then()
				.transform(notif.instance, "AnchorPoint", new Vector2(0, 0), {
					duration: 1,
					direction: "In",
					style: "Exponential",
				})
				.move(notif.instance, new UDim2(1, 20, 0, 180), { duration: 1, direction: "In", style: "Exponential" })
				.then()
				.destroy(notif.instance)
				.func(() => (isShowing = false))
				.run(notif);
		};

		this.event.subscribe(CustomRemotes.achievements.update.invoked, (datas) => {
			for (const [k, v] of pairs(datas)) {
				if (!v.completed) continue;

				const info = achievements.get().data[k];
				if (!info) continue;

				show(info);
			}
		});
	}
}

type AchievementControlParts = {
	readonly TitleLabel: TextLabel;
	readonly DescriptionLabel: TextLabel;
	readonly ProgressButton: TextButton;
	readonly IconImage: ImageLabel;

	readonly ProgressBar: GuiObject & {
		readonly Fill: GuiObject;
		readonly ValueLabel: TextLabel;
	};
};
class AchievementControl extends PartialControl<AchievementControlParts> {
	constructor(
		gui: GuiObject,
		readonly info: baseAchievementStats,
	) {
		super(gui);

		this.parts.TitleLabel.Text = info.name;
		this.parts.DescriptionLabel.Text = info.description;
		this.parts.IconImage.Image = `rbxassetid://${info.imageID ?? defaultAchievementId}`;

		this.update({});

		this.event.loop(1, () => {
			if (!this.data) return;
			this.update(this.data);
		});
	}

	private data?: AchievementData;
	getCachedData() {
		return this.data;
	}
	update(data: AchievementData) {
		this.data = data;
		const showHiddenInStudio = true;
		if (this.info.hidden) {
			const showInStudio = showHiddenInStudio && RunService.IsStudio();
			this.visibilityComponent().setVisible(showInStudio || (data.completed ?? false), "hiddenach");
		} else this.visibilityComponent().setVisible(true);

		const visualizeText = (num: number): string => {
			if (!this.info.units) {
				return Strings.prettyKMT(num);
			}
			if (this.info.units === "time") {
				return Strings.prettyTime(num);
			}
			if (this.info.units === "precise") {
				return tostring(math.round(num * 100) / 100);
			}

			this.info.units satisfies never;
			throw "what";
		};

		if (data.completed && data.completionDateUnix) {
			let completionAgo = DateTime.fromUnixTimestamp(data.completionDateUnix).ToIsoDate();
			completionAgo = Strings.prettySecondsAgo(DateTime.now().UnixTimestamp - data.completionDateUnix);

			this.parts.ProgressButton.Text = `COMPLETED\n${completionAgo}`;
			this.parts.ProgressButton.BackgroundColor3 = Color3.fromRGB(30, 90, 44);
		} else {
			if (this.info.max) {
				this.parts.ProgressButton.Text = `${visualizeText(data.progress ?? 0)}/${visualizeText(this.info.max)}`;
			} else {
				this.parts.ProgressButton.Text = "NOT COMPLETED";
			}

			if (data.progress && data.progress > 0) {
				this.parts.ProgressButton.BackgroundColor3 = Color3.fromRGB(50, 50, 120);
			} else {
				this.parts.ProgressButton.BackgroundColor3 = Color3.fromRGB(90, 90, 90);
			}
		}

		this.parts.ProgressBar.Visible = this.info.max !== undefined;
		if (this.info.max) {
			let progress = (data.progress ?? 0) / this.info.max;
			if (data.completed) {
				progress = 1;
			}

			this.parts.ProgressBar.Fill.Size = new UDim2(progress, 0, 1, 0);
			this.parts.ProgressBar.ValueLabel.Text = `${math.round(progress * 100 * 100) / 100}%`;
		}
	}
}

export type AchievementsGuiParts = {
	readonly Settings: GuiObject;
	readonly TemplatePB: GuiObject;
	readonly ScrollingFrame: ScrollingFrame;
	readonly TotalProgressBar: GuiObject & {
		readonly Fill: GuiObject;
		readonly ValueLabel: TextLabel;
	};
};

@injectable
export class AchievementsGui extends PartialControl<AchievementsGuiParts> {
	constructor(
		gui: GuiObject,
		@inject playerData: PlayerDataStorage,
		@inject achievementController: AchievementController,
	) {
		super(gui);

		type settings = {
			readonly CompletedCheckbox: CheckBoxControlDefinition;
			readonly NoncompletedCheckbox: CheckBoxControlDefinition;
		};
		const settings = this.parent(new PartialControl<settings>(this.parts.Settings));
		const completedcb = this.parent(new CheckBoxControl(settings.parts.CompletedCheckbox));
		completedcb.value.set(true);
		const noncompletedcb = this.parent(new CheckBoxControl(settings.parts.NoncompletedCheckbox));
		noncompletedcb.value.set(true);

		const template = this.asTemplate(this.parts.TemplatePB);

		const achs: { [k in string]: AchievementControl } = {};
		const as = achievementController.allAchievements.get();

		const orderMap = as.order.mapToMap((v, i) => $tuple(v, i));
		const sortedOrder = [...as.order].sort((l, r) => {
			const lc = playerData.achievements.get()?.[l]?.completed ?? false;
			const rc = playerData.achievements.get()?.[r]?.completed ?? false;

			if (lc && !rc) return false;
			if (rc && !lc) return true;

			return (orderMap.get(l) ?? 0) < (orderMap.get(r) ?? 1);
		});
		const sf = this.parent(new Control(this.parts.ScrollingFrame));
		for (const id of sortedOrder) {
			achs[id] = sf.parent(new AchievementControl(template(), as.data[id]));
		}

		const updateFilters = () => {
			const completed = completedcb.value.get() ?? false;
			const noncompleted = noncompletedcb.value.get() ?? false;

			for (const [, ach] of pairs(achs)) {
				const achcompleted = ach.getCachedData()?.completed;
				if (achcompleted) {
					ach.visibilityComponent().setVisible(completed, "filter");
				} else {
					ach.visibilityComponent().setVisible(noncompleted, "filter");
				}
			}
		};
		completedcb.value.subscribe(updateFilters);
		noncompletedcb.value.subscribe(updateFilters);

		this.event.subscribeObservable(
			playerData.achievements,
			(datas) => {
				let completed = 0;
				for (const [id, data] of pairs(datas)) {
					if (!(id in achs)) continue;
					achs[id].update(data);

					if (data.completed) {
						completed++;
					}
				}

				const total = as.order.size();
				this.parts.TotalProgressBar.Fill.Size = new UDim2(completed / total, 0, 1, 0);
				this.parts.TotalProgressBar.ValueLabel.Text = `Achievement completion: ${completed}/${total}`;
			},
			true,
		);
	}
}

export class AchievementController extends HostedService {
	readonly allAchievements;

	constructor() {
		super();

		this.allAchievements = new ObservableValue<{
			readonly order: readonly string[];
			readonly data: { readonly [x: string]: baseAchievementStats };
		}>({ order: [], data: {} });

		this.event.subscribe(CustomRemotes.achievements.loaded.invoked, (data) => {
			print(`[ach] CLIENT received loaded: ${data.order.size()} achievements`);
			this.allAchievements.set(data);
		});

		this.parent(new NotificationController(this.allAchievements));

		const hiddenAchSound = ReplicatedAssets.waitForAsset<Sound>("Effects", "AchievementUnlock", "Hidden");
		const commonAchSound = ReplicatedAssets.waitForAsset<Sound>("Effects", "AchievementUnlock", "Common");

		this.event.subscribe(CustomRemotes.achievements.ahievementUnlock.invoked, ({ player, id }) => {
			// broadcast can arrive before our own `loaded` (or for an id we don't know) — skip it
			const info = this.allAchievements.get().data[id];
			if (!info) return;
			const { hidden, name } = info;

			const channel = TextChatService.FindFirstChild("TextChannels")?.FindFirstChild("RBXGeneral") as TextChannel;

			if (hidden) {
				channel?.DisplaySystemMessage(
					`<b><font color='#FF0000'>${player.DisplayName}</font> obtained secret achievement <font color='#B88FFF'>"${name}"</font>!</b>`,
				);
				hiddenAchSound.TimePosition = 0;
				hiddenAchSound.Play();
			} else {
				channel?.DisplaySystemMessage(
					`<font color='#FF0000'>${player.DisplayName}</font> unlocked achievement <font color='#FFD700'>"${name}"</font>!`,
				);
				commonAchSound.TimePosition = 0;
				commonAchSound.Play();
			}
		});

		let tsk: thread;
		let sent = false;
		this.event.subscribe(UserInputService.InputBegan, () => {
			if (!sent) {
				sent = true;
				CustomRemotes.achievements.isAfk.send(false);
			}
			if (tsk) task.cancel(tsk);
			tsk = task.delay(60, () => {
				sent = false;
				CustomRemotes.achievements.isAfk.send(true);
			});
		});
	}
}
