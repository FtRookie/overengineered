import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { LedDisplayBlockLogic } from "shared/blocks/blocks/grouped/LedDisplayBlocks";

// Store the frames for each block
const blockFrames = new Map<Model, Frame[]>();

function decodeColorBuffer(compressed: buffer): buffer {
	const compressedSize = buffer.len(compressed);
	const numPixels = math.floor(compressedSize / 2);
	const output = buffer.create(numPixels * 3);

	for (let i = 0; i < numPixels; i++) {
		const packed = buffer.readu16(compressed, i * 2);

		// Extract and scale back to normal
		const r = math.floor((((packed >> 11) & 0x1f) * 255) / 31);
		const g = math.floor((((packed >> 5) & 0x3f) * 255) / 63);
		const b = math.floor(((packed & 0x1f) * 255) / 31);

		buffer.writeu8(output, i * 3, r);
		buffer.writeu8(output, i * 3 + 1, g);
		buffer.writeu8(output, i * 3 + 2, b);
	}

	return output;
}

@injectable
export class LEDDisplayServerLogic extends ServerBlockLogic<LedDisplayBlockLogic> {
	constructor(logic: LedDisplayBlockLogic, @inject playModeController: PlayModeController) {
		super(logic, playModeController);

		logic.events.prepare.invoked.Connect((player, { block, baseColor, size }) => {
			if (!this.isValidBlock(block, player)) return;

			const scale = 16;
			const gui = block.WaitForChild("Screen").WaitForChild("SurfaceGui") as SurfaceGui;
			gui.CanvasSize = new Vector2(size * scale, size * scale);

			const display: Frame[] = new Array(size * size);
			for (let y = 0; y < size; y++) {
				for (let x = 0; x < size; x++) {
					const idx = y * size + x;
					const frame = new Instance("Frame");

					frame.BorderSizePixel = 0;
					frame.Active = false;
					frame.AutoLocalize = false;

					frame.Position = new UDim2(0, x * scale, 0, y * scale);
					frame.Size = new UDim2(0, scale, 0, scale);

					frame.BackgroundColor3 = baseColor;
					frame.Name = `x${x}y${y}`;
					frame.Parent = gui;

					display[idx] = frame;
				}
			}

			gui.Enabled = true;
			blockFrames.set(block, display); // Store the block's frames for later

			// Remove when block destroyed
			block.Destroying.Connect(() => {
				blockFrames.delete(block);
			});
		});

		logic.events.update.invoked.Connect((player, { block, newBuffer }) => {
			if (!this.isValidBlock(block, player)) return;

			const frames = blockFrames.get(block);
			if (!frames) {
				warn("BlockMap for block does not exist!");
				return;
			}

			const dataBuffer = decodeColorBuffer(newBuffer);

			for (let i = 0; i < frames.size(); i++) {
				const offset = i * 3;

				const r = buffer.readu8(dataBuffer, offset);
				const g = buffer.readu8(dataBuffer, offset + 1);
				const b = buffer.readu8(dataBuffer, offset + 2);

				const f = frames[i];
				const newColor = Color3.fromRGB(r, g, b);

				if (f.BackgroundColor3 !== newColor) f.BackgroundColor3 = newColor;
			}
		});

		logic.events.fill.invoked.Connect((player, { block, color }) => {
			if (!this.isValidBlock(block, player)) return;

			const frames = blockFrames.get(block);
			if (!frames) {
				warn("BlockMap for block does not exist!!! :O (fill)");
				return;
			}

			// Just repeat for each frame and set its background
			for (const frame of frames) {
				frame.BackgroundColor3 = color;
			}
		});
	}
}
