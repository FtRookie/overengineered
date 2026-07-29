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
}
