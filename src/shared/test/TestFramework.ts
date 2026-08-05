import { Players, ReplicatedStorage, RunService, ServerScriptService } from "@rbxts/services";
import { Logger } from "engine/shared/Logger";

type UnitTest = (di: DIContainer) => unknown;
type UnitTests = { readonly [k in string]: UnitTest };
/** A test module's `Tests` export: one entry per namespace, each holding the test functions. */
type UnitTestGroups = { readonly [k in string]: UnitTests };

/** One runnable test, flattened out of the namespace it was declared in. */
export type DiscoveredTest = {
	readonly label: string;
	readonly run: (di: DIContainer) => void;
};

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

	export function loadTestsFromScript(mscript: ModuleScript): UnitTestGroups {
		const ts = require(
			ReplicatedStorage.WaitForChild("rbxts_include").WaitForChild("RuntimeLib") as ModuleScript,
		) as {
			import: (context: LuaSourceContainer, module: Instance, ...path: string[]) => unknown;
		};

		return (ts.import(script, mscript) as { Tests: UnitTestGroups }).Tests;
	}

	/** Every test in every module, flat, so a caller can offer them one at a time. */
	export function findAllTests(): readonly DiscoveredTest[] {
		const tests: DiscoveredTest[] = [];
		for (const mscript of findAllTestScripts()) {
			for (const [group, funcs] of pairs(loadTestsFromScript(mscript))) {
				for (const [name, func] of pairs(funcs)) {
					const label = `${group}.${name}`;
					tests.push({ label, run: (di) => run(label, func, di) });
				}
			}
		}

		return tests;
	}

	export function runMultiple(name: string, groups: UnitTestGroups, di: DIContainer): void {
		Logger.beginScope(name);
		$log("Running");

		// two levels: a module exports `Tests.SomeNamespace.someTest`, so the values here are namespaces
		for (const [group, funcs] of pairs(groups)) {
			for (const [name, func] of pairs(funcs)) {
				run(`${group}.${name}`, func, di);
			}
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
