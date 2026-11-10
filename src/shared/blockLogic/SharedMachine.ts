import { Component } from "engine/shared/component/Component";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { ImpactController } from "shared/block/impact/ImpactController";
import { BlockConfig } from "shared/blockLogic/BlockConfig";
import { BlockLogicRunner } from "shared/blockLogic/BlockLogicRunner";
import { LogicLoops } from "shared/blockLogic/LogicLoops";
import type { GenericBlockLogic } from "shared/blockLogic/BlockLogic";

type BlockData = {
	readonly block: PlacedBlockData;
	readonly logic: GenericBlockLogic;
};

@injectable
export class SharedMachine extends Component {
	readonly occupiedByLocalPlayer = new ObservableValue(true);
	private impactController?: ImpactController;
	readonly blocks;
	protected readonly blocksMap = new Map<BlockUuid, BlockData>();
	readonly runner = this.parent(new BlockLogicRunner());

	constructor(
		@inject private readonly blockList: BlockList,
		@inject private readonly di: DIContainer,
	) {
		super();
		this.blocks = this.parent(new ComponentChildren<GenericBlockLogic>());
	}

	/** Add blocks to the machine, initialize it and start */
	init(blocks: readonly PlacedBlockData[], startLogicImmediately = true) {
		const di = this.di.beginScope((di) => di.registerSingletonValue(this));

		for (const block of blocks) {
			const id = block.id;

			if (!this.blockList.blocks[id]) {
				$err(`Unknown block id ${id}`);
				continue;
			}

			const logicctor = this.blockList.blocks[id]?.logic?.ctor;
			if (!logicctor) continue;

			const logic = di.resolveForeignClass(logicctor, [block]);
			this.blocks.add(logic);
			this.blocksMap.set(block.uuid, { block, logic });
		}

		this.initialize(blocks, startLogicImmediately);
		this.enable();
	}
	protected initialize(blocks: readonly PlacedBlockData[], startLogicImmediately: boolean) {
		this.initializeBlockConnections(startLogicImmediately);

		const impact = this.createImpactControllerIfNeeded(blocks);
		if (impact) {
			this.impactController = this.parent(impact);
		}
	}
	protected createImpactControllerIfNeeded(blocks: readonly PlacedBlockData[]): ImpactController | undefined {
		return this.di.resolveForeignClass(ImpactController, [blocks]);
	}

	getImpactController(): ImpactController | undefined {
		return this.impactController;
	}

	protected initializeBlockConnections(startImmediately: boolean) {
		const logicMap = this.blocksMap.mapToMap((k, v) => $tuple(k, v.logic));

		for (const [, { block, logic }] of this.blocksMap) {
			const def = this.blockList.blocks[block.id]?.logic?.definition;
			if (!def) continue; // should we just continue or throw because this is strange?

			const config = BlockConfig.addDefaults(block.config, def.input);
			logic.initializeInputs(config, logicMap);
		}

		const entries: LogicLoops.Entry[] = [];
		for (const [uuid, { block, logic }] of this.blocksMap) {
			entries.push({ uuid, id: block.id, logic });
		}
		entries.sort((a, b) => a.uuid < b.uuid);
		for (const { id, logic } of entries) {
			this.runner.add(logic, this.blockList.blocks[id]?.logicPriority);
		}
		this.runner.setRegisters(LogicLoops.cutLoops(entries));

		if (startImmediately) {
			this.runner.startTicking();
		}
	}
}
