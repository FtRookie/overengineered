/** Manages local instance tags without replicating them */
export namespace LocalInstanceData {
	const instanceTags = new Map<Instance, Set<string>>();

	export function AddLocalTag(instance: Instance, tag: string) {
		const currentTags = instanceTags.has(instance) ? instanceTags.get(instance)! : new Set<string>();
		currentTags.add(tag);
		instanceTags.set(instance, currentTags);

		instance.Destroying.Once(() => instanceTags.delete(instance));
		instance.GetPropertyChangedSignal("Parent").Connect(() => {
			if (!instance.Parent) {
				instanceTags.delete(instance);
			}
		});
	}

	export function HasLocalTag(instance: Instance, tag: string) {
		if (!instanceTags.has(instance)) return false;

		const currentTags = instanceTags.get(instance)!;
		return currentTags.has(tag);
	}

	export function RemoveLocalTag(instance: Instance, tag: string) {
		if (!instanceTags.has(instance)) return;

		const currentTags = instanceTags.get(instance)!;
		currentTags.delete(tag);
		instanceTags.set(instance, currentTags);
	}

	export function GetAllLocalTags(instance: Instance) {
		if (!instanceTags.has(instance)) return [];

		const currentTags = instanceTags.get(instance)!;
		return currentTags.map((item) => item);
	}
}
