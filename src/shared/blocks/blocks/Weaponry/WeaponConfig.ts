export namespace WeaponConfig {
	const laserEmitter = 50;
	const plasmaGun = 100;
	const mgLoader = 100;
	const cannon = 150;

	/** Per-machine placement caps. Derived values keep the original ratios (barrel = gun ×15, lens = emitter ×10). */
	export const limits = {
		cannon,
		cannonBarrels: cannon * 10,
		laserEmitter,
		laserLens: laserEmitter * 5,
		plasmaGun, // Muzzles are automatically the same limit
		plasmaGunBarrel: plasmaGun * 10,
		mgLoader,
		mgBarrels: mgLoader * 15,
		mgAmmo: mgLoader * 4,
		armoredMgBarrels: mgLoader * 5,
	};

	/**
	 * Cannon blast per calibre. A shell's damage is entirely its explosion — the impact itself is never
	 * scored — so these are the whole of a cannon's output.
	 *
	 * fixme: all three are the same placeholder, carried over from the single hardcoded pair that used to
	 * live in ShellProjectileLogic. Split out so light/medium/heavy can be tuned apart; until they are, a
	 * heavy shell hits exactly as hard as a light one.
	 */
	export const cannonBlast = {
		light: { radius: 8, pressure: 1200 },
		medium: { radius: 8, pressure: 1200 },
		heavy: { radius: 8, pressure: 1200 },
	} as const;

	type Blast = { readonly radius: number; readonly pressure: number };

	const strongest = { radius: 0, pressure: 0 };
	for (const [, blast] of pairs(cannonBlast)) {
		strongest.radius = math.max(strongest.radius, blast.radius);
		strongest.pressure = math.max(strongest.pressure, blast.pressure);
	}

	// NaN slips past math.clamp, so it falls back instead
	const clampPart = (value: unknown, max: number, fallback: number) =>
		typeIs(value, "number") && value === value ? math.clamp(value, 0, max) : fallback;

	/** A blast whose size a client chose: cut down to the strongest real calibre */
	export function clampBlast(blast: unknown, fallback: Blast): Blast {
		if (!typeIs(blast, "table")) return fallback;

		const { radius, pressure } = blast as { readonly radius?: unknown; readonly pressure?: unknown };
		return {
			radius: clampPart(radius, strongest.radius, fallback.radius),
			pressure: clampPart(pressure, strongest.pressure, fallback.pressure),
		};
	}
}
