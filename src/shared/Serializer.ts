import { Color4 } from "shared/Color4";

export namespace Serializer {
	export namespace CFrameSerializer {
		export function serialize(cframe: CFrame): SerializedCFrame {
			return [cframe.Position.X, cframe.Position.Y, cframe.Position.Z, cframe.ToEulerAnglesXYZ()];
		}

		export function deserialize(serializedCFrame: SerializedCFrame): CFrame {
			if (typeIs(serializedCFrame, "CFrame")) {
				return serializedCFrame;
			}

			return new CFrame(serializedCFrame[0], serializedCFrame[1], serializedCFrame[2]).mul(
				CFrame.fromEulerAnglesXYZ(serializedCFrame[3][0], serializedCFrame[3][1], serializedCFrame[3][2]),
			);
		}
	}

	export namespace EnumMaterialSerializer {
		const byValue = new Map<SerializedEnum, Enum.Material>();
		for (const material of Enum.Material.GetEnumItems()) {
			byValue.set(material.Value, material);
		}

		export function serialize(material: Enum.Material): SerializedEnum {
			return material.Value;
		}

		export function deserialize(serializedEnumMaterial: SerializedEnum): Enum.Material {
			return byValue.get(serializedEnumMaterial)!;
		}
	}

	export namespace Color3Serializer {
		export function serialize(color: Color3): SerializedColor {
			return color.ToHex();
		}

		export function deserialize(serializedColor: SerializedColor | readonly [number, number, number]): Color3 {
			if (!typeIs(serializedColor, "string"))
				return Color3.fromRGB(serializedColor[0], serializedColor[1], serializedColor[2]);

			return Color3.fromHex(serializedColor);
		}
	}

	export namespace Color4Serializer {
		export function serialize(color: Color4): SerializedColor {
			return Color4.toHex(color);
		}

		export function deserialize(serializedColor: SerializedColor | readonly [number, number, number]): Color4 {
			if (!typeIs(serializedColor, "string")) {
				return { color: Color3.fromRGB(serializedColor[0], serializedColor[1], serializedColor[2]), alpha: 1 };
			}

			return Color4.fromHex(serializedColor);
		}
	}
}
