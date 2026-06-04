import { Players, RunService } from "@rbxts/services";
import { ButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { ComponentKeyedChildren } from "engine/shared/component/ComponentKeyedChildren";
import { Transforms } from "engine/shared/component/Transforms";
import { ObservableCollectionSet } from "engine/shared/event/ObservableCollection";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { ArgsSignal } from "engine/shared/event/Signal";
import { PlayerRank } from "engine/shared/PlayerRank";

type FakePlayer = {
	readonly UserId: number;
	readonly DisplayName: string;
	readonly Name: string;
};

type PlayerContainerDefinition = Frame & {
	readonly TextButton: TextButton & {
		readonly ImageLabel: ImageLabel;
		readonly Texts: GuiObject & {
			readonly TitleLabel: TextLabel;
			readonly UsernameLabel: TextLabel;
		};
	};
};
class PlayerContainer extends Control<PlayerContainerDefinition> {
	readonly clicked;

	constructor(
		gui: PlayerContainerDefinition,
		readonly player: FakePlayer,
	) {
		super(gui);

		gui.TextButton.Texts.TitleLabel.Text = player.DisplayName;
		gui.TextButton.Texts.UsernameLabel.Text = `@${player.Name}`;
		task.spawn(() => {
			gui.TextButton.ImageLabel.Image = Players.GetUserThumbnailAsync(
				player.UserId,
				Enum.ThumbnailType.HeadShot,
				Enum.ThumbnailSize.Size100x100,
			)[0];
		});

		const button = this.add(new ButtonControl(gui.TextButton));
		this.clicked = button.activated;
	}
}

export type PlayerSelectorColumnControlDefinition = Frame & {
	readonly Left: Frame & {
		readonly Container: PlayerContainerDefinition;
	};
	readonly Right: Frame;
};

export class PlayerSelectorColumnControl extends Control<PlayerSelectorColumnControlDefinition> {
	private readonly playerTemplate;

	private readonly leftControl;
	private readonly rightControl;

	private updating = false;
	readonly publicValue = new ObservableValue<ReadonlySet<number>>(new ReadonlySet<number>());
	private readonly value = new ObservableCollectionSet<number>();
	readonly submitted = new ArgsSignal<[players: ReadonlySet<number>]>();

	constructor(gui: PlayerSelectorColumnControlDefinition) {
		super(gui);

		this.playerTemplate = this.asTemplate(gui.Left.Container, true);
		this.leftControl = this.parent(
			new ComponentKeyedChildren<FakePlayer, PlayerContainer>().withParentInstance(gui.Left),
		);
		this.rightControl = this.parent(
			new ComponentKeyedChildren<FakePlayer, PlayerContainer>().withParentInstance(gui.Right),
		);

		this.onEnable(() => this.updateOnlinePlayers());
		this.publicValue.changed.Connect((v) => {
			if (this.updating) return;
			this.value.set(v);
			this.updateOnlinePlayers();
		});
		this.event.subscribe(Players.PlayerAdded, (player) => this.addPlayer(player));
		this.event.subscribe(Players.PlayerRemoving, (player) => this.removePlayer(player));
	}

	updateOnlinePlayers() {
		this.leftControl.clear();
		this.rightControl.clear();

		for (const player of Players.GetPlayers()) {
			this.addPlayer(player);
		}

		if (RunService.IsStudio()) {
			const pl: FakePlayer[] = [
				{ DisplayName: "Amongus3", Name: "Sus3", UserId: 123 },
				{ DisplayName: "Amongus4", Name: "Sus4", UserId: 124 },
				{ DisplayName: "Amongus5", Name: "Sus5", UserId: 125 },
			];
			for (const player of pl) {
				this.addPlayer(player);
			}
		}
	}
	private addPlayer(player: FakePlayer) {
		if (player === Players.LocalPlayer) return;
		if (!RunService.IsStudio() && PlayerRank.isDevById(player.UserId)) return;

		const control = new PlayerContainer(this.playerTemplate(), player);
		const instance = control.instance.TextButton;

		if (!this.value.has(player.UserId)) {
			this.leftControl.add(player, control);
		} else {
			this.rightControl.add(player, control);
		}

		const direction = this.leftControl.get(player) ? -1 : 1;
		Transforms.create()
			.func(() => (instance.Visible = false))
			.transform(instance, "BackgroundTransparency", 1)
			.moveRelative(instance, new UDim2(0, direction * 50, 0, 0))
			.wait(this.leftControl.getAll().size() * 0.05)
			.then()
			.func(() => (instance.Visible = true))
			.transform(instance, "BackgroundTransparency", 0, Transforms.quadOut02)
			.moveRelative(instance, new UDim2(0, direction * -50, 0, 0), Transforms.quadOut02)
			.then()
			.func(() => {
				control.clicked.Connect(() => {
					if (!this.value.has(player.UserId)) {
						this.value.add(player.UserId);
					} else {
						this.value.remove(player.UserId);
					}

					this.removePlayer(player);
					this.addPlayer(player);

					this.updating = true;
					this.publicValue.set(this.value.get());
					this.submitted.Fire(this.value.get());
					this.updating = false;
				});
			})
			.run(instance);
	}
	private removePlayer(player: FakePlayer) {
		const control = this.leftControl.get(player) ?? this.rightControl.get(player);
		if (!control) return;

		control.disable();
		control.instance.Interactable = false;

		const direction = this.leftControl.get(player) ? -1 : 1;
		Transforms.create()
			.transform(control.instance.TextButton.Texts.TitleLabel, "TextTransparency", 1, Transforms.quadOut02)
			.transform(control.instance.TextButton.Texts.UsernameLabel, "TextTransparency", 1, Transforms.quadOut02)
			.transform(control.instance.TextButton.ImageLabel, "ImageTransparency", 1, Transforms.quadOut02)
			.moveRelative(control.instance.TextButton, new UDim2(0, direction * 50, 0, 0), Transforms.quadOut02)
			.transform(control.instance.TextButton, "BackgroundTransparency", 1, Transforms.quadOut02)
			.then()
			.func(() => control.destroy())
			.run({});
	}
}
