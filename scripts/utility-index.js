/* eslint-disable roblox-ts/no-regex */
/* eslint-disable no-undef */
// Generates the file index in docs/claude/UTILITY_APIS.md from the utility layer's exported signatures, or checks
// that it still matches src/.
//
//   node scripts/utility-index.js           exit 1 with a diff when the index no longer matches src/
//   node scripts/utility-index.js --write   regenerate the index in place
//
// Only `path -> signature line` is compared. The one-sentence description under each heading is hand-written and
// carried over by --write, so rewording or rewrapping it never fails the check; a missing one does.

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..");
const DOC = path.join(ROOT, "docs", "claude", "UTILITY_APIS.md");
const BEGIN = "<!-- utility-index:begin -->";
const END = "<!-- utility-index:end -->";
const PLACEHOLDER = "_No description yet._";

const DIRS = ["src/engine/shared/fixes", "src/engine/shared/utils", "src/engine/shared/event", "src/shared/utils"];
const LOOSE = [
	"src/client/CursorService.ts",
	"src/engine/shared/Assert.ts",
	"src/engine/shared/Colors.ts",
	"src/engine/shared/Element.ts",
	"src/engine/shared/Lazy.ts",
	"src/engine/shared/Operation.ts",
	"src/engine/shared/Throttler.ts",
	"src/engine/shared/component/ComponentEvents.ts",
	"src/engine/shared/t.ts",
	"src/shared/Colors.ts",
];
// data tables with no callable surface
const SKIP = ["src/engine/shared/fixes/utf8data.ts"];
// augmentation interfaces merged into something with a different name; the value is what a caller writes before the member
const ALIASES = { t_propmacro: "t.", t_type_propmacro: "t.Type#" };
// a data table with more keys than this renders as its key count
const MAX_LISTED_KEYS = 16;

const listDir = (dir) =>
	fs
		.readdirSync(path.join(ROOT, dir))
		.sort()
		.map((name) => `${dir}/${name}`);

const findPropmacros = (dir) => {
	const out = [];
	for (const entry of fs
		.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
		.sort((a, b) => (a.name < b.name ? -1 : 1))) {
		const rel = `${dir}/${entry.name}`;
		if (entry.isDirectory()) out.push(...findPropmacros(rel));
		else if (entry.name.endsWith(".propmacro.ts")) out.push(rel);
	}
	return out;
};

const collectFiles = () => {
	const files = new Set([...DIRS.flatMap(listDir), ...LOOSE, ...findPropmacros("src")]);
	return [...files].filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !SKIP.includes(f)).sort();
};

const createProgram = (files) => {
	const configPath = path.join(ROOT, "tsconfig.json");
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));

	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
	const options = { ...parsed.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined, plugins: [] };
	const ambient = parsed.fileNames.filter((f) => f.endsWith(".d.ts"));
	return ts.createProgram([...files.map((f) => path.join(ROOT, f)), ...ambient], options);
};

//

const FORMAT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

const oneLine = (text) =>
	text
		.replace(/\s+/g, " ")
		.replace(/([(<]) /g, "$1")
		.replace(/ ([)>])/g, "$1")
		.trim();

const isDeprecated = (node) => ts.getJSDocTags(node).some((tag) => tag.tagName.text === "deprecated");

const hasModifier = (node, kind) => (ts.getCombinedModifierFlags(node) & kind) !== 0;

const isHidden = (node) =>
	hasModifier(node, ts.ModifierFlags.Private) ||
	hasModifier(node, ts.ModifierFlags.Protected) ||
	(node.name !== undefined && ts.isPrivateIdentifier(node.name));

const signatureText = (checker, signature, decl) => {
	let text = checker.signatureToString(signature, decl, FORMAT);
	if (signature.thisParameter) {
		const self = `this: ${checker.typeToString(checker.getTypeOfSymbol(signature.thisParameter), decl, FORMAT)}`;
		text = text.replace(`(${self}, `, "(").replace(`(${self})`, "()");
	}
	return oneLine(text);
};

const constructorText = (checker, signature, decl) => {
	const text = signatureText(checker, signature, decl);
	const ret = `: ${oneLine(checker.typeToString(checker.getReturnTypeOfSignature(signature), decl, FORMAT))}`;
	return text.endsWith(ret) ? text.slice(0, -ret.length) : text;
};

const typeText = (checker, node) => oneLine(checker.typeToString(checker.getTypeAtLocation(node), node, FORMAT));

const typeParams = (node) =>
	node.typeParameters && node.typeParameters.length > 0
		? `<${node.typeParameters.map((p) => oneLine(p.getText())).join(", ")}>`
		: "";

const code = (text) => (text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``);

const line = (text, node) => (node && isDeprecated(node) ? `${code(text)} *(deprecated)*` : code(text));

const renderCallable = (checker, name, node) => {
	const type = checker.getTypeAtLocation(node);
	return type.getCallSignatures().map((sig) => line(`${name}${signatureText(checker, sig, node)}`, node));
};

const renderClass = (checker, prefix, decl) => {
	const out = [];
	const heritage = (decl.heritageClauses ?? []).map((h) => oneLine(h.getText())).join(" ");
	out.push(line(`class ${prefix}${typeParams(decl)}${heritage ? ` ${heritage}` : ""}`, decl));

	const seen = new Set();
	for (const member of decl.members) {
		if (isHidden(member)) continue;
		const isStatic = hasModifier(member, ts.ModifierFlags.Static);
		const owner = isStatic ? `${prefix}.` : `${prefix}#`;

		if (ts.isConstructorDeclaration(member)) {
			const sig = checker.getSignatureFromDeclaration(member);
			out.push(line(`new ${prefix}${constructorText(checker, sig, member)}`, member));
			for (const param of member.parameters) {
				if (!ts.isParameterPropertyDeclaration(param, member) || isHidden(param)) continue;
				const readonly = hasModifier(param, ts.ModifierFlags.Readonly) ? "readonly " : "";
				out.push(line(`${readonly}${prefix}#${param.name.getText()}: ${typeText(checker, param)}`, param));
			}
			continue;
		}
		if (!member.name || ts.isComputedPropertyName(member.name)) continue;

		const name = member.name.getText();
		if (ts.isMethodDeclaration(member)) {
			// overloads share one symbol, whose type already carries every signature
			if (seen.has(owner + name)) continue;
			seen.add(owner + name);
			out.push(...renderCallable(checker, `${owner}${name}`, member));
		} else if (ts.isPropertyDeclaration(member)) {
			const readonly = hasModifier(member, ts.ModifierFlags.Readonly) ? "readonly " : "";
			out.push(line(`${readonly}${owner}${name}: ${typeText(checker, member)}`, member));
		} else if (ts.isGetAccessorDeclaration(member)) {
			out.push(line(`get ${owner}${name}: ${typeText(checker, member)}`, member));
		}
	}
	return out;
};

const renderDeclaration = (checker, prefix, decl, seen) => {
	if (ts.isFunctionDeclaration(decl)) {
		if (seen.has(prefix)) return [];
		seen.add(prefix);
		return renderCallable(checker, prefix, decl.name);
	}
	if (ts.isClassDeclaration(decl)) return renderClass(checker, prefix, decl);
	if (ts.isInterfaceDeclaration(decl)) return [line(`interface ${prefix}${typeParams(decl)}`, decl)];
	if (ts.isTypeAliasDeclaration(decl)) return [line(`type ${prefix}${typeParams(decl)}`, decl)];
	if (ts.isEnumDeclaration(decl)) return [line(`enum ${prefix}`, decl)];
	if (ts.isModuleDeclaration(decl)) return renderNamespace(checker, prefix, decl);
	if (ts.isVariableDeclaration(decl)) {
		const statement = decl.parent.parent;
		const init = decl.initializer;
		if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
			const deprecated = isDeprecated(statement);
			return renderCallable(checker, prefix, decl.name).map((l) =>
				deprecated && !l.endsWith("*(deprecated)*") ? `${l} *(deprecated)*` : l,
			);
		}
		const kind = decl.parent.flags & ts.NodeFlags.Const ? "const" : "let";
		if (isObjectApi(decl)) {
			const props = checker.getPropertiesOfType(checker.getTypeAtLocation(decl.name));
			const callable = props.some(
				(p) => checker.getTypeOfSymbolAtLocation(p, decl).getCallSignatures().length > 0,
			);
			if (callable) return props.flatMap((p) => renderProperty(checker, `${prefix}.${p.name}`, p, decl));
			if (props.length > MAX_LISTED_KEYS)
				return [line(`${kind} ${prefix}: object with ${props.length} keys`, statement)];
		}
		return [line(`${kind} ${prefix}: ${typeText(checker, decl.name)}`, statement)];
	}
	return [];
};

const unwrap = (node) => {
	while (
		node &&
		(ts.isAsExpression(node) ||
			ts.isSatisfiesExpression(node) ||
			ts.isParenthesizedExpression(node) ||
			ts.isTypeAssertionExpression(node))
	) {
		node = node.expression;
	}
	return node;
};

const isObjectApi = (decl) =>
	(decl.initializer !== undefined && ts.isObjectLiteralExpression(unwrap(decl.initializer))) ||
	(decl.type !== undefined &&
		(ts.isIntersectionTypeNode(decl.type) || ts.isTypeLiteralNode(decl.type) || ts.isMappedTypeNode(decl.type)));

const renderProperty = (checker, name, symbol, at) => {
	const type = checker.getTypeOfSymbolAtLocation(symbol, at);
	const node = symbol.valueDeclaration;
	const signatures = type.getCallSignatures();
	if (signatures.length > 0) return signatures.map((sig) => line(`${name}${signatureText(checker, sig, at)}`, node));
	return [line(`${name}: ${oneLine(checker.typeToString(type, at, FORMAT))}`, node)];
};

const renderNamespace = (checker, prefix, decl) => {
	let body = decl.body;
	while (body && ts.isModuleDeclaration(body)) body = body.body;
	if (!body || !ts.isModuleBlock(body)) return [];

	const out = [];
	const seen = new Set();
	for (const statement of body.statements) {
		if (!hasModifier(statement, ts.ModifierFlags.Export)) continue;
		for (const decl of declarationsOf(statement)) {
			out.push(...renderDeclaration(checker, `${prefix}.${decl.name.getText()}`, decl, seen));
		}
	}
	return out;
};

const declarationsOf = (statement) => {
	if (ts.isVariableStatement(statement))
		return statement.declarationList.declarations.filter((d) => ts.isIdentifier(d.name));
	if (
		(ts.isFunctionDeclaration(statement) ||
			ts.isClassDeclaration(statement) ||
			ts.isInterfaceDeclaration(statement) ||
			ts.isTypeAliasDeclaration(statement) ||
			ts.isEnumDeclaration(statement) ||
			ts.isModuleDeclaration(statement)) &&
		statement.name
	) {
		return [statement];
	}
	return [];
};

const isPropertyMacrosTable = (decl) =>
	ts.isVariableDeclaration(decl) && decl.type !== undefined && /^PropertyMacros\b/.test(decl.type.getText());

// `declare global { interface Vector3 { apply(this: Vector3, …) } }` — what a caller actually writes, as `v.apply(…)`
const renderAugmentations = (sourceFile) => {
	const out = [];
	for (const statement of sourceFile.statements) {
		if (!ts.isModuleDeclaration(statement) || !statement.body || !ts.isModuleBlock(statement.body)) continue;
		for (const inner of statement.body.statements) {
			if (!ts.isInterfaceDeclaration(inner)) continue;
			const owner = ALIASES[inner.name.text] ?? `${inner.name.text}#`;
			for (const member of inner.members) {
				if (!member.name) continue;
				const name = member.name.getText();
				if (ts.isMethodSignature(member)) {
					const params = member.parameters
						.filter((p) => p.name.getText() !== "this")
						.map((p) => oneLine(p.getText()))
						.join(", ");
					const ret = member.type ? oneLine(member.type.getText()) : "void";
					out.push(line(`${owner}${name}${typeParams(member)}(${params}): ${ret}`, member));
				} else if (ts.isPropertySignature(member)) {
					out.push(
						line(`${owner}${name}: ${member.type ? oneLine(member.type.getText()) : "unknown"}`, member),
					);
				}
			}
		}
	}
	return out;
};

const renderFile = (checker, sourceFile) => {
	const out = [];
	const seen = new Set();
	for (const statement of sourceFile.statements) {
		if (!hasModifier(statement, ts.ModifierFlags.Export)) continue;
		for (const decl of declarationsOf(statement)) {
			if (isPropertyMacrosTable(decl)) continue;
			out.push(...renderDeclaration(checker, decl.name.getText(), decl, seen));
		}
	}
	if (sourceFile.fileName.endsWith(".propmacro.ts")) out.push(...renderAugmentations(sourceFile));
	return out;
};

const generate = () => {
	const files = collectFiles();
	const program = createProgram(files);
	const checker = program.getTypeChecker();

	const index = new Map();
	for (const file of files) {
		const sourceFile = program.getSourceFile(path.join(ROOT, file));
		if (!sourceFile) throw new Error(`not in the program: ${file}`);
		index.set(file.replace(/^src\//, ""), renderFile(checker, sourceFile));
	}
	return index;
};

//

const parseBlock = (doc) => {
	const start = doc.indexOf(BEGIN);
	const end = doc.indexOf(END);
	if (start === -1 || end === -1 || end < start) throw new Error(`markers ${BEGIN} / ${END} not found in ${DOC}`);

	const entries = new Map();
	let current;
	for (const raw of doc.slice(start + BEGIN.length, end).split("\n")) {
		const heading = /^### `(.+)`$/.exec(raw);
		if (heading) {
			current = { purpose: [], signatures: [] };
			entries.set(heading[1], current);
		} else if (current && raw.startsWith("- ")) {
			current.signatures.push(raw.slice(2));
		} else if (current && current.signatures.length === 0 && raw.trim() !== "") {
			current.purpose.push(raw);
		}
	}
	return { start, end, entries };
};

const renderBlock = (index, previous) => {
	const parts = [BEGIN, ""];
	for (const [file, signatures] of index) {
		const purpose = previous.get(file)?.purpose ?? [];
		parts.push(`### \`${file}\``, "");
		parts.push(...(purpose.length > 0 ? purpose : [PLACEHOLDER]));
		parts.push("");
		if (signatures.length === 0) continue;
		parts.push(...signatures.map((s) => `- ${s}`));
		parts.push("");
	}
	parts.push(END);
	return parts.join("\n");
};

const main = () => {
	const write = process.argv.includes("--write");
	const doc = fs.readFileSync(DOC, "utf8");
	const { start, end, entries } = parseBlock(doc);
	const index = generate();

	if (write) {
		const next = doc.slice(0, start) + renderBlock(index, entries) + doc.slice(end + END.length);
		if (next !== doc) fs.writeFileSync(DOC, next, "utf8");
		console.log(`utility-index: ${next === doc ? "already current" : "updated"} (${index.size} files)`);
		return;
	}

	const problems = [];
	for (const file of entries.keys()) {
		if (!index.has(file)) problems.push(`- ${file}: listed in the doc, no longer indexed`);
	}
	for (const [file, signatures] of index) {
		const entry = entries.get(file);
		if (!entry) {
			problems.push(`+ ${file}: indexed, missing from the doc`);
			continue;
		}
		const was = new Set(entry.signatures);
		const now = new Set(signatures);
		for (const s of entry.signatures) if (!now.has(s)) problems.push(`- ${file}: ${s}`);
		for (const s of signatures) if (!was.has(s)) problems.push(`+ ${file}: ${s}`);
		if (
			entry.signatures.join("\n") !== signatures.join("\n") &&
			[...was].every((s) => now.has(s)) &&
			[...now].every((s) => was.has(s))
		) {
			problems.push(`~ ${file}: same signatures, different order`);
		}
		const purpose = entry.purpose.join(" ").trim();
		if (purpose === "" || purpose === PLACEHOLDER) problems.push(`? ${file}: no description`);
	}

	if (problems.length === 0) {
		console.log(`utility-index: OK (${index.size} files)`);
		return;
	}
	console.error(`utility-index: docs/claude/UTILITY_APIS.md does not match src/\n${problems.join("\n")}`);
	console.error("run `npm run docs:utils` to regenerate, then write any missing descriptions");
	process.exit(1);
};

main();
