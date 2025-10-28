import { Colors } from "engine/shared/Colors";
import { Element } from "engine/shared/Element";
import { Instances } from "engine/shared/fixes/Instances";
import { Objects } from "engine/shared/fixes/Objects";
import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	inputOrder: ["assetid", "stretch", "transparency", "color", "singleFace"],
	input: {
		assetid: {
			displayName: "Texture ID",
			types: {
				string: { config: "8508980527" },
				number: { config: 8508980527 },
			},
		},
		stretch: {
			displayName: "Stretch",
			types: { bool: { config: true } },
		},
		transparency: {
			displayName: "Transparency",
			types: { number: { config: 0, clamp: { showAsSlider: true, min: 0, max: 1 } } },
		},
		color: {
			displayName: "Color",
			types: { color: { config: Colors.white } },
		},
		singleFace: {
			displayName: "Single face",
			types: { bool: { config: false } },
			connectorHidden: true,
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

const updateType = t.intersection(
	t.interface({
		block: t.instance("Model").as<BlockModel>(),
		stretch: t.boolean,
	}),
	t.partial({
		assetId: t.union(t.string, t.number),
		transparency: t.numberWithBounds(0, 1),
		color: t.color,
		singleFace: t.boolean,
	}),
);
type updateType = t.Infer<typeof updateType>;

const update = ({ block, stretch, assetId, transparency, color, singleFace }: updateType) => {
	const part = block.FindFirstChild("Part");
	if (!part) return;

	for (const child of part.GetChildren()) {
		if (!child.IsA(stretch ? "Texture" : "Decal")) continue;
		child.Destroy();
	}

	let cur: readonly (Texture | Decal)[] = part.GetChildren().filter((c) => c.IsA(stretch ? "Decal" : "Texture"));
	if ((singleFace === true && cur.size() !== 1) || (singleFace === false && cur.size() !== 6)) {
		for (const item of cur) {
			item.Destroy();
		}

		cur = Objects.empty;
	}

	if (cur.size() === 0) {
		const forAllFaces = <T>(func: (face: Enum.NormalId) => T): T[] =>
			singleFace
				? [func(Enum.NormalId.Front)]
				: [
						func(Enum.NormalId.Top),
						func(Enum.NormalId.Bottom),
						func(Enum.NormalId.Left),
						func(Enum.NormalId.Right),
						func(Enum.NormalId.Front),
						func(Enum.NormalId.Back),
					];

		if (stretch) {
			cur = forAllFaces((face) => Element.create("Decal", { Name: face.Name, Face: face, Parent: part }));
		} else {
			cur = forAllFaces((face) => Element.create("Texture", { Name: face.Name, Face: face, Parent: part }));
		}
	}

	type TextureDecal = Texture & Decal;
	for (const child of cur) {
		if (assetId) {
			(child as TextureDecal).Texture = `rbxassetid://${assetId}`;
		}
		if (transparency) {
			(child as TextureDecal).Transparency = transparency;
		}
		if (color) {
			(child as TextureDecal).Color3 = color;
		}
	}
};

const events = {
	update: new BlockSynchronizer("tb_update", updateType, update),
};

export type { Logic as TextureBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const stretchCache = this.initializeInputCache("stretch");
		const assetIdCache = this.initializeInputCache("assetid");
		const transparencyCache = this.initializeInputCache("transparency");
		const colorCache = this.initializeInputCache("color");
		const singleFaceCache = this.initializeInputCache("singleFace");

		this.onk(["stretch"], ({ stretch }) => {
			events.update.send({
				block: block.instance,
				stretch: stretch,
				assetId: assetIdCache.tryGet(),
				transparency: transparencyCache.tryGet(),
				color: colorCache.tryGet(),
				singleFace: singleFaceCache.tryGet(),
			});
		});

		this.onk(["assetid"], ({ assetid }) => {
			events.update.send({
				block: block.instance,
				stretch: stretchCache.get(),
				assetId: assetid,
			});
		});
		this.onk(["transparency"], ({ transparency }) => {
			events.update.send({
				block: block.instance,
				stretch: stretchCache.get(),
				transparency,
			});
		});
		this.onk(["color"], ({ color }) => {
			events.update.send({
				block: block.instance,
				stretch: stretchCache.get(),
				color,
			});
		});
		this.onk(["singleFace"], ({ singleFace }) => {
			events.update.send({
				block: block.instance,
				stretch: stretchCache.get(),
				singleFace,
			});
		});
	}
}

const immediate = BlockCreation.immediate(definition, (block: BlockModel, config) => {
	Instances.waitForChild(block, "Part");

	events.update.send({
		block,
		stretch: BlockCreation.defaultIfWiredUnset(config?.stretch, definition.input.stretch.types.bool.config),
		assetId: BlockCreation.defaultIfWiredUnset(config?.assetid, definition.input.assetid.types.string.config),
		transparency: BlockCreation.defaultIfWiredUnset(
			config?.transparency,
			definition.input.transparency.types.number.config,
		),
		color: BlockCreation.defaultIfWiredUnset(config?.color, definition.input.color.types.color.config),
		singleFace: BlockCreation.defaultIfWiredUnset(
			config?.singleFace,
			definition.input.singleFace.types.bool.config,
		),
	});
});

export const TextureBlock = {
	...BlockCreation.defaults,
	id: "textureblock",
	displayName: "Texture Block",
	description: "Shows something appropriate",
	search: { partialAliases: ["decal"] },

	logic: { definition, ctor: Logic, events, immediate },
} as const satisfies BlockBuilder;
