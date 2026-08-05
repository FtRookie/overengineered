import { RunService } from "@rbxts/services";
import { ArgsSignal } from "engine/shared/event/Signal";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definitionScanner = {
	inputOrder: ["enabled", "frequency", "range", "visibility"],
	input: {
		enabled: {
			displayName: "Enabled",
			types: {
				bool: {
					config: true,
				},
			},
		},
		frequency: {
			displayName: "Frequency",
			types: {
				number: {
					config: 868,
					clamp: {
						showAsSlider: true,
						min: 434,
						max: 1500,
					},
				},
			},
		},
		range: {
			displayName: "Diameter",
			types: {
				number: {
					config: 50,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 2048,
					},
				},
			},
		},
		visibility: {
			displayName: "Detection Area Visibility",
			types: {
				bool: { config: false },
			},
			connectorHidden: true,
		},
	},
	output: {
		connected: {
			displayName: "Connected",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

const definitionReceiver = {
	inputOrder: ["frequency", "range", "visibility"],
	input: {
		frequency: {
			displayName: "Frequency",
			types: {
				number: {
					config: 868,
					clamp: {
						showAsSlider: true,
						min: 434,
						max: 1500,
					},
				},
			},
		},
		range: {
			displayName: "Diameter",
			types: {
				number: {
					config: 50,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 2048,
					},
				},
			},
		},
		visibility: {
			displayName: "Detection Area Visibility",
			types: {
				bool: { config: false },
			},
			connectorHidden: true,
		},
	},
	output: {
		scanners: {
			displayName: "Scanners",
			types: ["number"],
		},
		connected: {
			displayName: "Connected",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type ProximityModel = BlockModel & {
	readonly Sphere: BasePart | UnionOperation | MeshPart;
};

const update = new ArgsSignal<[receiver: ProximityReceiverBlock]>();
const allReceivers = new Map<ProximityModel, ProximityReceiverBlock>();

abstract class LogicShared<T extends typeof definitionScanner | typeof definitionReceiver> extends InstanceBlockLogic<
	T,
	ProximityModel
> {
	constructor(definition: T, block: InstanceBlockLogicArgs) {
		super(definition, block);
		const sphere = this.instance.Sphere;

		this.onk(["range"], ({ range }) => {
			sphere.Size = Vector3.one.mul(range);
		});

		// Config-only, so it is set in build mode and constant for the ride: read once rather than every tick.
		this.onkFirstInputs(["visibility"], ({ visibility }) => {
			sphere.Transparency = visibility ? 0.8 : 1;
		});

		const follow = () => {
			// A block destroyed mid-ride loses its PrimaryPart a tick before the runner burns its logic.
			const primary = this.instance.PrimaryPart;
			if (!primary) return;

			sphere.AssemblyLinearVelocity = Vector3.zero;
			sphere.AssemblyAngularVelocity = Vector3.zero;
			sphere.PivotTo(primary.CFrame);
		};
		this.event.subscribe(RunService.PreSimulation, follow); // for actual contact
		if (RunService.IsClient()) {
			this.event.subscribe(RunService.PreRender, follow); // for logic visualizer
		}

		// The block is regenerated on the way back to build mode, so the ride's sphere need not outlive it.
		this.onDisable(() => sphere.Destroy());
	}
}

class ProximityScannerBlock extends LogicShared<typeof definitionScanner> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definitionScanner, block);

		const sphere = this.instance.Sphere;
		const touching = new Set<ProximityModel>();
		const connected = new Set<ProximityReceiverBlock>();

		const frequencyInputCache = this.initializeInputCache("frequency");
		// An unset frequency matches nothing. Both sides read undefined until their first tick, and comparing
		// them directly paired every scanner with every receiver that a touch had reached before then.
		const matches = (receiver: ProximityReceiverBlock) => {
			const frequency = frequencyInputCache.tryGet();
			return frequency !== undefined && receiver.frequency === frequency;
		};

		const updateOutput = () => {
			this.output.connected.set("bool", connected.size() !== 0);
		};
		// Nothing in range still has to read as false: an output never set reads as AVAILABLELATER downstream.
		this.onEnable(updateOutput);

		const connect = (receiver: ProximityReceiverBlock) => {
			connected.add(receiver);
			receiver.connected.add(this);
			receiver.setOutput.Fire();

			updateOutput();
		};
		// Breaks the logical link only. What is physically inside the sphere is the touch events' to say, and
		// clearing it here lost a receiver that had merely retuned away and could no longer be reconnected.
		const disconnect = (receiver: ProximityReceiverBlock) => {
			// Nothing to break, and no output moves: retuning a receiver would otherwise cost every scanner on
			// the map a pair of output writes for a link it never had.
			if (!connected.has(receiver)) return;

			connected.delete(receiver);
			receiver.connected.delete(this);
			receiver.setOutput.Fire();

			updateOutput();
		};

		const disconnectAll = () => {
			for (const receiver of connected) {
				disconnect(receiver);
			}

			// Touches stop being reported while CanTouch is off, so nothing else would clear these.
			touching.clear();
		};

		this.onk(["enabled"], ({ enabled }) => {
			sphere.CanTouch = enabled;
			if (!enabled) disconnectAll();
		});

		this.onDisable(disconnectAll);

		this.event.subscribe(update, (receiver) => {
			if (!matches(receiver)) {
				disconnect(receiver);
				return;
			}

			if (touching.has(receiver.instance)) {
				connect(receiver);
			}
		});

		const tryGetReceiverByPart = (part: BasePart) => {
			const partModel = BlockManager.tryGetBlockModelByPart(part);
			if (!partModel) return;

			return allReceivers.get(partModel as ProximityModel);
		};

		this.event.subscribe(sphere.Touched, (part) => {
			const receiver = tryGetReceiverByPart(part);
			if (!receiver) return;

			touching.add(receiver.instance);
			if (matches(receiver)) {
				connect(receiver);
			}
		});

		this.event.subscribe(sphere.TouchEnded, (part) => {
			const receiver = tryGetReceiverByPart(part);
			if (!receiver) return;

			touching.delete(receiver.instance);
			disconnect(receiver);
		});
	}
}
class ProximityReceiverBlock extends LogicShared<typeof definitionReceiver> {
	frequency?: number;
	readonly connected = new Set<ProximityScannerBlock>();
	readonly setOutput = new ArgsSignal<[]>();
	constructor(block: InstanceBlockLogicArgs) {
		super(definitionReceiver, block);

		this.onEnable(() => allReceivers.set(this.instance, this));
		this.onDisable(() => {
			// Undefined rather than an out-of-range number: `matches` treats it as pairing with nothing.
			this.frequency = undefined;
			update.Fire(this);
			allReceivers.delete(this.instance);
		});

		const refreshOutputs = () => {
			this.output.connected.set("bool", this.connected.size() !== 0);
			this.output.scanners.set("number", this.connected.size());
		};
		this.event.subscribe(this.setOutput, refreshOutputs);
		// Nothing connected still has to read as false and 0 rather than as an output that was never set.
		this.onEnable(refreshOutputs);

		this.onk(["frequency"], ({ frequency }) => {
			this.frequency = frequency;
			update.Fire(this);
		});
	}
}

export const ProximityBlocks = [
	{
		...BlockCreation.defaults,
		id: "proximityscanner",
		displayName: "Proximity Scanner",
		description: "Looks for Receivers on the same frequency, returns true when connected, false if not",
		search: { partialAliases: ["proxy", "gun", "reader"] },
		logic: { definition: definitionScanner, ctor: ProximityScannerBlock },
	},
	{
		...BlockCreation.defaults,
		id: "proximityreceiver",
		displayName: "Proximity Receiver",
		description: "Returns if it is within proximity of a scanner on the same frequency, and how many of them",
		search: {
			partialAliases: ["proxy", "bullet"],
			aliases: ["keycard"],
		},

		logic: { definition: definitionReceiver, ctor: ProximityReceiverBlock },
	},
] as const satisfies BlockBuilder[];
