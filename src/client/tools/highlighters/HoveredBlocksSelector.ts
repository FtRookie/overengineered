import { Signals } from "client/Signals";
import { BlockSelect } from "client/tools/highlighters/BlockSelect";
import { MultiModelHighlighter } from "client/tools/highlighters/MultiModelHighlighter";
import { Component } from "engine/shared/component/Component";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { ArgsSignal } from "engine/shared/event/Signal";
import { BuildingManager } from "shared/building/BuildingManager";
import { SharedPlot } from "shared/building/SharedPlot";
import type { BlockSelector } from "client/tools/highlighters/MultiBlockSelector";

export type HoveredBlocksSelectorMode = keyof typeof HoveredBlocksSelector.Modes;
export class HoveredBlocksSelector extends Component implements BlockSelector {
	static readonly Modes = {
		single: (block: BlockModel): BlockModel[] => [block],
		assembly: BuildingManager.getAssemblyBlocks,
		machine: BuildingManager.getMachineBlocks,
	};

	private readonly _highlighted = new ObservableValue<readonly BlockModel[]>([]);
	readonly highlighted = this._highlighted.asReadonly();
	private readonly _submit = new ArgsSignal<[blocks: readonly BlockModel[]]>();
	readonly submit = this._submit.asReadonly();

	constructor(getTargets: (block: BlockModel, highlighted: ReadonlySet<BlockModel>) => readonly BlockModel[]) {
		super();

		const highlighter = this.parent(new MultiModelHighlighter(this.highlighted));
		let prevTarget: Instance | undefined;

		const empty = [] as const;
		const destroyHighlight = () => {
			prevTarget = undefined;
			this._highlighted.set(empty);
		};

		let pressing = false;
		const updateTarget = () => {
			const add = pressing;

			const target = BlockSelect.getTargetedBlock();
			if (!target) {
				if (!add) destroyHighlight();
				return;
			}

			if (target === prevTarget) {
				return;
			}
			prevTarget = target;

			const targets = getTargets(target, pressing ? this.highlighted.get().toSet() : new Set([target]));
			this._highlighted.set(add ? [...this._highlighted.get(), ...targets].distinct() : targets.distinct());
		};
		const submit = () => {
			if (!pressing) return;

			pressing = false;
			highlighter.disable();
			this._submit.Fire(this.highlighted.get());
			highlighter.enable();
		};

		this.event.onPrepare((inputType, eh, ih) => {
			eh.subscribe(SharedPlot.anyChanged, updateTarget);
			ih.onInputBegan(() => {
				prevTarget = undefined;
				updateTarget();
			});
			ih.onInputChanged(updateTarget);
			ih.onInputEnded((input) => {
				if (
					input.UserInputType === Enum.UserInputType.MouseButton1 ||
					input.UserInputType === Enum.UserInputType.Touch
				) {
					return;
				}

				prevTarget = undefined;
				updateTarget();
			});
			eh.subscribe(Signals.CAMERA.MOVED, updateTarget);

			if (inputType === "Desktop") {
				ih.onMouse1Down(() => (pressing = true), false);
				ih.onMouse1Up(submit, true);
			} else if (inputType === "Gamepad") {
				ih.onKeyDown("ButtonX", () => (pressing = true));
				ih.onKeyUp("ButtonX", submit);
			} else if (inputType === "Touch") {
				ih.onInputEnded((input) => {
					if (input.UserInputType !== Enum.UserInputType.Touch) return;

					pressing = true;
					submit();
				});
			}

			updateTarget();
		});
		this.onDisable(destroyHighlight);
	}
}
