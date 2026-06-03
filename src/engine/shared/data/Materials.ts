import { Workspace } from "@rbxts/services";
import { Colors } from "engine/shared/Colors";
import { Objects } from "engine/shared/fixes/Objects";

type MaterialEntry = {
	readonly id: string;
	// Physics overrides, consumed by SharedBuilding (sparse — only set where a material needs them)
	readonly Density?: number;
	readonly Elasticity?: number;
	readonly ElasticityWeight?: number;
	readonly Friction?: number;
	readonly FrictionWeight?: number;
	/** Heat system properties */
	readonly thermalProperties?: {
		/** Red-shift the block color as it heats up */
		readonly heatGlow?: boolean;
		/** Applies neon material at max heat, only used if heatGlow is true */
		readonly neonGlow?: boolean;
		/** Heat lost per second (higher = cools faster)
		- Do not use fractions.
		*/
		readonly conductivity?: number;
		/** Per-tick chance to ignite once heat exceeds thermal mass
		 * - Fractions reccomended for low probabilities
		 */
		readonly ignitionChance?: number;
		/** Resistance to heat damage -> damage * (1-this) */
		readonly thermalResilience?: number;
	};
};
type MaterialTable = { readonly Default: MaterialEntry } & {
	readonly [k in Enum.Material["Name"]]?: MaterialEntry;
};

export namespace Materials {
	const materialNames: { readonly [k in Enum.Material["Name"]]?: string } = {
		RoofShingles: "Roof Shingles",
		DiamondPlate: "Diamond Plate",
		WoodPlanks: "Wood Planks",
		CorrodedMetal: "Corroded Metal",
		Asphalt: undefined,
		Basalt: undefined,
		Cardboard: undefined,
		Rubber: undefined,
		Brick: undefined,
		Cobblestone: undefined,
		Concrete: undefined,
		Fabric: undefined,
		Glass: undefined,
		Granite: undefined,
		Grass: undefined,
		Ice: undefined,
		Marble: undefined,
		Metal: undefined,
		Pebble: undefined,
		Plastic: undefined,
		Sand: undefined,
		Slate: undefined,
		Wood: undefined,
	};
	export function getMaterialDisplayName(material: Enum.Material): string {
		return materialNames[material.Name] ?? material.Name;
	}

	export function getMaterialTexture(material: Enum.Material): string | undefined {
		return Properties[material.Name]?.id;
	}
	export function getMaterialTextureAssetId(material: Enum.Material): string {
		const m = getMaterialTexture(material);
		if (!m) return "";

		return `rbxassetid://${m}`;
	}

	export function getMaterialDefaultColor(material: Enum.Material): Color3 {
		try {
			return Workspace.Terrain!.GetMaterialColor(material);
		} catch {
			return Colors.white;
		}
	}

	// was stone generic
	const GenericWithID = (id: string): MaterialEntry => ({
		id,
		thermalProperties: {
			heatGlow: true,
			conductivity: 0.09,
			ignitionChance: 1 / 300,
			thermalResilience: 0.5,
		},
	});

	export const Properties: MaterialTable = {
		Default: {
			id: "",
			thermalProperties: {
				heatGlow: false,
				neonGlow: false,
				conductivity: 0.05,
				ignitionChance: 0.3,
				thermalResilience: 0.3,
			},
		},
		// Special
		...{
			ForceField: {
				id: "",
				thermalProperties: {
					conductivity: math.huge,
					ignitionChance: 0,
					thermalResilience: 1,
				},
			},
			Neon: {
				id: "",
				thermalProperties: { conductivity: 1, ignitionChance: 0 },
			},
			Glass: {
				id: "9438868521",
				thermalProperties: {
					heatGlow: true,
					conductivity: 0.05,
					ignitionChance: 1 / 300,
					thermalResilience: 0.3, // Transparency is 0.3
				},
			},
		},
		// Organic
		...{
			Wood: {
				id: "9920625290",
				thermalProperties: {
					conductivity: 0.02,
					ignitionChance: 1.0,
				},
			},
			WoodPlanks: {
				id: "9920626778",
				thermalProperties: {
					conductivity: 0.02,
					ignitionChance: 1.0,
				},
			},
			RoofShingles: {
				id: "119722544879522",
				thermalProperties: {
					conductivity: 0.02,
					ignitionChance: 0.05,
				},
			},
			Cardboard: {
				id: "14108651729",
				thermalProperties: {
					conductivity: 0.001,
					ignitionChance: 1.0,
					thermalResilience: 0.5,
				},
			},
			Fabric: {
				id: "9920517696",
				thermalProperties: {
					conductivity: 0.03,
					ignitionChance: 1.0,
				},
			},
			Leather: {
				id: "14108670073",
				thermalProperties: {
					conductivity: 0.05,
					ignitionChance: 0.4,
				},
			},
		},
		// Polymers
		...{
			Carpet: {
				id: "14108662587",
				thermalProperties: {
					conductivity: 0.01,
					ignitionChance: 0.9,
				},
			},
			Rubber: {
				id: "14108673018",
				thermalProperties: {
					conductivity: 0.03,
					ignitionChance: 0.5,
				},
			},
			Plastic: {
				id: "",
				thermalProperties: { conductivity: 0.01, ignitionChance: 0.6 },
			},
			SmoothPlastic: {
				id: "",
				thermalProperties: {
					conductivity: 0.01,
					ignitionChance: 0.6,
				},
			},
		},
		// Metals
		...{
			Metal: {
				id: "9920574687",
				thermalProperties: {
					heatGlow: true,
					neonGlow: true,
					conductivity: 0.08,
					ignitionChance: 1 / 800,
					thermalResilience: -0.2,
				},
			},
			DiamondPlate: {
				id: "10237720195",
				thermalProperties: {
					heatGlow: true,
					neonGlow: true,
					conductivity: 0.1,
					ignitionChance: 1 / 1000,
					thermalResilience: -0.17,
				},
			},
			CorrodedMetal: {
				id: "9920589327",
				thermalProperties: {
					heatGlow: true,
					conductivity: 0.075,
					ignitionChance: 1 / 600,
					thermalResilience: -0.1,
				},
			},
			Foil: {
				id: "9466552117",
				thermalProperties: {
					heatGlow: true,
					neonGlow: true,
					conductivity: 0.125,
					ignitionChance: 1 / 250,
					thermalResilience: -0.5,
				},
			},
		},
		// Masonry / Stone
		...{
			Asphalt: GenericWithID("9930003046"),
			Basalt: GenericWithID("9920482056"),
			Brick: GenericWithID("9920482813"),
			CeramicTiles: GenericWithID("17429425079"),
			ClayRoofTiles: GenericWithID("18147681935"),
			Cobblestone: GenericWithID("9919718991"),
			Concrete: GenericWithID("9920484153"),
			CrackedLava: Objects.deepCombine(GenericWithID("9920484943"), { thermalProperties: { ignitionChance: 0 } }),
			Granite: GenericWithID("9920550238"),
			Limestone: GenericWithID("9920561437"),
			Marble: GenericWithID("9439430596"),
			Pavement: GenericWithID("9920579943"),
			Pebble: GenericWithID("9920581082"),
			Plaster: GenericWithID("14108671255"), // Surprisingly not flammable
			Rock: GenericWithID("9920587470"),
			Salt: Objects.deepCombine(GenericWithID("9920590225"), { thermalProperties: { neonGlow: true } }),
			Sandstone: GenericWithID("9920596120"),
			Slate: GenericWithID("9920599782"),
		},
		// Earth / Terrain
		...{
			Grass: {
				id: "9920551868",
				thermalProperties: {
					conductivity: 0.01,
					ignitionChance: 0.02,
				},
			},
			LeafyGrass: {
				id: "9920557906",
				thermalProperties: {
					conductivity: 0.01,
					ignitionChance: 0.1,
				},
			},
			Ground: {
				id: "9920554482",
				thermalProperties: {
					conductivity: 0.01,
					ignitionChance: 0.02,
				},
			},
			Mud: {
				id: "9920578473",
				thermalProperties: {
					conductivity: 0.01,
					ignitionChance: 0,
				},
			},
			Sand: {
				id: "9920591683",
				thermalProperties: {
					heatGlow: true,
					conductivity: 0.1,
					ignitionChance: 0,
				},
			},
		},
		// Ice / Cold
		...{
			Ice: {
				id: "9920555943",
				Friction: 0.02,
				FrictionWeight: 50,
				thermalProperties: {
					conductivity: 1,
					ignitionChance: 0,
				},
			},
			Glacier: {
				id: "9920518732",
				Friction: 0.02,
				FrictionWeight: 50,
				thermalProperties: {
					conductivity: 1,
					ignitionChance: 0,
				},
			},
			Snow: {
				id: "9920620284",
				thermalProperties: {
					conductivity: 1,
					ignitionChance: 1 / 2000,
				},
			},
		},
	} as const;
}
