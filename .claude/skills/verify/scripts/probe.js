#!/usr/bin/env node
// Runs a throwaway Luau snippet against the compiled modules in out/, through the lunit shim.
//
// The shim resolves `require("../node_modules/...")` relative to the script's own file, so a probe has to
// live in tests/ to load anything. This writes it there with a preamble, runs it, and removes it again
// whatever happened, so nothing is left for git to notice.
//
//   node probe.js path/to/snippet.luau
//   node probe.js -e 'print(load("shared/SlotsMeta").SlotsMeta.isReadonly(-1))'
//   echo 'print(1)' | node probe.js -
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..", "..", "..");
if (!fs.existsSync(path.join(root, "package.json"))) {
	console.error(`probe: expected the repo root at ${root}`);
	process.exit(2);
}

const args = process.argv.slice(2);
let body;
if (args[0] === "-e") body = args.slice(1).join(" ");
else if (args[0] === "-" || args.length === 0) body = fs.readFileSync(0, "utf8");
else body = fs.readFileSync(path.resolve(args[0]), "utf8");

const preamble = `
local roblox = require("@lune/roblox")
local rbxRequire = require("../node_modules/@rbxts/lunit/scripts/lune-shim")
local Vector3, Vector2, CFrame, Color3, Enum = roblox.Vector3, roblox.Vector2, roblox.CFrame, roblox.Color3, roblox.Enum
local function load(modulePath)
	return rbxRequire("out/" .. modulePath)
end
-- probe body follows
`;

const target = path.join(root, "tests", "_probe.luau");
if (fs.existsSync(target)) {
	console.error("probe: tests/_probe.luau already exists; another probe may be running. Remove it and retry.");
	process.exit(2);
}

fs.writeFileSync(target, preamble + body + "\n");
let status = 1;
try {
	const run = spawnSync("lune", ["run", "tests/_probe.luau"], { cwd: root, stdio: "inherit", shell: true });
	status = run.status ?? 1;
} finally {
	fs.rmSync(target, { force: true });
}
process.exit(status);
