import { RunService } from "@rbxts/services";
import { ArgsSignal } from "engine/shared/event/Signal";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definitionScanner = {
	inputOrder: ["enabled", "frequency", "range"],
	input: {
		enabled: {
			displayName: "Enabled",
			types: {
				bool: {
					config: false,
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
	},
	output: {
		connected: {
			displayName: "Connected",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

const definitionReceiver = {
	inputOrder: ["frequency", "range"],
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

type ProxyModel = BlockModel & {
	readonly Sphere: BasePart | UnionOperation | MeshPart;
};

const update = new ArgsSignal<[self: ProxyReceiverBlock]>();
const allReceivers = new Map<number, Map<ProxyModel, ProxyReceiverBlock>>();

const all = new Set<ProxyModel>();
const tpSphere = () => {
	for (const model of all) {
		const sphere = model.Sphere;

		sphere.AssemblyLinearVelocity = Vector3.zero;
		sphere.AssemblyAngularVelocity = Vector3.zero;
		sphere.PivotTo(model.PrimaryPart!.CFrame);
	}
};
RunService.PreRender.Connect(tpSphere); // for logic visualizer
RunService.PreSimulation.Connect(tpSphere); // for actual contact

abstract class LogicShared extends InstanceBlockLogic<
	typeof definitionScanner | typeof definitionReceiver,
	ProxyModel
> {
	readonly detected = new ArgsSignal<[state: boolean]>();

	constructor(definition: typeof definitionScanner | typeof definitionReceiver, block: InstanceBlockLogicArgs) {
		super(definition, block);
		const sphere = this.instance.Sphere;

		this.onk(["range"], ({ range }) => {
			if (!sphere) return;
			sphere.Size = Vector3.one.mul(range);
		});

		this.onEnable(() => all.add(this.instance));
		this.onDisable(() => all.delete(this.instance));
	}
}

@injectable
class ProxyScannerBlock extends LogicShared {
	constructor(block: InstanceBlockLogicArgs) {
		super(definitionScanner, block);

		const sphere = this.instance.Sphere;
		const touching = new Set<ProxyModel>();
		const connected = new Set<ProxyReceiverBlock>();

		const frequencyInputCache = this.initializeInputCache("frequency");

		const getConnectedFromTouching = () => {
			const selfFrequency = frequencyInputCache.get();
			const freqMap = allReceivers.get(selfFrequency);
			for (const touch of touching) {
				if (freqMap?.containsKey(touch)) {
					const logic = freqMap.get(touch);
					if (!logic) continue;
					connected.add(logic);
				}
			}
		};

		const updateOutput = () => {
			this.output.connected.set("bool", connected.size() > 0);
		};

		this.event.subscribe(update, (receiver) => {
			if (receiver.frequency !== frequencyInputCache.tryGet()) {
				connected.delete(receiver);
				return;
			}

			const instance = receiver.instance;
			if (!touching.has(instance)) return;

			updateOutput();
		});

		const tryGetReceiverByPart = (part: BasePart) => {
			const partModel = BlockManager.tryGetBlockModelByPart(part);
			if (!partModel) return;

			allReceivers; // fuck
		};

		this.event.subscribe(sphere.Touched, (part) => {
			const partModel = BlockManager.tryGetBlockModelByPart(part);
			if (!partModel) return;

			touching.add(partModel as ProxyModel);
		});

		this.event.subscribe(sphere.TouchEnded, (part) => {
			const partModel = BlockManager.tryGetBlockModelByPart(part);
			if (!partModel) return;

			touching.delete(partModel as ProxyModel);
			connected.delete(receiver); // where
			// lets' tru somthign, make a commit so we can revert if i dont like it
			// do you need the number map at all
			// its for the touch iterating thing but if there is a better way to do the whole system then yes it can be changed
		});

		this.onTicc(() => {
			this.output.connected.set("bool", connected.size() > 0);
		});
	}
}
@injectable
class ProxyReceiverBlock extends LogicShared {
	frequency?: number;

	constructor(block: InstanceBlockLogicArgs) {
		super(definitionReceiver, block);

		this.onk(["frequency"], ({ frequency }) => {
			if (this.frequency) {
				const prevMap = allReceivers.get(this.frequency);
				if (prevMap) {
					prevMap.delete(this.instance); // delete from previous
					if (prevMap.size() === 0) allReceivers.delete(this.frequency);
				}
			}
			this.frequency = frequency;
			// todo: event that update all/relevant scanners

			// create frequency map if doesn't exist at all
			let thisFreq = allReceivers.get(frequency);
			if (!thisFreq) {
				const newMap = new Map<ProxyModel, LogicShared>();
				allReceivers.set(frequency, newMap);
				thisFreq = newMap;
			}
			thisFreq.set(this.instance, this);
		});
	}
}

export const blocks = [
	{
		...BlockCreation.defaults,
		id: "proxyscanner",
		displayName: "Proxy Scanner",
		description: "Looks for Receivers on the same frequency, returns boolean of connection state",

		logic: { definition: definitionScanner, ctor: ProxyScannerBlock },
	},
	{
		...BlockCreation.defaults,
		id: "proxyreceiver",
		displayName: "Proxy Receiver",
		description: "Returns if it is within proximity of a scanner, and how many of them on the same frequency",

		logic: { definition: definitionReceiver, ctor: ProxyReceiverBlock },
	},
] as const satisfies BlockBuilder[];
