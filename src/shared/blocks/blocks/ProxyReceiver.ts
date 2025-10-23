import { RunService } from "@rbxts/services";
import { ArgsSignal } from "engine/shared/event/Signal";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
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

type proxyReceiver = BlockModel & {
	Sphere: BasePart | UnionOperation | MeshPart;
};

export { Logic as ProxyReceiverBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, proxyReceiver> {
	static allReceivers = new Map<number, Map<BlockModel, Logic>>();

	readonly detected = new ArgsSignal<[state: boolean]>();

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const sphere = this.instance.Sphere;
		let prevFrequency = 0;

		this.onk(["frequency"], ({ frequency }) => {
			const allReceivers = Logic.allReceivers;
			const prevMap = allReceivers.get(prevFrequency);
			if (prevMap) {
				prevMap.delete(this.instance); // delete from previous
				if (prevMap.size() === 0) allReceivers.delete(prevFrequency);
			}
			prevFrequency = frequency;

			// create frequency map if doesn't exist at all
			let thisFreq = allReceivers.get(frequency);
			if (!thisFreq) {
				const newMap = new Map<BlockModel, Logic>();
				allReceivers.set(frequency, newMap);
				thisFreq = newMap;
			}
			thisFreq.set(this.instance, this);
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

export const ProxyReceiverBlock = {
	...BlockCreation.defaults,
	id: "proxyreceiver",
	displayName: "Proxy Receiver",
	description: "Returns if it is within proximity of a scanner, and how many of them on the same frequency",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
