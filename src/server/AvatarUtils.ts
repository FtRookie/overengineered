import { JSON } from "engine/shared/fixes/Json";

type SerializedVector = { X: number; Y: number; Z: number };
type Emote = { assetId: number; assetName: string; position: number };
type LayeredClothing = { order: number; puffiness: number; version: number };
type ScaledAsset = {
	position?: SerializedVector;
	rotation?: SerializedVector;
	scale?: SerializedVector;
	version: number;
};
type AvatarAsset = {
	id: number;
	name: string;
	assetType: { id: number; name: string };
	currentVersionId: number;
	meta: LayeredClothing | ScaledAsset;
};
export type AvatarApiSerialized = {
	scales: {
		height: number;
		width: number;
		head: number;
		depth: number;
		proportion: number;
		bodyType: number;
	};
	playerAvatarType: "R6" | "R15";
	bodyColors: {
		headColorId: keyof BrickColorsByNumber;
		torsoColorId: keyof BrickColorsByNumber;
		rightArmColorId: keyof BrickColorsByNumber;
		leftArmColorId: keyof BrickColorsByNumber;
		rightLegColorId: keyof BrickColorsByNumber;
		leftLegColorId: keyof BrickColorsByNumber;
	};
	assets: AvatarAsset[];
	defaultShirtApplied: false;
	defaultPantsApplied: false;
	emotes: Emote[];
};

const serializedVectorToVector3 = (s: SerializedVector) => new Vector3(s.X, s.Y, s.Z);

/** This entire thing is honestly patchwork */
export namespace AvatarUtils {
	const LayeredClothing = [
		9, // TShirt
		10, // Shirt
		11, //Pants
		12, //Jacket
		13, //Sweater
		14, //Shorts
		15, //LeftShoe
		16, // RightShoe
		17, // DressSkirt
	];
	export const DeserializeAndApplyAvatar = (humanoid: Humanoid, json: string) => {
		const object = JSON.deserialize<AvatarApiSerialized>(json);

		const p = new Instance("HumanoidDescription");

		p.BodyTypeScale = object.scales.bodyType;
		for (const [k, v] of pairs(object.bodyColors)) {
			const index = k.gsub("^%l", string.upper)[0].gsub("Id", "")[0]; // stupid logic
			p[index as "HeadColor"] = new BrickColor(v).Color;
		}

		const originalSpecifications: defined[] = [];
		for (const asset of object.assets) {
			const assetTypeName = asset.assetType.name;
			if (assetTypeName === "Shirt") {
				p.Shirt = asset.id;
				continue;
			}
			if (assetTypeName === "Pants") {
				p.Pants = asset.id;
				continue;
			}

			const accessoryType = Enum.AccessoryType.FromName(assetTypeName.gsub("Accessory", "", 1)[0]);
			if (!accessoryType) continue;
			let spec;
			if (LayeredClothing.contains(accessoryType.Value)) {
				spec = {
					AssetId: asset.id,
					AccessoryType: accessoryType,
					Order: (asset.meta as LayeredClothing).order ?? 1,
					Puffiness: (asset.meta as LayeredClothing).puffiness ?? 0,
				};
			} else {
				spec = {
					AssetId: asset.id,
					AccessoryType: accessoryType,
				} as {
					AssetId: number;
					AccessoryType: Enum.AccessoryType;
					Position?: SerializedVector;
					Rotation?: SerializedVector;
					Scale?: SerializedVector;
				};
				if (asset.meta) {
					const asScaled = asset.meta as ScaledAsset;
					if (asScaled.position) spec.Position = asScaled.position;
					if (asScaled.rotation) spec.Rotation = asScaled.rotation;
					if (asScaled.scale) spec.Scale = asScaled.scale;
				}
			}
			originalSpecifications.push(spec);
		}
		p.SetAccessories(originalSpecifications, true);

		for (const asset of object.assets) {
			const assetTypeName = asset.assetType.name;
			if (asset.id === 137831860413813) {
				// Redcliff face
				p.Face = 2493587489;
				p.Head = 0;
				continue;
			}
			p[assetTypeName as "Torso"] = asset.id;
		}

		humanoid.ApplyDescription(p);

		// const loadedAccessories: Accessory[] = [];

		// for (const asset of object.assets) {
		// 	const loadedAsset = InsertService.LoadAsset(asset.id);

		// 	const isAccessory = loadedAsset.FindFirstChildOfClass("Accessory") as Accessory & { Handle: Instance };
		// 	if (isAccessory) {
		// 		isAccessory.Name = asset.name;
		// 		const assetTypeId = asset.assetType.id;
		// 		const assetTypeName = asset.assetType.name;
		// 		const assetType =
		// 			Enum.AccessoryType.FromName(assetTypeName.gsub("Accessory", "", 1)[0]) ??
		// 			Enum.AccessoryType.Unknown;

		// 		if (LayeredClothing.contains(assetType.Value) && humanoid.RigType === Enum.HumanoidRigType.R6) continue; // Ignore layered clothing for R6

		// 		isAccessory.AccessoryType = assetType;

		// 		const isScaled = asset.meta as ScaledAsset;
		// 		if (isScaled?.position !== undefined) {
		// 			const attachment = isAccessory.Handle.FindFirstChildOfClass("Attachment");
		// 			if (attachment) {
		// 				const metaCframe = new CFrame(serializedVectorToVector3(isScaled.position)) //
		// 					.mul(CFrame.Angles(isScaled.position.X, isScaled.position.Y, isScaled.position.Z));
		// 				print(metaCframe);
		// 				attachment.CFrame = attachment.CFrame.mul(metaCframe);
		// 			}
		// 		}
		// 		loadedAccessories.push(isAccessory);
		// 	}
		// }
		// loadedAccessories.forEach((a) => humanoid.AddAccessory(a));
	};
}
