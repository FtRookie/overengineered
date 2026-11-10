#!/usr/bin/env node
// Shows what the watcher refused, without touching out/.
//
// `npm run dev` compiles into out/ and reports errors to a terminal this session cannot read. When the tee
// in .dev.log is not available (dev-errors.js says so), this compiles the whole tree with the same tsconfig
// into a throwaway directory, so rbxtsc's own message — the one tsc never gives, for reserved identifiers
// and macro misuse — lands in this terminal instead. It never runs against out/, so it is safe while the
// watcher is up.
//
// rbxtsc resolves every emitted file against the Rojo project, so the throwaway output needs a throwaway
// project too: default.project.json with each `out/` path pointed at the scratch directory. Both temporary
// files and the scratch output are removed whatever happens.
//
// rbxtsc deletes every file in its outDir that has no source, so a wrong outDir deletes real files: an empty one
// once took the repo root with it (2026-11-09). Every path below is checked before anything is written or removed.
//
//   node compile-check.js
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..", "..", "..");
// inside the repo rather than the OS temp dir: Rojo `$path` entries are relative to the project file, and
// the roblox-ts resolver mangles an absolute path outside the tree into a broken ../.. walk
// per process, so agents running it at once do not delete each other's project mid-compile
const scratchName = `.verify-check-out-${process.pid}`;
const scratch = path.join(root, scratchName);
const configName = `tsconfig.verify-check-${process.pid}.json`;
const config = path.join(root, configName);
const projectName = `verify-check-${process.pid}.project.json`;
const project = path.join(root, projectName);

function refuse(why) {
	console.error(`compile-check: refusing to run: ${why}`);
	process.exit(2);
}

if (!fs.existsSync(path.join(root, "package.json")) || !fs.existsSync(path.join(root, "default.project.json"))) {
	refuse(`expected the repo root at ${root}`);
}
if (!/^\.verify-check-out-\d+$/.test(scratchName)) refuse(`unexpected scratch name ${scratchName}`);
if (path.dirname(scratch) !== root) refuse(`scratch ${scratch} is not directly inside ${root}`);
if (scratch === root || scratch === path.join(root, "out")) refuse(`scratch ${scratch} is a real directory`);

function retarget(node) {
	if (Array.isArray(node)) return node.map(retarget);
	if (node === null || typeof node !== "object") return node;
	const copy = {};
	for (const [key, value] of Object.entries(node)) {
		copy[key] =
			key === "$path" && typeof value === "string" && (value === "out" || value.startsWith("out/"))
				? scratchName + value.slice(3)
				: retarget(value);
	}
	return copy;
}

fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(scratch);
fs.writeFileSync(
	config,
	JSON.stringify(
		{
			extends: "./tsconfig.json",
			// the base config is incremental with its buildinfo inside out/; keep incremental (tsc refuses a
			// buildinfo path without it) and point the buildinfo into the scratch directory instead
			compilerOptions: {
				outDir: scratchName,
				incremental: true,
				tsBuildInfoFile: `${scratchName}/buildinfo`,
			},
		},
		null,
		"\t",
	),
);
fs.writeFileSync(
	project,
	JSON.stringify(retarget(JSON.parse(fs.readFileSync(path.join(root, "default.project.json"), "utf8"))), null, "\t"),
);

let status = 1;
try {
	const written = JSON.parse(fs.readFileSync(config, "utf8")).compilerOptions.outDir;
	if (written !== scratchName || path.resolve(root, written) !== scratch) {
		console.error(`compile-check: refusing to run: the temporary tsconfig points outDir at ${JSON.stringify(written)}`);
		status = 2;
	} else {
		const run = spawnSync("npx", ["rbxtsc", "-p", configName, "--rojo", projectName, "--noInclude"], {
			cwd: root,
			stdio: "inherit",
			shell: true,
		});
		status = run.status ?? 1;
	}
} finally {
	fs.rmSync(config, { force: true });
	fs.rmSync(project, { force: true });
	fs.rmSync(scratch, { recursive: true, force: true });
}

if (status === 0) console.log("rbxtsc accepts the tree; if out/ is still stale, the watcher is not running.");
process.exit(status);
