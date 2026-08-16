export namespace FunctionEnvironment {
	// limit size of series otherwise it will hang
	const seriesLimit = 10_000;
	const checkSeriesRange = (from: number, to: number) => {
		const count = math.floor(to - from) + 1;
		if (count > seriesLimit) {
			error(`Series of ${count} terms exceeds the limit of ${seriesLimit}`, 2);
		}
	};

	const sum = (term: (index: number) => number, from: number, to: number): number => {
		checkSeriesRange(from, to);

		let total = 0;
		for (let i = from; i <= to; i++) {
			total += term(i);
		}

		return total;
	};
	const prod = (term: (index: number) => number, from: number, to: number): number => {
		checkSeriesRange(from, to);

		let total = 1;
		for (let i = from; i <= to; i++) {
			total *= term(i);
		}

		return total;
	};

	// Simpson's rule: the term is sampled rather than iterated, so the step count is what bounds the work,
	// not the range. Even intervals are required, so an odd request is rounded up.
	const integral = (term: (x: number) => number, from: number, to: number, steps?: number): number => {
		const requested = math.floor(steps ?? 100);
		if (requested > seriesLimit) {
			error(`Integral of ${requested} steps exceeds the limit of ${seriesLimit}`, 2);
		}

		let intervals = math.max(2, requested);
		if (intervals % 2 !== 0) intervals += 1;

		const dx = (to - from) / intervals;
		let total = term(from) + term(to);
		for (let i = 1; i < intervals; i++) {
			total += term(from + i * dx) * (i % 2 === 0 ? 2 : 4);
		}

		return (total * dx) / 3;
	};

	export const baseEnv = { ...math, sum, prod, integral };
	delete (baseEnv as Partial<typeof baseEnv>).randomseed;

	export const createSafeEnv = () =>
		setmetatable(
			{},
			{
				__index: baseEnv as never,
				__newindex: (t, key, value) => {
					if (baseEnv[key as never] !== undefined) {
						error("Attempt to overwrite protected key: " + tostring(key), 2);
					}
					rawset(t, key, value);
				},
			},
		);
}
