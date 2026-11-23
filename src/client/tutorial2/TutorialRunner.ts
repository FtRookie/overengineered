import { RunService } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { ArgsSignal } from "engine/shared/event/Signal";

// asked every frame until `done` returns true, then the next, in the same frame. Nothing here yields: the runner
// waits between frames. Everything a step sets up belongs to its `scope`, which is destroyed as the step ends
export interface TutorialStep {
	readonly begin?: (scope: Component) => void;
	// `elapsed` is seconds since the step began
	readonly done: (elapsed: number) => boolean;
	// brings the step to its finished state; the step still ends only once `done` agrees
	readonly skip?: () => void;
}

export namespace TutorialStep {
	export function once(run: (scope: Component) => void): TutorialStep {
		return { begin: run, done: () => true };
	}
	export function wait(seconds: number): TutorialStep {
		return { done: (elapsed) => elapsed >= seconds, skip: () => {} };
	}
}

/** Runs tutorial steps one after another, the way a cutscene runs its beats */
export class TutorialRunner extends Component {
	private readonly steps: TutorialStep[] = [];
	private readonly _current = new ObservableValue(0);
	/** 1-based number of the step running now, 0 before the first */
	readonly current = this._current.asReadonly();
	private readonly _finished = new ArgsSignal();
	readonly finished = this._finished.asReadonly();

	private index = -1;
	private scope?: Component;
	private began = 0;

	add(step: TutorialStep): this {
		this.steps.push(step);
		return this;
	}
	count(): number {
		return this.steps.size();
	}

	start(): void {
		this.enter(0);
		this.event.subscribe(RunService.Heartbeat, () => this.advance());
	}

	// a request that failed can be skipped again: each request sends only what is still missing
	skip(): void {
		this.steps[this.index]?.skip?.();
	}

	private enter(index: number): void {
		this.index = index;
		if (index >= this.steps.size()) {
			this._finished.Fire();
			return;
		}

		this.scope = this.parent(new Component());
		this.began = os.clock();
		this._current.set(index + 1);
		this.steps[index].begin?.(this.scope);
	}

	private advance(): void {
		while (this.index < this.steps.size()) {
			if (!this.steps[this.index].done(os.clock() - this.began)) return;

			this.scope?.destroy();
			this.scope = undefined;
			this.enter(this.index + 1);
		}
	}
}
