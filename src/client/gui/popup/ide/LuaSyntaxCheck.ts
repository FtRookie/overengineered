import { Modules } from "shared/Modules";

/** Compiles `code` without running it; returns a one-line error message, or undefined if it parses. */
export function checkLuaSyntax(code: string): string | undefined {
	const [ok, err] = pcall(() => {
		Modules.vLuau.luau_execute(code, {}, "ide");
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
