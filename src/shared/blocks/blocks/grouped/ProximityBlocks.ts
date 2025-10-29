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
			displayName: "Range",
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
			displayName: "Range",
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

const allProxies = new Set<ProximityModel>();
const tpSphere = () => {
	for (const model of allProxies) {
		const sphere = model.Sphere;

		sphere.AssemblyLinearVelocity = Vector3.zero;
		sphere.AssemblyAngularVelocity = Vector3.zero;
		sphere.PivotTo(model.PrimaryPart!.CFrame);
	}
};
RunService.PreRender.Connect(tpSphere); // for logic visualizer
RunService.PreSimulation.Connect(tpSphere); // for actual contact

abstract class LogicShared<T extends typeof definitionScanner | typeof definitionReceiver> extends InstanceBlockLogic<
	T,
	ProximityModel
> {
	readonly detected = new ArgsSignal<[state: boolean]>();

	constructor(definition: T, block: InstanceBlockLogicArgs) {
		super(definition, block);
		const sphere = this.instance.Sphere;

		this.onk(["range"], ({ range }) => {
			if (!sphere) return;
			sphere.Size = Vector3.one.mul(range);
		});

		this.onk(["visibility"], ({ visibility }) => {
			sphere.Transparency = visibility ? 0.8 : 1;
		});

		this.onEnable(() => allProxies.add(this.instance));
		this.onDisable(() => allProxies.delete(this.instance));
	}
}

@injectable
class ProximityScannerBlock extends LogicShared<typeof definitionScanner> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definitionScanner, block);

		const sphere = this.instance.Sphere;
		const touching = new Set<ProximityModel>();
		const connected = new Set<ProximityReceiverBlock>();

		const frequencyInputCache = this.initializeInputCache("frequency");

		const updateOutput = () => {
			this.output.connected.set("bool", connected.size() !== 0);
		};

		const connect = (receiver: ProximityReceiverBlock) => {
			connected.add(receiver);
			receiver.connected.add(this);
			receiver.setOutput.Fire();

			updateOutput();
		};
		const disconnect = (receiver: ProximityReceiverBlock) => {
			touching.delete(receiver.instance);
			connected.delete(receiver);
			receiver.connected.delete(this);
			receiver.setOutput.Fire();

			updateOutput();
		};

		const disconnectAll = () => {
			for (const receiver of connected) {
				disconnect(receiver);
			}
		};

		this.onk(["enabled"], ({ enabled }) => {
			sphere.CanTouch = enabled;
			if (!enabled) disconnectAll();
		});

		this.onDisable(disconnectAll);

		this.event.subscribe(update, (receiver) => {
			if (receiver.frequency !== frequencyInputCache.tryGet()) {
				disconnect(receiver);
			} else {
				if (touching.has(receiver.instance)) {
					connect(receiver);
				}
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
			if (receiver.frequency === frequencyInputCache.tryGet()) {
				connect(receiver);
			}
		});

		this.event.subscribe(sphere.TouchEnded, (part) => {
			const receiver = tryGetReceiverByPart(part);
			if (!receiver) return;
			disconnect(receiver);
		});
	}
}
@injectable
class ProximityReceiverBlock extends LogicShared<typeof definitionReceiver> {
	frequency?: number;
	readonly connected = new Set<ProximityScannerBlock>();
	setOutput = new ArgsSignal<[]>();
	constructor(block: InstanceBlockLogicArgs) {
		super(definitionReceiver, block);

		this.onEnable(() => allReceivers.set(this.instance, this));
		this.onDisable(() => {
			this.instance.Sphere.Destroy();
			this.frequency = -1;
			update.Fire(this);
			allReceivers.delete(this.instance);
		});

		this.event.subscribe(this.setOutput, () => {
			this.output.connected.set("bool", this.connected.size() !== 0);
			this.output.scanners.set("number", this.connected.size());
		});

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
