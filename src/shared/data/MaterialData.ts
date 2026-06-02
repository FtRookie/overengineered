type MaterialEntry = {
	// Physics overrides, consumed by SharedBuilding (sparse — only set where a material needs them)
	readonly Density?: number;
	readonly Elasticity?: number;
	readonly ElasticityWeight?: number;
	readonly Friction?: number;
	readonly FrictionWeight?: number;
	// Heat system
	/** Red-shift the block color as it heats up */
	readonly heatGlow?: boolean;
	/** Heat lost per second (higher = cools faster)
	- Do not use fractions. 
	*/
	readonly thermalConductivity?: number;
	/** Per-tick chance to ignite once heat exceeds thermal mass
	 * - Fractions reccomended for low probabilities
	 */
	readonly ignitionChance?: number;
};
type MaterialTable = { readonly Default: MaterialEntry } & {
	readonly [k in Enum.Material["Name"]]?: MaterialEntry;
};

const GenericStone: MaterialEntry = {
	heatGlow: true,
	thermalConductivity: 0.09,
	ignitionChance: 1 / 100,
};

export namespace MaterialData {
	export const Properties: MaterialTable = {
		Default: {
			heatGlow: false,
			thermalConductivity: 0.05,
			ignitionChance: 0.3,
		},
		// Special
		...{
			ForceField: {
				thermalConductivity: math.huge,
				ignitionChance: 0,
			},
			Neon: {
				thermalConductivity: 1,
				ignitionChance: 0,
			},
			Glass: {
				heatGlow: true,
				thermalConductivity: 0.05,
				ignitionChance: 1 / 1000,
			},
		},
		// Organic
		...{
			Wood: {
				thermalConductivity: 0.02,
				ignitionChance: 1.0,
			},
			WoodPlanks: {
				thermalConductivity: 0.02,
				ignitionChance: 1.0,
			},
			RoofShingles: {
				thermalConductivity: 0.02,
				ignitionChance: 0.05,
			},
			Cardboard: {
				thermalConductivity: 0.001,
				ignitionChance: 1.0,
			},
			Fabric: {
				thermalConductivity: 0.03,
				ignitionChance: 1.0,
			},
			Leather: {
				thermalConductivity: 0.05,
				ignitionChance: 0.4,
			},
		},
		// Polymers
		...{
			Carpet: {
				thermalConductivity: 0.01,
				ignitionChance: 0.9,
			},
			Rubber: {
				thermalConductivity: 0.03,
				ignitionChance: 0.5,
			},
			Plastic: {
				thermalConductivity: 0.01,
				ignitionChance: 0.6,
			},
			SmoothPlastic: {
				thermalConductivity: 0.01,
				ignitionChance: 0.6,
			},
		},
		// Metals
		...{
			Metal: {
				heatGlow: true,
				thermalConductivity: 0.12,
				ignitionChance: 1 / 800,
			},
			DiamondPlate: {
				heatGlow: true,
				thermalConductivity: 0.15,
				ignitionChance: 1 / 1000,
			},
			CorrodedMetal: {
				heatGlow: true,
				thermalConductivity: 0.1,
				ignitionChance: 1 / 600,
			},
			Foil: {
				heatGlow: true,
				thermalConductivity: 0.25,
				ignitionChance: 1 / 250,
			},
		},
		// Masonry / Stone
		...{
			Asphalt: GenericStone,
			Basalt: GenericStone,
			Brick: GenericStone,
			CeramicTiles: GenericStone,
			ClayRoofTiles: GenericStone,
			Cobblestone: GenericStone,
			Concrete: GenericStone,
			CrackedLava: { ...GenericStone, ignitionChance: 0 },
			Granite: GenericStone,
			Limestone: GenericStone,
			Marble: GenericStone,
			Pavement: GenericStone,
			Pebble: GenericStone,
			Plaster: GenericStone, // Surprisingly not flammable
			Rock: GenericStone,
			Salt: GenericStone,
			Sandstone: GenericStone,
			Slate: GenericStone,
		},
		// Earth / Terrain
		...{
			Grass: {
				thermalConductivity: 0.01,
				ignitionChance: 0.02,
			},
			LeafyGrass: {
				thermalConductivity: 0.01,
				ignitionChance: 0.1,
			},
			Ground: {
				thermalConductivity: 0.01,
				ignitionChance: 0.02,
			},
			Mud: {
				thermalConductivity: 0.01,
				ignitionChance: 0,
			},
			Sand: {
				heatGlow: true,
				thermalConductivity: 0.1,
				ignitionChance: 0,
			},
		},
		// Ice / Cold
		...{
			Ice: {
				Friction: 0.02,
				FrictionWeight: 50,
				thermalConductivity: 1,
				ignitionChance: 0,
			},
			Glacier: {
				Friction: 0.02,
				FrictionWeight: 50,
				thermalConductivity: 1,
				ignitionChance: 0,
			},
			Snow: {
				thermalConductivity: 1,
				ignitionChance: 1 / 2000,
			},
		},
	} as const;
}
