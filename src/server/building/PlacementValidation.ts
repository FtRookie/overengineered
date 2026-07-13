import { Objects } from "engine/shared/fixes/Objects";
import { BuildingManager } from "shared/building/BuildingManager";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";

/**
 * Server-side value checks for client-supplied building requests. roblox-ts types are compile-time only,
 * and the building remotes are unvalidated on the wire, so an exploiter can send any garbage (NaN CFrames,
 * disallowed materials, oversized blobs). These reject it before it reaches the plot.
 */
export namespace PlacementValidation {
	const MAX_SCALE = 64;
	const MAX_CONFIG_ENTRIES = 256;

	function finite(n: number): boolean {
		// NaN fails self-compare; ±inf fail the bounds
		return n === n && n < math.huge && n > -math.huge;
	}
	function finiteVector(v: Vector3): boolean {
		return finite(v.X) && finite(v.Y) && finite(v.Z);
	}
	function finiteCFrame(cf: CFrame): boolean {
		const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = cf.GetComponents();
		return (
			finite(x) &&
			finite(y) &&
			finite(z) &&
			finite(r00) &&
			finite(r01) &&
			finite(r02) &&
			finite(r10) &&
			finite(r11) &&
			finite(r12) &&
			finite(r20) &&
			finite(r21) &&
			finite(r22)
		);
	}

	function checkMaterial(material: Enum.Material | undefined): string | undefined {
		if (material === undefined) return undefined;
		if (!BuildingManager.AllowedMaterials.includes(material)) return "Disallowed material";
		return undefined;
	}
	function checkColor(color: Color4 | undefined): string | undefined {
		if (color === undefined) return undefined;
		if (!finite(color.alpha) || color.alpha < 0 || color.alpha > 1) return "Invalid color alpha";
		if (!finite(color.color.R) || !finite(color.color.G) || !finite(color.color.B)) return "Invalid color";
		return undefined;
	}
	function checkScale(scale: Vector3 | undefined): string | undefined {
		if (scale === undefined) return undefined;
		if (!finiteVector(scale)) return "Invalid scale";
		if (scale.X <= 0 || scale.Y <= 0 || scale.Z <= 0) return "Invalid scale";
		if (scale.X > MAX_SCALE || scale.Y > MAX_SCALE || scale.Z > MAX_SCALE) return "Scale too large";
		return undefined;
	}
	function checkConfig(config: PlacedBlockConfig | undefined): string | undefined {
		if (config === undefined) return undefined;
		if (!typeIs(config, "table")) return "Invalid config";
		if (Objects.size(config) > MAX_CONFIG_ENTRIES) return "Config too large";
		return undefined;
	}

	export function validatePlace(block: PlaceBlockRequest): string | undefined {
		if (!finiteCFrame(block.location)) return "Invalid location";
		return (
			checkMaterial(block.material) ??
			checkColor(block.color) ??
			checkScale(block.scale) ??
			checkConfig(block.config)
		);
	}
	export function validatePaint({ color, material }: PaintBlocksRequest): string | undefined {
		return checkMaterial(material) ?? checkColor(color);
	}
	export function validateEdit(blocks: EditBlocksRequest["blocks"]): string | undefined {
		for (const block of blocks) {
			if (block.position !== undefined && !finiteCFrame(block.position)) return "Invalid edit position";

			const scaleError = checkScale(block.scale);
			if (scaleError !== undefined) return scaleError;
		}

		return undefined;
	}
}
