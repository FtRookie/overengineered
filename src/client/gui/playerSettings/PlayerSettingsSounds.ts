import { ConfigControlList } from "client/gui/configControls/ConfigControlsList";
import { MultiSlider } from "client/gui/MultiSlider";
import type { SoundMixer } from "client/controller/sound/SoundMixer";
import type {
	ConfigControlListDefinition,
	ConfigControlTemplateList,
} from "client/gui/configControls/ConfigControlsList";
import type { ObservableValue } from "engine/shared/event/ObservableValue";

export class PlayerSettingsSounds extends ConfigControlList {
	constructor(gui: ConfigControlListDefinition & ConfigControlTemplateList, value: ObservableValue<PlayerConfig>) {
		super(gui);

		this.onInject((di) => {
			const mixer = di.resolve<SoundMixer>();

			this.addCategory("Master");
			this.addSlider("Master Volume", { min: 0, max: 100, step: 1 }) //
				.initToObjectPart(value, ["sound", "master"], "value");

			for (const group of mixer.getGroups()) {
				const multi = this.parent(new MultiSlider(this.clone(this.gui.MultiSlider), group.title));

				for (const slider of group.sliders) {
					const control = multi.addSlider(slider.name, { min: 0, max: 100, step: 1 });
					control.value.set(value.get().sound.volumes[slider.address] ?? 100);

					// The row is a raw slider, not a ConfigControlBase, so it can't use initToObjectPart —
					// bind by hand. Drag previews live through the mixer (no config churn); release writes the
					// config observable, which the mixer reacts to and SettingsPopup persists on close.
					this.event.subscribe(control.moved, (v) => mixer.previewSound(slider.address, v));
					this.event.subscribe(control.submitted, (v) => {
						const config = value.get();
						value.set({
							...config,
							sound: {
								...config.sound,
								volumes: { ...config.sound.volumes, [slider.address]: v },
							},
						});
					});
				}
			}
		});
	}
}
