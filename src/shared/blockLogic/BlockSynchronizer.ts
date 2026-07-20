import { Players, RunService } from "@rbxts/services";
import { BidirectionalRemoteEvent, C2SRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { ArgsSignal } from "engine/shared/event/Signal";
import { t } from "engine/shared/t";
import { CustomRemotes } from "shared/Remotes";
import { TagUtils } from "shared/utils/TagUtils";
import type { CreatableRemoteEvents } from "engine/shared/event/PERemoteEvent";
import type { BlockLogic, BlockLogicBothDefinitions } from "shared/blockLogic/BlockLogic";

type BatchItem = { readonly name: string; readonly arg: unknown };

const batchItemTType = t.interface({ name: t.string, arg: t.any });
const batchTType = t.array(batchItemTType);

/**
 * Remote event which:
 * Upon sending the value from the server, sends it to every player.
 * Upon sending the value from the client, locally executes the callback and sends it to every other player.
 * Upon a player join, sends the value to that player from the server.
 * Callbacks are instaneous, Remotes are batched and sent at the end of the thread
 */
export class BlockSynchronizer<TArg extends { readonly block: BlockModel; reqid?: number }> {
	private static readonly all = new Map<string, BlockSynchronizer<never>>();
	private static batchHandlerInitialized = false;
	private static batchQueue: BatchItem[] | undefined;
	private static readonly batchRemote = new C2SRemoteEvent<BatchItem[]>("bs_batch");

	/** @client */
	private readonly _invoked = new ArgsSignal<[value: TArg]>();
	/** @client */
	readonly invoked = this._invoked.asReadonly();

	/** @server */
	private serverMiddleware?: (<T extends TArg>(
		invoker: Player | undefined,
		arg: T,
	) => "dontsend" | ObjectResponse<TArg>)[];
	/** @server */
	private serverMiddlewarePerPlayer?: (<T extends TArg>(
		invoker: Player | undefined,
		target: Player,
		arg: T,
	) => "dontsend" | ObjectResponse<TArg>)[];

	private readonly event;
	private readonly saved = new Map<BlockModel, TArg>();

	/** If true, sends the event to the block owner. Useful for execting server-only middlewares like text censoring. */
	sendBackToOwner = false;

	/** If set, specifies the value that's being sent to a newly joined player. */
	getExisting?: <T extends TArg = TArg>(stored: T) => TArg;

	constructor(
		private readonly name: string,
		private readonly ttype: t.Type<TArg>,
		func?: NoInfer<(arg: TArg) => void>,
		eventType: CreatableRemoteEvents = "RemoteEvent",
	) {
		const event = new BidirectionalRemoteEvent<TArg>(name, eventType);
		this.event = event;

		BlockSynchronizer.all.set(name, this as never);

		if (RunService.IsServer()) {
			BlockSynchronizer.initBatchHandler();

			event.c2s.invoked.Connect((invoker, arg) => this.handleC2S(invoker, arg));

			CustomRemotes.playerLoaded.invoked.Connect((player) => {
				for (const [, arg] of this.saved) {
					event.s2c.send(player, this.getExisting?.(arg) ?? arg);
				}
			});
		} else if (RunService.IsClient()) {
			event.s2c.invoked.Connect((arg) => {
				if (!arg.block) return;
				//print(`[BS] [CLI] receied   ${name}`, Strings.pretty(arg ?? {}));
				if (this.sendBackToOwner && "reqid" in arg && arg.reqid) {
					// reqid is being sent to owner only

					const existingState =
						(arg.block.GetAttribute(this.reqidAttributeName()) as number | undefined) ?? 0;
					if (existingState > arg.reqid) {
						// skip invoking if the request is too old
						return;
					}
				}

				this._invoked.Fire(arg);
			});
			if (func) {
				this._invoked.Connect((arg) => {
					if (!arg.block) return;
					func(arg);
				});
			}
		}
	}

	private static initBatchHandler() {
		if (BlockSynchronizer.batchHandlerInitialized) return;
		BlockSynchronizer.batchHandlerInitialized = true;

		BlockSynchronizer.batchRemote.invoked.Connect((invoker, items) => {
			if (!t.typeCheck(items, batchTType)) {
				invoker.Kick("Network error at bs_batch");
				return;
			}

			for (const item of items) {
				const bs = BlockSynchronizer.all.get(item.name);
				if (!bs) continue;
				bs.handleC2S(invoker, item.arg as never);
			}
		});
	}

	private handleC2S(invoker: Player, arg: TArg): void {
		//print(`[BS] [SRV] received inv  ${this.name}`, Strings.pretty(arg ?? {}));
		if (!t.typeCheck(arg, this.ttype)) {
			invoker.Kick(`Network error at ${this.name}`);

			const res = t.newResult();
			t.typeCheck(arg, this.ttype, res);
			$log(`Player ${invoker.Name} got blocksynchro error ${res.getText()}`);
			return;
		}

		if (this.serverMiddleware) {
			for (const func of this.serverMiddleware) {
				const result = func(invoker, arg);
				if (result === "dontsend") return;

				if (!result.success) {
					$err(`Error invoking synchronizer remote ${this.name}: ${result.message}`);
					return;
				}

				arg = result.value;
			}
		}

		if (!this.saved.has(arg.block)) {
			arg.block.Destroying.Connect(() => this.saved.delete(arg.block));
		}
		// one payload per block, replaced wholesale rather than merged. A block that sends partial updates
		// (one field per handler) therefore leaves only its most recent field here, and that is all a newly
		// joined player is replayed — every other field silently falls back to whatever the client builds by
		// default. Senders must pass complete state, or override getExisting to reconstruct it.
		this.saved.set(arg.block, arg);

		for (const player of Players.GetPlayers()) {
			if (player === invoker) {
				if (!this.sendBackToOwner) continue;
				if (!player.HasTag(TagUtils.allTags.PLAYER_LOADED)) {
					continue;
				}

				this.event.s2c.send(player, { ...arg, reqid: arg.reqid ?? 0 });
				return;
			}

			let parg = arg;
			let send = true;
			if (this.serverMiddlewarePerPlayer) {
				for (const func of this.serverMiddlewarePerPlayer) {
					const result = func(invoker, player, arg);
					if (result === "dontsend") {
						send = false;
						continue;
					}

					if (!result.success) {
						$err(`Error invoking synchronizer remote ${this.name}: ${result.message}`);
						send = false;
						continue;
					}

					parg = result.value;
				}
			}
			if (!send) continue;

			//print(`[BS] [SRV] sending   ${this.name} to ${player.Name}`, Strings.pretty(arg ?? {}));
			this.event.s2c.send(player, parg);
		}
	}

	private reqidAttributeName() {
		return `reqid_${this.name}`;
	}

	addServerMiddleware(
		middleware: (invoker: Player | undefined, arg: TArg) => "dontsend" | ObjectResponse<TArg>,
	): this {
		if (!RunService.IsServer()) return this;

		this.serverMiddleware ??= [];
		this.serverMiddleware.push(middleware);
		return this;
	}
	addServerMiddlewarePerPlayer(
		middleware: (invoker: Player | undefined, target: Player, arg: TArg) => "dontsend" | ObjectResponse<TArg>,
	): this {
		if (!RunService.IsServer()) return this;

		this.serverMiddlewarePerPlayer ??= [];
		this.serverMiddlewarePerPlayer.push(middleware);
		return this;
	}

	/**
	 * Check the type of arg, burn the block if wrong. Send the event if correct.
	 */
	sendOrBurn<TDef extends BlockLogicBothDefinitions>(arg: TArg, block: BlockLogic<TDef>): void {
		if (!t.typeCheck(arg, this.ttype)) {
			block.disableAndBurn();

			try {
				t.typeCheckWithThrow(arg, this.ttype);
			} catch (ex) {
				$err(ex);
			}

			return;
		}

		this.send(arg);
	}
	send(arg: TArg): void {
		if (RunService.IsServer()) {
			if (this.serverMiddleware) {
				for (const func of this.serverMiddleware) {
					const result = func(undefined, arg);
					if (result === "dontsend") return;

					if (!result.success) {
						$err(`Error invoking synchronizer remote ${this.name}: ${result.message}`);
						return;
					}

					arg = result.value;
				}
			}

			for (const player of Players.GetPlayers()) {
				if (!player.HasTag(TagUtils.allTags.PLAYER_LOADED)) {
					continue;
				}

				let parg = arg;
				let send = true;
				if (this.serverMiddlewarePerPlayer) {
					for (const func of this.serverMiddlewarePerPlayer) {
						const result = func(undefined, player, arg);
						if (result === "dontsend") {
							send = false;
							continue;
						}

						if (!result.success) {
							$err(`Error invoking synchronizer remote ${this.name}: ${result.message}`);
							send = false;
							continue;
						}

						parg = result.value;
					}
				}
				if (!send) continue;

				//print(`[BS] [SRC] sending   ${this.name} to ${player.Name}`, Strings.pretty(arg ?? {}));
				this.event.s2c.send(player, parg);
			}
		} else if (RunService.IsClient()) {
			if (this.sendBackToOwner) {
				const name = this.reqidAttributeName();
				arg.reqid = ((arg.block.GetAttribute(name) as number | undefined) ?? 0) + 1;
				arg.block.SetAttribute(name, arg.reqid);
			}

			//print(`[BS] [CLI] invoking LOCAL   ${this.name}`, Strings.pretty(arg ?? {}));
			this._invoked.Fire(arg);

			if (!BlockSynchronizer.batchQueue) {
				BlockSynchronizer.batchQueue = [];
				task.defer(() => {
					const queue = BlockSynchronizer.batchQueue;
					BlockSynchronizer.batchQueue = undefined;
					if (queue && !queue.isEmpty()) {
						BlockSynchronizer.batchRemote.send(queue);
					}
				});
			}
			BlockSynchronizer.batchQueue.push({ name: this.name, arg });
		}
	}
}
