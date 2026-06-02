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
}
