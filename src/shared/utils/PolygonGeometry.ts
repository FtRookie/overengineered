const epsilon = 1e-8;

const cross2 = (o: Vector2, a: Vector2, b: Vector2) => (a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X);

/** Even-odd crossing test */
const isInside = (coords: readonly Vector2[], p: Vector2): boolean => {
	let inside = false;
	for (let i = 0; i < coords.size(); i++) {
		const a = coords[i];
		const b = coords[(i + coords.size() - 1) % coords.size()];
		if (a.Y > p.Y !== b.Y > p.Y && p.X < ((b.X - a.X) * (p.Y - a.Y)) / (b.Y - a.Y) + a.X) inside = !inside;
	}

	return inside;
};

/** Sorted, with values closer than `tolerance` merged into the first of them */
const distinct = (values: readonly number[], tolerance: number): number[] => {
	const result: number[] = [];
	for (const value of [...values].sort((l, r) => l < r)) {
		if (result.isEmpty() || value - result[result.size() - 1] > tolerance) result.push(value);
	}

	return result;
};

type Rectangle = { readonly min: Vector2; readonly max: Vector2 };

/**
 * Cuts the outline into strips across one axis at every corner, keeps the cells inside it, and joins each strip's
 * spans onto identical spans of the strip before. `swap` cuts across the other axis instead.
 */
const stripRectangles = (coords: readonly Vector2[], tolerance: number, swap: boolean): Rectangle[] => {
	const across = (c: Vector2) => (swap ? c.Y : c.X);
	const along = (c: Vector2) => (swap ? c.X : c.Y);
	const point = (a: number, b: number) => (swap ? new Vector2(b, a) : new Vector2(a, b));

	const cuts = distinct(coords.map(across), tolerance);
	const levels = distinct(coords.map(along), tolerance);

	const rectangles: Rectangle[] = [];
	type Open = { readonly from: number; readonly low: number; readonly high: number };
	let open = new Map<string, Open>();

	const close = (span: Open, to: number) =>
		rectangles.push({ min: point(span.from, levels[span.low]), max: point(to, levels[span.high]) });

	for (let i = 0; i < cuts.size() - 1; i++) {
		const middle = (cuts[i] + cuts[i + 1]) / 2;
		const nextOpen = new Map<string, Open>();

		let low: number | undefined;
		for (let j = 0; j < levels.size() - 1; j++) {
			const covered = isInside(coords, point(middle, (levels[j] + levels[j + 1]) / 2));
			if (covered && low === undefined) low = j;

			const endsHere = low !== undefined && (!covered || j + 2 === levels.size());
			if (!endsHere) continue;

			const high = covered ? j + 1 : j;
			const key = `${low}:${high}`;
			nextOpen.set(key, open.get(key) ?? { from: cuts[i], low: low!, high });
			open.delete(key);
			low = undefined;
		}

		for (const [, span] of open) close(span, cuts[i]);
		open = nextOpen;
	}
	for (const [, span] of open) close(span, cuts[cuts.size() - 1]);

	return rectangles;
};

export namespace PolygonGeometry {
	/**
	 * Splits an outline whose edges all run along the axes into rectangles, cutting across whichever axis gives
	 * fewer. Undefined when an edge is slanted.
	 */
	export function rectangles(coords: readonly Vector2[], tolerance = 1e-3): Rectangle[] | undefined {
		for (let i = 0; i < coords.size(); i++) {
			const edge = coords[(i + 1) % coords.size()].sub(coords[i]);
			if (math.abs(edge.X) > tolerance && math.abs(edge.Y) > tolerance) return;
		}

		const byColumns = stripRectangles(coords, tolerance, false);
		const byRows = stripRectangles(coords, tolerance, true);
		return byRows.size() < byColumns.size() ? byRows : byColumns;
	}

	/**
	 * Split a simple polygon into triangles by cutting off "ears": corners whose triangle with both neighbours lies
	 * inside the outline. Works for concave outlines; undefined for self-intersecting or zero-area ones.
	 * Returns index triples into `coords`, each wound counter-clockwise.
	 */
	export function earClip(coords: readonly Vector2[]): [number, number, number][] | undefined {
		let area = 0;
		for (let i = 0; i < coords.size(); i++) {
			const a = coords[i];
			const b = coords[(i + 1) % coords.size()];
			area += a.X * b.Y - b.X * a.Y;
		}
		if (math.abs(area) < epsilon) return;

		// counter-clockwise order, so a convex corner has a positive cross product
		const remaining = coords.map((_, i) => (area > 0 ? i : coords.size() - 1 - i));
		const triangles: [number, number, number][] = [];

		while (remaining.size() > 3) {
			const count = remaining.size();
			let clipped = false;

			for (let k = 0; k < count; k++) {
				const i0 = remaining[(k + count - 1) % count];
				const i1 = remaining[k];
				const i2 = remaining[(k + 1) % count];
				const [a, b, c] = [coords[i0], coords[i1], coords[i2]];
				if (cross2(a, b, c) <= epsilon) continue;

				const containsOther = remaining.any(
					(j) =>
						j !== i0 &&
						j !== i1 &&
						j !== i2 &&
						cross2(a, b, coords[j]) >= 0 &&
						cross2(b, c, coords[j]) >= 0 &&
						cross2(c, a, coords[j]) >= 0,
				);
				if (containsOther) continue;

				triangles.push([i0, i1, i2]);
				remaining.remove(k);
				clipped = true;
				break;
			}

			if (!clipped) return;
		}

		triangles.push([remaining[0], remaining[1], remaining[2]]);
		return triangles;
	}
}
