import { RunService } from "@rbxts/services";
import { t } from "engine/shared/t";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockBackedInputLogicValueStorage } from "shared/blockLogic/BlockLogicValueStorage";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults, BlockLogicInfo } from "shared/blocks/Block";

function createDefinition(size: number) {
	const maxPos = size - 1;
	return {
		inputOrder: ["posx", "posy", "color", "hex", "reset", "update", "suspendDraw"],
		input: {
			posx: {
				displayName: "Position X",
				types: {
					number: {
						config: 0,
						clamp: {
							showAsSlider: true,
							min: 0,
							max: maxPos,
							step: 1,
						},
					},
				},
				configHidden: true,
			},
			posy: {
				displayName: "Position Y",
				types: {
					number: {
						config: 0,
						clamp: {
							showAsSlider: true,
							min: 0,
							max: maxPos,
							step: 1,
						},
					},
				},
				configHidden: true,
			},
			color: {
				displayName: "Color",
				types: {
					vector3: {
						config: new Vector3(0, 0, 0),
					},
					color: {
						config: new Color3(0, 0, 0),
					},
				},
				configHidden: true,
			},
			update: {
				displayName: "Update",
				types: {
					bool: {
						config: false,
					},
				},
				configHidden: true,
			},
			reset: {
				displayName: "Reset",
				types: {
					bool: {
						config: false,
					},
				},
				configHidden: true,
			},
			suspendDraw: {
				displayName: "Suspend drawing",
				tooltip: "When true, drawing updates are buffered and applied all at once after disabling",
				types: {
					bool: {
						config: false,
					},
				},
				configHidden: true,
			},
			hex: {
				displayName: "Hex String",
				types: {
					string: {
						// 6 hex chars per pixel
						config: string.rep("000000", size * size),
					},
				},
				configHidden: true,
			},
		},
		output: {},
	} satisfies BlockLogicFullBothDefinitions;
}

const definition8 = createDefinition(8);
const definition16 = createDefinition(16);
type LedDisplayDefinition = typeof definition8 | typeof definition16;

// Converts a set of colors into a single buffer
function colorsToPackedBuffer(pixels: Color3[]): buffer {
	const pixelCount = pixels.size();
	const output = buffer.create(pixelCount * 2);

	for (let i = 0; i < pixelCount; i++) {
		const color = pixels[i];

		const r5 = (math.round(color.R * 255) >> 3) & 0x1f; // 3 bits
		const g6 = (math.round(color.G * 255) >> 2) & 0x3f; // 2 bits
		const b5 = (math.round(color.B * 255) >> 3) & 0x1f; // 3 bits

		const packed = (r5 << 11) | (g6 << 5) | b5;
		buffer.writeu16(output, i * 2, packed);
	}

	return output;
}

type LedDisplayModel = BlockModel & {
	readonly Screen: BasePart & {
		readonly SurfaceGui: SurfaceGui;
	};
};

/** Canvas units per pixel. */
const pixelScale = 16;
const maxSize = 16;

const updateType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<LedDisplayModel>(),
	baseColor: t.color,
	// 8 and 16 are the only two definitions; the step keeps everything between them out
	size: t.numberWithBounds(8, maxSize, 8),
	pixels: t.custom((value): value is buffer => typeIs(value, "buffer") && buffer.len(value) <= maxSize * maxSize * 2),
});
type UpdateData = t.Infer<typeof updateType>;

/** Built on each client that receives a payload, and rebuilt only when the size changes. */
const screens = new Map<LedDisplayModel, { readonly frames: Frame[]; readonly size: number }>();

const buildScreen = (block: LedDisplayModel, size: number, baseColor: Color3) => {
	const gui = block.Screen.SurfaceGui;
	gui.CanvasSize = new Vector2(size * pixelScale, size * pixelScale);
	for (const child of gui.GetChildren()) {
		child.Destroy();
	}

	const frames: Frame[] = [];
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const frame = new Instance("Frame");

			frame.BorderSizePixel = 0;
			frame.Active = false;
			frame.AutoLocalize = false;

			frame.Position = new UDim2(0, x * pixelScale, 0, y * pixelScale);
			frame.Size = new UDim2(0, pixelScale, 0, pixelScale);

			frame.BackgroundColor3 = baseColor;
			frame.Name = `x${x}y${y}`;
			frame.Parent = gui;

			frames[y * size + x] = frame;
		}
	}

	gui.Enabled = true;
	const screen = { frames, size };
	screens.set(block, screen);
	block.Destroying.Connect(() => screens.delete(block));

	return screen;
};

const update = ({ block, baseColor, size, pixels }: UpdateData) => {
	// The one constraint the validator cannot express, since it spans two fields.
	if (buffer.len(pixels) !== size * size * 2) return;

	let screen = screens.get(block);
	if (!screen || screen.size !== size) {
		screen = buildScreen(block, size, baseColor);
	}

	const frames = screen.frames;
	for (let i = 0; i < frames.size(); i++) {
		const packed = buffer.readu16(pixels, i * 2);
		const color = Color3.fromRGB(
			math.floor((((packed >> 11) & 0x1f) * 255) / 31),
			math.floor((((packed >> 5) & 0x3f) * 255) / 63),
			math.floor(((packed & 0x1f) * 255) / 31),
		);

		if (frames[i].BackgroundColor3 !== color) {
			frames[i].BackgroundColor3 = color;
		}
	}
};

const events = {
	update: new BlockSynchronizer("leddisplay_update", updateType, update),
} as const;

abstract class LedDisplayBlockLogic extends InstanceBlockLogic<LedDisplayDefinition, LedDisplayModel> {
	constructor(definition: LedDisplayDefinition, block: InstanceBlockLogicArgs, size: number) {
		super(definition, block);

		const suspendInputCache = this.initializeInputCache("suspendDraw");
		const baseColor = this.definition.input.color.types.color.config;

		// Temporary local buffer
		const renderBuffer = table.create(size * size, baseColor);
		let syncPending = false;

		// Always the whole state: a synchronizer keeps one payload per block and replays that to joining
		// players, so a send carrying only the pixels would leave them without a size to build a screen from.
		const sendAll = () => {
			syncPending = false;
			events.update.send({
				block: this.instance,
				baseColor,
				size,
				pixels: colorsToPackedBuffer(renderBuffer),
			});
		};
		// The first payload is what builds the screen, so there is no separate prepare step to order against.
		this.onEnable(sendAll);

		this.event.subscribe(RunService.PostSimulation, () => {
			if (!syncPending) return;
			if (suspendInputCache.tryGet() ?? false) return;

			sendAll();
		});

		this.onk(["posx", "posy", "color", "update"], ({ posx, posy, color, update }) => {
			if (!update) return;

			if (typeIs(color, "Vector3")) {
				color = Color3.fromRGB(color.X, color.Y, color.Z);
			}

			renderBuffer[posx + posy * size] = color;
			syncPending = true;
		});
		// hex overrides posX and posY
		this.onk(["hex", "update"], ({ hex, update }) => {
			if (!update) return;
			// unwired hex shouldn't override posX, posY
			if (!(this.input.hex instanceof BlockBackedInputLogicValueStorage)) return;
			if (hex.size() !== size * size * 6) return;

			// RRGGBB hex string per pixel, X first
			// first 6 char = (1,1,hexclr)
			for (let i = 0; i < size * size; i++) {
				const packed = tonumber(hex.sub(i * 6 + 1, i * 6 + 6), 16);
				if (packed === undefined) continue;
				renderBuffer[i] = Color3.fromRGB((packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff);
			}

			syncPending = true;
		});

		this.onk(["suspendDraw"], ({ suspendDraw }) => {
			if (suspendDraw) return;
			if (!syncPending) return;

			sendAll();
		});

		this.onk(["reset"], ({ reset }) => {
			if (!reset) return;

			for (let i = 0; i < renderBuffer.size(); i++) {
				renderBuffer[i] = baseColor;
			}

			sendAll();
		});
	}
}

class LedLogic8 extends LedDisplayBlockLogic {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition8, block, 8);
	}
}

class LedLogic16 extends LedDisplayBlockLogic {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition16, block, 16);
	}
}

const list: BlockBuildersWithoutIdAndDefaults = {
	leddisplay: {
		displayName: "Display",
		description: "Simple 8x8 pixel display. Wonder what can you do with it..",
		limit: 256,
		logic: { definition: definition8, ctor: LedLogic8, events } as BlockLogicInfo,
	},
	leddisplay16: {
		displayName: "Display16",
		description: "A 16x16 pixel display, with big screen comes great lagginess.",
		limit: 256,
		logic: { definition: definition16, ctor: LedLogic16, events } as BlockLogicInfo,
	},
};
export const LedDisplayBlocks = BlockCreation.arrayFromObject(list);

type LedDisplays = typeof LedLogic8 | typeof LedLogic16;
export type { LedDisplays as LedDisplayBlockLogic };
