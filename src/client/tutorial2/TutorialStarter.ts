import { TutorialController } from "client/tutorial2/TutorialController";
import { TutorialPlotController } from "client/tutorial2/TutorialPlotController";
import { TutorialRunner } from "client/tutorial2/TutorialRunner";
import { Component } from "engine/shared/component/Component";
import { Transforms } from "engine/shared/component/Transforms";
import { ArgsSignal } from "engine/shared/event/Signal";

export type TutorialOutcome = "finished" | "stopped";

export class TutorialStarter extends Component {
	readonly controller = this.parent(new TutorialController());
	readonly plot = this.parent(new TutorialPlotController(this));
	readonly runner = this.parent(new TutorialRunner());

	private readonly _stepSkipped = new ArgsSignal();
	readonly stepSkipped = this._stepSkipped.asReadonly();

	// fires as the tutorial is destroyed; "stopped" unless every step was reached
	private readonly _completed = new ArgsSignal<[outcome: TutorialOutcome]>();
	readonly completed = this._completed.asReadonly();
	private outcome: TutorialOutcome = "stopped";

	constructor() {
		super();
		const progress = this.controller.gui.progress;
		progress.setStopAction(() => this.destroy());
		progress.setSkipAction(() => {
			this._stepSkipped.Fire();
			this.runner.skip();
		});

		this.onDestroy(() => {
			this._completed.Fire(this.outcome);
			this._completed.destroy();
		});
	}

	start() {
		const progress = this.controller.gui.progress;
		this.event.subscribeObservable(
			this.runner.current,
			(current) => {
				progress.setStep(current, this.runner.count());
				progress.setProgress(math.max(current - 1, 0) / math.max(this.runner.count(), 1));
			},
			true,
		);

		this.event.subscribe(this.runner.finished, () => {
			this.outcome = "finished";
			progress.setProgress(1);

			const t = progress.addTask("Finishing the tutorial...", 1);
			t.hideProgressText();
			Transforms.create() //
				.funcTransform(1, 0, (v) => t.setProgress(v, 1), { duration: 1, style: "Linear" })
				.then()
				.func(() => this.destroy())
				.run(t);
		});

		this.runner.start();
	}
}
