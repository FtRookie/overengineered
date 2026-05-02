import { Players } from "@rbxts/services";
import { SavePopup } from "client/gui/popup/SavePopup";
import { ServiceIntegrityChecker } from "client/integrity/ServiceIntegrityChecker";
import { PlayerDataStorage } from "client/PlayerDataStorage";
import { BuildingDiffer } from "client/tutorial2/BuildingDiffer";
import { TestTutorial } from "client/tutorial2/tutorials/TestTutorial";
import { TutorialStarter } from "client/tutorial2/TutorialStarter";
import { TextButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { InputController } from "engine/client/InputController";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { InstanceComponent } from "engine/shared/component/InstanceComponent";
import { HostedService } from "engine/shared/di/HostedService";
import { Element } from "engine/shared/Element";
import { PlayerRank } from "engine/shared/PlayerRank";
import type { PopupController } from "client/gui/PopupController";
import type { TutorialsService } from "client/tutorial/TutorialService";
import type { Component } from "engine/shared/component/Component";
import type { InstanceComponentParentConfig } from "engine/shared/component/InstanceComponent";
import type { GameHost } from "engine/shared/GameHost";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";
import type { Switches } from "engine/shared/Switches";
import type { ReadonlyPlot } from "shared/building/ReadonlyPlot";

class VerticalList extends Control {
	constructor() {
		const gui = Element.create(
			"Frame",
			{
				BackgroundTransparency: 1,
				BorderSizePixel: 0,
				Size: new UDim2(0, 200, 0, 0),
				AutomaticSize: Enum.AutomaticSize.Y,
			},
			{ list: Element.create("UIListLayout", { FillDirection: Enum.FillDirection.Vertical }) },
		);
		super(gui);
	}

	override parent<T extends Component>(child: T, config?: InstanceComponentParentConfig): T {
		const isControl = (component: Component): component is InstanceComponent<GuiObject> => {
			return child instanceof InstanceComponent && (child.instance as Instance).IsA("GuiObject");
		};

		if (
			isControl(child) &&
			child.instance.Size.X.Scale === 0 &&
			child.instance.Size.X.Offset === 0 &&
			child.instance.Size.Y.Scale === 0 &&
			child.instance.Size.Y.Offset === 0
		) {
			child.instance.Size = new UDim2(1, 0, 0, 30);
		}

		return super.parent(child, config);
	}

	addLabel(): Control<TextLabel> {
		return this.parent(new Control(Element.create("TextLabel", { AutomaticSize: Enum.AutomaticSize.Y })));
	}
	addTextBox(placeholder: string, text?: string): Control<TextBox> {
		return this.parent(
			new Control(
				Element.create("TextBox", {
					PlaceholderText: placeholder,
					Text: text ?? undefined,
					ClearTextOnFocus: false,
				}),
			),
		);
	}
	addButton(text: string, action: () => void): TextButtonControl {
		return this.parent(TextButtonControl.create({ Text: text }, action));
	}
}

@injectable
export class AdminGui extends HostedService {
	static initializeIfAdminOrStudio(host: GameHostBuilder) {
		if (!PlayerRank.isAdmin(Players.LocalPlayer)) return;
		host.services.registerService(this);
	}

	constructor(@inject di: DIContainer) {
		super();

		const screen = Element.create("ScreenGui", { Name: "Admin", Enabled: false, Parent: Interface.getPlayerGui() });
		ComponentInstance.init(this, screen);
		ServiceIntegrityChecker.whitelistInstance(screen);

		this.event.onInputBegin((input) => {
			if (input.UserInputType !== Enum.UserInputType.Keyboard) return;
			if (input.KeyCode !== Enum.KeyCode.F7) return;
			if (!InputController.isShiftPressed()) return;

			screen.Enabled = !screen.Enabled;
		});

		const list = this.parent(new VerticalList());
		list.instance.Parent = screen;
		list.addButton("[Hide]", () => (screen.Enabled = false));

		const subframe = Element.create("Frame", {
			BackgroundTransparency: 1,
			BorderSizePixel: 0,
			Size: new UDim2(0, 200, 0, 0),
			AutomaticSize: Enum.AutomaticSize.Y,
			Position: new UDim2(0, 200, 0, 0),
		});
		subframe.Parent = screen;
		ComponentInstance.init(this, subframe);

		const openSub = (control: Control) => {
			subframe.ClearAllChildren();
			this.parent(control);
			control.instance.Parent = subframe;
		};
		const openVertical = (setup: (control: VerticalList) => void) => {
			const sub = new VerticalList();
			setup(sub);

			openSub(sub);
		};

		//

		list.addButton("Switches", () => {
			openVertical((sub) => {
				const map = asMap(di.resolve<Switches>().registered).mapToMap((k, v) =>
					$tuple(k + " " + (v.get() ? "+" : "-"), (di: DIContainer, btn: TextButtonControl) => {
						v.set(!v.get());
						btn.text.set(k + " " + (v.get() ? "+" : "-"));
					}),
				);
				for (const [k, v] of map) {
					const btn = sub.addButton(k, () => v(di, btn));
				}
			});
		});

		list.addButton("Load slot", () => {
			openVertical((sub) => {
				const tb = sub.addTextBox("Player ID", "238427763");
				sub.addButton("Open saves", () => {
					const pds = PlayerDataStorage.forPlayer(tonumber(tb.instance.Text)!);
					const scope = di.beginScope((builder) => {
						builder.registerSingletonValue(pds);
					});

					const popup = scope.resolveForeignClass(SavePopup);
					const wrapper = new Control(popup.instance);
					wrapper.cacheDI(pds);
					wrapper.parent(popup);
					popup.onDisable(() => wrapper.destroy());

					scope.resolve<PopupController>().showPopup(wrapper);
				});
			});
		});

		list.addButton("Tutorials", () => {
			openVertical((sub) => {
				sub.addButton("Set BEFORE", () => BuildingDiffer.setBefore(di.resolve<ReadonlyPlot>()));
				sub.addButton("Print DIFF", () =>
					print(BuildingDiffer.serializeDiffToTsCode(di.resolve<ReadonlyPlot>())),
				);
				sub.addButton("Print FULL", () =>
					print(BuildingDiffer.serializePlotToTsCode(di.resolve<ReadonlyPlot>())),
				);

				for (const tutorial of di.resolve<TutorialsService>().allTutorials) {
					sub.addButton(`run '${tutorial.name}'`, () => di.resolve<TutorialsService>().run(tutorial));
				}

				sub.addButton("[2] Run TestTutorial", () => {
					const stepController = new TutorialStarter();
					TestTutorial.start(stepController, true);
					di.resolve<GameHost>().parent(stepController);
				});
			});
		});
	}
}
