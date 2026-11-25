import { RunService, TweenService } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { ArgsSignal } from "engine/shared/event/Signal";

// asked every frame until `done` returns true, then the next, in the same frame. Nothing here yields: the runner
// waits between frames. Everything a step sets up belongs to its `scope`, which is destroyed as the step ends
export interface SceneStep {
	readonly begin?: (scope: Component) => void;
	// `elapsed` is seconds since the step began
	readonly done: (elapsed: number) => boolean;
	// brings the step to its finished state; the step still ends only once `done` agrees
	readonly skip?: () => void;
}

export namespace SceneStep {
	export function once(run: (scope: Component) => void): SceneStep {
		return { begin: run, done: () => true };
	}
	export function wait(seconds: number): SceneStep {
		return { done: (elapsed) => elapsed >= seconds, skip: () => {} };
	}
}

/** Runs scene steps one after another, the way a cutscene runs its beats */
export class SceneRunner extends Component {
	private readonly steps: SceneStep[] = [];
	private readonly _current = new ObservableValue(0);
	/** 1-based number of the step running now, 0 before the first */
	readonly current = this._current.asReadonly();
	private readonly _finished = new ArgsSignal();
	readonly finished = this._finished.asReadonly();
	private readonly _ticked = new ArgsSignal<[dt: number]>();

	private index = -1;
	private scope?: Component;
	private elapsed = 0;
	private lastDone = false;

	/** `holdLast` keeps the last step and its scope once it is done, instead of ending it, so its state stays shown */
	constructor(private readonly holdLast = false) {
		super();
	}

	add(step: SceneStep): this {
		this.steps.push(step);
		return this;
	}
	count(): number {
		return this.steps.size();
	}
	/** Seconds since the running step began */
	stepElapsed(): number {
		return this.elapsed;
	}
	isFinished(): boolean {
		return this.index >= this.steps.size() || (this.holdLast && this.lastDone);
	}

	/** Starts the first step and advances on every Heartbeat */
	start(): void {
		this.enter(0);
		this.event.subscribe(RunService.Heartbeat, (dt) => this.advance(dt));
	}

	/** Ends the running step and starts over from the first */
	restart(): void {
		this.scope?.destroy();
		this.scope = undefined;
		this.lastDone = false;
		this.enter(0);
	}

	// a request that failed can be skipped again: each request sends only what is still missing
	skip(): void {
		this.steps[this.index]?.skip?.();
	}

	/** Runs `func` with the scene's time step on every advance until `scope` is destroyed, alongside the steps */
	loop(scope: Component, func: (dt: number) => void): void {
		scope.event.subscribe(this._ticked, func);
	}

	/**
	 * Runs `apply` with the eased progress, from 0 to 1, over `duration` seconds of the scene's time, then stops and
	 * calls `finished`; it also stops, without `finished`, if `scope` is destroyed first. Progress 0 is applied at once.
	 */
	tween(
		scope: Component,
		duration: number,
		apply: (alpha: number) => void,
		style: Enum.EasingStyle = Enum.EasingStyle.Quad,
		direction: Enum.EasingDirection = Enum.EasingDirection.Out,
		finished?: () => void,
	): void {
		const tween = scope.parent(new Component());
		let time = 0;
		apply(0);

		this.loop(tween, (dt) => {
			time += dt;
			const progress = math.min(time / math.max(duration, 1e-3), 1);
			apply(TweenService.GetValue(progress, style, direction));
			if (progress < 1) return;

			tween.destroy();
			finished?.();
		});
	}

	advance(dt: number): void {
		this.elapsed += dt;
		this._ticked.Fire(dt);

		while (this.index < this.steps.size()) {
			if (this.lastDone) return;

			if (!this.steps[this.index].done(this.elapsed)) return;

			if (this.holdLast && this.index === this.steps.size() - 1) {
				this.lastDone = true;
				this._finished.Fire();
				return;
			}

			this.scope?.destroy();
			this.scope = undefined;
			this.enter(this.index + 1);
		}
	}

	private enter(index: number): void {
		this.index = index;
		if (index >= this.steps.size()) {
			this._finished.Fire();
			return;
		}

		this.scope = this.parent(new Component());
		this.elapsed = 0;
		this._current.set(index + 1);
		this.steps[index].begin?.(this.scope);
	}
}
