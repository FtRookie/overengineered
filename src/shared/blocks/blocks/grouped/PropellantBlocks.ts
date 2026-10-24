import { S2CRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { t } from "engine/shared/t";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { notifyAssemblySplit } from "shared/blocks/blocks/MassSensorBlock";
import { BlockManager } from "shared/building/BlockManager";
import { PartUtils } from "shared/utils/PartUtils";
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
		disintegrating: {
			displayName: "Disintegrating",
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
	Bottom: BasePart;
	Top: BasePart;
	ColBox: BasePart & { WeldTop: WeldConstraint };
};

const forceClamp = definition.input.force.types.number.clamp;
const replicateEventType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<PropellantBlock>(),
	willDisintegrate: t.boolean,
	force: t.numberWithBounds(forceClamp.min, forceClamp.max),
	symmetric: t.boolean,
});
type ReplicateData = t.Infer<typeof replicateEventType>;

/**
 * The client-visible half of firing a charge, run on every client and on the sender before the round trip.
 * Breaking the weld and dropping the halves is physics, so the server repeats both authoritatively in
 * PropellantBlockServerLogic. Joining players are replayed this too, hence resolving rather than indexing —
 * by then the charge may be long spent.
 */
const replicate = ({ block, willDisintegrate }: ReplicateData) => {
	const colbox = block.FindFirstChild("ColBox") as BasePart | undefined;
	if (!colbox) return;

	colbox.FindFirstChild("WeldTop")?.Destroy();
	for (const decal of colbox.GetChildren()) {
		if (decal.IsA("Decal")) decal.Transparency = 1; // hide decals or else forever death
	}

	if (!willDisintegrate) return;
	task.spawn(() => {
		task.wait();
		block.FindFirstChild("Top")?.Destroy();
		block.FindFirstChild("Bottom")?.Destroy();
	});
};

const events = {
	replicate: new BlockSynchronizer("b_propellantblock_disconnect", replicateEventType, replicate),
} as const;

export type { Logic as PropellantBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, PropellantBlock> {
	static readonly events = events;

	// Kept off `events`: the controller registers block-validity middleware on every entry there, and an
	// S2C event has no such method. The server is the only sender, so there is nothing to validate anyway.
	static readonly propel2c = new S2CRemoteEvent<{ readonly block: PropellantBlock }>(
		"b_propellantblock_disconnect2c",
	);

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const bottom = this.instance.Bottom;
		const top = this.instance.Top;

		const force = this.initializeInputCache("force");
		const symmetric = this.initializeInputCache("symmetric");
		const disintegrating = this.initializeInputCache("disintegrating");

		const blockScale = BlockManager.manager.scale.get(this.instance) ?? Vector3.one;
		const scale = blockScale.X * blockScale.Y * blockScale.Z;

		this.on(({ propel }) => {
			if (!propel) return;

			// an anchored assembly is the server's, so a push from here would do nothing: the server pushes
			// whatever half the break frees
			const anchored = top.AssemblyRootPart?.Anchored === true;

			// before the send, not after: sendOrBurn runs `replicate` locally and synchronously, and that is
			// where WeldTop goes
			if (!anchored) {
				PartUtils.pinAssemblyVelocity(top);
				PartUtils.pinAssemblyVelocity(bottom);
			}

			const forceValue = force.tryGet() ?? 0;
			const isSymmetric = symmetric.get() === true;
			events.replicate.sendOrBurn(
				{
					block: this.instance,
					willDisintegrate: disintegrating.get(),
					force: forceValue,
					symmetric: isSymmetric,
				},
				this,
			);
			// breaking WeldTop splits the assembly, same as the disconnector
			notifyAssemblySplit(this.instance);

			// the impulse stays out of the synchronizer: only the owning client holds network ownership of
			// these parts, so it is the only one whose push counts
			if (!anchored) {
				const impulse = math.max(1, scale) * forceValue;
				if (!isSymmetric) {
					top.ApplyImpulse(top.CFrame.UpVector.mul(impulse));
				} else {
					top.ApplyImpulse(top.CFrame.UpVector.mul(impulse / 2));
					bottom.ApplyImpulse(bottom.CFrame.UpVector.mul(impulse / 2));
				}
			}

			this.disable();
		});
	}
}

Logic.propel2c.invoked.Connect(({ block }) => {
	PartUtils.unpinAssemblyVelocity(block.FindFirstChild("Top"));
	PartUtils.unpinAssemblyVelocity(block.FindFirstChild("Bottom"));
});

const logic: BlockLogicInfo = { definition, ctor: Logic, events };
const search = { partialAliases: ["gunpowder", "explosive"] };
const list: BlockBuildersWithoutIdAndDefaults = {
	propellantblock: {
		displayName: "Propellant Charge",
		description: "A single use propellant that propels things",
		limitFamily: "propellant",
		logic,
		search,
	},
	cylindricalpropellant: {
		displayName: "Cylindrical Propellant Charge",
		description: "Propels things, but cylindrically",
		limitFamily: "propellant",
		logic,
		search,
	},
};
export const PropellantBlocks = BlockCreation.arrayFromObject(list);
