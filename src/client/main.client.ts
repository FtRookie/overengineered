import { ContentProvider, Players, ReplicatedStorage, RunService, Workspace } from "@rbxts/services";
import { LoadingController } from "client/controller/LoadingController";
import { BSOD } from "client/gui/BSOD";
import { SandboxGame } from "client/SandboxGame";
import { Interface } from "engine/client/gui/Interface";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { Instances } from "engine/shared/fixes/Instances";
import { GameHostBuilder } from "engine/shared/GameHostBuilder";
import { gameInfo } from "shared/GameInfo";

LocalPlayer.character.waitOnceFor(
	(character) => character !== undefined,
	(character) =>
		character.PivotTo(
			Instances.waitForChild<SpawnLocation>(Workspace, "Map", "SpawnLocation").CFrame.add(new Vector3(0, 1, 0)),
		),
);

task.spawn(() => {
	const allSoundIDs = ReplicatedStorage.Assets.GetDescendants().filter((value) => value.IsA("Sound"));
	ContentProvider.PreloadAsync(allSoundIDs);
});

const host = LoadingController.run("Initializing", () => {
	Interface.getInterface<{ Version: TextLabel }>().Version.Text =
		`v${RunService.IsStudio() ? "studio" : game.PlaceVersion}`;

	const builder = new GameHostBuilder(gameInfo);
	try {
		SandboxGame.initialize(builder);
	} catch (err) {
		BSOD.showWithDefaultText(err, "The game has failed to load.");
		throw err;
	}

	const host = LoadingController.run("Initializing services", () => builder.build());
	LoadingController.run("Starting services", () => host.run());

	return host;
});

//testing
//RunService.IsStudio() &&
if (Players.LocalPlayer.Name === "samlovebutter") {
	//&& (false as boolean)
	/*
	task.spawn(() => {
		while (true as boolean) {
			PlasmaProjectile.spawn.send({
				startPosition: new Vector3(369, -16377, 330),
				baseVelocity: new Vector3(
					0 + (math.random() - 0.5) * 10,
					20 + (math.random() - 0.5) * 10,
					-(500 + (math.random() - 0.5) * 10),
				),
				baseDamage: 1,
			});
			task.wait(0.1);
		}
	});

	task.spawn(() => {
		while (true as boolean) {
			BulletProjectile.spawn.send({
				startPosition: new Vector3(379, -16377, 330),
				baseVelocity: new Vector3(
					0 + (math.random() - 0.5) * 10,
					20 + (math.random() - 0.5) * 10,
					-(500 + (math.random() - 0.5) * 10),
				),
				baseDamage: 1,
			});
			task.wait(0.1);
		}
	});

	LaserProjectile.spawn.send({
		startPosition: new Vector3(359, -16377, 330),
		baseVelocity: new Vector3(
			0 + (math.random() - 0.5) * 10,
			20 + (math.random() - 0.5) * 10,
			-(500 + (math.random() - 0.5) * 10),
		),
		baseDamage: 1,
	});
	
	*/
}
