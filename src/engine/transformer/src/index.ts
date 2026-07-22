import path from "path";
import ts from "typescript";
import { createInstanceTreeWalker } from "./instanceTreeWalker";

const create = (program: ts.Program, context: ts.TransformationContext) => {
	const factory = ts.factory;
	const typeChecker = program.getTypeChecker();

	const identifierByTypeNode = (typeNode: ts.TypeNode) => identifierByType(typeChecker.getTypeFromTypeNode(typeNode));
	const identifierByType = (type: ts.Type) => {
		const declaration =
			type.symbol?.valueDeclaration ??
			type.aliasSymbol?.declarations?.[0] ??
			type.symbol?.declarations?.[0] ??
			type.aliasSymbol?.valueDeclaration;
		if (!declaration) return;

		const pth = path.relative("src", declaration.getSourceFile().fileName).replaceAll("\\", "/");
		return pth + "$" + (type.aliasSymbol?.name ?? type.symbol.name);
	};

	/** Fix namespace function hoisting by moving any variable and inside namespace declarations to the bottom */
	const transformNamespaces = (file: ts.SourceFile): ts.SourceFile => {
		const fixNamespace = (node: ts.ModuleDeclaration): ts.ModuleDeclaration => {
			if ((node.flags & ts.NodeFlags.Namespace) === 0 || !node.body || !ts.isModuleBlock(node.body)) return node;

			const functionDeclarations: ts.FunctionDeclaration[] = [];
			const anyDeclarations: ts.Statement[] = [];

			for (const child of node.body.statements) {
				if (ts.isFunctionDeclaration(child)) {
					functionDeclarations.push(child);
				} else if (ts.isModuleDeclaration(child)) {
					anyDeclarations.push(fixNamespace(child));
				} else {
					anyDeclarations.push(child);
				}
			}

			return ts.factory.createModuleDeclaration(
				node.modifiers,
				node.name,
				ts.factory.createModuleBlock([...functionDeclarations, ...anyDeclarations]),
				node.flags,
			);
		};

		return ts.visitEachChild(
			file,
			(node) => {
				if (ts.isModuleDeclaration(node)) {
					return fixNamespace(node);
				}

				return node;
			},
			context,
		);
	};
	const transformLogs = (file: ts.SourceFile): ts.SourceFile => {
		let needsImport = false;
		const scopedBlocks = new Set<ts.Block | ts.SourceFile>();

		const constructLog = (expression: ts.CallExpression, logType: string): ts.Node => {
			needsImport = true;
			const spt = file.fileName.split("/");
			let fileName = spt[spt.length - 1];
			fileName = fileName.substring(0, fileName.length - ".ts".length);

			return factory.createCallExpression(
				factory.createPropertyAccessExpression(
					factory.createIdentifier("__logger"),
					factory.createIdentifier(`_${logType}`),
				),
				expression.typeArguments,
				[
					factory.createStringLiteral(
						`\t - ${fileName}:${file.getLineAndCharacterOfPosition(expression.getStart()).line}`,
					),
					...expression.arguments,
				],
			);
		};
		const constructScope = (expression: ts.CallExpression): ts.Node => {
			needsImport = true;

			let parent = expression.parent;
			while (parent && !ts.isBlock(parent) && !ts.isSourceFile(parent)) {
				parent = parent.parent;
			}
			if (!parent) throw "what";
			if (!ts.isBlock(parent) && !ts.isSourceFile(parent)) throw "what";

			scopedBlocks.add(parent);

			return factory.createCallExpression(
				factory.createPropertyAccessExpression(
					factory.createIdentifier("__logger"),
					factory.createIdentifier(`beginScope`),
				),
				expression.typeArguments,
				expression.arguments,
			);
		};

		const visit = (node: ts.Node): ts.Node => {
			if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
				if (node.expression.text === "$trace") {
					return constructLog(node, "trace");
				}
				if (node.expression.text === "$debug") {
					return constructLog(node, "debug");
				}
				if (node.expression.text === "$log") {
					return constructLog(node, "info");
				}
				if (node.expression.text === "$warn") {
					return constructLog(node, "warn");
				}
				if (node.expression.text === "$err") {
					return constructLog(node, "err");
				}

				if (node.expression.text === "$beginScope") {
					return constructScope(node);
				}
			}

			return ts.visitEachChild(node, visit, context);
		};

		const addTryCatch = (statements: readonly ts.Statement[]): ts.TryStatement => {
			statements = [...statements];
			return factory.createTryStatement(
				factory.createBlock(statements),
				undefined,
				factory.createBlock([
					factory.createExpressionStatement(
						factory.createCallExpression(
							factory.createPropertyAccessExpression(
								factory.createIdentifier("__logger"),
								factory.createIdentifier(`endScope`),
							),
							undefined,
							undefined,
						),
					),
				]),
			);
		};

		const addEndScopes = (node: ts.Node): ts.Node => {
			if (ts.isBlock(node) || ts.isSourceFile(node)) {
				for (const child of node.statements) {
					if (
						ts.isExpressionStatement(child) &&
						ts.isCallExpression(child.expression) &&
						ts.isIdentifier(child.expression.expression) &&
						child.expression.expression.text === "$beginScope"
					) {
						needsImport = true;

						if (ts.isBlock(node)) {
							return addTryCatch((ts.visitEachChild(node, addEndScopes, context) as ts.Block).statements);
						} else if (ts.isSourceFile(node)) {
							if (true as boolean) throw "Logger scoping outside of blocks is not supported!";
							return factory.updateSourceFile(
								node,
								[addTryCatch(ts.visitEachChild(node, addEndScopes, context).statements)],
								node.isDeclarationFile,
								node.referencedFiles,
								node.typeReferenceDirectives,
								node.hasNoDefaultLib,
								node.libReferenceDirectives,
							);
						}
					}
				}
			}

			return ts.visitEachChild(node, addEndScopes, context);
		};

		file = addEndScopes(file) as ts.SourceFile;
		file = ts.visitEachChild(file, visit, context);
		if (needsImport) {
			file = factory.updateSourceFile(
				file,
				[
					factory.createImportDeclaration(
						undefined,
						factory.createImportClause(
							false,
							undefined,
							factory.createNamedImports([
								factory.createImportSpecifier(
									false,
									factory.createIdentifier("Logger"),
									factory.createIdentifier("__logger"),
								),
							]),
						),
						factory.createStringLiteral("engine/shared/Logger"),
					),
					...file.statements,
				],
				file.isDeclarationFile,
				file.referencedFiles,
				file.typeReferenceDirectives,
				file.hasNoDefaultLib,
				file.libReferenceDirectives,
			);
		}

		return file;
	};
	const transformInstanceTree = (file: ts.SourceFile): ts.SourceFile => {
		const walker = createInstanceTreeWalker(typeChecker, factory);

		function rewrite(node: ts.CallExpression): ts.Expression | undefined {
			if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
			if (!ts.isIdentifier(node.expression.name) || node.expression.name.text !== "instanceTree") return undefined;
			if (node.arguments.length !== 0) return undefined;
			if (!node.typeArguments || node.typeArguments.length === 0) return undefined;

			const type = typeChecker.getTypeFromTypeNode(node.typeArguments[0]);
			return walker.build(type, node, node.expression.expression, node.typeArguments[0].getText());
		}

		const visit = (node: ts.Node): ts.Node => {
			if (ts.isCallExpression(node)) {
				node = rewrite(node) ?? node;
			}

			return ts.visitEachChild(node, visit, context);
		};

		return ts.visitEachChild(file, visit, context);
	};
	const transformDI = (file: ts.SourceFile): ts.SourceFile => {
		const modifyParameters = (clazz: ts.ClassDeclaration): ts.ClassDeclaration => {
			if (!clazz.name) return clazz;

			const classParentOf = (clazz: ts.ClassDeclaration): ts.ClassDeclaration | undefined => {
				const extend = clazz.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]
					.expression;
				if (!extend) return;

				const t = typeChecker.getSymbolAtLocation(extend)?.declarations?.[0];
				if (!t || !ts.isClassDeclaration(t)) return;

				return t;
			};
			const isClassInjectable = (clazz: ts.ClassDeclaration): boolean => {
				if (
					clazz.modifiers?.find(
						(m) => ts.isDecorator(m) && ts.isIdentifier(m.expression) && m.expression.text === "injectable",
					)
				) {
					return true;
				}

				const parent = classParentOf(clazz);
				if (!parent) return false;

				return isClassInjectable(parent);
			};

			if (!isClassInjectable(clazz)) {
				return clazz;
			}

			type decl = {
				readonly name: ts.Identifier;
				readonly type: ts.TypeNode;
				readonly nullable: boolean;
				readonly isFunc: boolean;
			};
			let ctorAdded: decl[] = [];
			let propAdded: decl[] = [];
			let classsymb: ts.Symbol | undefined = undefined;
			let constr: ts.ConstructorDeclaration | undefined = undefined;

			if (!clazz.modifiers?.find((m) => m.kind === ts.SyntaxKind.AbstractKeyword)) {
				const getCtor = (clazz: ts.ClassDeclaration): ts.ConstructorDeclaration | undefined => {
					const ctor = clazz.members.find(ts.isConstructorDeclaration);
					if (ctor) return ctor;

					const parent = classParentOf(clazz);
					if (!parent) return;

					return getCtor(parent);
				};

				constr = getCtor(clazz);
				if (constr) {
					for (const parameter of constr.parameters) {
						if (!parameter.modifiers || parameter.modifiers.length === 0) {
							if (ctorAdded && ctorAdded.length !== 0) {
								throw "Can not have @inject declarations before non-inject ones";
							}

							continue;
						}

						for (const decorator of parameter.modifiers) {
							if (!ts.isDecorator(decorator)) continue;
							if (!ts.isIdentifier(decorator.expression)) continue;
							if (
								decorator.expression.text !== "inject" &&
								decorator.expression.text !== "tryInject" &&
								decorator.expression.text !== "injectFunc"
							)
								continue;
							if (!ts.isIdentifier(parameter.name)) continue;

							classsymb ??= program.getTypeChecker().getSymbolAtLocation(clazz.name);
							if (!classsymb) {
								throw `Could not find symbol for class ${clazz.name.text}`;
							}

							if (decorator.expression.text === "inject" || decorator.expression.text === "tryInject") {
								if (!parameter.type || !ts.isTypeReferenceNode(parameter.type)) continue;
								if (!ts.isIdentifier(parameter.type.typeName)) continue;

								ctorAdded ??= [];
								ctorAdded.push({
									name: parameter.name,
									type: parameter.type,
									nullable: decorator.expression.text === "tryInject",
									isFunc: false,
								});
							} else {
								if (!parameter.type || !ts.isFunctionTypeNode(parameter.type)) continue;

								ctorAdded ??= [];
								ctorAdded.push({
									name: parameter.name,
									type: parameter.type.type,
									nullable: false, // decorator.expression.text === 'tryInject',
									isFunc: true,
								});
							}
						}
					}
				}
			}
			for (const node of clazz.members) {
				if (ts.isPropertyDeclaration(node)) {
					const parameter = node;
					if (!parameter.modifiers) continue;

					for (const decorator of parameter.modifiers) {
						if (!ts.isDecorator(decorator)) continue;
						if (!ts.isIdentifier(decorator.expression)) continue;
						if (
							decorator.expression.text !== "inject" &&
							decorator.expression.text !== "tryInject" &&
							decorator.expression.text !== "injectFunc"
						)
							continue;
						if (!ts.isIdentifier(parameter.name)) continue;
						if (!parameter.type || !ts.isTypeReferenceNode(parameter.type)) continue;
						if (!ts.isIdentifier(parameter.type.typeName)) continue;

						classsymb ??= program.getTypeChecker().getSymbolAtLocation(clazz.name);
						if (!classsymb) {
							throw `Could not find symbol for class ${clazz.name.text}`;
						}

						propAdded ??= [];
						identifierByTypeNode(parameter.type);
						propAdded.push({
							name: parameter.name,
							type: parameter.type,
							nullable: decorator.expression.text === "tryInject",
							isFunc: decorator.expression.text === "injectFunc",
						});
					}
				}
			}

			const methods: ts.MethodDeclaration[] = [];
			if (ctorAdded.length !== 0 && !ctorAdded.find((a) => !identifierByTypeNode(a.type))) {
				const method: ts.MethodDeclaration = factory.createMethodDeclaration(
					[factory.createToken(ts.SyntaxKind.StaticKeyword)],
					undefined,
					factory.createIdentifier("_depsCreate"),
					undefined,
					clazz.typeParameters,
					[
						factory.createParameterDeclaration(
							undefined,
							undefined,
							factory.createIdentifier("_____instance"),
							undefined,
							factory.createTypeReferenceNode(factory.createIdentifier("unknown"), undefined),
							undefined,
						),
						factory.createParameterDeclaration(
							undefined,
							undefined,
							factory.createIdentifier("di"),
							undefined,
							factory.createTypeReferenceNode(factory.createIdentifier("DIContainer"), undefined),
							undefined,
						),
						...(
							constr?.parameters.filter(
								(p) => !ctorAdded.find((a) => a.name.text === (p.name as ts.Identifier).text),
							) ?? []
						).map((p) =>
							ts.factory.createParameterDeclaration(
								p.modifiers?.filter(
									(m) =>
										m.kind !== ts.SyntaxKind.PrivateKeyword &&
										m.kind !== ts.SyntaxKind.ReadonlyKeyword,
								),
								p.dotDotDotToken,
								p.name,
								p.questionToken,
								p.type,
								p.initializer,
							),
						),
					],
					factory.createTypeReferenceNode(
						factory.createIdentifier(clazz.name.text),
						clazz.typeParameters?.map(t => factory.createTypeReferenceNode(t.name)),
					),
					factory.createBlock(
						[
							factory.createReturnStatement(
								factory.createCallExpression(
									factory.createPropertyAccessExpression(
										factory.createParenthesizedExpression(
											factory.createAsExpression(
												factory.createAsExpression(
													factory.createIdentifier("_____instance"),
													factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
												),
												factory.createTypeLiteralNode([
													factory.createMethodSignature(
														undefined,
														factory.createIdentifier("constructor"),
														undefined,
														undefined,
														[
															factory.createParameterDeclaration(
																undefined,
																factory.createToken(ts.SyntaxKind.DotDotDotToken),
																factory.createIdentifier("args"),
																undefined,
																factory.createArrayTypeNode(
																	factory.createKeywordTypeNode(
																		ts.SyntaxKind.AnyKeyword,
																	),
																),
																undefined,
															),
														],
														factory.createTypeReferenceNode(
															factory.createIdentifier(clazz.name.text),
															clazz.typeParameters?.map(t => factory.createTypeReferenceNode(t.name)),
														),
													),
												]),
											),
										),
										factory.createIdentifier("constructor"),
									),
									undefined,
									[
										...(constr?.parameters
											.filter(
												(p) =>
													!ctorAdded.find(
														(a) => a.name.text === (p.name as ts.Identifier).text,
													),
											)
											.map((p) => p.name as ts.Identifier) ?? []),
										...ctorAdded.map((a) => {
											let resolve: ts.Expression = factory.createCallExpression(
												factory.createPropertyAccessExpression(
													factory.createIdentifier("di"),
													factory.createIdentifier(a.nullable ? "tryResolve" : "resolve"),
												),
												[a.type],
												[factory.createStringLiteral(identifierByTypeNode(a.type)!)],
											);

											if (a.isFunc) {
												resolve = factory.createArrowFunction(
													undefined,
													undefined,
													[],
													undefined,
													undefined,
													resolve,
												);
											}

											return resolve;
										}),
									],
								),
							),
						],
						true,
					),
				);
				methods.push(method);
			}
			if (propAdded.length !== 0 && !propAdded.find((a) => !identifierByTypeNode(a.type))) {
				const method: ts.MethodDeclaration = factory.createMethodDeclaration(
					undefined,
					undefined,
					factory.createIdentifier("_inject"),
					undefined,
					undefined,
					[
						factory.createParameterDeclaration(
							undefined,
							undefined,
							factory.createIdentifier("di"),
							undefined,
							factory.createTypeReferenceNode(factory.createIdentifier("DIContainer"), undefined),
							undefined,
						),
					],
					undefined,
					factory.createBlock(
						[
							...propAdded.map((p) => {
								return factory.createExpressionStatement(
									factory.createBinaryExpression(
										factory.createPropertyAccessExpression(
											factory.createAsExpression(
												factory.createThis(),
												factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
											),
											p.name,
										),
										factory.createToken(ts.SyntaxKind.EqualsToken),
										factory.createCallExpression(
											factory.createPropertyAccessExpression(
												factory.createIdentifier("di"),
												factory.createIdentifier(p.nullable ? "tryResolve" : "resolve"),
											),
											[p.type],
											[factory.createStringLiteral(identifierByTypeNode(p.type)!)],
										),
									),
								);
							}),
						],
						true,
					),
				);
				methods.push(method);
			}

			return ts.factory.createClassDeclaration(
				clazz.modifiers?.filter(
					(m) => !(ts.isDecorator(m) && ts.isIdentifier(m.expression) && m.expression.text === "injectable"),
				),
				clazz.name,
				clazz.typeParameters,
				clazz.heritageClauses,
				[
					...methods,
					...clazz.members.map((m) => {
						if (ts.isConstructorDeclaration(m)) {
							return ts.factory.createConstructorDeclaration(
								m.modifiers,
								m.parameters.map((p) =>
									ts.factory.createParameterDeclaration(
										p.modifiers?.filter(
											(m) =>
												!(
													ts.isDecorator(m) &&
													ts.isIdentifier(m.expression) &&
													(m.expression.text === "inject" ||
														m.expression.text === "injectFunc" ||
														m.expression.text === "tryInject")
												),
										),
										p.dotDotDotToken,
										p.name,
										p.questionToken,
										p.type,
										p.initializer,
									),
								),
								m.body,
							);
						}
						if (ts.isPropertyDeclaration(m)) {
							return ts.factory.createPropertyDeclaration(
								m.modifiers?.filter(
									(m) =>
										!(
											ts.isDecorator(m) &&
											ts.isIdentifier(m.expression) &&
											(m.expression.text === "inject" ||
												m.expression.text === "injectFunc" ||
												m.expression.text === "tryInject")
										),
								),
								m.name,
								m.questionToken ?? m.exclamationToken,
								m.type,
								m.initializer,
							);
						}

						return m;
					}),
				],
			);
		};

		const visit = (node: ts.Node): ts.Node => {
			if (ts.isClassDeclaration(node) && node.name) {
				node = modifyParameters(node);
			}

			return ts.visitEachChild(node, visit, context);
		};

		return ts.visitEachChild(file, visit, context);
	};
	const transformDIDecoratorPathOf = (file: ts.SourceFile): ts.SourceFile => {
		const modifyParameters = (call: ts.CallExpression): ts.CallExpression | undefined => {
			const methodType = typeChecker.getResolvedSignature(call);
			if (!methodType) return;
			const declaration = methodType.getDeclaration();
			if (!declaration) return;

			let paramIdx = -1;
			for (const parameter of declaration.parameters) {
				if (ts.isIdentifier(parameter.name) && parameter.name.text === "this") continue;
				paramIdx++;

				const decorators = ts.getDecorators(parameter);
				if (!decorators) continue;

				for (const decorator of decorators) {
					if (!ts.isCallExpression(decorator.expression)) continue;
					if (!ts.isIdentifier(decorator.expression.expression)) continue;

					if (decorator.expression.expression.text === "pathOf") {
						if (!declaration.typeParameters) continue;
						if (call.arguments.length > paramIdx) continue;

						const typeName = (decorator.expression.arguments[0] as ts.StringLiteral).text;
						const typeArgumentIndex = declaration.typeParameters.findIndex((p) => p.name.text === typeName);
						if (typeArgumentIndex < 0) continue;

						let type: ts.Type;
						if (call.typeArguments) {
							const typeNode = call.typeArguments[typeArgumentIndex];
							if (!typeNode) continue;

							type = typeChecker.getTypeFromTypeNode(typeNode);
						} else {
							const typeParameter = methodType.getTypeParameterAtPosition(typeArgumentIndex);
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							type = (typeParameter as any)?.mapper?.target ?? typeParameter;
						}

						const path = identifierByType(type);
						if (!path) continue;

						const args = [...(call.arguments ?? [])];
						args[paramIdx] = ts.factory.createStringLiteral(path);

						call = ts.factory.createCallExpression(call.expression, call.typeArguments, args);
					}
				}
			}

			return call;
		};

		const visit = (node: ts.Node): ts.Node => {
			if (ts.isCallExpression(node)) {
				node = modifyParameters(node) ?? node;
			}

			return ts.visitEachChild(node, visit, context);
		};

		return ts.visitEachChild(file, visit, context);
	};
	const transformDIConvertToResolveFunction = (file: ts.SourceFile): ts.SourceFile => {
		const createArrowFunction = (func: ts.Expression, types: readonly ts.Type[]): ts.ArrowFunction => {
			return factory.createArrowFunction(
				undefined,
				undefined,
				[
					factory.createParameterDeclaration(
						undefined,
						undefined,
						factory.createIdentifier("di"),
						undefined,
						factory.createTypeReferenceNode(factory.createIdentifier("DIContainer"), undefined),
						undefined,
					),
				],
				undefined,
				undefined,
				factory.createBlock(
					[
						factory.createVariableStatement(
							undefined,
							factory.createVariableDeclarationList(
								[
									factory.createVariableDeclaration(
										'_func',
										undefined,
										undefined,
										func,
									),
								],
								ts.NodeFlags.Const,
							),
						),
						factory.createReturnStatement(
							factory.createCallExpression(
								factory.createIdentifier('_func'),
								undefined,
								types.map((type) => {
									let resolve: ts.Expression = factory.createCallExpression(
										factory.createPropertyAccessExpression(
											factory.createIdentifier("di"),
											factory.createIdentifier(/*a.nullable*/ false ? "tryResolve" : "resolve"),
										),
										undefined,
										[factory.createStringLiteral(identifierByType(type)!)],
									);

									if (type.getCallSignatures().length !== 0) {
										resolve = factory.createArrowFunction(
											undefined,
											undefined,
											[],
											undefined,
											undefined,
											resolve,
										);
									}

									return resolve;
								}),
							),
						),
					],
					true,
				),
			);
		};

		const fixCall = (call: ts.CallExpression): ts.Expression | undefined => {
			if (!ts.isIdentifier(call.expression)) return;
			if (call.expression.text !== "$autoResolve") return;

			const methodType = typeChecker.getResolvedSignature(call);
			if (!methodType) return;

			const ret = methodType.getReturnType();
			const param = ret.getProperty("___convertToResolveFunctionArgs");
			if (!param) return;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const w = (param as any)?.links?.mapper?.target as ts.Symbol;
			if (!w?.members) return;

			const types: ts.Type[] = [];
			for (let i = 0; true; i++){
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const t = (w.members?.get(i.toString() as never) as any)?.links?.type as ts.Type | undefined;
				if (!t) break;

				types.push(t);
			}

			if (types.length === 0) return;
			return createArrowFunction(call.arguments[0], types);
		};
		const fixProperty = (call: ts.CallExpression): ts.Expression | undefined => {
			if (!ts.isPropertyAccessExpression(call.expression)) return;
			if (!ts.isIdentifier(call.expression.name)) return;
			if (call.expression.name.text !== "$onInjectAuto") return;
			
			const methodType = typeChecker.getResolvedSignature(call);
			if (!methodType) return;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const w = (methodType as any).mapper?.target as ts.Symbol;
			if (!w?.members) return;

			const types: ts.Type[] = [];
			for (let i = 0; true; i++){
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const t = (w.members?.get(i.toString() as never) as any)?.links?.type as ts.Type | undefined;
				if (!t) break;

				types.push(t);
			}

			if (types.length === 0) return;

			return factory.createCallExpression(
				factory.createPropertyAccessExpression(
					call.expression.expression,
					"onInject",
				),
				undefined,
				[ createArrowFunction(call.arguments[0], types) ],
			)
		};

		const visit = (node: ts.Node): ts.Node => {
			if (ts.isCallExpression(node)) {
				node = fixCall(node) ?? fixProperty(node) ?? node;
			}

			return ts.visitEachChild(node, visit, context);
		};

		return ts.visitEachChild(file, visit, context);
	};

	return (file: ts.SourceFile): ts.SourceFile => {
		file = transformNamespaces(file);
		file = transformLogs(file);
		file = transformInstanceTree(file);
		file = transformDI(file);
		file = transformDIDecoratorPathOf(file);
		file = transformDIConvertToResolveFunction(file);

		return file;
	};
};

export default function (program: ts.Program) {
	return (context: ts.TransformationContext) => create(program, context);
}
