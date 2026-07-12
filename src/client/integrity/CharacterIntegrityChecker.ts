import { ProtectedClass } from "client/integrity/ProtectedClass";
import { LocalPlayer } from "engine/client/LocalPlayer";
//import type { IntegrityChecker } from "anywaymachines/client/integrity/IntegrityChecker";
import { CustomRemotes } from "shared/Remotes";

const scriptInstances: (keyof Instances)[] = ["LocalScript", "ModuleScript", "Script"];

const forbiddenInstances: (keyof Instances)[] = [
	// Modern movement instances
	"VectorForce",
	"AngularVelocity",
	"LinearVelocity",

	// Legacy movement instances
	"BodyVelocity",
	"BodyGyro",
	"BodyPosition",
	"BodyAngularVelocity",
	"BodyThrust",

	// Anti-ESP's
	"Highlight",
];

export class CharacterIntegrityChecker extends ProtectedClass {
	constructor() {
		super(script, (info) => CustomRemotes.integrityViolation.send(info));

		this.initialize();
	}

	private initialize() {
		LocalPlayer.character.subscribe((character) => {
			if (!character) return;

			character.DescendantAdded.Connect((desc) => {
				task.wait();

				if (forbiddenInstances.includes(desc.ClassName as keyof Instances)) {
					CustomRemotes.integrityViolation.send(`${desc.ClassName} added to character`);
					return;
				}

				if (scriptInstances.includes(desc.ClassName as keyof Instances)) {
					if (desc.Name === "Animate" || desc.Name === "Health") {
						return;
					}

					CustomRemotes.integrityViolation.send(`${desc.ClassName} added to character`);
				}
			});
		}, true);
	}
}
