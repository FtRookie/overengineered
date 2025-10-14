import { RunService } from "@rbxts/services";
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
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const sphere = this.instance.Sphere;
		const receivers = ProxyReceiverBlockLogic.allReceivers;
		const touching = new Set<ProxyReceiverBlockLogic>();
		const localConnections = new Set<ProxyReceiverBlockLogic>();
		let freq = 0;

		this.on(({ range }) => {
			if (!sphere) return;
			sphere.Size = Vector3.one.mul(range);
		});

		this.on(({ frequency }) => {
			if (freq === frequency) return;
			freq = frequency;
			updateConnections();
		});

		const clearConnects = () => {
			localConnections.forEach((value) => value.detected.Fire(false));
			localConnections.clear();
		};

		const updateConnections = () => {
			clearConnects();
			for (const potential of touching) {
				const partFrequency = potential?.currentFrequency;
				if (partFrequency === freq) {
					potential.detected.Fire(true);
					localConnections.add(potential);
				}
			}
			if (localConnections.isEmpty()) this.output.connected.set("bool", false);
			else this.output.connected.set("bool", true);
		};

		this.event.subscribe(sphere.Touched, (part) => {
			const partModel = BlockManager.tryGetBlockModelByPart(part);
			if (!partModel) return;
			const partLogic = receivers.get(partModel);
			if (!partLogic) return;
			touching.add(partLogic);
			partLogic.update.Connect(updateConnections);
		});

		this.event.subscribe(sphere.TouchEnded, (part) => {
			const partModel = BlockManager.tryGetBlockModelByPart(part);
			if (!partModel) return;
			const partLogic = receivers.get(partModel);
			if (!partLogic) return;
			touching.delete(partLogic);
			updateConnections();
		});

		this.onDisable(() => {
			clearConnects();
		});

		this.event.subscribe(RunService.Stepped, () => {
			sphere.AssemblyLinearVelocity = Vector3.zero;
			sphere.AssemblyAngularVelocity = Vector3.zero;
			sphere.PivotTo(this.instance.PrimaryPart!.CFrame);
		});
	}
}

export const ProxyScannerBlock = {
	...BlockCreation.defaults,
	id: "proxyscanner",
	displayName: "Proxy Scanner",
	description: "Looks for Receivers on the same frequency, returns boolean of connection state",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
