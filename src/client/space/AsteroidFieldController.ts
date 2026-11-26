import { ReplicatedStorage, RunService, Workspace } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { Element } from "engine/shared/Element";
import { Instances } from "engine/shared/fixes/Instances";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { AtmosphereService } from "client/AtmosphereService";

const profiling = RunService.IsStudio();

const Patches = {
	sector: 8192, // each sector of space holds at most one patch
	chance: 0.08,
	// local heights and horizontal reach from the map's centre that patches can sit in
	floor: 30000,
	ceiling: 300000,
	reach: 60000,
	minRadius: 600,
	maxRadius: 2000,
	// stretched along a random axis, as a collision family is along the direction its fragments flew
	minStretch: 1.5,
	maxStretch: 3,
	extent: 2.5, // radii past which density counts as nothing
} as const;

const Field = {
	cell: 512,
	loadRadius: 2048, // no asteroid drawn farther from the camera
	repassDistance: 128, // camera travel before every cell in range is checked again
} as const;
const cellHalfDiagonal = (Field.cell * math.sqrt(3)) / 2;

const Asteroid = {
	perCell: 4, // mean asteroids per cell at density 1
	// cumulative size distribution N(>D) ∝ D^-q, the slope measured for collision fragments
	minSize: 12,
	maxSize: 420,
	sizeSlope: 2.5,
	lodRatio: 0.006, // drawn once at least this fraction of its distance across
	smallSize: 40, // below this, the small rock meshes
	poolSize: 32, // hidden parts kept per mesh for reuse
} as const;

const Budget = {
	fill: 0.004,
	unload: 0.002,
} as const;

type AsteroidSpec = {
	readonly cframe: CFrame;
	readonly size: number;
	readonly template: MeshPart;
	readonly shade: number;
};
type Cell = {
	readonly specs: readonly AsteroidSpec[];
	readonly parts: Map<number, MeshPart>; // by index into specs
	readonly center: Vector3;
};

const Seed = {
	range: 2147483646,
	sectorSalt: 0x5eed,
} as const;
// same on every client for one grid position; each coordinate reseeds from the previous draw so positions don't share seeds
const seedOf = (position: Vector3, salt: number) => {
	let seed = new Random(salt * Seed.range + position.X).NextInteger(0, Seed.range);
	seed = new Random(seed + position.Y).NextInteger(0, Seed.range);
	return new Random(seed + position.Z).NextInteger(0, Seed.range);
};

const patchOf = (sector: Vector3) => {
	const origin = sector.mul(Patches.sector);
	const height = origin.Y + Patches.sector / 2 - GameDefinitions.HEIGHT_OFFSET;
	if (height < Patches.floor || height > Patches.ceiling) return;
	if (math.sqrt(origin.X * origin.X + origin.Z * origin.Z) > Patches.reach) return;

	const rng = new Random(seedOf(sector, Seed.sectorSalt));
	if (rng.NextNumber() >= Patches.chance) return;

	const radius = rng.NextNumber(Patches.minRadius, Patches.maxRadius);
	const stretch = rng.NextNumber(Patches.minStretch, Patches.maxStretch);
	return {
		center: origin.add(new Vector3(rng.NextNumber(), rng.NextNumber(), rng.NextNumber()).mul(Patches.sector)),
		radius,
		axis: rng.NextUnitVector(),
		stretch,
		richness: rng.NextNumber(0.6, 1.4),
		extent: radius * stretch * Patches.extent, // from the centre, past which the patch holds nothing
	};
};
type Patch = Readonly<NonNullable<ReturnType<typeof patchOf>>>;

// Gaussian around each patch, the distance along its axis divided by its stretch
const densityAt = (position: Vector3, patches: readonly Patch[]): number => {
	let density = 0;
	for (const patch of patches) {
		const offset = position.sub(patch.center);
		const along = offset.Dot(patch.axis);
		const across = offset.sub(patch.axis.mul(along)).Magnitude;
		const distance2 = (along / patch.stretch) ** 2 + across ** 2;
		density += patch.richness * math.exp(-distance2 / (patch.radius * patch.radius));
	}
	return density;
};

const poisson = (rng: Random, mean: number) => {
	const limit = math.exp(-mean);
	let count = 0;
	let product = rng.NextNumber();
	while (product > limit) {
		count++;
		product *= rng.NextNumber();
	}
	return count;
};

/** Streams occasional seeded patches of static asteroids around the camera while it is in space */
@injectable
export class AsteroidFieldController extends HostedService {
	private readonly cells = new Map<Vector3, Cell>();
	private readonly offsets: Vector3[] = [];
	private readonly pool = new Map<MeshPart, MeshPart[]>();
	private readonly sectorPatches = new Map<Vector3, Patch | false>();
	private folder?: Folder;
	private small: MeshPart[] = [];
	private large: MeshPart[] = [];
	private stepping?: RBXScriptConnection;

	private cameraSector?: Vector3;
	private nearbyPatches: Patch[] = [];

	private passOrigin?: Vector3;
	private passCenter = Vector3.zero;
	private fillIndex = 0;
	private unloadPending = false;

	// read from Studio through the folder's attributes
	private passStarted = 0;
	private passFrames = 0;
	private passGenerateTime = 0;
	private shown = 0;
	private pooled = 0;

	constructor(@inject atmosphere: AtmosphereService) {
		super();

		// the camera can be anywhere in its own cell, so the offsets reach one cell diagonal past the radius
		const reach = Field.loadRadius + 2 * cellHalfDiagonal;
		const radius = math.ceil(reach / Field.cell);
		for (let x = -radius; x <= radius; x++) {
			for (let y = -radius; y <= radius; y++) {
				for (let z = -radius; z <= radius; z++) {
					if ((x * x + y * y + z * z) * Field.cell * Field.cell <= reach * reach) {
						this.offsets.push(new Vector3(x, y, z));
					}
				}
			}
		}
		this.offsets.sort((a, b) => a.Magnitude < b.Magnitude);

		this.event.subscribeObservable(
			atmosphere.inSpace,
			(inSpace) => {
				if (!inSpace) return this.stop();
				if (this.stepping) return;

				const template = (name: string) =>
					Instances.waitForChild<MeshPart>(ReplicatedStorage, "SpaceModels", name);
				this.small = [template("Rock"), template("Boulder")];
				this.large = [template("Asteroid1"), template("Asteroid2"), template("Asteroid3")];

				this.stepping = RunService.Heartbeat.Connect(() => {
					if (profiling) debug.profilebegin("AsteroidField step");
					this.step();
					if (profiling) debug.profileend();
				});
			},
			true,
		);
		this.onDestroy(() => this.stop());
	}

	private stop() {
		this.stepping?.Disconnect();
		this.stepping = undefined;
		this.clear();
		this.sectorPatches.clear();
		this.cameraSector = undefined;
		this.nearbyPatches = [];
	}

	private clear() {
		this.cells.clear();
		for (const [, parts] of this.pool) {
			for (const part of parts) part.Destroy();
		}
		this.pool.clear();
		this.folder?.Destroy();
		this.folder = undefined;
		this.passOrigin = undefined;
		this.shown = 0;
		this.pooled = 0;
	}

	private patchesAround(sector: Vector3): Patch[] {
		const patches: Patch[] = [];
		for (let x = -1; x <= 1; x++) {
			for (let y = -1; y <= 1; y++) {
				for (let z = -1; z <= 1; z++) {
					const neighbour = sector.add(new Vector3(x, y, z));
					let patch = this.sectorPatches.get(neighbour);
					if (patch === undefined) {
						patch = patchOf(neighbour) ?? false;
						this.sectorPatches.set(neighbour, patch);
					}
					if (patch) patches.push(patch);
				}
			}
		}
		return patches;
	}

	private step() {
		const camera = Workspace.CurrentCamera;
		if (!camera) return;

		const position = camera.CFrame.Position;
		const sector = position.div(Patches.sector).apply(math.floor);
		if (sector !== this.cameraSector) {
			this.cameraSector = sector;
			this.nearbyPatches = this.patchesAround(sector);
		}

		let inReach = false;
		for (const patch of this.nearbyPatches) {
			if (position.sub(patch.center).Magnitude - patch.extent > Field.loadRadius) continue;
			inReach = true;
			break;
		}
		if (!inReach) {
			if (this.folder) this.clear();
			return;
		}

		const folder = (this.folder ??= Element.create("Folder", {
			Name: "Asteroids",
			Parent: Workspace.WaitForChild("Obstacles"),
		}));

		const origin = this.passOrigin;
		if (!origin || position.sub(origin).Magnitude > Field.repassDistance) {
			this.passOrigin = position;
			this.passCenter = position.div(Field.cell).apply(math.floor);
			this.fillIndex = 0;
			this.unloadPending = true;
			this.passStarted = os.clock();
			this.passFrames = 0;
			this.passGenerateTime = 0;
		}
		const passOrigin = this.passOrigin!;

		if (this.unloadPending) {
			if (profiling) debug.profilebegin("AsteroidField unload");
			this.unloadPending = !this.unloadFar(passOrigin);
			if (profiling) debug.profileend();
		}

		if (this.fillIndex >= this.offsets.size()) return;

		this.passFrames++;
		const deadline = os.clock() + Budget.fill;
		while (this.fillIndex < this.offsets.size() && os.clock() < deadline) {
			this.show(this.passCenter.add(this.offsets[this.fillIndex++]), passOrigin, folder);
		}
		if (this.fillIndex < this.offsets.size()) return;

		folder.SetAttribute("PassMs", (os.clock() - this.passStarted) * 1000);
		folder.SetAttribute("PassFrames", this.passFrames);
		folder.SetAttribute("GenerateMs", this.passGenerateTime * 1000);
		folder.SetAttribute("Cells", this.cells.size());
		folder.SetAttribute("Asteroids", this.shown);
		folder.SetAttribute("Pooled", this.pooled);
		folder.SetAttribute("Patches", this.nearbyPatches.size());
	}

	private show(cell: Vector3, camera: Vector3, folder: Folder) {
		const center = cell.add(new Vector3(0.5, 0.5, 0.5)).mul(Field.cell);
		if (camera.sub(center).Magnitude - cellHalfDiagonal > Field.loadRadius) return;

		let data = this.cells.get(cell);
		if (!data) {
			const started = os.clock();
			if (profiling) debug.profilebegin("AsteroidField generate");
			data = { specs: this.generate(cell, center), parts: new Map(), center };
			if (profiling) debug.profileend();
			this.passGenerateTime += os.clock() - started;
			this.cells.set(cell, data);
		}

		for (let i = 0; i < data.specs.size(); i++) {
			const spec = data.specs[i];
			const distance = spec.cframe.Position.sub(camera).Magnitude;
			const wanted = distance <= Field.loadRadius && spec.size >= Asteroid.lodRatio * distance;
			const part = data.parts.get(i);

			if (wanted && !part) {
				data.parts.set(i, this.build(spec, folder));
			} else if (!wanted && part) {
				this.release(spec.template, part);
				data.parts.delete(i);
			}
		}
	}

	private generate(cell: Vector3, center: Vector3): AsteroidSpec[] {
		const mean =
			Asteroid.perCell * densityAt(center, this.patchesAround(center.div(Patches.sector).apply(math.floor)));
		if (mean < 0.01) return [];

		// every value is drawn whatever the distance, so a cell always yields the same asteroids
		const rng = new Random(seedOf(cell, 0));
		const count = poisson(rng, mean);
		const origin = cell.mul(Field.cell);
		const specs: AsteroidSpec[] = [];
		for (let i = 0; i < count; i++) {
			const position = origin.add(
				new Vector3(
					rng.NextNumber() * Field.cell,
					rng.NextNumber() * Field.cell,
					rng.NextNumber() * Field.cell,
				),
			);
			const size = math.min(
				Asteroid.minSize * (1 - rng.NextNumber()) ** (-1 / Asteroid.sizeSlope),
				Asteroid.maxSize,
			);
			const rotation = CFrame.fromAxisAngle(rng.NextUnitVector(), rng.NextNumber() * math.pi * 2);
			const pool = size < Asteroid.smallSize ? this.small : this.large;
			const template = pool[rng.NextInteger(1, pool.size()) - 1];
			const shade = rng.NextNumber(0.75, 1.1);

			specs.push({ cframe: new CFrame(position).mul(rotation), size, template, shade });
		}

		return specs;
	}

	private build(spec: AsteroidSpec, folder: Folder): MeshPart {
		if (profiling) debug.profilebegin("AsteroidField build");
		const reused = this.pool.get(spec.template)?.pop();
		if (reused) this.pooled--;

		const part = reused ?? spec.template.Clone();
		const extent = spec.template.Size;
		part.Size = extent.mul(spec.size / math.max(extent.X, extent.Y, extent.Z));
		part.CFrame = spec.cframe;
		part.Color = spec.template.Color.Lerp(Color3.fromRGB(150, 140, 128), spec.shade - 0.75);
		part.CastShadow = false;
		part.Parent = folder;
		this.shown++;
		if (profiling) debug.profileend();
		return part;
	}

	private release(template: MeshPart, part: MeshPart) {
		this.shown--;
		const parts = this.pool.get(template) ?? [];
		if (parts.size() >= Asteroid.poolSize) {
			part.Destroy();
			return;
		}

		part.Parent = undefined;
		parts.push(part);
		this.pool.set(template, parts);
		this.pooled++;
	}

	// true once every cell that can no longer hold anything in range is gone, false if the budget ran out first
	private unloadFar(camera: Vector3): boolean {
		const deadline = os.clock() + Budget.unload;
		for (const [key, cell] of this.cells) {
			if (camera.sub(cell.center).Magnitude - cellHalfDiagonal <= Field.loadRadius) continue;

			for (const [index, part] of cell.parts) this.release(cell.specs[index].template, part);
			this.cells.delete(key);
			if (os.clock() >= deadline) return false;
		}

		return true;
	}
}
