import { Workspace } from "@rbxts/services";
import { BlockGhoster } from "client/tools/additional/BlockGhoster";
import { Component } from "engine/shared/component/Component";
import { Element } from "engine/shared/Element";
import { PartUtils } from "shared/utils/PartUtils";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";

const model = Element.create("Model", { Name: "MultiHighlighterGlobal", Parent: Workspace });
const highlightInstance = BlockGhoster.createHighlight({ Parent: model });

/** Highlights multiple {@link PVInstance}s by cloning them and putting them in a single {@link Model} */
export class MultiModelHighlighter extends Component {
	private highlighted?: readonly PVInstance[];

	constructor(instances: ReadonlyObservableValue<readonly PVInstance[]>) {
		super();

		const highlight = (instances: readonly PVInstance[]) => {
			stop();
			if (instances.size() === 0) return;

			const cloned = instances.map((i) => i.Clone());
			for (const instance of cloned) {
				PartUtils.applyToAllDescendantsOfType("WeldConstraint", instance, (desc) => {
					if (
						desc.Part0?.IsDescendantOf(instance) === false ||
						desc.Part1?.IsDescendantOf(instance) === false
					) {
						desc.Destroy();
					}
				});

				instance.Name += "_CLONED";
				instance.Parent = model;
			}

			highlightInstance.Adornee = model;
			this.highlighted = cloned;
		};
		const stop = () => {
			if (!this.highlighted) return;

			highlightInstance.Adornee = undefined;
			for (const instance of this.highlighted) {
				instance.Destroy();
			}

			this.highlighted = undefined;
		};

		this.event.subscribeObservable(instances, highlight, true);
		this.onDisable(stop);
	}
}
