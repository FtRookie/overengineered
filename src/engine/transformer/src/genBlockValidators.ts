// Build-time codegen: scans every `InstanceBlockLogic<_, TModel>` block, walks TModel with the shared
// instanceTree walker, and emits a game-synced module of `{ [blockId]: t.instanceTree(...) }` used to validate
// every block model against its declared type — headless (asset check) and at runtime (BlockListBuilder, Studio).
// Reads only the static type of each block, never its runtime code, so it sidesteps the heavy import graph.

import * as fs from "fs";
import * as nodePath from "path";
import ts from "typescript";
import { createInstanceTreeWalker } from "./instanceTreeWalker";

const ROOT = process.cwd();
const SRC = nodePath.join(ROOT, "src");
const OUT_FILE = nodePath.join(SRC, "shared", "blocks", "BlockModelValidators.generated.ts");

function createProgram(): ts.Program {
	const configPath = nodePath.join(ROOT, "tsconfig.json");
	const read = ts.readConfigFile(configPath, ts.sys.readFile);
	const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
	return ts.createProgram(parsed.fileNames, parsed.options);
}

function modelTypeArgOf(node: ts.ClassLikeDeclaration): ts.TypeNode | undefined {
	const ext = node.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword);
	if (!ext) return undefined;
	for (const h of ext.types) {
		if (ts.isIdentifier(h.expression) && h.expression.text === "InstanceBlockLogic") {
			return h.typeArguments?.[1];
		}
	}
	return undefined;
}

function objectKeys(obj: ts.ObjectLiteralExpression): string[] {
	const keys: string[] = [];
	for (const p of obj.properties) {
		const name = (p as ts.PropertyAssignment | ts.ShorthandPropertyAssignment | ts.MethodDeclaration).name;
		if (!name) continue;
		if (ts.isIdentifier(name)) keys.push(name.text);
		else if (ts.isStringLiteral(name)) keys.push(name.text);
	}
	return keys;
}

// A block id in a file comes either from an explicit `id: "..."` or, for grouped blocks, from the keys of the
// object passed to `BlockCreation.arrayFromObject(...)`.
function collectIds(sf: ts.SourceFile, checker: ts.TypeChecker): string[] {
	const ids = new Set<string>();
	const visit = (node: ts.Node): void => {
		if (
			ts.isPropertyAssignment(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "id" &&
			ts.isStringLiteral(node.initializer) &&
			/[a-z]/.test(node.initializer.text)
		) {
			ids.add(node.initializer.text);
		}
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === "arrayFromObject"
		) {
			const arg = node.arguments[0];
			let obj: ts.ObjectLiteralExpression | undefined;
			if (arg && ts.isObjectLiteralExpression(arg)) {
				obj = arg;
			} else if (arg && ts.isIdentifier(arg)) {
				const decl = checker.getSymbolAtLocation(arg)?.valueDeclaration;
				if (decl && ts.isVariableDeclaration(decl) && decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
					obj = decl.initializer;
				}
			}
			if (obj) for (const k of objectKeys(obj)) if (/[a-z]/.test(k)) ids.add(k);
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return [...ids];
}

const program = createProgram();
const checker = program.getTypeChecker();
const walker = createInstanceTreeWalker(checker, ts.factory);

const entries: { id: string; expr: ts.Expression }[] = [];
const errors: string[] = [];
const seen = new Map<string, string>();
let modelsFound = 0;

for (const sf of program.getSourceFiles()) {
	if (sf.isDeclarationFile) continue;
	const rel = nodePath.relative(SRC, sf.fileName).replace(/\\/g, "/");
	if (!rel.startsWith("shared/blocks/")) continue;

	let modelArg: ts.TypeNode | undefined;
	const findClass = (node: ts.Node): void => {
		if (modelArg) return;
		if (ts.isClassLike(node)) {
			const a = modelTypeArgOf(node);
			if (a) {
				modelArg = a;
				return;
			}
		}
		ts.forEachChild(node, findClass);
	};
	findClass(sf);
	if (!modelArg) continue;
	modelsFound++;

	let expr: ts.Expression | undefined;
	try {
		const type = checker.getTypeFromTypeNode(modelArg);
		expr = walker.build(type, modelArg, ts.factory.createIdentifier("t"), `${rel} (${modelArg.getText()})`);
	} catch (e) {
		errors.push(`${rel}: ${String(e)}`);
		continue;
	}
	if (!expr) continue;

	for (const id of collectIds(sf, checker)) {
		const prev = seen.get(id);
		if (prev !== undefined) continue; // first file to claim an id wins (config-default ids can collide)
		seen.set(id, rel);
		entries.push({ id, expr });
	}
}

// --- block definition metadata ------------------------------------------------------------------
// The logic assertions in BlockAssertions (checkDefinitionOrder, checkNoSameNamesInLogicDefinition,
// checkLowercaseAlias) need only key sets and string arrays, never a model or a live service. The block
// builders themselves cannot be loaded outside Roblox — block files transitively import SharedPlots, whose
// module scope spin-waits on the place's Plots folder — so the data is lifted statically here and fed to the
// real assertions by tests/assetcheck.luau. Anything not resolvable statically is reported, never guessed:
// a wrong key set would fail a correct block.

const DEFS_OUT = nodePath.join(ROOT, "tests", "generated", "BlockDefinitions.generated.json");

interface DefinitionMeta {
	readonly input?: Record<string, true>;
	readonly output?: Record<string, true>;
	readonly inputOrder?: readonly string[];
	readonly outputOrder?: readonly string[];
	readonly aliases?: readonly string[];
	readonly partialAliases?: readonly string[];
}

function unwrap(node: ts.Expression): ts.Expression {
	let e = node;
	for (;;) {
		if (ts.isAsExpression(e) || ts.isParenthesizedExpression(e)) {
			e = e.expression;
			continue;
		}
		if (ts.isSatisfiesExpression?.(e)) {
			e = e.expression;
			continue;
		}
		return e;
	}
}

// `const outputs = {}; for (…) outputs[`value${i}`] = …` — the initializer is a complete-looking literal but
// the real key set is only assembled at runtime. Following it would emit an empty set and fail a correct block,
// so any object whose variable is ever written through is treated as unreadable.
const mutatedCache = new Map<ts.SourceFile, Set<ts.Symbol>>();

function mutatedSymbolsOf(sf: ts.SourceFile): Set<ts.Symbol> {
	const cached = mutatedCache.get(sf);
	if (cached) return cached;

	const found = new Set<ts.Symbol>();
	const visit = (node: ts.Node): void => {
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			(ts.isElementAccessExpression(node.left) || ts.isPropertyAccessExpression(node.left))
		) {
			let base: ts.Expression = node.left.expression;
			while (ts.isElementAccessExpression(base) || ts.isPropertyAccessExpression(base)) {
				base = base.expression;
			}
			if (ts.isIdentifier(base)) {
				const s = checker.getSymbolAtLocation(base);
				if (s) found.add(s);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);

	mutatedCache.set(sf, found);
	return found;
}

function isMutated(symbol: ts.Symbol): boolean {
	const decl = symbol.valueDeclaration;
	if (!decl) return false;
	return mutatedSymbolsOf(decl.getSourceFile()).has(symbol);
}

function followIdentifier(node: ts.Expression): ts.Expression | undefined {
	if (!ts.isIdentifier(node)) return undefined;

	let symbol = checker.getSymbolAtLocation(node);
	// `{ definition, ctor }` — a shorthand property's own symbol is the property, not the value it references
	if (node.parent && ts.isShorthandPropertyAssignment(node.parent)) {
		symbol = checker.getShorthandAssignmentValueSymbol(node.parent) ?? symbol;
	}
	if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
		symbol = checker.getAliasedSymbol(symbol);
	}

	if (!symbol || isMutated(symbol)) return undefined;

	const decl = symbol.valueDeclaration;
	if (decl && ts.isVariableDeclaration(decl) && decl.initializer) return decl.initializer;
	return undefined;
}

function asObject(node: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined {
	if (!node) return undefined;
	const e = unwrap(node);
	if (ts.isObjectLiteralExpression(e)) return e;
	const followed = followIdentifier(e);
	return followed ? asObject(followed) : undefined;
}

function asStringArray(node: ts.Expression | undefined): readonly string[] | undefined {
	if (!node) return undefined;
	const e = unwrap(node);
	if (ts.isArrayLiteralExpression(e)) {
		const out: string[] = [];
		for (const el of e.elements) {
			const item = unwrap(el as ts.Expression);
			if (!ts.isStringLiteral(item)) return undefined;
			out.push(item.text);
		}
		return out;
	}
	const followed = followIdentifier(e);
	return followed ? asStringArray(followed) : undefined;
}

function propertyOf(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
	for (const p of obj.properties) {
		if (ts.isPropertyAssignment(p)) {
			const n = p.name;
			if ((ts.isIdentifier(n) || ts.isStringLiteral(n)) && n.text === name) return p.initializer;
		} else if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) {
			return p.name;
		}
	}
	return undefined;
}

// A spread means the real key set is wider than the literal, so the order checks would compare against an
// incomplete set. Refuse rather than emit a key set that would fail a correct block.
function strictKeySet(obj: ts.ObjectLiteralExpression): Record<string, true> | undefined {
	const keys: Record<string, true> = {};
	for (const p of obj.properties) {
		if (ts.isSpreadAssignment(p)) return undefined;
		const n = (p as ts.PropertyAssignment).name;
		if (!n) continue;
		if (ts.isIdentifier(n) || ts.isStringLiteral(n)) keys[n.text] = true;
	}
	return keys;
}

type MetaResult = { readonly meta: DefinitionMeta } | { readonly skip: string };

function metaOf(builder: ts.ObjectLiteralExpression): MetaResult | undefined {
	const logicExpr = propertyOf(builder, "logic");
	const searchExpr = propertyOf(builder, "search");
	if (!logicExpr && !searchExpr) return undefined;

	const meta: {
		input?: Record<string, true>;
		output?: Record<string, true>;
		inputOrder?: readonly string[];
		outputOrder?: readonly string[];
		aliases?: readonly string[];
		partialAliases?: readonly string[];
	} = {};

	if (logicExpr) {
		const logic = asObject(logicExpr);
		if (!logic) return { skip: "logic is not a resolvable object literal" };
		const defsExpr = propertyOf(logic, "definition");
		if (defsExpr) {
			const defs = asObject(defsExpr);
			// e.g. Objects.deepCombine(base, {...}) — composed at runtime, not statically readable
			if (!defs) return { skip: "logic.definition is computed, not a literal" };

			for (const side of ["input", "output"] as const) {
				const obj = asObject(propertyOf(defs, side));
				if (!obj) return { skip: `definition.${side} is not a resolvable object literal` };
				const keys = strictKeySet(obj);
				if (!keys) return { skip: `definition.${side} uses a spread` };
				meta[side] = keys;
			}

			for (const order of ["inputOrder", "outputOrder"] as const) {
				const raw = propertyOf(defs, order);
				if (!raw) continue;
				const arr = asStringArray(raw);
				if (!arr) return { skip: `definition.${order} is not a literal string array` };
				meta[order] = arr;
			}
		}
	}

	if (searchExpr) {
		const search = asObject(searchExpr);
		if (search) {
			for (const key of ["aliases", "partialAliases"] as const) {
				const raw = propertyOf(search, key);
				if (!raw) continue;
				const arr = asStringArray(raw);
				if (arr) meta[key] = arr;
			}
		}
	}

	if (Object.keys(meta).length === 0) return undefined;
	return { meta };
}

const ID_RE = /^[a-z0-9_]+$/;

function collectBuilders(sf: ts.SourceFile): { id: string; obj: ts.ObjectLiteralExpression }[] {
	const found: { id: string; obj: ts.ObjectLiteralExpression }[] = [];
	const visit = (node: ts.Node): void => {
		if (
			ts.isPropertyAssignment(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "id" &&
			ts.isStringLiteral(node.initializer) &&
			ID_RE.test(node.initializer.text) &&
			ts.isObjectLiteralExpression(node.parent)
		) {
			found.push({ id: node.initializer.text, obj: node.parent });
		}

		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === "arrayFromObject"
		) {
			const grouped = asObject(node.arguments[0]);
			if (grouped) {
				for (const p of grouped.properties) {
					if (!ts.isPropertyAssignment(p)) continue;
					const n = p.name;
					if (!ts.isIdentifier(n) && !ts.isStringLiteral(n)) continue;
					if (!ID_RE.test(n.text)) continue;
					const obj = asObject(p.initializer);
					if (obj) found.push({ id: n.text, obj });
				}
			}
		}

		ts.forEachChild(node, visit);
	};
	visit(sf);
	return found;
}

const definitions: Record<string, DefinitionMeta> = {};
const skipped: string[] = [];
const claimed = new Set<string>();

for (const sf of program.getSourceFiles()) {
	if (sf.isDeclarationFile) continue;
	const rel = nodePath.relative(SRC, sf.fileName).replace(/\\/g, "/");
	if (!rel.startsWith("shared/blocks/")) continue;

	for (const { id, obj } of collectBuilders(sf)) {
		if (claimed.has(id)) continue;
		const result = metaOf(obj);
		if (!result) continue;
		claimed.add(id);
		if ("skip" in result) {
			skipped.push(`${id} (${rel}): ${result.skip}`);
			continue;
		}
		definitions[id] = result.meta;
	}
}

fs.mkdirSync(nodePath.dirname(DEFS_OUT), { recursive: true });
fs.writeFileSync(
	DEFS_OUT,
	JSON.stringify(
		{
			// consumed by tests/assetcheck.luau; regenerated by `npm run genvalidators`
			definitions: Object.fromEntries(Object.entries(definitions).sort(([a], [b]) => (a < b ? -1 : 1))),
			skipped: skipped.sort(),
		},
		undefined,
		"\t",
	) + "\n",
);
console.log(
	`[genBlockValidators] ${Object.keys(definitions).length} block definitions, ${skipped.length} unresolvable -> ${nodePath.relative(ROOT, DEFS_OUT)}`,
);

if (errors.length > 0) {
	console.error("[genBlockValidators] failed:");
	for (const e of errors) console.error("  " + e);
	process.exit(1);
}

entries.sort((a, b) => (a.id < b.id ? -1 : 1));
const object = ts.factory.createObjectLiteralExpression(
	entries.map((e) => ts.factory.createPropertyAssignment(ts.factory.createStringLiteral(e.id), e.expr)),
	true,
);
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const dummy = ts.createSourceFile("gen.ts", "", ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
const objectText = printer.printNode(ts.EmitHint.Unspecified, object, dummy);

const output =
	"// GENERATED by src/engine/transformer/src/genBlockValidators.ts — do not edit.\n" +
	'import { t } from "engine/shared/t";\n\n' +
	`export const BlockModelValidators: { readonly [blockId in string]: t.Type<Model> } = ${objectText};\n`;

fs.writeFileSync(OUT_FILE, output);
console.log(
	`[genBlockValidators] ${modelsFound} InstanceBlockLogic models, ${entries.length} block ids -> ${nodePath.relative(ROOT, OUT_FILE)}`,
);
