import { RunService } from "@rbxts/services";
import { A2SRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockBackedInputLogicValueStorage } from "shared/blockLogic/BlockLogicValueStorage";
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

abstract class LedDisplayBlockLogic extends InstanceBlockLogic<LedDisplayDefinition> {
	static readonly events = {
		prepare: new A2SRemoteEvent<{
			readonly block: BlockModel;
			readonly baseColor: Color3;
			readonly size: number;
		}>("leddisplay_prepare", "RemoteEvent"),
		update: new A2SRemoteEvent<{
			readonly block: BlockModel;
			readonly newBuffer: buffer;
		}>("leddisplay_update", "RemoteEvent"),
	} as const;

	constructor(definition: LedDisplayDefinition, block: InstanceBlockLogicArgs, size: number) {
		super(definition, block);

		const suspendInputCache = this.initializeInputCache("suspendDraw");
		const baseColor = this.definition.input.color.types.color.config;

		// Temporary local buffer
		const renderBuffer = table.create(size * size, baseColor);
		let syncPending = false;

		LedDisplayBlockLogic.events.prepare.send({ block: block.instance, baseColor, size });
		const gui = block.instance.WaitForChild("Screen").WaitForChild("SurfaceGui");

		this.event.subscribe(RunService.PostSimulation, () => {
			if (!syncPending) return;
			if (suspendInputCache.get()) return;

			syncPending = false;
			LedDisplayBlockLogic.events.update.send({
				block: block.instance,
				newBuffer: colorsToPackedBuffer(renderBuffer),
			});
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

			syncPending = false;
			LedDisplayBlockLogic.events.update.send({
				block: block.instance,
				newBuffer: colorsToPackedBuffer(renderBuffer),
			});
		});

		this.onk(["reset"], ({ reset }) => {
			if (!reset) return;

			const baseColor = this.definition.input.color.types.color.config;
			for (let i = 0; i < renderBuffer.size(); i++) {
				renderBuffer[i] = baseColor;
			}

			syncPending = false;
			LedDisplayBlockLogic.events.update.send({
				block: block.instance,
				newBuffer: colorsToPackedBuffer(renderBuffer),
			});
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
		logic: { definition: definition8, ctor: LedLogic8 } as BlockLogicInfo,
	},
	leddisplay16: {
		displayName: "Display16",
		description: "A 16x16 pixel display, with big screen comes great lagginess.",
		limit: 256,
		logic: { definition: definition16, ctor: LedLogic16 } as BlockLogicInfo,
	},
};
export const LedDisplayBlocks = BlockCreation.arrayFromObject(list);

type LedDisplays = typeof LedLogic8 | typeof LedLogic16;
export type { LedDisplays as LedDisplayBlockLogic };
