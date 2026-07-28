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

			this.addCategory("Effects");
			this.addToggle("Supersonic") //
				.setDescription("Silence sound a craft has outrun, leaving a cone of audibility behind it")
				.initToObjectPart(value, ["sound", "supersonicScaling"]);
			this.addToggle("Sonic Booms") //
				.setDescription("Crack as a supersonic craft's cone of audibility sweeps over you")
				.initToObjectPart(value, ["sound", "supersonicBooms"]);
			this.addSlider("Doppler", { min: 0, max: 3, inputStep: 0.1 }) //
				.setDescription("How strongly a passing source shifts pitch. 0 turns the effect off")
				.initToObjectPart(value, ["sound", "dopplerScale"], "value");
			this.addNumber("Distance Factor", 0.1, undefined, undefined) //
				.setDescription("Studs treated as a metre when calculating Doppler")
				.initToObjectPart(value, ["sound", "distanceFactor"], "value");

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
