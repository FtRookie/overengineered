import { ReplicatedStorage } from "@rbxts/services";

// compiles (Fiu) and returns a start closure without running it; a syntax error throws here, so a
// pcall around it with the start closure discarded is a side-effect-free parse check
const vLuau = require(ReplicatedStorage.Modules.vLuau) as {
	luau_execute: (code: string, env: unknown, chunkname?: string) => LuaTuple<[start: () => void, close: () => void]>;
};

/** Compiles `code` without running it; returns a one-line error message, or undefined if it parses. */
export function checkLuaSyntax(code: string): string | undefined {
	const [ok, err] = pcall(() => {
		vLuau.luau_execute(code, {}, "ide");
	});
	if (ok) return undefined;
	return formatCompilationError(err);
}

function formatCompilationError(err: unknown): string {
	const message = tostring(err);
	const [line] = string.match(message, ":(%d+):");
	const stripped = string.gsub(message, "^.-:%d+: ", "")[0];
	return line !== undefined ? `Line ${line}: ${stripped}` : stripped;
}
