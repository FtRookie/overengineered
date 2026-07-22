import ts from "typescript";

// Shared type-walker behind `t.instanceTree<T>()`. Consumed by the compile-time transformer (index.ts)
// and by the build-time block-validator codegen (genBlockValidators.ts) so both derive identical specs.

export type ChildInfo = { readonly name: string; readonly type: ts.Type; readonly optional: boolean };
export type Described = { readonly className: string; readonly children: ChildInfo[] };

export function createInstanceTreeWalker(typeChecker: ts.TypeChecker, factory: ts.NodeFactory) {
	function tAccess(base: ts.Expression, name: string): ts.Expression {
		return factory.createPropertyAccessExpression(
			ts.isIdentifier(base) ? factory.createIdentifier(base.text) : base,
			name,
		);
	}
	function isTypeLiteral(type: ts.Type): boolean {
		return ((type.symbol?.flags ?? 0) & ts.SymbolFlags.TypeLiteral) !== 0;
	}
	function flatten(type: ts.Type, out: ts.Type[]): void {
		if (type.isIntersection()) {
			for (const part of type.types) flatten(part, out);
		} else {
			out.push(type);
		}
	}
	function describe(type: ts.Type, location: ts.Node): Described | undefined {
		const members: ts.Type[] = [];
		flatten(type, members);

		const root = members.find((m) => !isTypeLiteral(m));
		const className = root?.symbol?.name ?? root?.aliasSymbol?.name;
		if (className === undefined) return undefined;

		const children: ChildInfo[] = [];
		for (const member of members) {
			if (!isTypeLiteral(member)) continue;
			for (const prop of member.getProperties()) {
				if (prop.name.startsWith("___")) continue;
				children.push({
					name: prop.name,
					type: typeChecker.getTypeOfSymbolAtLocation(prop, location),
					optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
				});
			}
		}

		return { className, children };
	}
	function emitSpecObject(
		children: readonly ChildInfo[],
		base: ts.Expression,
		location: ts.Node,
		depth: number,
		path: string,
	): ts.ObjectLiteralExpression {
		return factory.createObjectLiteralExpression(
			children.map((child) =>
				factory.createPropertyAssignment(
					factory.createStringLiteral(child.name),
					emitSpecValue(child.type, base, location, depth + 1, `${path}.${child.name}`, child.optional),
				),
			),
			true,
		);
	}
	function emitTypeExpr(
		type: ts.Type,
		base: ts.Expression,
		location: ts.Node,
		depth: number,
		path: string,
	): ts.Expression {
		const described = describe(type, location);
		if (!described) {
			throw `instanceTree: '${path}' (union member) has no instance class to validate; type it as \`SomeClass & { ... }\``;
		}

		if (described.children.length === 0) {
			return factory.createCallExpression(tAccess(base, "instance"), undefined, [
				factory.createStringLiteral(described.className),
			]);
		}
		return factory.createCallExpression(tAccess(base, "instanceTree"), undefined, [
			factory.createStringLiteral(described.className),
			emitSpecObject(described.children, base, location, depth, path),
		]);
	}
	function emitSpecValue(
		type: ts.Type,
		base: ts.Expression,
		location: ts.Node,
		depth: number,
		path: string,
		optional: boolean,
	): ts.Expression {
		if (depth > 32) throw `instanceTree: '${path}' nested too deeply`;

		let isOptional = optional;
		let members: ts.Type[];
		if (type.isUnion()) {
			members = [];
			for (const part of type.types) {
				if ((part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) !== 0) {
					isOptional = true;
					continue;
				}
				members.push(part);
			}
		} else {
			members = [type];
		}
		if (members.length === 0) {
			throw `instanceTree: child '${path}' has no non-undefined type to validate`;
		}

		if (isOptional) {
			return factory.createCallExpression(tAccess(base, "union"), undefined, [
				...members.map((member) => emitTypeExpr(member, base, location, depth, path)),
				tAccess(base, "undefined"),
			]);
		}
		if (members.length > 1) {
			return factory.createCallExpression(
				tAccess(base, "union"),
				undefined,
				members.map((member) => emitTypeExpr(member, base, location, depth, path)),
			);
		}

		const described = describe(members[0], location);
		if (!described) {
			throw `instanceTree: child '${path}' has no instance class to validate; type it as \`SomeClass & { ... }\``;
		}

		if (described.children.length === 0) {
			return factory.createStringLiteral(described.className);
		}
		return factory.createArrayLiteralExpression([
			factory.createStringLiteral(described.className),
			emitSpecObject(described.children, base, location, depth, path),
		]);
	}

	// Builds `t.instanceTree("ClassName", { ...spec })` for a model type. `tExpr` is the reference to `t`.
	// Returns undefined when the type has no instance class (not an instance type at all).
	function build(type: ts.Type, location: ts.Node, tExpr: ts.Expression, path: string): ts.Expression | undefined {
		const described = describe(type, location);
		if (!described) return undefined;

		return factory.createCallExpression(tAccess(tExpr, "instanceTree"), undefined, [
			factory.createStringLiteral(described.className),
			emitSpecObject(described.children, tExpr, location, 0, path),
		]);
	}

	return { describe, build };
}
