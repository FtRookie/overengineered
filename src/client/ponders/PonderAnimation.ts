import type { SceneRunner } from "client/scene/SceneRunner";
import type { Component } from "engine/shared/component/Component";

/**
 * How a block arrives in a ponder: `apply` poses the model, already at its final placement `final`, for an eased
 * progress from 0 (just appearing) to 1 (in place), over `duration` seconds of the ponder's clock.
 */
export type PonderAnimation = {
	readonly duration: number;
	readonly style?: Enum.EasingStyle;
	readonly direction?: Enum.EasingDirection;
	readonly begin: (model: Model, final: CFrame) => (alpha: number) => void;
};

/** Every visible part, with the transparency it ends at; a fully transparent part stays hidden throughout */
const visibleParts = (model: Model) =>
	model
		.GetDescendants()
		.filter((d): d is BasePart => d.IsA("BasePart") && d.Transparency < 1)
		.map((part) => ({ part, transparency: part.Transparency }));
const setFade = (parts: ReturnType<typeof visibleParts>, alpha: number) => {
	for (const { part, transparency } of parts) {
		part.Transparency = transparency + (1 - transparency) * (1 - alpha);
	}
};

export namespace PonderAnimation {
	/** Fades in where it stands */
	export const fade: PonderAnimation = {
		duration: 0.3,
		begin: (model) => {
			const parts = visibleParts(model);
			return (alpha) => setFade(parts, alpha);
		},
	};

	/** Falls the last stud and a half into place while fading in */
	export const drop: PonderAnimation = {
		duration: 0.35,
		direction: Enum.EasingDirection.Out,
		style: Enum.EasingStyle.Quad,
		begin: (model, final) => {
			const parts = visibleParts(model);
			const height = 1.5;
			return (alpha) => {
				model.PivotTo(final.add(new Vector3(0, height * (1 - alpha), 0)));
				setFade(parts, alpha);
			};
		},
	};

	/**
	 * Plays `animation` on `model`, which is at its final placement, on the runner's clock and owned by `scope`;
	 * `finished` runs once the model is in place
	 */
	export function play(
		runner: SceneRunner,
		scope: Component,
		model: Model,
		animation: PonderAnimation,
		finished?: () => void,
	) {
		const apply = animation.begin(model, model.GetPivot());
		runner.tween(scope, animation.duration, apply, animation.style, animation.direction, finished);
	}
}
