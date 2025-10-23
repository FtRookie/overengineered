import { RunService } from "@rbxts/services";
import { ArgsSignal } from "engine/shared/event/Signal";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { ProxyReceiverBlockLogic } from "shared/blocks/blocks/ProxyReceiver";
import { BlockManager } from "shared/building/BlockManager";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
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

type proxyScanner = BlockModel & {
	Sphere: BasePart | UnionOperation | MeshPart;
};

export type { Logic as ProxyScannerBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, proxyScanner> {
	static readonly update = new ArgsSignal<[self: Logic]>();

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const sphere = this.instance.Sphere;
		const receivers = ProxyReceiverBlockLogic.allReceivers;
		const touching = new Set<BlockModel>();
		const localConnections = new Set<ProxyReceiverBlockLogic>();

		const frequencyInputCache = this.initializeInputCache("frequency");

		const getConnectedFromTouching = () => {
			const selfFrequency = frequencyInputCache.get();
			const freqMap = receivers.get(selfFrequency);
			for (const touch of touching) {
				if (freqMap?.containsKey(touch)) {
					const logic = freqMap.get(touch);
					if (!logic) continue;
					localConnections.add(logic);
				}
			}
		};

		Logic.update.Connect(() => {
			// something
		});

		this.onTicc(() => {
			this.output.connected.set("bool", localConnections.size() > 0);
		});

		this.event.subscribe(sphere.Touched, (part) => {
			const partModel = BlockManager.tryGetBlockModelByPart(part);
			if (!partModel) return;
			touching.add(partModel);
		});

		this.event.subscribe(sphere.TouchEnded, (part) => {
			const partModel = BlockManager.tryGetBlockModelByPart(part);
			if (!partModel) return;
			touching.delete(partModel);
		});

		this.onk(["range"], ({ range }) => {
			if (!sphere) return;
			sphere.Size = Vector3.one.mul(range);
		});

		const stopMoving = () => {
			sphere.AssemblyLinearVelocity = Vector3.zero;
			sphere.AssemblyAngularVelocity = Vector3.zero;
			sphere.PivotTo(this.instance.PrimaryPart!.CFrame);
		};
		this.event.subscribe(RunService.PreRender, stopMoving); // for logic debug
		this.event.subscribe(RunService.PreSimulation, stopMoving); // for actual contact
	}
}

export const ProxyScannerBlock = {
	...BlockCreation.defaults,
	id: "proxyscanner",
	displayName: "Proxy Scanner",
	description: "Looks for Receivers on the same frequency, returns boolean of connection state",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
