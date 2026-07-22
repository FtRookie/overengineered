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
