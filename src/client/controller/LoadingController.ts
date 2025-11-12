import { Workspace } from "@rbxts/services";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { Transforms } from "engine/shared/component/Transforms";
import { ObservableCollectionArr } from "engine/shared/event/ObservableCollection";
import { Instances } from "engine/shared/fixes/Instances";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";

class LoadingImage extends Control {
	constructor(gui: GuiObject) {
		super(gui);

		this.onEnable(() => {
			const startanim = () => {
				if (!this.isEnabled()) return;

				Transforms.create()
					.transform(this.instance, "Rotation", this.instance.Rotation + 90, {
						duration: 0.8,
						style: "Quad",
						direction: "InOut",
					})
					.then()
					.func(startanim)
					.run(this.instance, true);
			};

			Transforms.create()
				.then()
				.transform(
					this.instance,
					"Rotation",
					{ run: "once", func: () => this.instance.Rotation + 270 },
					{
						duration: 0.3,
						style: "Quad",
						direction: "Out",
					},
				)
				.then()
				.func(startanim)
				.run(this.instance, true);
		});

		this.onDisable(() => {
			Transforms.create()
				.transform(
					this.instance,
					"Rotation",
					{ run: "once", func: () => this.instance.Rotation - 270 },
					{
						duration: 0.3,
						style: "Quad",
						direction: "In",
					},
				)
				.run(this.instance, true);
		});
	}
}

type LoadingPopupDefinition = GuiObject & {
	readonly LoadingImage: GuiObject;
	readonly TextLabel: TextLabel;
};
class LoadingPopup extends Control<LoadingPopupDefinition> {
	constructor(gui: LoadingPopupDefinition) {
		super(gui);

		this.parent(new LoadingImage(gui.LoadingImage));

		this.visibilityComponent().addTransform(true, () =>
			Transforms.create()
				.show(this.instance)
				.fadeIn(this.instance, { duration: 0.3, style: "Quad", direction: "Out" })
				.moveY(this.instance, new UDim(0, 80), { duration: 0.3, style: "Quad", direction: "Out" }),
		);
		this.visibilityComponent().addTransform(false, () =>
			Transforms.create()
				.moveY(this.instance, new UDim(0, 40), { duration: 0.4, style: "Quad", direction: "In" })
				.fadeOut(this.instance, { duration: 0.3, style: "Quad", direction: "In" })
				.then()
				.hide(this.instance),
		);

		this.hide();
	}

	setText(text: string) {
		this.instance.TextLabel.Text = text;
	}
}

spawn(() => {
	for (const child of Instances.waitForChild(Workspace, "Map", "Main Island", "Base").GetChildren()) {
		const gui = child.FindFirstChild("SurfaceGui") as SurfaceGui | undefined;
		if (!gui) continue;

		const loading = new LoadingImage(gui.GetChildren()[0] as GuiObject);
		loading.enable();

		task.delay(60, () => gui.Destroy());
	}
});

export namespace LoadingController {
	const state = new ObservableCollectionArr<{ readonly text: string }>();
	export const isLoading: ReadonlyObservableValue<boolean> = state.fReadonlyCreateBased((c) => !c.isEmpty());
	export const isNotLoading: ReadonlyObservableValue<boolean> = isLoading.fReadonlyCreateBased((b) => !b);

	const control = new LoadingPopup(Interface.getInterface<{ Loading: LoadingPopupDefinition }>().Loading);
	state.subscribe((state) => {
		if (state.isEmpty()) {
			control.hide();
			return;
		}

		control.setText(`${state[state.size() - 1].text}...`);
		control.show();
	});

	export function run<T>(text: string, func: () => T): T {
		const key = { text };

		try {
			state.add(key);
			return func();
		} finally {
			state.remove(key);
		}
	}
}
