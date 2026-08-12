import { Workspace } from "@rbxts/services";
import { LocalPlayer } from "engine/client/LocalPlayer";

export namespace ScreenSpace {
	const camera = Workspace.CurrentCamera!;
	let fov = camera.FieldOfView;

	camera.GetPropertyChangedSignal("FieldOfView").Connect(() => {
		fov = camera.FieldOfView;
	});

	export function ViewSizeX() {
		const x = LocalPlayer.mouse.ViewSizeX;
		const y = LocalPlayer.mouse.ViewSizeY;
		if (x === 0) {
			return 1024;
		} else {
			if (x > y) {
				return x;
			} else {
				return y;
			}
		}
	}

	export function ViewSizeY() {
		const x = LocalPlayer.mouse.ViewSizeX;
		const y = LocalPlayer.mouse.ViewSizeY;
		if (y === 0) {
			return 768;
		} else {
			if (x > y) {
				return y;
			} else {
				return x;
			}
		}
	}

	/** Aspect ratio. The ViewSize checks keep the divisor non-zero, so this never divides by zero. */
	export function AspectRatio() {
		return ViewSizeX() / ViewSizeY();
	}

	/** World position -> screen position. */
	export function WorldToScreen(at: Vector3) {
		const point = camera.CFrame.PointToObjectSpace(at);
		const aspectRatio = AspectRatio();
		const hfactor = math.tan(math.rad(fov) / 2);
		const wfactor = aspectRatio * hfactor;

		const x = point.X / point.Z / -wfactor;
		const y = point.Y / point.Z / hfactor;

		return new Vector2(ViewSizeX() * (0.5 + 0.5 * x), ViewSizeY() * (0.5 + 0.5 * y));
	}

	/** Screen position + depth -> world position. */
	export function ScreenToWorld(x: number, y: number, depth: number) {
		const aspectRatio = AspectRatio();
		const hfactor = math.tan(math.rad(fov) / 2);
		const wfactor = aspectRatio * hfactor;

		const xf = (x / ViewSizeX()) * 2 - 1;
		const yf = (y / ViewSizeY()) * 2 - 1;
		const xpos = xf * -wfactor * depth;
		const ypos = yf * hfactor * depth;

		return new Vector3(xpos, ypos, depth);
	}

	/** ScreenSize -> WorldSize */
	export function ScreenWidthToWorldWidth(screenWidth: number, depth: number) {
		const aspectRatio = AspectRatio();
		const hfactor = math.tan(math.rad(fov) / 2);
		const wfactor = aspectRatio * hfactor;
		const sx = ViewSizeX();

		return -(screenWidth / sx) * 2 * wfactor * depth;
	}
	export function ScreenHeightToWorldHeight(screenHeight: number, depth: number) {
		const hfactor = math.tan(math.rad(fov) / 2);
		const sy = ViewSizeY();

		return -(screenHeight / sy) * 2 * hfactor * depth;
	}

	/** WorldSize -> ScreenSize */
	export function WorldWidthToScreenWidth(worldWidth: number, depth: number) {
		const aspectRatio = AspectRatio();
		const hfactor = math.tan(math.rad(fov) / 2);
		const wfactor = aspectRatio * hfactor;
		const sx = ViewSizeX();

		return -(worldWidth * sx) / (2 * wfactor * depth);
	}
	export function WorldHeightToScreenHeight(worldHeight: number, depth: number) {
		const hfactor = math.tan(math.rad(fov) / 2);
		const sy = ViewSizeY();

		return -(worldHeight * sy) / (2 * hfactor * depth);
	}

	/** WorldSize + ScreenSize -> Depth needed */
	export function GetDepthForWidth(screenWidth: number, worldWidth: number) {
		const aspectRatio = AspectRatio();
		const hfactor = math.tan(math.rad(fov) / 2);
		const wfactor = aspectRatio * hfactor;
		const sx = ViewSizeX();
		const sy = ViewSizeY();

		return -(sx * worldWidth) / (screenWidth * 2 * wfactor);
	}
	export function GetDepthForHeight(screenHeight: number, worldHeight: number) {
		const hfactor = math.tan(math.rad(fov) / 2);
		const sy = ViewSizeY();

		return -(sy * worldHeight) / (screenHeight * 2 * hfactor);
	}

	/** Screen point + screen height + depth -> world position and the world size to appear that size at that depth. */
	export function ScreenToWorldByHeightDepth(x: number, y: number, screenHeight: number, depth: number) {
		const aspectRatio = AspectRatio();
		const hfactor = math.tan(math.rad(fov) / 2);
		const wfactor = aspectRatio * hfactor;
		const sx = ViewSizeX();
		const sy = ViewSizeY();

		const worldHeight = -(screenHeight / sy) * 2 * hfactor * depth;

		const xf = (x / sx) * 2 - 1;
		const yf = (y / sy) * 2 - 1;

		const xpos = xf * -wfactor * depth;
		const ypos = yf * hfactor * depth;

		return [new Vector3(xpos, ypos, depth), worldHeight];
	}

	/** Screen point + screen width + depth -> world position and the world size to appear that size at that depth. */
	export function ScreenToWorldByWidthDepth(x: number, y: number, screenWidth: number, depth: number) {
		const aspectRatio = AspectRatio();
		const hfactor = math.tan(math.rad(fov) / 2);
		const wfactor = aspectRatio * hfactor;
		const sx = ViewSizeX();
		const sy = ViewSizeY();

		const worldWidth = (screenWidth / sx) * 2 * -wfactor * depth;

		const xf = (x / sx) * 2 - 1;
		const yf = (y / sy) * 2 - 1;
		const xpos = xf * -wfactor * depth;
		const ypos = yf * hfactor * depth;

		return [new Vector3(xpos, ypos, depth), worldWidth];
	}

	/** Screen point + wanted screen height + object world height -> world position that satisfies them. */
	export function ScreenToWorldByHeight(x: number, y: number, screenHeight: number, worldHeight: number) {
		const aspectRatio = AspectRatio();
		const hfactor = math.tan(math.rad(fov) / 2);
		const wfactor = aspectRatio * hfactor;
		const sx = ViewSizeX();
		const sy = ViewSizeY();

		const depth = -(sy * worldHeight) / (screenHeight * 2 * hfactor);

		const xf = (x / sx) * 2 - 1;
		const yf = (y / sy) * 2 - 1;
		const xpos = xf * -wfactor * depth;
		const ypos = yf * hfactor * depth;

		return new Vector3(xpos, ypos, depth);
	}

	/** Screen point + wanted screen width + object world width -> world position that satisfies them. */
	export function ScreenToWorldByWidth(x: number, y: number, screenWidth: number, worldWidth: number) {
		const aspectRatio = AspectRatio();
		const hfactor = math.tan(math.rad(fov) / 2);
		const wfactor = aspectRatio * hfactor;
		const sx = ViewSizeX();
		const sy = ViewSizeY();

		const depth = -(sx * worldWidth) / (screenWidth * 2 * wfactor);

		const xf = (x / sx) * 2 - 1;
		const yf = (y / sy) * 2 - 1;
		const xpos = xf * -wfactor * depth;
		const ypos = yf * hfactor * depth;

		return new Vector3(xpos, ypos, depth);
	}
}
