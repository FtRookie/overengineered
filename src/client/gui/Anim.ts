import { ScaledScreenGui } from "client/gui/ScaledScreenGui";
import { ServiceIntegrityChecker } from "client/integrity/ServiceIntegrityChecker";
import { Interface } from "engine/client/gui/Interface";
import { Transforms } from "engine/shared/component/Transforms";
import { Element } from "engine/shared/Element";
import type { TransformBuilder, TransformProps } from "engine/shared/component/Transform";

export namespace Anim {
	export namespace UIListLayout {
		/** Creates an animation of removing the child from an UIListLayout */
		export function animRemove(
			parent: GuiObject,
			child: GuiObject,
			props: TransformProps,
			childAction: "none" | "hide" | "destroy" | "unparent" = "none",
		): TransformBuilder {
			if (child.Parent !== parent) {
				throw `${child} is not a child of ${parent}`;
			}

			const listLayout = parent.FindFirstChildWhichIsA("UIListLayout");
			if (!listLayout) {
				throw `${parent} does not have a UIListLayout`;
			}
			if (listLayout.SortOrder !== Enum.SortOrder.LayoutOrder) {
				throw `${listLayout}.SortOrder is not ListLayout`;
			}

			return Transforms.func(() => {
				const container = Element.create("Frame", {
					BackgroundTransparency: 1,
					LayoutOrder: child.LayoutOrder,
					Size: child.Size,
					Parent: parent,
				});

				if (childAction === "hide") {
					child.Visible = false;
				} else if (childAction === "destroy") {
					child.Destroy();
				} else if (childAction === "unparent") {
					child.Parent = undefined;
				}

				const target =
					listLayout.FillDirection === Enum.FillDirection.Horizontal
						? new UDim2(new UDim().sub(listLayout.Padding), child.Size.Y)
						: new UDim2(child.Size.X, new UDim().sub(listLayout.Padding));

				return Transforms.create() //
					.transform(container, "Size", target, props)
					.then()
					.destroy(container);
			});
		}

		/** Creates an animation of adding the child to an UIListLayout */
		export function animAdd(
			parent: GuiObject,
			child: GuiObject,
			props: TransformProps,
			layoutIndex?: number,
		): TransformBuilder {
			const listLayout = parent.FindFirstChildWhichIsA("UIListLayout");
			if (!listLayout) {
				throw `${parent} does not have a UIListLayout`;
			}
			if (listLayout.SortOrder !== Enum.SortOrder.LayoutOrder) {
				throw `${listLayout}.SortOrder is not ListLayout`;
			}

			return Transforms.func(() => {
				const source =
					listLayout.FillDirection === Enum.FillDirection.Horizontal
						? new UDim2(new UDim().sub(listLayout.Padding), child.Size.Y)
						: new UDim2(child.Size.X, new UDim().sub(listLayout.Padding));

				const container = Element.create("Frame", {
					BackgroundTransparency: 1,
					LayoutOrder: layoutIndex ?? child.LayoutOrder,
					Size: source,
					Parent: parent,
				});

				return Transforms.create() //
					.resize(container, child.Size, props)
					.then()
					.destroy(container);
			});
		}
	}

	function cloneWithAbsolutePosition<T extends GuiObject>(instance: T, scale: number, offset: Vector2): T {
		const clone = instance.Clone();
		clone.Position = new UDim2(
			0,
			(instance.AbsolutePosition.X + offset.X) / scale,
			0,
			(instance.AbsolutePosition.Y + offset.Y) / scale,
		);
		clone.Size = new UDim2(0, instance.AbsoluteSize.X / scale, 0, instance.AbsoluteSize.Y / scale);
		clone.AnchorPoint = Vector2.zero;

		return clone;
	}

	export function findScreen(instance: Instance): ScreenGui | undefined {
		let parent = instance;
		while (true as boolean) {
			if (parent.IsA("ScreenGui")) {
				return parent;
			}

			if (!parent.Parent) return;
			parent = parent.Parent;
		}
	}

	/** Wraps the provided `GuiObject` in a `Frame`. */
	export function wrapInFrame(gui: GuiObject): Frame {
		const frame = new Instance("Frame");
		frame.Name = "Wrapper";
		frame.AnchorPoint = gui.AnchorPoint;
		frame.Position = gui.Position;
		frame.AutomaticSize = Enum.AutomaticSize.XY;
		frame.BackgroundTransparency = 1;
		frame.Parent = gui.Parent;

		gui.AnchorPoint = new Vector2();
		gui.Position = new UDim2();
		gui.Parent = frame;

		return frame;
	}

	/** Creates a GuiScreen with all the provided instances being **copied** into it, with adjusted position/size/etc */
	export function createScreenForAnimating<TChildren extends readonly GuiObject[]>(
		...children: TChildren
	): LuaTuple<[ScreenGui, ...TChildren]> {
		const childScreen = children[0] && findScreen(children[0]);

		const screen = Element.create("ScreenGui", {
			ClipToDeviceSafeArea: childScreen?.ClipToDeviceSafeArea,
			SafeAreaCompatibility: childScreen?.SafeAreaCompatibility,
			ScreenInsets: childScreen?.ScreenInsets,
		});
		ServiceIntegrityChecker.whitelistInstance(screen);
		screen.Parent = Interface.getPlayerGui();
		const ssg = new ScaledScreenGui(screen);
		ssg.enable();

		const scale = ssg.getScale();
		const offset = screen.AbsolutePosition.mul(-1);
		const clones = children.map((c) => cloneWithAbsolutePosition(c, scale, offset)) as unknown as TChildren;
		for (const clone of clones) {
			clone.Parent = screen;
		}

		return $tuple(screen, ...clones);
	}
}
