import { GuiService, Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { Signals } from "client/Signals";
import { Interface } from "engine/client/gui/Interface";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { HostedService } from "engine/shared/di/HostedService";
import { ArgsSignal } from "engine/shared/event/Signal";
import { PlayerUtils } from "engine/shared/utils/PlayerUtils";
import { BlockManager } from "shared/building/BlockManager";

export type CursorHit = {
	readonly part: BasePart;
	readonly block: BlockModel | undefined;
	readonly position: Vector3;
	readonly normal: Vector3;
	/** Undefined only when a plot cast landed on a different part than the engine's mouse */
	readonly surface: Enum.NormalId | undefined;
};

/** What a cast is allowed to hit: the current plot only, or everything but the local character */
export type CursorFilter = "plot" | "world";

type CacheSlot = {
	stale: boolean;
	hit: CursorHit | undefined;
};

const RAY_LENGTH = 1000;

/** Include list, filled with the current plot by BuildingMode */
export const plotRaycastParams = new RaycastParams();
plotRaycastParams.FilterType = Enum.RaycastFilterType.Include;
plotRaycastParams.CollisionGroup = "BlockRaycast";

/** False while the ESC menu is open, the player is dead, or the cursor is over a visible GUI element */
export function isCursorUsable(): boolean {
	if (GuiService.MenuIsOpen) return false;
	if (!PlayerUtils.isAlive(Players.LocalPlayer)) return false;
	if (Interface.isCursorOnVisibleGui()) return false;

	return true;
}

const caches = new Map<CursorFilter, CacheSlot>();
let cachedRay: Ray | undefined;
let cachedPoint: Vector3 | undefined;
const invalidateCaches = () => {
	cachedRay = undefined;
	cachedPoint = undefined;

	for (const [, cache] of caches) {
		cache.stale = true;
	}
};
// the world moves every frame, the ray moves with the cursor and with the camera
RunService.PostSimulation.Connect(invalidateCaches);
LocalPlayer.mouse.Move.Connect(invalidateCaches);
Signals.CAMERA.MOVED.Connect(invalidateCaches);

/** What is under the cursor, resolved at most once per frame per filter. No usability checks */
export function castCursor(filter: CursorFilter = "plot"): CursorHit | undefined {
	const cache = caches.getOrSet(filter, () => ({ stale: true, hit: undefined }) as CacheSlot);
	if (!cache.stale) return cache.hit;

	cache.stale = false;
	cache.hit = filter === "plot" ? castPlot() : readMouse();
	return cache.hit;
}

function castPlot(): CursorHit | undefined {
	const ray = getCursorRay();
	const hit = Workspace.Raycast(ray.Origin, ray.Direction.mul(RAY_LENGTH), plotRaycastParams);
	if (!hit) return;

	const mouse = LocalPlayer.mouse;
	return {
		part: hit.Instance,
		block: BlockManager.tryGetBlockModelByPart(hit.Instance),
		position: hit.Position,
		normal: hit.Normal,
		surface: hit.Instance === mouse.Target ? mouse.TargetSurface : undefined,
	};
}

// the engine casts its own mouse ray every frame anyway, so world hits are read rather than cast again
function readMouse(): CursorHit | undefined {
	const mouse = LocalPlayer.mouse;
	const part = mouse.Target;
	if (!part) return;

	const surface = mouse.TargetSurface;
	return {
		part,
		block: BlockManager.tryGetBlockModelByPart(part),
		position: getCursorPoint(),
		normal: part.CFrame.Rotation.VectorToWorldSpace(Vector3.FromNormalId(surface)),
		surface,
	};
}

/** World-space normal of the face under the cursor, the six directions Mouse.TargetSurface is limited to */
export function hitFaceNormal(hit: CursorHit): Vector3 {
	if (hit.surface) return hit.part.CFrame.Rotation.VectorToWorldSpace(Vector3.FromNormalId(hit.surface));

	return snapNormalToFace(hit.part, hit.normal);
}

/** Round a hit normal to the nearest face of the part, the six directions Mouse.TargetSurface is limited to */
export function snapNormalToFace(part: BasePart, normal: Vector3): Vector3 {
	const localNormal = part.CFrame.VectorToObjectSpace(normal);
	const x = math.abs(localNormal.X);
	const y = math.abs(localNormal.Y);
	const z = math.abs(localNormal.Z);

	const axis =
		x >= y && x >= z
			? new Vector3(math.sign(localNormal.X), 0, 0)
			: y >= z
				? new Vector3(0, math.sign(localNormal.Y), 0)
				: new Vector3(0, 0, math.sign(localNormal.Z));

	return part.CFrame.VectorToWorldSpace(axis);
}

/** Unit ray from the camera through the cursor, built once per frame. No screen coordinates, so no GUI inset to get wrong */
export function getCursorRay(): Ray {
	return (cachedRay ??= LocalPlayer.mouse.UnitRay);
}

/** Point under the cursor, 1000 studs out when pointing at nothing. Engine-side, unaffected by the filters */
export function getCursorPoint(): Vector3 {
	return (cachedPoint ??= LocalPlayer.mouse.Hit.Position);
}

const isLMB = (input: InputObject) =>
	input.UserInputType === Enum.UserInputType.MouseButton1 || input.UserInputType === Enum.UserInputType.Touch;

const isRMB = (input: InputObject) => input.UserInputType === Enum.UserInputType.MouseButton2;

@injectable
export class CursorService extends HostedService {
	/** Generic platform tap/touch/click start */
	readonly pressed = new ArgsSignal<[hit: CursorHit]>();
	/** Fires every frame while any button or finger is down */
	readonly held = new ArgsSignal<[hit: CursorHit]>();
	/** Fires once the last button or finger is released */
	readonly released = new ArgsSignal();
	/** PC-specific right mouse button click trigger */
	readonly rightPressed = new ArgsSignal<[hit: CursorHit]>();

	constructor() {
		super();

		let holding = false;
		this.event.subscribe(UserInputService.InputBegan, (input, processed) => {
			if (processed) return;

			if (isRMB(input)) {
				const hit = this.getHit();
				if (hit) this.rightPressed.Fire(hit);
				return;
			}

			if (!holding && isLMB(input)) {
				holding = true;
				const hit = this.getHit();
				if (hit) this.pressed.Fire(hit);
				return;
			}
		});

		this.event.subscribe(UserInputService.InputEnded, (input) => {
			if (!isLMB(input)) return;
			// ignore if nothing was pressed in the world
			if (!holding) return;

			holding = false;
			this.released.Fire();
		});

		this.event.subscribe(RunService.PostSimulation, () => {
			if (!holding) return;

			const hit = this.getHit();
			if (hit) this.held.Fire(hit);
		});
	}

	/** Unit ray from the camera through the cursor */
	getRay(): Ray {
		return getCursorRay();
	}

	/** Point under the cursor, 1000 studs out when pointing at nothing. Engine-side, unaffected by the filter */
	getPoint(): Vector3 {
		return getCursorPoint();
	}

	/** Part and block under the cursor */
	getHit(filter: CursorFilter = "plot"): CursorHit | undefined {
		if (!isCursorUsable()) return;

		return castCursor(filter);
	}
}
