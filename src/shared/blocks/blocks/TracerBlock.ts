import { Colors } from "engine/shared/Colors";
import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { inferEnumLogicType } from "shared/blockLogic/BlockLogicTypes";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: [
		"enabled",
		"size",
		"length",
		"transparency",
		"lightEmission",
		"color",
		"lifetime",
		"texture",
		"textureMode",
	],
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
		length: {
			displayName: "Length",
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
				// inferred so the input narrows to its own element keys, which is what the payload and the
				// lookup below both expect
				enum: inferEnumLogicType({
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
				}),
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

/** Attachment offset baked into the model, hoisted so it is not rebuilt on every update. */
const baseCFrame = new CFrame(0.125, 0, 0);

const updateDataType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<TracerBlockModel>(),
	enabled: t.boolean,
	size: t.numberWithBounds(0, 10),
	length: t.numberWithBounds(0, 10),
	transparency: t.numberWithBounds(0, 1),
	lightEmission: t.numberWithBounds(0, 1),
	lifetime: t.numberWithBounds(0, 20),
	color: t.color,
	texture: t.string,
	textureMode: t.union(
		t.const("static"), //
		t.const("stretch"),
		t.const("wrap"),
	),
});
type UpdateData = t.Infer<typeof updateDataType>;

const update = ({
	block,
	enabled,
	size,
	length,
	transparency,
	lightEmission,
	color,
	lifetime,
	texture,
	textureMode,
}: UpdateData) => {
	const trail = block.Emitter.Trail;
	trail.Enabled = enabled;
	trail.Transparency = new NumberSequence(transparency, 1); // todo: player determined
	trail.LightEmission = lightEmission;
	trail.Color = new ColorSequence(color); // todo: player determined
	trail.Lifetime = lifetime;
	trail.Texture = `rbxassetid://${texture}`;
	trail.TextureMode = Logic.textureModeLookup[textureMode];

	const attach0 = block.Emitter.Attachment0;
	const attach1 = block.Emitter.Attachment1;
	attach0.CFrame = baseCFrame.mul(new CFrame(0, 0, size / 2));
	attach1.CFrame = baseCFrame.mul(new CFrame(0, 0, -size / 2));
	trail.TextureLength = length;
};

export type TracerBlockLogic = typeof Logic;
export class Logic extends InstanceBlockLogic<typeof definition, TracerBlockModel> {
	// lookup record because roblox method suck
	// keyed on the payload's own union, so adding a mode to the input without adding it here will not compile
	static textureModeLookup: Record<UpdateData["textureMode"], Enum.TextureMode> = {
		static: Enum.TextureMode.Static,
		stretch: Enum.TextureMode.Stretch,
		wrap: Enum.TextureMode.Wrap,
	};

	static readonly events = {
		update: new BlockSynchronizer<UpdateData>("tracer_update", updateDataType, update),
	} as const;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
		this.onk(
			[
				"enabled",
				"size",
				"length",
				"transparency",
				"lightEmission",
				"color",
				"lifetime",
				"texture",
				"textureMode",
			],
			({ enabled, size, length, transparency, lightEmission, color, lifetime, texture, textureMode }) => {
				Logic.events.update.sendOrBurn(
					{
						block: this.instance,
						enabled,
						size,
						length,
						transparency,
						lightEmission,
						color,
						lifetime,
						texture,
						textureMode,
					},
					this,
				);
			},
		);
		this.onDisable(() =>
			task.defer(() => {
				if (this.isDestroyed()) return;
				Logic.events.update.sendOrBurn(
					{
						block: this.instance,
						enabled: false,
						size: 0,
						length: 0,
						transparency: 1,
						lightEmission: 0,
						color: Colors.black,
						lifetime: 0,
						texture: "6586510550",
						textureMode: "static",
					},
					this,
				);
			}),
		);
	}
}

export const TracerBlock = {
	...BlockCreation.defaults,
	id: "tracerblock",
	displayName: "Tracer",
	description: "Creates a trail with an optional texture",
	limit: 200,
	search: { partialAliases: ["oreo", "trail"], aliases: ["visualize", "follow"] },
	logic: { definition, ctor: Logic, events: Logic.events },
} as const satisfies BlockBuilder;
