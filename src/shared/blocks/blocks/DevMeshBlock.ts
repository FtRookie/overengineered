import { AssetService } from "@rbxts/services";
import { Instances } from "engine/shared/fixes/Instances";
import { t } from "engine/shared/t";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["mesh", "texture", "overrideScale", "scale"],
	input: {
		mesh: {
			displayName: "Mesh",
			types: {
				string: {
					config: "",
				},
			},
		},
		texture: {
			displayName: "Texture",
			types: {
				string: {
					config: "",
				},
			},
		},
		overrideScale: {
			displayName: "Override Scale",
			tooltip: "Use Scale as-is instead of fitting the mesh to the block. Most meshes cannot be measured.",
			types: {
				bool: {
					config: false,
				},
			},
		},
		scale: {
			displayName: "Scale",
			tooltip: "Mesh scale. Only applies while Override Scale is on.",
			types: {
				vector3: {
					config: new Vector3(1, 1, 1),
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

export type DevMeshBlockModel = BlockModel & {
	Part: Part & { Mesh: SpecialMesh };
};

const updateEventType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<DevMeshBlockModel>(),
	mesh: t.string,
	texture: t.string,
	overrideScale: t.boolean,
	scale: t.vector3,
});
type UpdateData = t.Infer<typeof updateEventType>;

// A mesh asset's dimensions never change, and update() runs on every client for every placed block, so
// measure once per id rather than once per block.
const nativeSizes = new Map<string, Vector3>();

/** Largest uniform scale that keeps a mesh of `native` size inside `bounds`. */
const fitScale = (bounds: Vector3, native: Vector3): Vector3 => {
	if (native.X <= 0 || native.Y <= 0 || native.Z <= 0) return Vector3.zero;
	return Vector3.one.mul(math.min(bounds.X / native.X, bounds.Y / native.Y, bounds.Z / native.Z));
};

// Scale caps the mesh to the block, so anything short of a known size renders nothing: a failed cap would
// otherwise leave the mesh at its native size, stretching past the block it is meant to be bounded by.
const applyMeshFit = (block: DevMeshBlockModel, meshId: string) => {
	const specialMesh = block.Part.Mesh;
	if (meshId === "") {
		specialMesh.Scale = Vector3.zero;
		return;
	}

	const cached = nativeSizes.get(meshId);
	if (cached) {
		specialMesh.Scale = fitScale(block.Part.Size, cached);
		return;
	}

	specialMesh.Scale = Vector3.zero;

	// CreateEditableMeshAsync yields, and ArgsSignal.Fire runs its subscribers inline — yielding here would
	// stall every other handler on the same signal.
	task.spawn(() => {
		let measured: Vector3;
		try {
			const editable = AssetService.CreateEditableMeshAsync(Content.fromUri(`rbxassetid://${meshId}`));
			measured = editable.GetSize();
			editable.Destroy();
		} catch (err) {
			// the block stays blank on failure, so the reason has to reach the log or it looks like nothing happened
			$warn(`Mesh block could not measure mesh ${meshId}:`, err);
			return;
		}

		nativeSizes.set(meshId, measured);
		if (specialMesh.Parent === undefined) return;

		specialMesh.Scale = fitScale(block.Part.Size, measured);
	});
};

const update = ({ block, mesh, texture, overrideScale, scale }: UpdateData) => {
	block.Part.Mesh.MeshId = `rbxassetid://${mesh}`;
	block.Part.Mesh.TextureId = `rbxassetid://${texture}`;

	// The override hands the cap back to the developer wholesale — no measurement, and no zeroing, since
	// there is nothing left to fail.
	if (overrideScale) {
		block.Part.Mesh.Scale = scale;
		return;
	}

	applyMeshFit(block, mesh);
};

const events = {
	update: new BlockSynchronizer("b_dev_meshblock_update", updateEventType, update),
} as const;

export type { Logic as DevMeshBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, DevMeshBlockModel> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
		this.onk(["mesh", "texture", "overrideScale", "scale"], ({ mesh, texture, overrideScale, scale }) => {
			events.update.sendOrBurn(
				{
					block: this.instance,
					mesh,
					texture,
					overrideScale,
					scale,
				},
				this,
			);
		});
	}
}

const immediate = BlockCreation.immediate(definition, (block: DevMeshBlockModel, config) => {
	Instances.waitForChild(block, "Part");
	events.update.send({
		block,
		mesh: BlockCreation.defaultIfWiredUnset(config?.mesh, definition.input.mesh.types.string.config),
		texture: BlockCreation.defaultIfWiredUnset(config?.texture, definition.input.texture.types.string.config),
		overrideScale: BlockCreation.defaultIfWiredUnset(
			config?.overrideScale,
			definition.input.overrideScale.types.bool.config,
		),
		scale: BlockCreation.defaultIfWiredUnset(config?.scale, definition.input.scale.types.vector3.config),
	});
});

export const DevMeshBlock = {
	...BlockCreation.defaults,
	id: "devmeshblock",
	displayName: "Mesh Block",
	description: "A self contained SpecialMesh, developer use only",
	search: { partialAliases: ["dev"] },
	devOnly: true,
	logic: { definition, ctor: Logic, events, immediate },
} as const satisfies BlockBuilder;
