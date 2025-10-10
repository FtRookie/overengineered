import { C2SRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults, BlockLogicInfo } from "shared/blocks/Block";

const definition = {
	input: {
		propel: {
			displayName: "Propel",
			types: {
				bool: {
					config: false,
					control: {
						config: {
							enabled: true,
							key: "B",
							switch: false,
							reversed: false,
						},
						canBeSwitch: false,
						canBeReversed: false,
					},
				},
			},
		},
		force: {
			displayName: "Force",
			connectorHidden: true,
			types: {
				number: {
					config: 25000,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 25000,
					},
				},
			},
		},
		symmetric: {
			displayName: "Symmetric",
			connectorHidden: true,
			types: {
				bool: {
					config: true,
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type PropellantBlock = BlockModel & {
	Bottom: Part;
	Top: Part;
	ColBox: Part & { WeldTop: WeldConstraint };
};

export type { Logic as PropellantBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, PropellantBlock> {
	static readonly events = {
		replicate: new C2SRemoteEvent<{ readonly block: PropellantBlock }>("b_propellantblock_disconnect"),
	} as const;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const primaryPart = this.instance.ColBox;
		const bottom = this.instance.Bottom;
		const top = this.instance.Top;

		const force = this.initializeInputCache("force");
		const symmetric = this.initializeInputCache("symmetric");

		const blockScale = BlockManager.manager.scale.get(this.instance) ?? Vector3.one;
		const scale = blockScale.X * blockScale.Y * blockScale.Z;

		this.on(({ propel }) => {
			if (!propel) return;
			primaryPart.WeldTop.Destroy();
			Logic.events.replicate.send({ block: this.instance });

			for (const decal of primaryPart.GetChildren()) {
				if (decal.IsA("Decal")) decal.Transparency = 1; // hide decals or else forever death
			}

			if (!symmetric.get()) {
				top.ApplyImpulse(top.CFrame.UpVector.mul(math.max(1, scale) * force.get()));
			} else {
				top.ApplyImpulse(top.CFrame.UpVector.mul((math.max(1, scale) * force.get()) / 2));
				bottom.ApplyImpulse(bottom.CFrame.UpVector.mul((math.max(1, scale) * force.get()) / 2));
			}
			this.disable();
		});
	}
}

const logic: BlockLogicInfo = { definition, ctor: Logic };
const list: BlockBuildersWithoutIdAndDefaults = {
	propellantblock: {
		displayName: "Propellant Charge",
		description: "A single use propellant that propels things",
		limit: 100,
		logic,
	},
	cylindricalpropellant: {
		displayName: "Cylindrical Propellant Charge",
		description: "Propels things, but cylindrically",
		limit: 100,
		logic,
	},
};
export const PropellantBlocks = BlockCreation.arrayFromObject(list);
