/* eslint-disable roblox-ts/no-regex */
/* eslint-disable no-undef */
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");

let projectRoot = process.cwd();
const argIndex = process.argv.indexOf("--project-root");
if (argIndex !== -1 && process.argv[argIndex + 1]) {
	projectRoot = path.resolve(process.argv[argIndex + 1]);
}

const invocationDir = process.cwd();
const outPath = path.join(projectRoot, "out");
const lunewatchPath = path.join(projectRoot, "scripts", "lunewatch.js");

const logMain = (...args) => console.log(chalk.green("[main]"), ...args);

logMain("Project root:   ", projectRoot);
logMain("Invocation dir: ", invocationDir);
logMain("Watching ./out in:", outPath);
logMain("lunewatch path:", lunewatchPath);

// Regenerate .studioconfig.json from .env, so a change to .env lands without a reinstall.
const studioConfig = require("./studioconfig.js");

// A token is not just the Save button — a Studio session autosaves every 5 minutes and snapshots the plot on
// exit. Nobody should discover that from the aftermath.
if (studioConfig.writetoken) {
	logMain(chalk.red("DB WRITES ARE LIVE: WRITETOKEN is set in .env, so this session saves to PRODUCTION"));
} else {
	logMain("DB is read-only (no WRITETOKEN in .env)");
}
if (studioConfig.baseurl) {
	logMain("DB baseurl:", studioConfig.baseurl);
}

function printWithPrefix(data, prefix, colorFn) {
	const lines = data.toString().split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim() !== "") {
			console.log(colorFn(prefix) + " " + line);
		}
	}
}

const children = [];
let shuttingDown = false;

function stopChild(proc) {
	if (process.platform === "win32") {
		execFile("taskkill", ["/pid", String(proc.pid), "/t", "/f"]);
		return;
	}

	try {
		process.kill(-proc.pid, "SIGTERM");
	} catch {
		// group already gone
	}
}

function shutdown(reason) {
	if (shuttingDown) return;
	shuttingDown = true;

	logMain(reason);
	for (const proc of children) {
		stopChild(proc);
	}

	setTimeout(() => process.exit(0), 300);
}

function runCommand(label, command, argsArray, cwd) {
	const fullCommand = [command, ...argsArray].map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ");

	const proc = spawn(fullCommand, {
		cwd,
		stdio: "pipe",
		shell: true,
		// own process group, so stopChild can signal the shell's descendants too
		detached: process.platform !== "win32",
	});
	children.push(proc);

	const prefix = `[${label}]`;
	const color = chalk.blue;
	const errorColor = chalk.red;
	const exitColor = chalk.gray;

	proc.stdout.on("data", (data) => {
		printWithPrefix(data, prefix, color);
	});

	proc.stderr.on("data", (data) => {
		printWithPrefix(data, prefix + " ERROR", errorColor);
	});

	proc.on("close", (code) => {
		if (shuttingDown) return;
		console.log(exitColor(`${prefix} exited with code ${code}`));
	});

	return proc;
}

runCommand("compile", "npm", ["run", "watch"], invocationDir);

function waitForOutFolder() {
	if (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory()) {
		runCommand("rojo", "npm", ["run", "rojo"], invocationDir);
		return;
	}

	logMain("Waiting for ./out folder...");
	const interval = setInterval(() => {
		if (shuttingDown) {
			clearInterval(interval);
			return;
		}

		if (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory()) {
			clearInterval(interval);
			logMain("./out folder found. Starting rojo...");
			runCommand("rojo", "npm", ["run", "rojo"], invocationDir);
		}
	}, 500);
}

waitForOutFolder();

runCommand("assets", "node", [lunewatchPath], projectRoot);

const STUDIO_POLL_MS = 3000;
const STUDIO_MISSES_BEFORE_STOP = 2;

function isStudioRunning() {
	return new Promise((resolve) => {
		if (process.platform === "win32") {
			execFile("tasklist", ["/fi", "imagename eq RobloxStudioBeta.exe", "/nh"], (err, stdout) =>
				resolve(!err && stdout.toLowerCase().includes("robloxstudiobeta.exe")),
			);
			return;
		}

		// Wine reports the process name as "Main", so the command line is the only thing left to match on.
		execFile("pgrep", ["-f", "RobloxStudioBeta\\.exe"], (err) => resolve(!err));
	});
}

let studioSeen = false;
let studioMisses = 0;

setInterval(async () => {
	if (shuttingDown) return;

	if (await isStudioRunning()) {
		if (!studioSeen) logMain("Studio detected. This session will stop when Studio closes.");
		studioSeen = true;
		studioMisses = 0;
		return;
	}

	if (!studioSeen) return;

	studioMisses++;
	if (studioMisses < STUDIO_MISSES_BEFORE_STOP) return;

	shutdown("Studio closed. Stopping watchers.");
}, STUDIO_POLL_MS);

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => shutdown(`Received ${signal}. Stopping watchers.`));
}
