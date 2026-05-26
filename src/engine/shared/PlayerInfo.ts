import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Signal } from "engine/shared/event/Signal";

type PlayerCharacter = Model & {
	Humanoid: Humanoid;
	HumanoidRootPart: Part;
};

export class PlayerInfo extends InstanceComponent<Player> {
	readonly character = new ObservableValue<PlayerCharacter | undefined>(undefined);
	readonly humanoid = new ObservableValue<Humanoid | undefined>(undefined);
	readonly rootPart = new ObservableValue<BasePart | undefined>(undefined);

	readonly spawnEvent = new Signal();
	readonly diedEvent = new Signal();

	constructor(player: Player) {
		super(player, { destroyInstanceOnComponentDestroy: false });

		const playerSpawned = () => {
			const char = player.Character!;
			this.character.set(char as PlayerCharacter);

			const h = char.WaitForChild("Humanoid") as Humanoid;
			h.Died.Once(() => {
				this.character.set(undefined);
				this.humanoid.set(undefined);
				this.rootPart.set(undefined);

				this.diedEvent.Fire();
			});

			this.humanoid.set(h);
			this.rootPart.set(char.WaitForChild("HumanoidRootPart") as Part);

			this.spawnEvent.Fire();
		};

		this.event.subscribe(player.CharacterAdded, () => {
			if (!player.HasAppearanceLoaded()) {
				player.CharacterAppearanceLoaded.Wait();
			}

			playerSpawned();
		});

		this.onEnable(() => {
			if (player.Character) {
				playerSpawned();
			}
		});
	}

	/** Native `PlayerModule` library */
	getPlayerModule(): PlayerModule {
		const instance = this.instance
			.FindFirstChildOfClass("PlayerScripts")!
			.WaitForChild("PlayerModule") as ModuleScript;
		return require(instance) as PlayerModule;
	}
}
