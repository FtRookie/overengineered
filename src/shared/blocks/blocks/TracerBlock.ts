import { Colors } from "engine/shared/Colors";
import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["enabled", "size", "transparency", "lightEmission", "color", "lifetime", "texture", "textureMode"],
	input: {
		enabled: {
			displayName: "Enabled",
			types: {
				bool: {
					config: true,
				},
			},
		},
		size: {
			displayName: "Size",
			types: {
				number: {
					config: 1,
					clamp: {
						min: 0,
						max: 10,
						showAsSlider: true,
					},
				},
			},
		},
		transparency: {
			displayName: "Transparency",
			types: {
				number: {
					config: 0,
					clamp: {
						min: 0,
						max: 1,
						showAsSlider: true,
					},
				},
			},
		},
		lightEmission: {
			displayName: "Light Emission",
			types: {
				number: {
					config: 0,
					clamp: {
						min: 0,
						max: 1,
						showAsSlider: true,
					},
				},
			},
		},
		color: {
			displayName: "Color",
			types: { color: { config: Colors.white } },
		},
		lifetime: {
			displayName: "Lifetime",
			types: {
				number: {
					config: 5,
					clamp: {
						min: 0,
						max: 20,
						showAsSlider: true,
					},
				},
			},
		},
		texture: {
			displayName: "Texture",
			types: {
				string: {
					config: "6586510550",
				},
			},
			connectorHidden: true,
		},
		textureMode: {
			displayName: "Texture Mode",
			types: {
				enum: {
					config: "static",
					elementOrder: ["static", "stretch", "wrap"],
					elements: {
						static: {
							displayName: "Static",
							tooltip: "Texture length times beam width in size, relative velocity to world is zero",
						},
						stretch: { displayName: "Stretch", tooltip: "Stretches across the entire length of the trail" },
						wrap: {
							displayName: "Wrap",
							tooltip: "Same as static but relative velocity to block is zero",
						},
					},
				},
			},
			connectorHidden: true,
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type TracerBlockModel = BlockModel & {
	readonly Emitter: UnionOperation & {
		readonly Trail: Trail;
		readonly Attachment0: Attachment;
		readonly Attachment1: Attachment;
	};
};

const updateDataType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<TracerBlockModel>(),
	enabled: t.boolean,
	size: t.number,
	transparency: t.number,
	lightEmission: t.number,
	lifetime: t.number,
	color: t.color,
	texture: t.string,
	textureMode: t.string,
});
type UpdateData = t.Infer<typeof updateDataType>;

const update = ({
	block,
	enabled,
	size,
	transparency,
	lightEmission,
	color,
	lifetime,
	texture,
	textureMode,
}: UpdateData) => {
	if (!block) return;
	const trail = block.Emitter.Trail;
	trail.Enabled = enabled;
	trail.Transparency = new NumberSequence(transparency, 0);
	trail.LightEmission = lightEmission;
	trail.Color = new ColorSequence(color, Colors.white);
	trail.Lifetime = lifetime;
	trail.Texture = `rbxassetid://${texture}`;
	trail.TextureMode = Logic.textureModeLookup[textureMode];

	const baseCFrame = new CFrame(0.125, 0, 0);
	const attach0 = block.Emitter.Attachment0;
	const attach1 = block.Emitter.Attachment1;
	attach0.CFrame = baseCFrame.mul(new CFrame(0, 0, size / 2));
	attach1.CFrame = baseCFrame.mul(new CFrame(0, 0, -size / 2));
	trail.TextureLength = size; // for aspect ratio
};

const events = {
	update: new BlockSynchronizer("tracerblock_update", updateDataType, update),
} as const;

export type { Logic as TracerBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, TracerBlockModel> {
	// lookup record because roblox method suck
	static textureModeLookup: Record<string, Enum.TextureMode> = {
		static: Enum.TextureMode.Static,
		stretch: Enum.TextureMode.Stretch,
		wrap: Enum.TextureMode.Wrap,
	};
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
		this.onk(
			["enabled", "size", "transparency", "lightEmission", "color", "lifetime", "texture", "textureMode"],
			({ enabled, size, transparency, lightEmission, color, lifetime, texture, textureMode }) => {
				update({
					block: this.instance,
					enabled,
					size,
					transparency,
					lightEmission,
					color,
					lifetime,
					texture,
					textureMode,
				});
			},
		);
	}
}

export const TracerBlock = {
	...BlockCreation.defaults,
	id: "tracerblock",
	displayName: "Tracer",
	description: "Creates a trail with an optional texture",
	limit: 200,

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
