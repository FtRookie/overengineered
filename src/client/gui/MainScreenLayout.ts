import { LoadingController } from "client/controller/LoadingController";
import { HotbarControl } from "client/gui/buildmode/HotbarControl";
import { ServiceIntegrityChecker } from "client/integrity/ServiceIntegrityChecker";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { PartialControl } from "engine/client/gui/PartialControl";
import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { Transforms } from "engine/shared/component/Transforms";
import { TransformService } from "engine/shared/component/TransformService";
import { Element } from "engine/shared/Element";
import type { HotbarControlDefinition } from "client/gui/buildmode/HotbarControl";
import type { Theme, ThemeColorKey } from "client/Theme";
import type { TextButtonDefinition } from "engine/client/gui/Button";

namespace Top {
	type TopButtonParts = {
		readonly IconImage: ImageLabel;
	};

	type TopButtonConfig = ({ readonly text?: string } | { readonly iconId?: number }) & {
		readonly kind?: "square" | "bottom";
		readonly background?: ThemeColorKey;
		readonly width?: number;
	};
	type MainScreenTopLayerDefinition = GuiObject & {
		readonly ButtonTemplate: TextButtonDefinition;
		readonly BottomButtonTemplate: TextButtonDefinition;
	};
	class MainScreenTopLayer extends Control<MainScreenTopLayerDefinition> {
		private readonly template;
		private readonly bottomTemplate;

		constructor(gui: MainScreenTopLayerDefinition) {
			super(gui);
			this.template = this.asTemplate(gui.ButtonTemplate);
			this.bottomTemplate = this.asTemplate(gui.BottomButtonTemplate);
		}

		addButton(name: string, config: TopButtonConfig): PartialControl<TopButtonParts, TextButtonDefinition> {
			const text = "text" in config ? config.text : undefined;
			const icon = "iconId" in config ? config.iconId : undefined;

			const control = new PartialControl<TopButtonParts, TextButtonDefinition>(
				(config.kind ?? "square") === "square" ? this.template() : this.bottomTemplate(),
			);
			control.instance.Name = name;
			control.setButtonText((text ?? "").upper());
			this.$onInjectAuto((theme: Theme) => control.themeButton(theme, config.background ?? "buttonNormal"));
			control.parts.IconImage.Visible = icon !== undefined;
			control.parts.IconImage.Image = icon ? `rbxassetid://${icon}` : "";
			if (config?.width) {
				control.instance.Size = new UDim2(new UDim(0, config.width), control.instance.Size.Y);
			}

			this.parent(control);
			control.instance.Parent = this.gui;

			return control;
		}
	}

	export type MainScreenTopDefinition = GuiObject & {
		readonly LayerTemplate: MainScreenTopLayerDefinition;
	};
	export class MainScreenTop extends Control<MainScreenTopDefinition> {
		readonly main;
		private readonly template;

		constructor(gui: MainScreenTopDefinition) {
			super(gui);
			gui.LayerTemplate.Visible = false;
			this.template = this.asTemplate(gui.LayerTemplate);

			this.main = this.parentGui(this.push());
		}

		push(): MainScreenTopLayer {
			const control = new MainScreenTopLayer(this.template());
			control.instance.LayoutOrder = this.gui.GetChildren().size();
			control.instance.Parent = this.gui;

			return control;
		}
	}
}
namespace Bottom {
	type BottomButtonDefinition = TextButtonDefinition & {
		readonly Frame: GuiObject & {
			readonly ImageLabel: ImageLabel;
		};
	};

	interface BottomButtonConfig {
		readonly width?: number;
	}
	type MainScreenBottomLayerDefinition = GuiObject & {
		readonly ButtonTemplate: BottomButtonDefinition;
	};
	export type Layer = MainScreenBottomLayer;
	class MainScreenBottomLayer extends Control<MainScreenBottomLayerDefinition> {
		private readonly template;

		constructor(gui: MainScreenBottomLayerDefinition) {
			super(gui);
			this.template = this.asTemplate(gui.ButtonTemplate);
		}

		addButton(
			text: string,
			iconId?: number | string,
			background?: ThemeColorKey,
			config?: BottomButtonConfig,
		): Control<BottomButtonDefinition> {
			const control = new Control(this.template());
			control.instance.Name = text;
			control.setButtonText(text.upper());
			this.$onInjectAuto((theme: Theme) => control.themeButton(theme, background ?? "buttonNormal"));
			control.instance.Frame.ImageLabel.Visible = iconId !== undefined;
			control.instance.Frame.ImageLabel.Image = iconId ? `rbxassetid://${iconId}` : "";
			if (config?.width) {
				control.instance.Size = new UDim2(new UDim(0, config.width), control.instance.Size.Y);
			}

			this.parent(control);
			control.instance.Parent = this.gui;

			return control;
		}
	}

	export type MainScreenBottomDefinition = GuiObject & {
		readonly LayerTemplate: MainScreenBottomLayerDefinition;
	};
	export class MainScreenBottom extends Control<MainScreenBottomDefinition> {
		private readonly template;

		constructor(gui: MainScreenBottomDefinition) {
			super(gui);
			gui.LayerTemplate.Visible = false;
			this.template = this.asTemplate(gui.LayerTemplate);
		}

		push(): MainScreenBottomLayer {
			const control = new MainScreenBottomLayer(this.template());
			control.instance.LayoutOrder = -this.gui.GetChildren().size();
			control.instance.Parent = this.gui;

			return control;
		}
	}
}

export type MainScreenBottomLayer = Bottom.Layer;

type MainScreenRightDefinition = GuiObject & {
	readonly Template: TextButtonDefinition & {
		readonly ImageLabel: ImageLabel;
	};
};
class MainScreenRight extends Control<MainScreenRightDefinition> {
	private readonly template;

	constructor(gui: MainScreenRightDefinition) {
		super(gui);
		gui.Template.Visible = false;
		this.template = this.asTemplate(gui.Template);
	}

	private _push(text: string, imageAsset: string): Control<TextButtonDefinition> {
		const control = new Control(this.template());
		control.instance.LayoutOrder = this.gui.GetChildren().size();
		control.instance.Parent = this.gui;
		control.setButtonText(text);
		control.instance.ImageLabel.Image = imageAsset;

		return control;
	}
	push(text: string): Control<TextButtonDefinition> {
		return this._push(text, "");
	}
	pushImage(assetId: string): Control<TextButtonDefinition> {
		return this._push("", assetId);
	}
}

type MainScreenLayoutDefinition = Folder & {
	readonly Top: Top.MainScreenTopDefinition;
	readonly TopRight: GuiObject;

	readonly Left: GuiObject;
	readonly Bottom: Bottom.MainScreenBottomDefinition;
	readonly Right: MainScreenRightDefinition;
};
@injectable
export class MainScreenLayout extends Component {
	private readonly instance: MainScreenLayoutDefinition;
	readonly top: Top.MainScreenTop;
	readonly bottom: Bottom.MainScreenBottom;
	readonly right: MainScreenRight;
	readonly hotbar;
	readonly fullScreenScaled8: ScreenGui;

	constructor(@inject di: DIContainer) {
		super();

		this.instance = Interface.getInterface<{ Main: MainScreenLayoutDefinition }>().Main;
		ComponentInstance.init(this, this.instance);

		// fixme: should be a Studio asset; cloned before any tool's block menu destroys the templates inside Inventory
		const curatedInventory = this.instance.Left.WaitForChild("Inventory").Clone();
		curatedInventory.Name = "CuratedInventory";
		ServiceIntegrityChecker.whitelistInstance(curatedInventory);
		curatedInventory.Parent = this.instance.Left;

		this.fullScreenScaled8 = Element.create(
			"ScreenGui",
			{ Parent: this.instance, ZIndexBehavior: Enum.ZIndexBehavior.Sibling, DisplayOrder: -2 },
			{ scale: Element.create("UIScale", { Scale: 8 }) },
		);
		ServiceIntegrityChecker.whitelistInstance(this.fullScreenScaled8);

		this.top = this.parentGui(new Top.MainScreenTop(this.instance.Top));
		this.bottom = this.parentGui(new Bottom.MainScreenBottom(this.instance.Bottom));
		this.right = this.parentGui(new MainScreenRight(this.instance.Right));

		{
			this.hotbar = this.parent(
				di.resolveForeignClass(HotbarControl, [
					Interface.getInterface<{ Hotbar: HotbarControlDefinition }>().Hotbar,
				]),
			);

			const visibilityFunction = Transforms.boolStateMachine(
				this.hotbar.instance,
				TransformService.commonProps.quadOut02,
				{ AnchorPoint: new Vector2(0.5, 1) },
				{ AnchorPoint: new Vector2(0.5, 0) },
				(tr, enabled) => (enabled ? tr.show(this.hotbar.instance) : 0),
				(tr, enabled) => (enabled ? 0 : tr.hide(this.hotbar.instance)),
			);
			this.hotbar.onEnabledStateChange(visibilityFunction);

			this.event.subscribeObservable(
				LoadingController.isLoading,
				(loading) => this.hotbar.setEnabled(!loading),
				true,
			);
		}

		const forEachChild = (parent: Instance, callback: (child: GuiObject) => void) => {
			for (const child of parent.GetChildren()) {
				if (!child.IsA("GuiObject")) continue;
				callback(child);
			}
		};

		forEachChild(this.instance.Top, (child) => (child.Visible = false));
		forEachChild(this.instance.TopRight, (child) => (child.Visible = false));
		forEachChild(this.instance.Left, (child) => (child.Visible = false));
	}

	addTopRightButton<T extends GuiButton = TextButton>(
		name: string,
		icon?: number,
	): Control<T & { ImageLabel: ImageLabel }> {
		const template = this.instance.TopRight.WaitForChild("Template") as T & { ImageLabel: ImageLabel };
		const gui = template.Clone();
		gui.Name = name;
		gui.ImageLabel.Image = icon === undefined ? "" : `rbxassetid://${icon}`;
		gui.Parent = template.Parent;

		return new Control(gui);
	}
	/** @deprecated Use {@link addTopRightButton} instead */
	registerTopRightButton<T extends GuiButton>(name: string): Control<T> {
		return new Control(this.instance.TopRight.WaitForChild(name) as T);
	}

	registerLeft<T extends GuiObject>(name: string): Control<T> {
		const control = new Control(this.instance.Left.WaitForChild(name) as T);
		control.visibilityComponent().addTransformFunc((enabling) =>
			Transforms.create()
				.transform(
					control.instance as GuiObject,
					"AnchorPoint",
					new Vector2(enabling ? 0 : 1, 0),
					Transforms.quadOut02,
				)
				.moveX(control.instance, new UDim(0, enabling ? 0 : -10), Transforms.quadOut02),
		);

		return control;
	}
}
