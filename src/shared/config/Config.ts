export namespace Config {
	export function addDefaults<TKeys extends keyof TDef & string, TDef extends UnknownConfigDefinitions>(
		config: Partial<ConfigDefinitionsToConfig<TKeys, TDef>> | undefined,
		definition: TDef,
	): ConfigDefinitionsToConfig<TKeys, TDef> {
		config ??= {};

		for (const [key, def] of pairs(definition)) {
			if (typeIs(config[key], "table") || typeIs(def.config, "table")) {
				if (
					config[key] !== undefined &&
					def.config !== undefined &&
					typeOf(config[key]) !== typeOf(def.config)
				) {
					config[key] = def.config;
				} else if (
					(config[key] === undefined || typeIs(config[key], "table")) &&
					(def.config === undefined || typeIs(def.config, "table"))
				) {
					config[key] = {
						...((def.config as object) ?? {}),
						...(config[key] ?? {}),
					} as (typeof config)[typeof key];
				}

				if (typeIs(config[key], "table") && typeIs(def.config, "table")) {
					for (const [k, v] of pairs(config[key]!)) {
						if (!typeIs(v, "table")) continue;
						if (
							typeIs(def.config, "table") &&
							!typeIs((def.config as never as Record<keyof TDef, unknown>)[k], "table")
						) {
							continue;
						}

						config[key]![k] = {
							...((def.config as object)[k as keyof typeof def.config] as object),
							...(v ?? {}),
						};
					}
				}
			} else {
				config[key] ??= def.config;
			}
		}

		return config as ConfigDefinitionsToConfig<TKeys, TDef>;
	}

	/** Drops any value stored where the definition holds a table: readers index straight into those, so a scalar there throws */
	export function stripMisplacedScalars<T extends object, TDef extends UnknownConfigDefinitions>(
		config: T,
		definition: TDef,
	): T {
		const strip = (value: unknown, def: unknown): unknown => {
			if (!typeIs(def, "table")) return value;
			if (!typeIs(value, "table")) return undefined;

			const result: { [k in string]: unknown } = { ...(value as object) };
			for (const [k, d] of pairs(def as { [k in string]: unknown })) {
				if (result[k] !== undefined) result[k] = strip(result[k], d);
			}

			return result;
		};

		const result: { [k in string]: unknown } = { ...(config as object) };
		for (const [key, def] of pairs(definition)) {
			if (result[key as string] !== undefined) result[key as string] = strip(result[key as string], def.config);
		}

		return result as T;
	}
}
