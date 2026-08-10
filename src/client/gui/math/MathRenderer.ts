import { MathExpression } from "client/gui/math/MathExpression";
import { Strings } from "engine/shared/fixes/String.propmacro";

/**
 * Draws a parsed expression as math notation, out of four cloned templates composed with UIListLayout and
 * AutomaticSize. The engine measures everything; nothing here reads a text size or a baseline, so children of a
 * row share a centre line rather than a true baseline — close enough at a glance, and free.
 */
export namespace MathRenderer {
	export type Templates = {
		/** Horizontal run, children centred. */
		readonly row: () => Frame;
		/** Vertical stack, children centred — fractions, radicals and the limits of a big operator. */
		readonly stack: () => Frame;
		readonly glyph: () => TextLabel;
		/** Full-width 2px bar: a fraction bar or a radical's overbar. */
		readonly rule: () => Frame;
	};

	/** Names that read better as a symbol than as letters. */
	const symbols: { readonly [name: string]: string } = {
		pi: "π",
		tau: "τ",
		inf: "∞",
		huge: "∞",
		alpha: "α",
		beta: "β",
		gamma: "γ",
		delta: "δ",
		theta: "θ",
		lambda: "λ",
		sigma: "σ",
		omega: "ω",
		phi: "φ",
	};

	const operatorSymbols: { readonly [op: string]: string } = {
		"*": "·",
		"/": "/",
		"//": "÷",
		"<=": "≤",
		">=": "≥",
		"~=": "≠",
		"==": "=",
		"..": "⁀",
	};

	/** Drawn upright, the way a function name is set rather than a variable. */
	const functionNames = new Set([
		"sin",
		"cos",
		"tan",
		"asin",
		"acos",
		"atan",
		"log",
		"log10",
		"exp",
		"floor",
		"ceil",
		"round",
		"min",
		"max",
		"sign",
		"clamp",
		"fmod",
		"deg",
		"rad",
	]);

	/** How much smaller each level of superscript is, and how far it rides above the centre line. */
	const scriptScale = 0.7;
	const scriptRise = 0.55;
	/** Nesting shrinks, but only so far — past this a deep stack stops being readable at all. */
	const minScale = 0.4;

	/**
	 * A bar and the stack it should span. The bar cannot simply be `Size` scale 1: that asks for the full width
	 * of a parent which is itself sizing to fit its children, and the two ratchet each other outwards. It is
	 * built with no width at all — contributing nothing to the stack's measurement — and given one afterwards.
	 */
	export type Bar = {
		readonly bar: Frame;
		readonly of: GuiObject;
	};

	type Ctx = {
		readonly templates: Templates;
		/** Text size at this level; scripts render a level down. */
		readonly size: number;
		/** The base, so nesting shrinks against the original rather than compounding past {@link minScale}. */
		readonly base: number;
		/** How many fractions deep. The outermost keeps full size; anything inside one is set smaller. */
		readonly depth: number;
		readonly bars: Bar[];
	};

	function rule(ctx: Ctx): Frame {
		const bar = ctx.templates.rule();
		bar.Size = UDim2.fromOffset(0, bar.Size.Y.Offset);

		return bar;
	}

	function glyph(ctx: Ctx, text: string, italic = false): TextLabel {
		const label = ctx.templates.glyph();
		label.Text = text;
		// per level, so a superscript comes out smaller than its base; the template carries the base size
		label.TextSize = ctx.size;
		label.FontFace = new Font(
			label.FontFace.Family,
			label.FontFace.Weight,
			italic ? Enum.FontStyle.Italic : Enum.FontStyle.Normal,
		);

		return label;
	}

	function row(ctx: Ctx, children: readonly GuiObject[]): Frame {
		const frame = ctx.templates.row();
		for (let i = 0; i < children.size(); i++) {
			children[i].LayoutOrder = i;
			children[i].Parent = frame;
		}

		return frame;
	}

	function stack(ctx: Ctx, children: readonly GuiObject[]): Frame {
		const frame = ctx.templates.stack();
		for (let i = 0; i < children.size(); i++) {
			children[i].LayoutOrder = i;
			children[i].Parent = frame;
		}

		return frame;
	}

	/** Raises `child` above the centre line by padding beneath it, so its own height carries it up. */
	function raised(ctx: Ctx, child: GuiObject): Frame {
		const frame = ctx.templates.row();
		child.LayoutOrder = 0;
		child.Parent = frame;

		const padding = new Instance("UIPadding");
		padding.PaddingBottom = new UDim(0, math.round(ctx.size * scriptRise));
		padding.Parent = frame;

		return frame;
	}

	/**
	 * Whether a child of `parentOp` has to be bracketed. Source grouping is not kept, so this is derived purely
	 * from precedence — which is what drops the parentheses a fraction or a radical already implies.
	 */
	function needsParens(child: MathExpression.Node, parentOp: string, side: "left" | "right"): boolean {
		const parent = MathExpression.precedenceOf(parentOp);

		if (child.kind === "unary") {
			// only where the parent binds tighter than the sign does, which is exponentiation alone: drawn
			// bare, `(-a)^2` would read back as `-(a^2)`
			return side === "left" && parent !== undefined && parent.left > MathExpression.unaryPrecedence;
		}
		if (child.kind !== "binary") return false;

		const inner = MathExpression.precedenceOf(child.op);
		if (parent === undefined || inner === undefined) return false;

		if (inner.left < parent.left) return true;
		if (inner.left > parent.left) return false;

		// equal binding: whichever side the operator does not associate towards has to be bracketed
		return side === "right" ? parent.right > parent.left : parent.right === parent.left;
	}

	function bracketed(ctx: Ctx, node: MathExpression.Node): GuiObject {
		return row(ctx, [glyph(ctx, "("), render(ctx, node), glyph(ctx, ")")]);
	}

	function operand(ctx: Ctx, node: MathExpression.Node, parentOp: string, side: "left" | "right"): GuiObject {
		return needsParens(node, parentOp, side) ? bracketed(ctx, node) : render(ctx, node);
	}

	/** `√` followed by the operand under an overbar. */
	function radical(ctx: Ctx, inner: MathExpression.Node): GuiObject {
		const bar = rule(ctx);
		const over = stack(ctx, [bar, render(ctx, inner)]);
		ctx.bars.push({ bar, of: over });

		return row(ctx, [glyph(ctx, "√"), over]);
	}

	/** Σ or Π carrying `index = from` beneath and `to` above, with the term to its right. */
	function series(
		ctx: Ctx,
		sign: string,
		term: MathExpression.Node,
		from: MathExpression.Node,
		to: MathExpression.Node,
	): GuiObject {
		const small: Ctx = { ...ctx, size: math.round(ctx.size * scriptScale) };
		const index = term.kind === "function" ? term.params[0] : undefined;

		const lower =
			index === undefined
				? render(small, from)
				: row(small, [glyph(small, index, true), glyph(small, "="), render(small, from)]);

		const operator = stack(ctx, [render(small, to), glyph(ctx, sign), lower]);
		const body = term.kind === "function" ? render(ctx, term.body) : render(ctx, term);

		return row(ctx, [operator, body]);
	}

	function call(ctx: Ctx, node: MathExpression.Node & { readonly kind: "call" }): GuiObject {
		const args = node.args;

		if (node.callee === "sqrt" && args.size() === 1) return radical(ctx, args[0]);
		if (node.callee === "abs" && args.size() === 1) {
			return row(ctx, [glyph(ctx, "|"), render(ctx, args[0]), glyph(ctx, "|")]);
		}
		if ((node.callee === "sum" || node.callee === "prod") && args.size() === 3) {
			return series(ctx, node.callee === "sum" ? "Σ" : "Π", args[0], args[1], args[2]);
		}

		const children: GuiObject[] = [glyph(ctx, node.callee, !functionNames.has(node.callee)), glyph(ctx, "(")];
		for (let i = 0; i < args.size(); i++) {
			if (i !== 0) children.push(glyph(ctx, ", "));
			children.push(render(ctx, args[i]));
		}
		children.push(glyph(ctx, ")"));

		return row(ctx, children);
	}

	function render(ctx: Ctx, node: MathExpression.Node): GuiObject {
		if (node.kind === "number") {
			return glyph(ctx, Strings.prettyNumber(node.value, 0.0001));
		}
		if (node.kind === "name") {
			return glyph(ctx, symbols[node.text] ?? node.text, true);
		}
		if (node.kind === "unary") {
			// bracketed only where the operand binds looser than the sign: `-a^2` needs none, `-(a+b)` does
			const inner = MathExpression.precedenceOf(node.operand.kind === "binary" ? node.operand.op : "");
			const loose = inner !== undefined && inner.left < MathExpression.unaryPrecedence;

			return row(ctx, [
				glyph(ctx, node.op === "not" ? "¬" : node.op),
				loose ? bracketed(ctx, node.operand) : render(ctx, node.operand),
			]);
		}
		if (node.kind === "call") {
			return call(ctx, node);
		}
		if (node.kind === "function") {
			// only reached when a literal is not the term of a series; there is no notation for it, so it is
			// drawn as what it is
			const params = node.params.join(", ");
			return row(ctx, [glyph(ctx, `(${params}) ↦ `), render(ctx, node.body)]);
		}

		// binary
		if (node.op === "/") {
			// a fraction inside a fraction is set smaller, which is both the convention and the only thing
			// telling `a/(b/c)` apart from `(a/b)/c` — drawn at one size the two stacks are identical
			const shrunk = ctx.depth === 0 ? ctx.size : math.round(ctx.size * scriptScale);
			const parts: Ctx = {
				...ctx,
				depth: ctx.depth + 1,
				size: math.max(shrunk, math.round(ctx.base * minScale)),
			};

			const bar = rule(ctx);
			const fraction = stack(ctx, [render(parts, node.left), bar, render(parts, node.right)]);
			ctx.bars.push({ bar, of: fraction });

			return fraction;
		}
		if (node.op === "^") {
			const small: Ctx = { ...ctx, size: math.round(ctx.size * scriptScale) };
			return row(ctx, [operand(ctx, node.left, node.op, "left"), raised(ctx, render(small, node.right))]);
		}

		const symbol = operatorSymbols[node.op] ?? node.op;
		return row(ctx, [
			operand(ctx, node.left, node.op, "left"),
			glyph(ctx, ` ${symbol} `),
			operand(ctx, node.right, node.op, "right"),
		]);
	}

	/**
	 * Builds the tree for `node`. The caller owns the result and is responsible for destroying it, and must
	 * give every returned bar a width once the layout has settled — see {@link Bar}.
	 */
	export function build(
		templates: Templates,
		node: MathExpression.Node,
		textSize: number,
	): { readonly root: GuiObject; readonly bars: readonly Bar[] } {
		const bars: Bar[] = [];
		return { root: render({ templates, size: textSize, base: textSize, depth: 0, bars }, node), bars };
	}
}
