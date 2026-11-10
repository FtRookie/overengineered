import { BlockLogicRunner } from "shared/blockLogic/BlockLogicRunner";
import { LogicLoops } from "shared/blockLogic/LogicLoops";
import type { BlockLogicTickContext, GenericBlockLogic } from "shared/blockLogic/BlockLogic";

export class BlockTestRunner {
	private readonly runner = new BlockLogicRunner();
	private readonly blocks: GenericBlockLogic[] = [];
	private loopsCut = false;

	add(...blocks: GenericBlockLogic[]) {
		for (const block of blocks) {
			this.runner.add(block);
			this.blocks.push(block);
		}
		this.loopsCut = false;
	}

	getContext(overriddenDt?: number): BlockLogicTickContext {
		return this.runner.getContext(false, overriddenDt);
	}
	moveContextForward(overriddenDt?: number): void {
		this.runner.getContext(true, overriddenDt);
	}

	tick(amount: number = 1, dt?: number) {
		if (!this.loopsCut) {
			this.loopsCut = true;
			const entries = this.blocks.map((logic, i) => ({
				uuid: tostring(1_000_000 + i) as BlockUuid,
				id: (logic.instance?.GetAttribute("id") as BlockId | undefined) ?? "",
				logic,
			}));
			this.runner.setRegisters(LogicLoops.cutLoops(entries));
		}

		for (let i = 0; i < amount; i++) {
			this.runner.tick(dt);
		}
	}
}
