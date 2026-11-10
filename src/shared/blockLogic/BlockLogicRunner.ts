import { RunService } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { ArgsSignal } from "engine/shared/event/Signal";
import type { BlockLogic, BlockLogicFullBothDefinitions, BlockLogicTickContext } from "shared/blockLogic/BlockLogic";

const profiling = RunService.IsStudio();

type Logic = BlockLogic<BlockLogicFullBothDefinitions>;

export class BlockLogicRunner extends Component {
	private readonly ticked = new ArgsSignal<[ctx: BlockLogicTickContext]>();

	private readonly blocks: Logic[] = [];
	private readonly priorities = new Map<Logic, number>();
	private tickingLoop?: SignalConnection;
	private tickNumber = 0;
	private lastTickTime?: number;
	private readonly _isRunning = new ObservableValue(false);
	readonly isRunning = this._isRunning.asReadonly();

	readonly overclock = new ObservableValue<{ type: "speedup" | "slowdown"; multiplier: number }>({
		type: "speedup",
		multiplier: 1,
	});

	onAfterTick(func: (ctx: BlockLogicTickContext) => void): SignalConnection {
		return this.ticked.Connect(func);
	}

	getContext(update: boolean, overriddenDt?: number): Writable<BlockLogicTickContext> {
		if (update) {
			this.tickNumber++;
		}

		const now = os.clock();
		const dt = overriddenDt ?? now - (this.lastTickTime ?? now);
		if (update) {
			this.lastTickTime = now;
		}

		return {
			tick: this.tickNumber,
			dt,
		};
	}

	startTicking() {
		this.stopTicking();
		this._isRunning.set(true);
		this.tickingLoop = this.event.loop(0, () => {
			if (profiling) debug.profilebegin("BlockLogic tick");
			this.tick();
			if (profiling) debug.profileend();
		});
	}
	stopTicking() {
		this._isRunning.set(false);
		this.tickingLoop?.Disconnect();
		this.tickingLoop = undefined;
	}

	private ticksSinceLast = 0;
	tick(overriddenDt?: number) {
		const overclock = this.overclock.get();
		if (this.unsorted) this.sortBlocks();

		const tick = (ctx: BlockLogicTickContext) => {
			for (const register of this.registers) {
				register.snapshotOutputs();
			}
			for (const block of this.blocks) {
				if (!block.isEnabled()) continue;

				try {
					block.ticc(ctx);
				} catch (err) {
					$warn(err);
					block.disableAndBurn();
				}
			}
			for (const register of this.registers) {
				if (!register.isEnabled()) continue;

				try {
					register.recalculate(ctx);
				} catch (err) {
					$warn(err);
					register.disableAndBurn();
				}
			}
			this.ticked.Fire(ctx);
		};

		let realdt = this.getContext(false, overriddenDt).dt;
		if (overclock.type === "speedup") {
			realdt /= overclock.multiplier;
			for (let i = 0; i < overclock.multiplier; i++) {
				tick(this.getContext(true, realdt));
			}
		} else if (overclock.type === "slowdown") {
			this.ticksSinceLast = (this.ticksSinceLast + 1) % overclock.multiplier;
			if (this.ticksSinceLast === 0) {
				tick(this.getContext(true, realdt));
			}
		} else overclock.type satisfies never;
	}

	private registers: readonly Logic[] = [];
	setRegisters(registers: readonly Logic[]) {
		this.registers = registers;
	}

	private readonly addOrder = new Map<Logic, number>();
	private unsorted = false;
	add(block: Logic, priority: number) {
		if (this.priorities.has(block)) return;

		this.priorities.set(block, priority);
		this.addOrder.set(block, this.blocks.size());
		this.blocks.push(block);
		this.unsorted = true;
	}
	private sortBlocks() {
		this.unsorted = false;
		this.blocks.sort((a, b) => {
			const pa = this.priorities.get(a)!;
			const pb = this.priorities.get(b)!;
			if (pa !== pb) return pa < pb;
			return this.addOrder.get(a)! < this.addOrder.get(b)!;
		});
	}
}
