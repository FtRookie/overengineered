export abstract class ProtectedClass {
	constructor(caller: LuaSourceContainer, callback: (info: string) => void) {
		caller.GetPropertyChangedSignal("Parent").Connect(() => {
			callback(`protected service ${caller.Name} moved or destroyed`);
		});
	}
}
