import { RunService, Workspace } from "@rbxts/services";
import { Colors } from "engine/shared/Colors";
import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { Strings } from "engine/shared/fixes/String.propmacro";
import { ReplicatedAssets } from "shared/ReplicatedAssets";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";

type Label = BillboardGui & { readonly Label: TextLabel };
type Wing = {
	readonly surface: BasePart;
	readonly color: Color3;
	force?: VectorForce;
	label?: Label;
};

const liftColor = Color3.fromRGB(52, 120, 235);
const downforceColor = Color3.fromRGB(235, 64, 52);

/**
 * Shows the vertical force each simplified-aerodynamics wing is applying: a tint from red (downforce) through white to
 * blue (lift), scaled against the strongest wing, and a value label.
 */
export class AeroVisualizer extends Component {
	constructor(
		surfaces: readonly BasePart[],
		tint: ReadonlyObservableValue<boolean>,
		values: ReadonlyObservableValue<boolean>,
	) {
		super();

		const parent = new Instance("Folder");
		parent.Name = "AeroVisualizer";
		parent.Parent = Workspace;
		ComponentInstance.init(this, parent);

		const labelTemplate = this.asTemplate(ReplicatedAssets.waitForAsset<Label>("Wires", "MarkerValue"), false);
		const wings: Wing[] = surfaces.map((surface) => ({ surface, color: surface.Color }));

		const restoreColors = () => {
			for (const wing of wings) {
				wing.surface.Color = wing.color;
			}
		};
		this.event.subscribeObservable(tint, (enabled) => {
			if (!enabled) restoreColors();
		});
		this.onDestroy(restoreColors);

		this.event.subscribeObservable(values, (enabled) => {
			for (const wing of wings) {
				if (wing.label) wing.label.Enabled = enabled;
			}
		});

		const lifts = new Map<Wing, number>();
		this.event.subscribe(RunService.PostSimulation, () => {
			let strongest = 1;
			for (const wing of wings) {
				if (wing.surface.Parent === undefined) continue;

				wing.force ??= wing.surface.FindFirstChildOfClass("VectorForce");
				const force = wing.force;
				const lift = force && force.Enabled ? wing.surface.CFrame.VectorToWorldSpace(force.Force).Y : 0;

				lifts.set(wing, lift);
				strongest = math.max(strongest, math.abs(lift));
			}

			const showTint = tint.get();
			const showValues = values.get();
			for (const [wing, lift] of lifts) {
				if (showTint) {
					const ratio = lift / strongest;
					wing.surface.Color =
						ratio >= 0 ? Colors.white.Lerp(liftColor, ratio) : Colors.white.Lerp(downforceColor, -ratio);
				}

				if (showValues) {
					wing.label ??= (() => {
						const label = labelTemplate();
						label.AlwaysOnTop = true;
						label.Adornee = wing.surface;
						label.Parent = parent;
						return label;
					})();
					wing.label.Label.Text = Strings.prettyKMB(math.round(lift));
				}
			}
		});
	}
}
