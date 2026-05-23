import { RunService } from "@rbxts/services";
import { A2SRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { InstanceBlockLogic as InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults, BlockLogicInfo } from "shared/blocks/Block";

const definition = {
	inputOrder: ["posx", "posy", "color", "update", "reset", "suspendDraw"],
	input: {
		posx: {
			displayName: "Position X",
			types: {
				number: {
					config: 0,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 7,
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
						max: 7,
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
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

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

class LedDisplayBlockLogic extends InstanceBlockLogic<typeof definition> {
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
		fill: new A2SRemoteEvent<{
			readonly block: BlockModel;
			readonly color: Color3;
		}>("leddisplay_fill", "RemoteEvent"),
	} as const;

	constructor(block: InstanceBlockLogicArgs, size: number) {
		super(definition, block);

		const suspendInputCache = this.initializeInputCache("suspendDraw");
		const baseColor = this.definition.input.color.types.color.config;

		// Temperary local buffer
		const renderBuffer = table.create(size * size, baseColor);
		let syncPending = false;

		// Clamp to size bounds
		this.definition.input.posx.types.number.clamp.max = size - 1;
		this.definition.input.posy.types.number.clamp.max = size - 1;

		LedDisplayBlockLogic.events.prepare.send({ block: block.instance, baseColor, size });
		const gui = block.instance.WaitForChild("Screen").WaitForChild("SurfaceGui");

		this.event.subscribe(RunService.Heartbeat, () => {
			// No updates -> return
			if (!syncPending) return;

			if (suspendInputCache.get()) {
				// Suspend is active
				return;
			}

			syncPending = false;
			LedDisplayBlockLogic.events.update.send({
				block: block.instance,
				newBuffer: colorsToPackedBuffer(renderBuffer),
			});
		});

		this.on(({ posx, posy, color, update, suspendDraw }) => {
			if (!update) return;

			if (typeIs(color, "Vector3")) {
				color = Color3.fromRGB(color.X, color.Y, color.Z);
			}

			// Write to buffer
			renderBuffer[posx + posy * size] = color;
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

			LedDisplayBlockLogic.events.fill.send({
				block: block.instance,
				color: baseColor,
			});
		});
	}
}

class LedLogic8 extends LedDisplayBlockLogic {
	constructor(block: InstanceBlockLogicArgs) {
		super(block, 8);
	}
}

class LedLogic16 extends LedDisplayBlockLogic {
	constructor(block: InstanceBlockLogicArgs) {
		super(block, 16);
	}
}

const list: BlockBuildersWithoutIdAndDefaults = {
	leddisplay: {
		displayName: "Display",
		description: "Simple 8x8 pixel display. Wonder what can you do with it..",
		limit: 256,
		logic: { definition, ctor: LedLogic8 } as BlockLogicInfo,
	},
	leddisplay16: {
		displayName: "Display16",
		description: "A 16x16 pixel display, with big screen comes great laggyness.",
		limit: 256,
		logic: { definition, ctor: LedLogic16 } as BlockLogicInfo,
	},
};
export const LedDisplayBlocks = BlockCreation.arrayFromObject(list);

type LedDisplays = typeof LedLogic8 | typeof LedLogic16;
export type { LedDisplays as LedDisplayBlockLogic };
