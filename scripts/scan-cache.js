/* eslint-disable roblox-ts/no-regex */
/* eslint-disable no-undef */
// Cache keys for the src/ scanners (tripwires.js, utility-index.js), so a file is only type-checked again when
// something its result can depend on has changed.
//
// A scan reads types, and a file's types come from every file it imports, transitively, plus everything global. So a
// file's key hashes its own text, the text of every src file in its import closure, and a global part: the scanner
// script, the TypeScript version, tsconfig.json, the installed packages, and every file that can declare globals
// (`.d.ts`, `declare global`, triple-slash references; tsconfig's `moduleDetection: "force"` makes everything
// else a module). Over-invalidating is harmless; an input missing from the key replays a stale result.
//
// Stored under node_modules/.cache, which `npm install` and a clean checkout both start without.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..");
const CACHE_DIR = path.join(ROOT, "node_modules", ".cache", "overengineered-scanners");
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

// the installed packages: npm rewrites .package-lock.json on every install, and patch-types.js edits lua.d.ts after it
const INSTALL_INPUTS = [
	"package-lock.json",
	"node_modules/.package-lock.json",
	"node_modules/@rbxts/types/include/lua.d.ts",
	"scripts/patch-types.js",
	"tsconfig.json",
	"scripts/scan-cache.js",
];

const sha1 = (...parts) => {
	const hash = crypto.createHash("sha1");
	for (const part of parts) hash.update(String(part)).update("\0");
	return hash.digest("hex");
};

const readOrMissing = (file) => {
	try {
		return fs.readFileSync(file, "utf8");
	} catch {
		return "<missing>";
	}
};

const declaresGlobals = (file, text) =>
	file.endsWith(".d.ts") || /\bdeclare\s+global\b/.test(text) || /^\s*\/\/\/\s*<reference\b/m.test(text);

/**
 * @param scannerFile the scanner's own path, part of every key so editing a rule invalidates its results
 * @param options parsed tsconfig compiler options, used to resolve imports the way the program will
 * @param fileNames the tsconfig file list (absolute)
 */
function createKeys(scannerFile, options, fileNames) {
	const texts = new Map();
	const text = (file) => {
		let t = texts.get(file);
		if (t === undefined) {
			t = readOrMissing(file);
			texts.set(file, t);
		}
		return t;
	};

	const globalParts = [
		ts.version,
		require(require.resolve("roblox-ts/package.json", { paths: [ROOT] })).version,
		readOrMissing(scannerFile),
		...INSTALL_INPUTS.map((f) => `${f}\n${readOrMissing(path.join(ROOT, f))}`),
	];
	for (const file of [...fileNames].sort()) {
		if (declaresGlobals(file, text(file))) globalParts.push(`${path.relative(ROOT, file)}\n${text(file)}`);
	}
	const globalKey = sha1(...globalParts);

	const resolutionCache = ts.createModuleResolutionCache(ROOT, (f) => f.toLowerCase(), options);
	// A bare specifier resolves the same from every file here: baseUrl (src) is tried first, then node_modules
	// walking up, and the only node_modules under src is in the excluded transformer. So resolve each once.
	const bare = new Map();
	const resolve = (specifier, file) => {
		const isBare = !specifier.startsWith(".") && !path.isAbsolute(specifier);
		if (isBare && bare.has(specifier)) return bare.get(specifier);

		const resolved = ts.resolveModuleName(specifier, file, options, ts.sys, resolutionCache).resolvedModule;
		const result = resolved ? path.resolve(resolved.resolvedFileName) : undefined;
		if (isBare) bare.set(specifier, result);
		return result;
	};
	const edges = new Map();
	const edgesOf = (file) => {
		let out = edges.get(file);
		if (out) return out;
		out = { files: [], unresolved: [] };
		edges.set(file, out);

		for (const { fileName } of ts.preProcessFile(text(file), true, true).importedFiles) {
			const resolved = resolve(fileName, file);
			if (resolved === undefined) out.unresolved.push(fileName);
			else if (!resolved.includes(NODE_MODULES)) out.files.push(resolved);
		}
		return out;
	};

	const hashes = new Map();
	const contentHash = (file) => {
		let h = hashes.get(file);
		if (h === undefined) {
			h = sha1(text(file));
			hashes.set(file, h);
		}
		return h;
	};

	const keys = new Map();
	const keyOf = (file) => {
		file = path.resolve(file);
		let key = keys.get(file);
		if (key) return key;

		const seen = new Set([file]);
		const unresolved = new Set();
		const stack = [file];
		while (stack.length > 0) {
			const { files, unresolved: missing } = edgesOf(stack.pop());
			for (const m of missing) unresolved.add(m);
			for (const dep of files) {
				if (seen.has(dep)) continue;
				seen.add(dep);
				stack.push(dep);
			}
		}

		const parts = [globalKey, path.relative(ROOT, file)];
		for (const dep of [...seen].sort()) parts.push(path.relative(ROOT, dep), contentHash(dep));
		for (const m of [...unresolved].sort()) parts.push(`unresolved:${m}`);
		key = sha1(...parts);
		keys.set(file, key);
		return key;
	};

	return { globalKey, keyOf };
}

const cachePath = (name) => path.join(CACHE_DIR, `${name}.json`);

/** The stored cache, or undefined when absent, unreadable, or disabled with --no-cache. */
function load(name) {
	if (process.argv.includes("--no-cache")) return undefined;
	try {
		return JSON.parse(fs.readFileSync(cachePath(name), "utf8"));
	} catch {
		return undefined;
	}
}

function save(name, data) {
	fs.mkdirSync(CACHE_DIR, { recursive: true });
	fs.writeFileSync(cachePath(name), JSON.stringify(data), "utf8");
}

module.exports = { createKeys, load, save };
