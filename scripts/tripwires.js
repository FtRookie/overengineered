/* eslint-disable roblox-ts/no-regex */
/* eslint-disable no-undef */
// Scans src/ for the Luau tripwires from CLAUDE.md that tsc, ESLint and rbxtsc all accept.
//
// Every rule first runs against the in-memory fixtures below and must fire on exactly the lines marked for it.
// If one stops firing (typings that rename LuaTuple, a compiler that moves its reserved-name table), the run
// exits 2 before src/ is scanned, rather than reporting a clean tree that the rule can no longer see.
// The fixtures are never written to disk: a .ts file outside src/ breaks rbxtsc with TS6059 (rootDir).
//
// Exit codes: 0 clean, 1 hits in src/, 2 self-test failed or nothing to scan.

const path = require("node:path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const compilerDir = path.dirname(require.resolve("roblox-ts/package.json", { paths: [root] }));

// Read from the compiler rather than copied, so the check cannot drift from what rbxtsc validates and emits.
const reservedGlobals = new Set(
	Object.keys(require(require.resolve("@roblox-ts/luau-ast", { paths: [compilerDir] })).default.globals),
);
const { NOMINAL_LUA_TUPLE_NAME, SYMBOL_NAMES } = require(
	path.join(compilerDir, "out", "TSTransformer", "classes", "MacroManager"),
);

const RULES = {
	catchBinding: "catch-binding-shadows-global",
	tupleComparison: "luatuple-comparison",
	tupleOrUndefined: "luatuple-or-undefined-return",
	asMissingKey: "as-hides-missing-key",
};

const fixtures = {
	"catch.ts": `
export function tableBinding(out: string[]) {
	try {
		out.push("a");
	} catch (table) { // expect ${RULES.catchBinding}
		out.push(\`\${table}\`);
	}
}
export function errorBindingThatThrows() {
	try {
		print("a");
	} catch (error) { // expect ${RULES.catchBinding}
		throw \`wrapped: \${error}\`;
	}
}
export function errorBindingThatThrowsFromAClosure() {
	try {
		print("a");
	} catch (error) { // expect ${RULES.catchBinding}
		const rethrow = () => {
			throw error;
		};
		rethrow();
	}
}
export function errorBindingThatOnlyLogs() {
	try {
		print("a");
	} catch (error) {
		warn(error);
	}
}
export function ordinaryBinding(out: string[]) {
	try {
		print("a");
	} catch (err) {
		out.push(\`\${err}\`);
		throw \`wrapped: \${err}\`;
	}
}
`,
	"comparison.ts": `
function pair(ok: boolean): LuaTuple<[number, string]> | undefined { // expect ${RULES.tupleOrUndefined}
	return ok ? $tuple(1, "a") : undefined;
}
export function matchCompared(s: string) {
	return string.match(s, "x") === undefined; // expect ${RULES.tupleComparison}
}
export function matchComparedReversed(s: string) {
	return undefined !== string.match(s, "x"); // expect ${RULES.tupleComparison}
}
export function packedResultCompared(ok: boolean) {
	const r = pair(ok);
	return r === undefined; // expect ${RULES.tupleComparison}
}
export function matchDestructured(s: string) {
	const [m] = string.match(s, "x");
	return m === undefined;
}
`,
	"return.ts": `
export function declared(ok: boolean): LuaTuple<[number, string]> | undefined { // expect ${RULES.tupleOrUndefined}
	return ok ? $tuple(1, "a") : undefined;
}
export function inferred(ok: boolean) { // expect ${RULES.tupleOrUndefined}
	if (!ok) return;
	return $tuple(1, "a");
}
export const arrow = (ok: boolean): LuaTuple<[number]> | undefined => (ok ? $tuple(1) : undefined); // expect ${RULES.tupleOrUndefined}
export class Holder {
	method(ok: boolean): LuaTuple<[number]> | void { // expect ${RULES.tupleOrUndefined}
		if (ok) return $tuple(1);
	}
}
export function sentinel(ok: boolean): LuaTuple<[number | undefined, string | undefined]> {
	if (!ok) return $tuple(undefined, undefined);
	return $tuple(1, "a");
}
export function plainOptional(ok: boolean): number | undefined {
	return ok ? 1 : undefined;
}
export function iterator(values: number[]) {
	let i = 0;
	return (() => {
		i += 1;
		if (i > values.size()) return undefined;
		return $tuple(i, values[i - 1]);
	}) as IterableFunction<LuaTuple<[number, number]>>;
}
`,
	"assertion.ts": `
type Level = "Idle" | "Alert" | "Engaged" | "Critical";
type Levels = { readonly [k in Level]: number };
const partial = { Idle: 1, Alert: 2 };
const key: string = "Idle";

export const missing = { Idle: 1, Alert: 2, Engaged: 3 } as Levels; // expect ${RULES.asMissingKey}
export const parenthesized = ({ Idle: 1 }) as Levels; // expect ${RULES.asMissingKey}
export const angleBracket = <{ a: number; b: string }>{ a: 1 }; // expect ${RULES.asMissingKey}
export const fakeInstance = {} as Folder; // expect ${RULES.asMissingKey}
export const complete = { Idle: 1, Alert: 2, Engaged: 3, Critical: 4 } as Levels;
export const satisfied = { Idle: 1, Alert: 2, Engaged: 3, Critical: 4 } satisfies Levels;
export const satisfiedThenWidened = { Idle: 1, Alert: 2, Engaged: 3, Critical: 4 } satisfies Levels as Levels;
export const spread = { ...partial, Engaged: 3, Critical: 4 } as Levels;
export const computedKey = { [key]: 1 } as Levels;
export const optionalKey = { a: 1 } as { a: number; b?: number };
export const undefinedKey = { a: 1 } as { a: number; b: number | undefined };
export const methodOnly = { a: 1 } as { a: number; run(): void };
export const emptyMap = {} as Map<string, number>;
export const constant = { a: 1 } as const;
export const erased = {} as unknown;
export function generic<T extends Levels>() {
	return {} as T;
}
export function genericKeys<K extends Level>() {
	return {} as Record<K, number>;
}
`,
};

const equalityOperators = new Set([
	ts.SyntaxKind.EqualsEqualsEqualsToken,
	ts.SyntaxKind.ExclamationEqualsEqualsToken,
	ts.SyntaxKind.EqualsEqualsToken,
	ts.SyntaxKind.ExclamationEqualsToken,
]);
const erasingAssertions = new Set([ts.SyntaxKind.AnyKeyword, ts.SyntaxKind.UnknownKeyword, ts.SyntaxKind.NeverKeyword]);
const nilFlags = ts.TypeFlags.Undefined | ts.TypeFlags.Void;
const unsureFlags = ts.TypeFlags.AnyOrUnknown | ts.TypeFlags.Instantiable;

const constituents = (type) => (type.isUnion() ? type.types : [type]);
const relative = (file) => path.relative(root, file).split(path.sep).join("/");
// plain code-unit order, so the output does not depend on the machine's locale
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byLocation = (a, b) => compare(a.file, b.file) || a.line - b.line || a.col - b.col || compare(a.rule, b.rule);

// the same title and verdict colours as tests/_report.luau, so this reads as its own check in `npm run check`
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

function loadConfig() {
	const configPath = path.join(root, "tsconfig.json");
	const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
	if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));

	const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root, undefined, configPath);
	return { options: { ...parsed.options, noEmit: true }, fileNames: parsed.fileNames };
}

// The compiler's own test (MacroManager, isLuaTupleType): a type is a LuaTuple when its nominal property is the
// symbol declared on the LuaTuple alias.
function findNominalLuaTuple(checker) {
	const alias = checker.resolveName(SYMBOL_NAMES.LuaTuple, undefined, ts.SymbolFlags.All, false);
	const declaration = alias?.declarations?.find(ts.isTypeAliasDeclaration);
	if (!declaration) return undefined;

	return checker.getTypeAtLocation(declaration).getProperty(NOMINAL_LUA_TUPLE_NAME);
}

function findIterableFunction(checker) {
	return checker.resolveName(SYMBOL_NAMES.IterableFunction, undefined, ts.SymbolFlags.Type, false);
}

function containsThrow(node) {
	return ts.isThrowStatement(node) || ts.forEachChild(node, containsThrow) === true;
}

function skipParentheses(node) {
	while (ts.isParenthesizedExpression(node)) node = node.expression;
	return node;
}

function listNames(names) {
	const shown = names.slice(0, 5).join(", ");
	return names.length > 5 ? `${shown} and ${names.length - 5} more` : shown;
}

function snippet(node, sourceFile) {
	const text = node.getText(sourceFile).replace(/\s+/g, " ");
	return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function scan(program, sourceFiles) {
	const checker = program.getTypeChecker();
	const nominalLuaTuple = findNominalLuaTuple(checker);
	const iterableFunction = findIterableFunction(checker);
	const hits = [];
	const checked = Object.fromEntries(Object.values(RULES).map((rule) => [rule, 0]));
	let sourceFile;

	const isLuaTuple = (type) =>
		nominalLuaTuple !== undefined && type.getProperty(NOMINAL_LUA_TUPLE_NAME) === nominalLuaTuple;
	const isIterator = (node) => {
		if (iterableFunction === undefined || !(ts.isArrowFunction(node) || ts.isFunctionExpression(node)))
			return false;
		const contextual = checker.getContextualType(node);
		return contextual !== undefined && constituents(contextual).some((type) => type.symbol === iterableFunction);
	};
	const isUnsure = (type) =>
		(type.flags & unsureFlags) !== 0 || (type.isUnionOrIntersection() && type.types.some(isUnsure));
	const mentionsTypeParameter = (typeNode) =>
		(ts.isTypeReferenceNode(typeNode) && isUnsure(checker.getTypeFromTypeNode(typeNode))) ||
		ts.forEachChild(typeNode, mentionsTypeParameter) === true;

	// Not flagged: a key whose type admits undefined (a missing key and a nil one read the same in Luau), a method
	// (a missing one errors on its first call rather than reading a wrong value), and a unique-symbol brand such as
	// the `_nominal_*` markers, which no literal can supply.
	const isSilentWhenMissing = (prop) => {
		if ((prop.flags & ts.SymbolFlags.Optional) !== 0) return false;
		if (prop.declarations?.every((d) => ts.isMethodSignature(d) || ts.isMethodDeclaration(d))) return false;

		const type = checker.getTypeOfSymbol(prop);
		if ((type.flags & (ts.TypeFlags.UniqueESSymbol | ts.TypeFlags.AnyOrUnknown)) !== 0) return false;
		return !constituents(type).some((t) => (t.flags & nilFlags) !== 0);
	};

	const hit = (node, rule, message) => {
		const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
		hits.push({ file: sourceFile.fileName, line: line + 1, col: character + 1, rule, message });
	};

	const checkCatch = (node) => {
		const binding = node.variableDeclaration?.name;
		if (!binding || !ts.isIdentifier(binding)) return;

		checked[RULES.catchBinding]++;
		if (!reservedGlobals.has(binding.text)) return;
		// `throw` compiles to `error(...)`, so a block without one is exempt.
		// fixme: the `reduce` macro also emits `error(...)` when given no initial value (roblox-ts
		// TSTransformer/macros/propertyCallMacros.js); read from the compiler source, not detected here.
		if (binding.text === "error" && !containsThrow(node.block)) return;

		const name = binding.text;
		hit(
			binding,
			RULES.catchBinding,
			`\`${name}\` shadows the Luau global; emitted calls to \`${name}\` call the caught value`,
		);
	};

	const checkComparison = (node) => {
		checked[RULES.tupleComparison]++;
		for (const operand of [node.left, node.right]) {
			if (!constituents(checker.getTypeAtLocation(operand)).some(isLuaTuple)) continue;

			const text = snippet(operand, sourceFile);
			hit(
				operand,
				RULES.tupleComparison,
				`\`${text}\` is a LuaTuple, a table at runtime; the comparison is constant`,
			);
		}
	};

	const checkReturn = (node) => {
		const signature = checker.getSignatureFromDeclaration(node);
		if (!signature) return;

		checked[RULES.tupleOrUndefined]++;
		const types = constituents(checker.getReturnTypeOfSignature(signature));
		if (!types.some(isLuaTuple) || !types.some((type) => (type.flags & nilFlags) !== 0)) return;
		// an iterator ends a generic `for` by returning nil, and `for ... in` never packs what it returns
		if (isIterator(node)) return;

		const message = "returns LuaTuple | undefined; an assigned result is a table even when undefined was returned";
		hit(node.name ?? node, RULES.tupleOrUndefined, message);
	};

	const checkAssertion = (node) => {
		const literal = skipParentheses(node.expression);
		if (!ts.isObjectLiteralExpression(literal)) return;
		if (ts.isConstTypeReference(node.type) || erasingAssertions.has(node.type.kind)) return;

		checked[RULES.asMissingKey]++;
		if (mentionsTypeParameter(node.type)) return;

		const literalType = checker.getTypeAtLocation(literal);
		if (isUnsure(literalType) || constituents(literalType).some((t) => checker.getIndexInfosOfType(t).length > 0))
			return;

		const declared = new Set(constituents(literalType).flatMap((t) => t.getProperties().map((p) => p.name)));
		const missing = checker
			.getPropertiesOfType(checker.getTypeFromTypeNode(node.type))
			.filter((prop) => !declared.has(prop.name) && isSilentWhenMissing(prop))
			.map((prop) => prop.name)
			.sort();
		if (missing.length === 0) return;

		const [keys, them] = missing.length === 1 ? ["key", "it"] : ["keys", "them"];
		const target = `\`as ${snippet(node.type, sourceFile)}\``;
		hit(
			node,
			RULES.asMissingKey,
			`${target} hides missing required ${keys} ${listNames(missing)}; \`satisfies\` would report ${them}`,
		);
	};

	const visit = (node) => {
		if (ts.isCatchClause(node)) checkCatch(node);
		else if (ts.isBinaryExpression(node) && equalityOperators.has(node.operatorToken.kind)) checkComparison(node);
		else if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) checkAssertion(node);
		else if (
			ts.isFunctionDeclaration(node) ||
			ts.isMethodDeclaration(node) ||
			ts.isArrowFunction(node) ||
			ts.isFunctionExpression(node)
		)
			checkReturn(node);

		ts.forEachChild(node, visit);
	};

	for (sourceFile of sourceFiles) visit(sourceFile);
	return { hits, checked };
}

function selfTest(options) {
	const dir = path.join(root, "src", ".tripwires-selftest");
	const sources = new Map(Object.entries(fixtures).map(([name, text]) => [path.join(dir, name), text]));

	const host = ts.createCompilerHost(options, true);
	const { getSourceFile, fileExists, readFile } = host;
	host.getSourceFile = (fileName, languageVersion, ...rest) => {
		const text = sources.get(path.resolve(fileName));
		if (text === undefined) return getSourceFile.call(host, fileName, languageVersion, ...rest);
		return ts.createSourceFile(fileName, text, languageVersion, true);
	};
	host.fileExists = (fileName) => sources.has(path.resolve(fileName)) || fileExists.call(host, fileName);
	host.readFile = (fileName) => sources.get(path.resolve(fileName)) ?? readFile.call(host, fileName);

	const program = ts.createProgram([...sources.keys()], options, host);
	const sourceFiles = [...sources.keys()].map((file) => program.getSourceFile(file));
	const failures = [];

	for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
		if (!sourceFiles.includes(diagnostic.file)) continue;

		const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
		const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
		failures.push(`fixtures: ${path.basename(diagnostic.file.fileName)}:${line + 1} does not compile: ${text}`);
	}

	const expected = sourceFiles.flatMap((sourceFile) =>
		sourceFile.text.split("\n").flatMap((text, i) => {
			const rule = text.match(/\/\/ expect (\S+)$/)?.[1];
			return rule ? [{ rule, file: path.basename(sourceFile.fileName), line: i + 1, col: 0 }] : [];
		}),
	);
	const actual = scan(program, sourceFiles).hits.map((h) => ({ ...h, file: path.basename(h.file), col: 0 }));
	const matches = (a) => (b) => a.rule === b.rule && a.file === b.file && a.line === b.line;

	for (const rule of Object.values(RULES)) {
		const ofRule = (h) => h.rule === rule;
		if (!expected.some(ofRule)) failures.push(`${rule}: no fixture violates it`);

		for (const h of expected.filter((e) => ofRule(e) && !actual.some(matches(e))).sort(byLocation))
			failures.push(`${rule}: did not fire at ${h.file}:${h.line}`);
		for (const h of actual.filter((a) => ofRule(a) && !expected.some(matches(a))).sort(byLocation))
			failures.push(`${rule}: fired on clean code at ${h.file}:${h.line}`);
	}

	return failures;
}

function main() {
	const title = "luau tripwires";
	console.log(`${BOLD}── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}${RESET}`);

	const { options, fileNames } = loadConfig();

	const failures = selfTest(options);
	if (failures.length > 0) {
		for (const failure of failures) console.error(`self-test failed: ${failure}`);
		process.exit(2);
	}

	const scanned = fileNames
		.filter((file) => {
			const rel = relative(file);
			if (!rel.startsWith("src/") || rel.startsWith("src/engine/transformer/")) return false;
			return !rel.endsWith(".d.ts") && !rel.endsWith(".generated.ts");
		})
		.sort(compare);
	if (scanned.length === 0) {
		console.error("tripwires: tsconfig.json resolved no files under src/ to scan");
		process.exit(2);
	}

	const program = ts.createProgram(fileNames, options);
	const { hits, checked } = scan(
		program,
		scanned.map((file) => program.getSourceFile(file)),
	);

	const lines = hits
		.map((h) => ({ ...h, file: relative(h.file) }))
		.sort(byLocation)
		.map((h) => `${h.file}:${h.line}:${h.col} ${h.rule} ${h.message}`);
	for (const line of lines) console.log(line);

	const counts = Object.values(RULES)
		.map((rule) => `${rule} ${hits.filter((h) => h.rule === rule).length}/${checked[rule]}`)
		.join(", ");
	if (lines.length > 0) {
		const plural = lines.length === 1 ? "" : "s";
		const summary = `${lines.length} hit${plural} in ${scanned.length} files (hits/checked: ${counts})`;
		console.log(`\n${RED}${BOLD}FAILED${RESET}${RED} tripwires: ${summary}${RESET}`);
		process.exit(1);
	}

	const summary = `${scanned.length} files scanned (hits/checked: ${counts})`;
	console.log(`\n${GREEN}${BOLD}OK${RESET}${GREEN} tripwires: ${summary}${RESET}`);
}

main();
