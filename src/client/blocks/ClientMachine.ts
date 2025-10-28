import { ClientBlockControls } from "client/blocks/ClientBlockControls";
import { LogicVisualizer } from "client/blocks/LogicVisualizer";
import { LogControl } from "client/gui/static/LogControl";
import { Colors } from "engine/shared/Colors";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { BlockConfig } from "shared/blockLogic/BlockConfig";
import { SharedMachine } from "shared/blockLogic/SharedMachine";
import type { IClientBlockControl } from "client/blocks/ClientBlockControls";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { ImpactController } from "shared/block/impact/ImpactController";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { ILogicValueStorage } from "shared/blockLogic/BlockLogicValueStorage";

@injectable
export class ClientMachine extends SharedMachine {
	readonly logicInputs = this.parent(new ComponentChildren<IClientBlockControl>());

	constructor(
		@inject private readonly playerData: PlayerDataStorage,
		@inject blockList: BlockList,
		@inject di: DIContainer,
	) {
		super(blockList, di);
	}

	getLogicInputs() {
		return this.logicInputs.getAll();
	}

	createVisualizer() {
		return new LogicVisualizer(
			this.runner,
			this.blocksMap.map((k, v) => v.logic),
		);
	}

	protected initialize(blocks: readonly PlacedBlockData[], startLogicImmediately: boolean) {
		super.initialize(blocks, startLogicImmediately);
		this.initializeControls();
	}
	protected createImpactControllerIfNeeded(blocks: readonly PlacedBlockData[]): ImpactController | undefined {
		if (!this.playerData.config.get().impact_destruction) {
			return undefined;
		}

		return super.createImpactControllerIfNeeded(blocks);
	}

	initializeControls() {
		for (const [, { block, logic }] of this.blocksMap) {
			const config = BlockConfig.addDefaults(block.config, logic.definition.input);
			for (const [k, v] of pairs(config)) {
				const cfg = config[k];
				if (!cfg) continue;

				if (!(v.type in ClientBlockControls)) {
					continue;
				}

				const input = logic.input[k] as
					| (typeof logic)["input"][typeof k]
					| ILogicValueStorage<keyof BlockLogicTypes.Primitives>;
				if (!input) {
					$warn(`Found nil input key ${k} for logic ${block.id}`);
					LogControl.instance.addLine(
						`Found nil input key ${k} for logic ${block.id}. Place re-place your ${block.id}`,
						Colors.red,
					);
					continue;
				}

				if (!("set" in input)) continue;

				const def = logic.definition.input[k].types[cfg.type] as
					| BlockLogicTypes.Primitives[keyof BlockLogicTypes.Controls]
					| undefined;
				if (!def) continue;
				if (!def.control) continue;
				if (!cfg.controlConfig) continue;
				if (!cfg.controlConfig.enabled) continue;

				const ctor = ClientBlockControls[v.type as keyof typeof ClientBlockControls];
				if (!ctor) continue;

				const control = ctor(input, cfg.controlConfig, def as MakeRequired<typeof def, "control">);
				this.parent(control);

				this.logicInputs.add(control);

				this.event.subscribeObservable(
					this.occupiedByLocalPlayer,
					(enabled) => {
						if (enabled) control.enable();
						else control.disable();
					},
					true,
				);
			}
		}
	}
}
