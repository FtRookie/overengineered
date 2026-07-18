/* eslint-disable no-undef */
// Re-applies the one @rbxts/types change this project depends on.
//
// Upstream types `pairs(object)` with a conditional return: `keyof T extends never ? [unknown, defined] : ...`.
// A conditional type cannot pick a branch while T is still an unresolved generic, so every generic helper that
// iterates with pairs() gets `unknown` keys — 76 errors across the codebase, notably Config.ts and BlockLogic.ts.
// The non-conditional form below resolves eagerly and keeps the real key type.
//
// This lived in the anywaymachines/roblox-ts-types-awm fork, which is read-only to us and 57 commits behind
// upstream. Run by `npm install`, after which node_modules holds stock upstream types plus this one edit.

const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "node_modules", "@rbxts", "types", "include", "lua.d.ts");

const upstream = `declare function pairs<T extends object>(
	object: T,
): keyof T extends never
	? IterableFunction<LuaTuple<[unknown, defined]>>
	: IterableFunction<LuaTuple<[keyof T, Exclude<T[keyof T], undefined>]>>;`;
const patched =
	"declare function pairs<T extends object>(object: T): IterableFunction<LuaTuple<[keyof T, T[keyof T] & defined]>>;";

const source = fs.readFileSync(file, "utf8");
if (source.includes(patched)) {
	process.exit(0);
}

if (!source.includes(upstream)) {
	console.error(
		"patch-types: the pairs() overload in @rbxts/types no longer matches what this patch expects.\n" +
			`Check ${path.relative(process.cwd(), file)} and update scripts/patch-types.js.`,
	);
	process.exit(1);
}

fs.writeFileSync(file, source.replace(upstream, patched), "utf8");
console.log("patch-types: re-applied the pairs() overload");
