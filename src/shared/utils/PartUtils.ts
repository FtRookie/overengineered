import { TagUtils } from "shared/utils/TagUtils";

export namespace PartUtils {
	export function ghostModel(model: Model, color: Color3): void {
		function fix(part: BasePart): void {
			if (part.Parent && part.Parent.Name === "Axis") return;

			part.Material = Enum.Material.SmoothPlastic;
			part.Color = color;
			part.CanCollide = false;
			part.CanQuery = false;
			part.CanTouch = false;

			if (part.IsA("UnionOperation")) {
				part.UsePartColor = true;
			}

			if (!part.HasTag(TagUtils.allTags.TRANSPARENT_MATERIAL)) {
				part.Transparency = 0.5;
			}
		}

		applyToAllDescendantsOfType("BasePart", model, fix);
		applyToAllDescendantsOfType("Decal", model, (part) => (part.Transparency = 0.5));
	}

	export function switchDescendantsMaterial(model: Instance, material: Enum.Material): void {
		applyToAllDescendantsOfType("BasePart", model, (part) => {
			if (part.HasTag(TagUtils.allTags.STATIC_MATERIAL)) return;
			if (part.HasTag(TagUtils.allTags.TRANSPARENT_MATERIAL)) return;

			part.Material = material;
		});
	}

	export function switchDescendantsColor(model: Instance, color: Color3): void {
		applyToAllDescendantsOfType("BasePart", model, (part) => {
			if (part.HasTag(TagUtils.allTags.STATIC_COLOR)) return;

			part.Color = color;
		});
	}

	export function switchDescendantsTransparency(model: Instance, transparency: number): void {
		applyToAllDescendantsOfType("BasePart", model, (part) => {
			if (part.HasTag(TagUtils.allTags.TRANSPARENT_MATERIAL)) return;
			part.Transparency = transparency;
		});
	}

	const velocityPinName = "deleted";

	/**
	 * Keeps the client's pre-break velocity on the new assembly so the ownership handoff that follows does not
	 * change it. Call before breaking the joint; the marker is client-only and never replicates.
	 */
	export function pinAssemblyVelocity(part: BasePart): void {
		const marker = new Instance("Part");
		marker.Name = velocityPinName;
		marker.CFrame = part.CFrame;
		marker.AssemblyLinearVelocity = part.AssemblyLinearVelocity;
		marker.AssemblyAngularVelocity = part.AssemblyAngularVelocity;
		marker.Size = Vector3.zero;
		marker.RootPriority = 127;
		marker.Parent = part;

		const weld = new Instance("WeldConstraint");
		weld.Part0 = marker;
		weld.Part1 = part;
		weld.Parent = marker;
	}

	/** Undoes pinAssemblyVelocity, once ownership has been handed over. */
	export function unpinAssemblyVelocity(part: Instance | undefined): void {
		part?.FindFirstChild(velocityPinName)?.Destroy();
	}

	export function BreakJoints(part: BasePart): void {
		for (const joint of part.GetJoints()) {
			joint.Destroy();
		}
	}

	/** Partial reimplementation of rbxts Instances type for compilation performance ONLY. Add other types if needed. */
	type Instances = {
		BasePart: BasePart;
		Sound: Sound;
		GuiObject: GuiObject;
		Decal: Decal;
		Constraint: Constraint;
		WeldConstraint: WeldConstraint;
	};
	type InstancesKeys = keyof Instances;
	export function applyToAllDescendantsOfType<T extends InstancesKeys>(
		typeName: T,
		parent: Instance,
		callback: (instance: Instances[T]) => void,
	): void {
		for (const child of parent.GetDescendants()) {
			if (!child.IsA(typeName)) continue;
			callback(child);
		}
	}
}
