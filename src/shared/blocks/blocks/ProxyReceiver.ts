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
	static allReceivers = new Map<BlockModel, Logic>();
	readonly detected = new ArgsSignal<[state: boolean]>();
	readonly update = new ArgsSignal<[self: Logic]>();
	currentFrequency = 0;
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const sphere = this.instance.Sphere;
		let connections = 0;

		Logic.allReceivers.set(this.instance, this);
		this.on(({ frequency }) => {
			if (this.currentFrequency === frequency) return;
			this.currentFrequency = frequency;
			updateConnected();
		});

		this.on(({ range }) => {
			if (!sphere) return;
			sphere.Size = Vector3.one.mul(range);
			updateConnected();
		});

		this.event.subscribe(RunService.Stepped, () => {
			sphere.AssemblyLinearVelocity = Vector3.zero;
			sphere.AssemblyAngularVelocity = Vector3.zero;
			sphere.PivotTo(this.instance.PrimaryPart!.CFrame);
		});

		const updateConnected = () => {
			this.update.Fire(this);
		};

		this.detected.Connect((state) => {
			if (state) connections += 1;
			else connections -= 1;
			if (connections > 0) this.output.connected.set("bool", true);
			else this.output.connected.set("bool", false);
			this.output.scanners.set("number", connections);
			updateConnected();
		});
	}
}

export const ProxyReceiverBlock = {
	...BlockCreation.defaults,
	id: "proxyreceiver",
	displayName: "Proxy Receiver",
	description: "Returns if it is within proximity of a scanner, and how many of them on the same frequency",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
