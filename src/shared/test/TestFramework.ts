import { Players, ReplicatedStorage, RunService, ServerScriptService } from "@rbxts/services";
import { Logger } from "engine/shared/Logger";

type UnitTest = (di: DIContainer) => unknown;
type UnitTests = { readonly [k in string]: UnitTest };

export namespace TestFramework {
	export function findAllTestScripts(): readonly ModuleScript[] {
		const ret: ModuleScript[] = [];
		const visit = (instance: Instance) => {
			if (instance.IsA("ModuleScript") && instance.Name.find(".test")[0]) {
				ret.push(instance);
			}

			for (const child of instance.GetChildren()) {
				visit(child);
			}
		};

		if (RunService.IsServer()) {
			visit(ReplicatedStorage);
			visit(ServerScriptService);
		} else if (RunService.IsClient()) {
			visit(ReplicatedStorage);
			visit(Players.LocalPlayer.FindFirstChildOfClass("PlayerScripts")!);
		}

		return ret;
	}

	export function loadTestsFromScript(mscript: ModuleScript): UnitTests {
		const ts = require(
			ReplicatedStorage.WaitForChild("rbxts_include").WaitForChild("RuntimeLib") as ModuleScript,
		) as {
			import: (context: LuaSourceContainer, module: Instance, ...path: string[]) => unknown;
		};

		return (ts.import(script, mscript) as { Tests: UnitTests }).Tests;
	}

	export function runMultiple(name: string, test: UnitTests, di: DIContainer): void {
		Logger.beginScope(name);
		$log("Running");

		for (const [name, tests] of pairs(test)) {
			run(name, tests, di);
		}

		$log("SUCCESS");
		Logger.endScope();
	}
	export function run<T extends UnitTest>(name: string, test: T, di: DIContainer): ReturnType<T> | undefined {
		Logger.beginScope(name);
		$log("Running");

		try {
			const result = test(di) as ReturnType<T>;
			$log("SUCCESS");

			return result;
		} catch (err) {
			$err(tostring(err ?? "Unknown error"));
			return undefined;
		} finally {
			Logger.endScope();
		}
	}
}
