/* eslint-disable roblox-ts/no-regex */
/* eslint-disable no-undef */
// Flags comments in src/ that retell history: how the code used to work, or what a fix changed. That belongs in
// the commit message; a comment should state the rule as it stands.
//
// Only comments are read (TypeScript's scanner), so string contents never match. The patterns are deliberately
// narrow: "no longer", "fixed" and a bare "old" mostly describe current behaviour and are not flagged.
//
// Exit codes: 0 clean, 1 hits in src/, 2 self-test failed.

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..");

const PATTERNS = [
	/\bpreviously\b/i,
	/\buntil now\b/i,
	/\bbefore (this|the) (fix|change)\b/i,
	/\bwas a bug\b/i,
	/(?<!\b(?:is|are|be|was|were|been|being|gets?|got|be)\s)\bused to\b(?!\s+(?:validate|check|compute|build|pick|find|resolve|tell|mark|key|store|hold|read|write|drive|decide|seed))/i,
	/\bthe old (order|gate|check|code|version|behaviou?r|approach|way|clamp|assertion|implementation|path|logic|fix)\b/i,
];

// each fixture line marked `hit` must match a pattern; every other line must not
const FIXTURES = `
// previously this returned early | hit
// until now the limbs were unregistered | hit
// before this fix the gate stayed false | hit
// that was a bug in the serializer | hit
// any Model used to pass here | hit
// the old order wiped first | hit
// a marker used to validate the module, kept for ordering
// config is used to pick a winner
// staleness lasts no longer than build mode
// the cadence is fixed while the trigger is held
// a range kept from the old data would never fit
// carries a level saved under the old ungrouped address
`;

const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

const matches = (text) => PATTERNS.some((p) => p.test(text));

function selfTest() {
	const failures = [];
	for (const raw of FIXTURES.trim().split("\n")) {
		const [text, mark] = raw.split(" | ");
		const expected = mark === "hit";
		if (matches(text) !== expected) failures.push(`${expected ? "missed" : "flagged clean"}: ${text}`);
	}
	return failures;
}

function collect(dir, out) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || full === path.join(ROOT, "src", "engine", "transformer")) continue;
			collect(full, out);
		} else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
			out.push(full);
		}
	}
	return out;
}

function scanFile(file) {
	const text = fs.readFileSync(file, "utf8");
	const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
	const hits = [];
	let lineStarts;
	const lineOf = (pos) => {
		lineStarts ??= ts.computeLineStarts(text);
		let lo = 0;
		let hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (lineStarts[mid] <= pos) lo = mid;
			else hi = mid - 1;
		}
		return lo + 1;
	};

	for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
		if (kind !== ts.SyntaxKind.SingleLineCommentTrivia && kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue;

		const start = scanner.getTokenPos();
		const comment = text.slice(start, scanner.getTextPos());
		let offset = 0;
		for (const line of comment.split("\n")) {
			if (matches(line)) hits.push({ line: lineOf(start + offset), text: line.trim() });
			offset += line.length + 1;
		}
	}
	return hits;
}

function main() {
	const title = "comment history";
	console.log(`${BOLD}── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}${RESET}`);

	const failures = selfTest();
	if (failures.length > 0) {
		for (const failure of failures) console.error(`self-test failed: ${failure}`);
		process.exit(2);
	}

	const files = collect(path.join(ROOT, "src"), []).sort();
	const lines = [];
	for (const file of files) {
		const rel = path.relative(ROOT, file).split(path.sep).join("/");
		for (const hit of scanFile(file)) lines.push(`${rel}:${hit.line} ${hit.text}`);
	}

	if (lines.length > 0) {
		for (const line of lines) console.log(line);
		console.log(
			`\n${RED}${BOLD}FAILED${RESET}${RED} comment history: ${lines.length} comment line(s) retell history; ` +
				`state the current rule and put the story in the commit message${RESET}`,
		);
		process.exit(1);
	}

	console.log(
		`\n${GREEN}${BOLD}OK${RESET}${GREEN} comment history: ${files.length} files, no history in comments${RESET}`,
	);
}

main();
