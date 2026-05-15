type sps = readonly [name: string, { readonly name: string; readonly pos: CFrame | undefined }];

const cf = (x: number, y: number, z: number, yrot?: number) => {
	return new CFrame(x, y, z).ToWorldSpace(CFrame.fromOrientation(0, math.rad(yrot ?? 0), 0));
};

const sps = [
	["plot", { name: "Plot", pos: undefined }],
	["water1", { name: "Water 1", pos: cf(769, -16345.559, 1269.5) }],
	["water2", { name: "Water 2", pos: cf(-101, -16411.887, 3045) }],
	["space", { name: "Space", pos: cf(50, 26411, 894) }],
	["helipad", { name: "Big John", pos: cf(901, -14871.997, -798) }],
	["helipad1", { name: "Helipad 1", pos: cf(296.5, -16382.999, -1138) }],
	["helipad2", { name: "Helipad 2", pos: cf(296.5, -16382.999, -1283) }],
	["helipad3", { name: "Helipad 3", pos: cf(296.5, -16382.999, -1428) }],
	["train1", { name: "Train tracks 1", pos: cf(441, -16381.27, 608) }],
	["train2", { name: "Train tracks 2", pos: cf(220.637, -16381.27, 1445.5, 90) }],
	["train3", { name: "Train tracks 3", pos: cf(2046.5, -16381.27, -665.596, 180) }],
	["train4", { name: "Train tracks 4", pos: cf(-1186.676, -16381.893, -347.449, 90) }],
	["idk", { name: "idk", pos: cf(-14101, -16411.887, 35045) }],
	["crusher", { name: "Crusher", pos: cf(775.5, -16348.143, -973.5) }],
	["stadium", { name: "Centrifuge", pos: cf(2630.937, -16183.715, -32.289) }],
	["quarry", { name: "Quarry?", pos: cf(1410.5, -16360.775, -1399) }],
	["runway1", { name: "Runway 1", pos: cf(-95.001, -16382.999, -2400.25, 90) }],
	["runway2", { name: "Runway 2", pos: cf(-95.007, -16382.417, 1572.948, -90) }],
	["house", { name: "Rocket Launch Pad", pos: cf(644.5, -16380.433, -2129.5) }],
] as const satisfies readonly sps[];

export const spawnPositions: readonly sps[] = sps;
export const spawnPositionsKeyed = asObject(spawnPositions.mapToMap((c) => $tuple(c[0], c[1].pos)).asReadonly());

export type SpawnPosition = (typeof spawnPositions)[number][0];
