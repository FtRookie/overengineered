/* eslint-disable roblox-ts/no-regex */
/* eslint-disable no-undef */
// `npm test`: brings out/ up to date, then runs `npm run check` against it. With the dev watcher up it waits for the
// compile in flight, since a second compiler must never run against out/; with it down it builds once.
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const devLog = path.join(root, ".dev.log");
const COMPILE_WAIT_MS = 120000;

function watcherRunning() {
	try {
		if (process.platform === "win32") {
			const out = execFileSync(
				"powershell",
				[
					"-NoProfile",
					"-Command",
					"Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { $_.CommandLine }",
				],
				{ encoding: "utf8" },
			);
			return /(rbxtsc|roblox-ts[\\/]out[\\/]CLI[\\/]cli\.js)["']?\s+-w/.test(out);
		}

		execFileSync("pgrep", ["-f", "rbxtsc -w"]);
		return true;
	} catch {
		return false;
	}
}

// the watcher's last compile line: "Starting incremental compilation" until it finishes
function compiling() {
	if (!fs.existsSync(devLog)) return false;

	const lines = fs
		.readFileSync(devLog, "utf8")
		.split("\n")
		.filter((line) => line.includes("[compile]"));
	const last = lines[lines.length - 1] ?? "";
	return /Starting (incremental )?compilation/.test(last);
}

function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
	return result.status ?? 1;
}

async function main() {
	if (watcherRunning()) {
		const started = Date.now();
		if (compiling()) console.log("[test] waiting for the dev watcher to finish compiling");
		while (compiling()) {
			if (Date.now() - started > COMPILE_WAIT_MS) {
				console.error("[test] the dev watcher is still compiling after 2 minutes; see .dev.log");
				return 1;
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	} else {
		console.log("[test] no dev watcher; building out/ once");
		const status = run("npm", ["run", "build"]);
		if (status !== 0) return status;
	}

	return run("npm", ["run", "check"]);
}

main().then((status) => process.exit(status));
