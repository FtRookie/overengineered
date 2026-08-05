import { Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";

type RotationSpec = {
	readonly names: readonly string[];
	/** Max tilt off vertical in degrees, on X and Z. Yaw is always fully random. */
	readonly tilt: number;
	/** Tried in order when the model has no PrimaryPart. */
	readonly rootNames: readonly string[];
};

const specs: readonly RotationSpec[] = [
	{ names: ["Rock", "Bush"], tilt: 360, rootNames: ["Main"] },
	{ names: ["tree1", "tree2"], tilt: 5, rootNames: ["Trunk", "Main"] },
	{ names: ["deadtree"], tilt: 15, rootNames: ["Trunk", "Main"] },
];

/** One-off scatter so map dressing does not read as a grid. Purely cosmetic and client-side. */
@injectable
export class EnvironmentRotationController extends HostedService {
	constructor() {
		super();

		this.onEnable(() => {
			const byName = new Map<string, RotationSpec>();
			for (const spec of specs) {
				for (const name of spec.names) byName.set(name.lower(), spec);
			}

			for (const model of Workspace.GetDescendants()) {
				if (!model.IsA("Model")) continue;

				const spec = byName.get(model.Name.lower());
				if (spec) this.scatter(model, spec);
			}
		});
	}

	private scatter(model: Model, spec: RotationSpec) {
		const root = model.PrimaryPart ?? this.resolveRoot(model, spec.rootNames);
		if (!root) return;

		model.PrimaryPart ??= root;
		root.CFrame = root.CFrame.mul(
			CFrame.Angles(
				math.rad(math.random(-spec.tilt, spec.tilt)),
				math.rad(math.random(-360, 360)),
				math.rad(math.random(-spec.tilt, spec.tilt)),
			),
		);
	}

	// The originals fell back to GetChildren()[0] / [1], which depends on child order and can land on a
	// non-part. Named parts first, then any BasePart.
	private resolveRoot(model: Model, rootNames: readonly string[]): BasePart | undefined {
		for (const name of rootNames) {
			const child = model.FindFirstChild(name);
			if (child?.IsA("BasePart")) return child;
		}

		return model.FindFirstChildWhichIsA("BasePart");
	}
}
