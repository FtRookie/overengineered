#!/usr/bin/env node
// Shows what the running watcher last said, from the session log scripts/watch-all.js writes to .dev.log.
//
// The dev terminal is where rbxtsc reports a refused file, and this session cannot read a terminal. The
// watcher tees every line into .dev.log, and this prints the most recent compile cycle from it: from the
// last "file change detected" (or the start of the session) to the "Found N errors" that closed it, or to
// the end of the log if it is still compiling. Exit code is 1 when that cycle reported errors, so it can
// gate a chain.
//
//   node dev-errors.js            the last compile cycle
//   node dev-errors.js --all      every child's last 60 lines, for rojo or asset trouble
//   node dev-errors.js --tail 40  when the cycle markers are not recognised, just the last N compile lines
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..", "..", "..");
const log = path.join(root, ".dev.log");
const args = process.argv.slice(2);
const all = args.includes("--all");
const tailArg = args.indexOf("--tail");
const tail = tailArg === -1 ? 0 : Number(args[tailArg + 1]) || 40;

if (!fs.existsSync(log)) {
	console.error(".dev.log not found: the watcher is not running, or was started before watch-all.js wrote one.");
	console.error("Restart `npm run dev`, or run compile-check.js to compile into a throwaway directory instead.");
	process.exit(2);
}

const ageMinutes = (Date.now() - fs.statSync(log).mtimeMs) / 60000;
const lines = fs
	.readFileSync(log, "utf8")
	.split(/\r?\n/)
	.filter((line) => line.trim() !== "")
	// "<iso timestamp> [label] text"
	.map((line) => {
		const match = /^(\S+) (\[[^\]]+\]) ?(.*)$/.exec(line);
		return match ? { at: match[1], label: match[2], text: match[3] } : { at: "", label: "[?]", text: line };
	});

if (all) {
	const byLabel = new Map();
	for (const entry of lines) {
		const bucket = byLabel.get(entry.label) ?? [];
		bucket.push(entry);
		byLabel.set(entry.label, bucket);
	}
	for (const [label, entries] of byLabel) {
		console.log(`--- ${label} (${entries.length} lines) ---`);
		for (const entry of entries.slice(-60)) console.log(`${entry.at.slice(11, 19)} ${entry.text}`);
	}
	process.exit(0);
}

const compile = lines.filter((entry) => entry.label.startsWith("[compile]"));
if (compile.length === 0) {
	console.error("no [compile] output in .dev.log yet");
	process.exit(2);
}

let cycle;
if (tail > 0) {
	cycle = compile.slice(-tail);
} else {
	// tsc's watch phrasing, which rbxtsc -w mirrors. If the markers ever change, --tail still works
	const starts = /file change detected|starting compilation|starting incremental compilation/i;
	let from = 0;
	for (let index = 0; index < compile.length; index++) {
		if (starts.test(compile[index].text)) from = index;
	}
	cycle = compile.slice(from);
}

const closing = /found (\d+) errors?/i;
let errors;
for (const entry of cycle) {
	const match = closing.exec(entry.text);
	if (match) errors = Number(match[1]);
}

const stamp = cycle[0]?.at ?? "";
console.log(`last compile cycle (${cycle.length} lines, log ${ageMinutes.toFixed(1)} min old, began ${stamp.slice(11, 19)})`);
for (const entry of cycle) console.log(`  ${entry.text}`);

if (errors === undefined) {
	console.log("cycle has not reported a result yet: still compiling, or the log stopped");
	process.exit(cycle.some((entry) => /error TS/.test(entry.text)) ? 1 : 0);
}
process.exit(errors > 0 ? 1 : 0);
