import { RunService } from "@rbxts/services";
import { C2CRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
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
		detected: {
			displayName: "Detected",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type proxyEmitter = BlockModel & {
	Sphere: BasePart | UnionOperation | MeshPart;
};

export type { Logic as ProxyEmitterBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, proxyEmitter> {
	static readonly sendEvent = new C2CRemoteEvent<{
		/* readonly frequency: number;
		readonly valueType: BlockLogicTypes.IdListOfType<typeof definition.input.value.types>;
		readonly value: BlockLogicTypes.TypeListOfType<typeof definition.input.value.types>; */
	}>("b_proxy_emitter_send", "RemoteEvent");

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const sphere = this.instance.Sphere;

		this.on(({ range }) => {
			if (!sphere) return;
			sphere.Size = Vector3.one.mul(range);
		});

		this.event.subscribe(RunService.Stepped, () => {
			sphere.AssemblyLinearVelocity = Vector3.zero;
			sphere.AssemblyAngularVelocity = Vector3.zero;
			sphere.PivotTo(this.instance.PrimaryPart!.CFrame);
		});
	}
}

export const ProxyEmitterBlock = {
	...BlockCreation.defaults,
	id: "proxyemitter",
	displayName: "Proxy Emitter",
	description: "Announces its existance on the given frequency with a certain range",

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
