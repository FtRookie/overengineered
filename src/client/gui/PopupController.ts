import { ServiceIntegrityChecker } from "client/integrity/ServiceIntegrityChecker";
import { AutoUIScaledComponent } from "engine/client/gui/AutoUIScaledControl";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { Colors } from "engine/shared/Colors";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { OverlayValueStorage } from "engine/shared/component/OverlayValueStorage";
import { HostedService } from "engine/shared/di/HostedService";
import { Element } from "engine/shared/Element";
import { EventHandler } from "engine/shared/event/EventHandler";
import type { BlurController } from "client/controller/BlurController";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";

export type { Popup };
class Popup extends InstanceComponent<ScreenGui> {
	readonly bg;

	constructor(readonly control: InstanceComponent<GuiObject>) {
		const gui = Element.create("ScreenGui", { Name: `popup_${control.instance.Name}`, IgnoreGuiInset: true });
		ServiceIntegrityChecker.whitelistInstance(gui);

		super(gui);

		this.parentGui(control);
		this.getComponent(AutoUIScaledComponent);

		const bg = this.parent(
			new Control(
				Element.create("Frame", {
					Size: new UDim2(1, 0, 1, 0),
					BackgroundColor3: Colors.black,
					ZIndex: -9999,
				}),
			),
		);
		this.bg = bg;

		const visible = control.visibilityComponent().visible;
		bg.valuesComponent()
			.get("BackgroundTransparency")
			.addBasicTransform()
			.addChildOverlay(visible.createBased((enabled) => (enabled ? 0.5 : 1)));
		bg.valuesComponent() //
			.get("Active")
			.addChildOverlay(visible);

		control //
			.visibilityComponent()
			.addWaitForTransform(bg.valuesComponent().get("BackgroundTransparency"));

		control.onDisable(() => this.disable());
		control.onDestroy(() => this.destroy());

		this.onInject((di) => {
			const blur = di.resolve<BlurController>();
			this.event.subscribeDestroyable(
				blur.blur.addChildOverlay(visible.createBased((visible) => (visible ? 12 : undefined))),
			);
		});
	}
}

@injectable
export class PopupController extends HostedService {
	private readonly _isShown;
	readonly isShown: ReadonlyObservableValue<boolean>;
	private readonly children;
	readonly screen: ScreenGui;

	constructor(@inject blur: BlurController) {
		super();
		this.screen = Interface.getPopupUI();

		this.children = this.parent(new ComponentChildren<Popup>()) //
			.withParentInstance(this.screen);

		this._isShown = OverlayValueStorage.bool();
		{
			const updateVisibility = () => {
				this._isShown.and(
					undefined,
					this.children.children.get().any((c) => c.control.visibilityComponent().visible.get()),
				);
			};

			const eh = new EventHandler();
			this.onDisable(() => eh.unsubscribeAll());
			this.event.subscribeObservable(this.children.children, (items) => {
				eh.unsubscribeAll();

				for (const item of items) {
					const sub = item.control.visibilityComponent().visible.subscribe(updateVisibility);
					eh.register(sub);
				}

				updateVisibility();
			});
		}

		this.isShown = this._isShown;
		this.event.subscribeDestroyable(
			blur.blur.addChildOverlay(this.isShown.createBased((visible) => (visible ? 12 : undefined))),
		);

		const controls = LocalPlayer.getPlayerModule().GetControls();
		this.event.subscribeObservable(
			this.isShown,
			(shown) => {
				if (shown) controls.Disable();
				else controls.Enable();
			},
			true,
		);
	}

	showPopup(control: InstanceComponent<GuiObject>): Popup {
		return this.children.add(PopupController.justCreatePopup(control));
	}

	static justCreatePopup(control: InstanceComponent<GuiObject>): Popup {
		return new Popup(control);
	}
}
