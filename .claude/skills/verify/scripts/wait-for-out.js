#!/usr/bin/env node
// Waits until out/ reflects src/: every compiled module at least as new as its source.
//
// While `npm run dev` runs, rbxtsc -w owns out/ and a second compiler must not be started against it. So
// after an edit the only honest move is to wait for the watcher, and this is how long to wait: it returns
// when every source file has a fresher .luau twin, and on timeout names the ones that never got one.
//
// A file that stays stale while everything else refreshes is the watcher refusing it — a compile error in
// the dev terminal you cannot see. Reserved Luau identifiers are the usual cause.
//
//   node wait-for-out.js [--timeout 30]
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..", "..", "..");
const src = path.join(root, "src");
const out = path.join(root, "out");
const timeoutSeconds = Number(process.argv[process.argv.indexOf("--timeout") + 1]) || 30;

// the transformer compiles separately into its own out/, and declarations emit nothing; genvalidators rewrites
// BlockModelValidators.generated.ts on every watch start, and rbxtsc leaves its .luau alone when nothing changed
const skipped = [path.join(src, "engine", "transformer")];

function sources(dir, into = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (skipped.some((prefix) => full.startsWith(prefix))) continue;
		if (entry.isDirectory()) sources(full, into);
		else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !entry.name.endsWith(".generated.ts"))
			into.push(full);
	}
	return into;
}

function stale() {
	const behind = [];
	for (const file of sources(src)) {
		const twin = path.join(out, path.relative(src, file)).replace(/\.ts$/, ".luau");
		const sourceTime = fs.statSync(file).mtimeMs;
		const outTime = fs.existsSync(twin) ? fs.statSync(twin).mtimeMs : -1;
		if (outTime < sourceTime) behind.push(path.relative(root, file));
	}
	return behind;
}

const started = Date.now();
const poll = () => {
	const behind = stale();
	if (behind.length === 0) {
		console.log(`out/ is fresh (${sources(src).length} modules)`);
		process.exit(0);
	}
	if (Date.now() - started > timeoutSeconds * 1000) {
		console.error(`out/ still behind after ${timeoutSeconds}s for ${behind.length} file(s):`);
		for (const file of behind) console.error(`  ${file}`);
		// the watcher tees its terminal into .dev.log; show what it said rather than guessing why
		const { spawnSync } = require("node:child_process");
		const shown = spawnSync(process.execPath, [path.join(__dirname, "dev-errors.js")], { stdio: "inherit" });
		if (shown.status === 2) console.error("If npm run dev is not running, npm run build is the right call.");
		process.exit(1);
	}
	setTimeout(poll, 250);
};
poll();
