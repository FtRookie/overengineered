import { ReplicatedStorage, RunService, Workspace } from "@rbxts/services";
import { Interface } from "engine/client/gui/Interface";
import { Colors } from "engine/shared/Colors";
import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { Element } from "engine/shared/Element";
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

/** Whole below ten thousand, then thousands or millions to a tenth: 1320, 13.2k, 1.3M */
const compact = (value: number) => {
	const whole = math.round(value);
	const size = math.abs(whole);
	if (size < 10_000) return tostring(whole);
	if (size < 1_000_000) return `${string.format("%.1f", value / 1_000)}k`;
	return `${string.format("%.1f", value / 1_000_000)}M`;
};

const liftColor = Color3.fromRGB(52, 120, 235);
const downforceColor = Color3.fromRGB(235, 64, 52);
const noLiftColor = Colors.grayscale(128);
const disabledColor = Colors.black;

/**
 * Shows the vertical force each simplified-aerodynamics wing is applying: a tint from red (downforce) through gray (none)
 * to blue (lift), scaled against the strongest wing, black for a wing whose force is off, and a value label.
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

		const lifts = new Map<Wing, number | undefined>();
		this.event.subscribe(RunService.PostSimulation, () => {
			let strongest = 1;
			for (const wing of wings) {
				if (wing.surface.Parent === undefined) continue;

				wing.force ??= wing.surface.FindFirstChildOfClass("VectorForce");
				const force = wing.force;
				// a wing without a working force is disabled, and lifts nothing
				const lift = force && force.Enabled ? wing.surface.CFrame.VectorToWorldSpace(force.Force).Y : undefined;

				lifts.set(wing, lift);
				if (lift !== undefined) strongest = math.max(strongest, math.abs(lift));
			}

			const showTint = tint.get();
			const showValues = values.get();
			for (const [wing, liftOrDisabled] of lifts) {
				const lift = liftOrDisabled ?? 0;
				if (showTint) {
					const ratio = lift / strongest;
					wing.surface.Color =
						liftOrDisabled === undefined
							? disabledColor
							: ratio >= 0
								? noLiftColor.Lerp(liftColor, ratio)
								: noLiftColor.Lerp(downforceColor, -ratio);
				}

				if (showValues) {
					wing.label ??= (() => {
						const label = labelTemplate();
						label.AlwaysOnTop = true;
						label.Adornee = wing.surface;
						label.Parent = parent;
						return label;
					})();
					wing.label.Label.Text = compact(lift);
				}
			}
		});
	}
}

const pressureColor = Color3.fromRGB(255, 220, 60);

/**
 * The whole vehicle's Roblox fluid forces, for the realistic aerodynamics modes: a FluidForceSensor on the vehicle's
 * heaviest assembly, split against the direction of travel into lift, drag and side force. A sensor reports its whole
 * assembly, so a vehicle welded together reads as one, and wings can't be told apart.
 */
export class AeroReadout extends Component {
	constructor(parts: () => readonly BasePart[], text: TextLabel, pressure: ReadonlyObservableValue<boolean>) {
		super();

		// drawn the way the Center of Mass tool draws its markers, so they show through the vehicle
		const viewport = Element.create("ViewportFrame", {
			Name: "AeroReadout",
			Size: UDim2.fromScale(1, 1),
			CurrentCamera: Workspace.CurrentCamera,
			Transparency: 1,
			Ambient: Colors.white,
			LightColor: Colors.white,
			ZIndex: -1000,
			Parent: Interface.getInterface(),
		});
		ComponentInstance.init(this, viewport);

		const sensor = new Instance("FluidForceSensor");
		this.onDestroy(() => sensor.Destroy());

		// the Center of Mass tool's whole-vehicle marker, and the same marker in yellow for the centre of pressure
		const massMarker = ReplicatedStorage.Assets.Helpers.CenterOfMassMachine.Clone();
		const pressureMarker = ReplicatedStorage.Assets.Helpers.CenterOfMassMachine.Clone();
		pressureMarker.Name = "CenterOfPressure";
		for (const part of pressureMarker.GetDescendants()) {
			if (part.IsA("BasePart")) part.Color = pressureColor;
		}
		const showMarkers = (shown: boolean) => {
			massMarker.Parent = shown ? viewport : undefined;
			pressureMarker.Parent = shown ? viewport : undefined;
		};
		this.onDestroy(() => {
			massMarker.Destroy();
			pressureMarker.Destroy();
		});

		/** The root of the heaviest assembly among the vehicle's parts */
		const heaviestRoot = () => {
			let best: BasePart | undefined;
			for (const part of parts()) {
				if (part.Parent === undefined) continue;

				const root = part.AssemblyRootPart;
				if (root && (!best || root.AssemblyMass > best.AssemblyMass)) best = root;
			}
			return best;
		};

		const line = (name: string, value: string) => `<b>${name}</b>  ${value}`;
		this.event.subscribe(RunService.PostSimulation, () => {
			// a block breaking off can leave the sensor on a fragment, so it follows the heaviest assembly
			const root = heaviestRoot();
			if (!root) {
				text.Text = "No vehicle";
				showMarkers(false);
				return;
			}
			if (sensor.Parent !== root) sensor.Parent = root;

			const force = sensor.Force;
			const velocity = root.AssemblyLinearVelocity;
			const speed = velocity.Magnitude;

			let lift = 0;
			let drag = 0;
			let side = 0;
			if (speed > 0.01) {
				const travel = velocity.div(speed);
				drag = -force.Dot(travel);

				// lift is the force across the travel direction measured along "up" as seen from that direction,
				// side force whatever is left across it
				const across = force.sub(travel.mul(force.Dot(travel)));
				const upAcross = Vector3.yAxis.sub(travel.mul(travel.Y));
				const up = upAcross.Magnitude > 0.001 ? upAcross.Unit : Vector3.zAxis;
				lift = across.Dot(up);
				side = across.sub(up.mul(lift)).Magnitude;
			}

			const round = compact;
			text.Text = [
				line("Lift", round(lift)),
				line("Drag", round(drag)),
				line("Side", round(side)),
				line("L/D", drag > 0.01 ? Strings.prettyNumber(lift / drag, 0.01) : "-"),
				line("Airspeed", `${round(speed)} studs/s`),
			].join("\n");

			const showPressure = pressure.get() && force.Magnitude > 0.01;
			showMarkers(showPressure);
			if (!showPressure) return;

			massMarker.PivotTo(new CFrame(root.AssemblyCenterOfMass));
			// the reference calls it an offset from the centre of mass, but in a ride it reads as a world position: it sat
			// within a stud of the plane's centre of mass, 16 thousand studs from the origin
			pressureMarker.PivotTo(new CFrame(sensor.CenterOfPressure));
		});
	}
}
