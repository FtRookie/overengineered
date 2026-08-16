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

	export const baseEnv = { ...math, sum, prod };
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
