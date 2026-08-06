import { ContextActionService, Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { Action } from "engine/client/Action";
import { Keybinds } from "engine/client/Keybinds";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { OverlayValueStorage } from "engine/shared/component/OverlayValueStorage";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Objects } from "engine/shared/fixes/Objects";
import type { KeybindRegistration } from "engine/client/Keybinds";

const pi = math.pi;
const abs = math.abs;
const clamp = math.clamp;
const exp = math.exp;
const rad = math.rad;
const sqrt = math.sqrt;
const tan = math.tan;
const sign = math.sign;

type GameSettings = {
	readonly ControlMode: Enum.ControlMode;
	readonly ComputerMovementMode: Enum.ComputerMovementMode;
};
const GameSettings = (UserSettings() as unknown as { GameSettings: GameSettings }).GameSettings;

let Player = Players.LocalPlayer;
if (!Player) {
	Players.GetPropertyChangedSignal("LocalPlayer").Wait();
	Player = Players.LocalPlayer;
}

let Camera = Workspace.CurrentCamera!;
Workspace.GetPropertyChangedSignal("CurrentCamera").Connect(function () {
	const newCamera = Workspace.CurrentCamera;
	if (newCamera) {
		Camera = newCamera;
	}
});

let FFlagUserExitFreecamBreaksWithShiftlock: boolean;
{
	const [success, result] = pcall(function () {
		return UserSettings().IsUserFeatureEnabled("UserExitFreecamBreaksWithShiftlock");
	});
	FFlagUserExitFreecamBreaksWithShiftlock = success && result;
}

const INPUT_PRIORITY = Enum.ContextActionPriority.High.Value;

/**
 * Movement is rebindable, so it goes through Keybinds rather than one blanket ContextActionService capture.
 * The registrations bind for the whole session; what makes them inert outside freecam is that nothing is
 * subscribed to them until {@link Input.StartCapture}, and a registration with no subscriber returns Pass.
 *
 * The second key on each axis is the vim-style set the stock script carried. Gamepad buttons are combos here
 * for the same reason — a raw bind would be invisible to the rebinding UI; only inputs with no key at all
 * (mouse movement, wheel, thumbsticks) stay as blanket sinks in {@link Input.StartCapture}.
 */
const movementKeydefs = {
	forward: Keybinds.registerDefinition("freecam_forward", ["Freecam", "Forward"], [["W"], ["U"]], INPUT_PRIORITY),
	back: Keybinds.registerDefinition("freecam_back", ["Freecam", "Back"], [["S"], ["J"]], INPUT_PRIORITY),
	left: Keybinds.registerDefinition("freecam_left", ["Freecam", "Left"], [["A"], ["H"]], INPUT_PRIORITY),
	right: Keybinds.registerDefinition("freecam_right", ["Freecam", "Right"], [["D"], ["K"]], INPUT_PRIORITY),
	up: Keybinds.registerDefinition(
		"freecam_up",
		["Freecam", "Up"],
		[["E"], ["I"], ["Space"], ["ButtonR2"]],
		INPUT_PRIORITY,
	),
	down: Keybinds.registerDefinition(
		"freecam_down",
		["Freecam", "Down"],
		[["Q"], ["Y"], ["ButtonL2"]],
		INPUT_PRIORITY,
	),
	speedUp: Keybinds.registerDefinition("freecam_speedUp", ["Freecam", "Speed up"], [["Up"]], INPUT_PRIORITY),
	speedDown: Keybinds.registerDefinition("freecam_speedDown", ["Freecam", "Speed down"], [["Down"]], INPUT_PRIORITY),
	slow: Keybinds.registerDefinition(
		"freecam_slow",
		["Freecam", "Move slowly"],
		[["LeftShift"], ["RightShift"]],
		INPUT_PRIORITY,
	),
	fovOut: Keybinds.registerDefinition("freecam_fovOut", ["Freecam", "Zoom out"], [["ButtonX"]], INPUT_PRIORITY),
	fovIn: Keybinds.registerDefinition("freecam_fovIn", ["Freecam", "Zoom in"], [["ButtonY"]], INPUT_PRIORITY),
} as const;
type MovementKey = keyof typeof movementKeydefs;

let movement: { readonly [k in MovementKey]: KeybindRegistration } | undefined;

const NAV_GAIN = Vector3.one.mul(64);
class VelocitySpring {
	p = Vector3.zero;
	v = Vector3.zero;

	Update(dt: number, goal: Vector3) {
		const VEL_STIFFNESS = 5;

		const f = VEL_STIFFNESS * 2 * pi;
		const p0 = this.p;
		const v0 = this.v;

		const offset = goal.sub(p0);
		const decay = exp(-f * dt);

		const p1 = goal.add(
			v0
				.mul(dt)
				.sub(offset.mul(f * dt + 1))
				.mul(decay),
		);
		const v1 = offset.mul(f).sub(v0).mul(f).mul(dt).add(v0).mul(decay);

		this.p = p1;
		this.v = v1;

		return p1;
	}

	Reset(pos: Vector3) {
		this.p = pos;
		this.v = pos.mul(0);
	}
}

/** Degrees per second at full wheel deflection, before the zoom-factor taper. */
const FOV_GAIN = 300;
class FovSpring {
	p = 0;
	v = 0;

	Update(dt: number, goal: number) {
		const FOV_STIFFNESS = 4;

		const f = FOV_STIFFNESS * 2 * pi;
		const p0 = this.p;
		const v0 = this.v;

		const offset = goal - p0;
		const decay = exp(-f * dt);

		const p1 = goal + (v0 * dt - offset * (f * dt + 1)) * decay;
		const v1 = (f * dt * (offset * f - v0) + v0) * decay;

		this.p = p1;
		this.v = v1;

		return p1;
	}

	Reset(pos: number) {
		this.p = pos;
		this.v = 0;
	}
}

let cameraPos = new Vector3();
let cameraFov = 70;
const velSpring = new VelocitySpring();
const fovSpring = new FovSpring();

namespace Input {
	const K_CURVATURE = 2.0;
	const K_DEADZONE = 0.15;
	function fCurve(x: number) {
		return (exp(K_CURVATURE * x) - 1) / (exp(K_CURVATURE) - 1);
	}
	function fDeadzone(x: number) {
		return fCurve((x - K_DEADZONE) / (1 - K_DEADZONE));
	}
	function thumbstickCurve(x: number) {
		return sign(x) * clamp(fDeadzone(abs(x)), 0, 1);
	}

	const _gamepad = {
		Thumbstick1: new Vector2(),
		Thumbstick2: new Vector2(),
	};
	const gamepad: typeof _gamepad & { [k in KeyCode]?: number | Vector2 | Vector3 } = _gamepad;

	const held: { [k in MovementKey]: number } = {
		forward: 0,
		back: 0,
		left: 0,
		right: 0,
		up: 0,
		down: 0,
		speedUp: 0,
		speedDown: 0,
		slow: 0,
		fovOut: 0,
		fovIn: 0,
	};
	let movementSubs: SignalConnection[] | undefined;

	const _mouse = {
		Delta: new Vector2(),
		MouseWheel: 0,
	};
	const mouse: typeof _mouse & { [k in Enum.UserInputType["Name"]]?: number } = _mouse;

	const NAV_GAMEPAD_SPEED = new Vector3(1, 1, 1);
	const NAV_KEYBOARD_SPEED = new Vector3(1, 1, 1);
	const NAV_ADJ_SPEED = 0.75;
	const FOV_WHEEL_SPEED = 1;
	const FOV_GAMEPAD_SPEED = 0.25;
	const NAV_SHIFT_MUL = 0.25;

	let navSpeed = 1;

	let base = Vector3.zero;
	let capture: SignalConnection | undefined;

	export function Vel(dt: number) {
		navSpeed = clamp(navSpeed + dt * (held.speedUp - held.speedDown) * NAV_ADJ_SPEED, 0.01, 4);

		const kGamepad = new Vector3(
			thumbstickCurve(gamepad.Thumbstick1.X),
			0,
			thumbstickCurve(-gamepad.Thumbstick1.Y),
		).mul(NAV_GAMEPAD_SPEED);

		// keyboard and gamepad buttons alike — everything arriving through the keybind registrations
		const kHeld = new Vector3(held.right - held.left, held.up - held.down, held.back - held.forward).mul(
			NAV_KEYBOARD_SPEED,
		);

		// `base` is the active control scheme's GetMoveVector — WASD, gamepad stick or the mobile thumbstick.
		// It is what gives touch a movement vector at all, a thumbstick being a GUI element with no keys.
		return base
			.add(kGamepad)
			.add(kHeld)
			.mul(navSpeed * (held.slow > 0 ? NAV_SHIFT_MUL : 1));
	}

	/** Consumes the accumulated wheel delta, so a frame that reads it twice would see nothing the second time. */
	export function Fov() {
		const kGamepad = (held.fovOut - held.fovIn) * FOV_GAMEPAD_SPEED;
		const kMouse = mouse.MouseWheel * FOV_WHEEL_SPEED;
		mouse.MouseWheel = 0;

		return kGamepad + kMouse;
	}

	function MousePan(action: string, state: Enum.UserInputState, input: InputObject) {
		const delta = input.Delta;
		mouse.Delta = new Vector2(-delta.Y, -delta.X);
		return Enum.ContextActionResult.Sink;
	}
	function Thumb(action: string, state: Enum.UserInputState, input: InputObject) {
		gamepad[input.KeyCode.Name] = input.Position as never;
		return Enum.ContextActionResult.Sink;
	}
	function MouseWheel(action: string, state: Enum.UserInputState, input: InputObject) {
		mouse[input.UserInputType.Name] = -input.Position.Z;
		return Enum.ContextActionResult.Sink;
	}

	function Zero(t: Record<string, number | Vector2 | Vector3>) {
		for (const [k, v] of pairs(t)) {
			if (typeIs(v, "number")) {
				t[k] = v * 0;
			} else if (typeIs(v, "Vector2")) {
				t[k] = v.mul(0);
			} else if (typeIs(v, "Vector3")) {
				t[k] = v.mul(0);
			}
		}
	}

	export function StartCapture() {
		// Subscribing is what arms the registrations: they are bound for the session, but sink nothing until
		// something is listening, so movement keys reach the character normally outside freecam.
		if (movement) {
			const subs: SignalConnection[] = [];
			for (const [key, registration] of pairs(movement)) {
				subs.push(
					registration.onDown(() => {
						held[key] = 1;
						return "Sink";
					}),
				);
				subs.push(
					registration.onUp(() => {
						held[key] = 0;
						return "Sink";
					}),
				);
			}

			movementSubs = subs;
		}

		ContextActionService.BindActionAtPriority(
			"FreecamMousePan",
			MousePan,
			false,
			INPUT_PRIORITY,
			Enum.UserInputType.MouseMovement,
		);
		ContextActionService.BindActionAtPriority(
			"FreecamMouseWheel",
			MouseWheel,
			false,
			INPUT_PRIORITY,
			Enum.UserInputType.MouseWheel,
		);
		ContextActionService.BindActionAtPriority(
			"FreecamGamepadThumbstick",
			Thumb,
			false,
			INPUT_PRIORITY,
			Enum.KeyCode.Thumbstick1,
			Enum.KeyCode.Thumbstick2,
		);

		const t = task.spawn(() => {
			const h = LocalPlayer.humanoid.get()!;
			const pos = h.RootPart!.GetPivot();

			const controls = LocalPlayer.getPlayerModule().GetControls();
			while (true as boolean) {
				task.wait();
				base = controls.GetMoveVector();
				h.RootPart?.PivotTo(pos);
			}
		});
		capture = {
			Disconnect() {
				task.cancel(t);
			},
		};
	}

	export function StopCapture() {
		capture?.Disconnect();
		navSpeed = 1;
		Zero(gamepad);
		Zero(held);
		Zero(mouse);

		for (const sub of movementSubs ?? []) {
			sub.Disconnect();
		}
		movementSubs = undefined;

		ContextActionService.UnbindAction("FreecamMousePan");
		ContextActionService.UnbindAction("FreecamMouseWheel");
		ContextActionService.UnbindAction("FreecamGamepadThumbstick");
	}
}

function StepFreecam(dt: number) {
	const vel = velSpring.Update(dt, Input.Vel(dt));
	const fov = fovSpring.Update(dt, Input.Fov());

	// Zoomed in, the same wheel delta covers far less of the view, so the rate tapers with the current FOV.
	const zoomFactor = sqrt(tan(rad(70 / 2)) / tan(rad(cameraFov / 2)));
	cameraFov = clamp(cameraFov + fov * FOV_GAIN * (dt / zoomFactor), 1, 120);

	const cameraCFrame = new CFrame(cameraPos) //
		.mul(Camera.CFrame.Rotation)
		.mul(new CFrame(vel.mul(NAV_GAIN).mul(dt)));
	cameraPos = cameraCFrame.Position;

	const bounds = Freecam.bounds.get();
	if (bounds) {
		const min = bounds.size.div(-2);
		const max = bounds.size.div(2);

		let objCameraPos = bounds.center.PointToObjectSpace(cameraPos);
		objCameraPos = new Vector3(
			math.clamp(objCameraPos.X, min.X, max.X),
			math.clamp(objCameraPos.Y, min.Y, max.Y),
			math.clamp(objCameraPos.Z, min.Z, max.Z),
		);
		cameraPos = bounds.center.PointToWorldSpace(objCameraPos);
	}

	Camera.CFrame = cameraCFrame;
	Camera.Focus = cameraCFrame;
	Camera.FieldOfView = cameraFov;
}

function CheckMouseLockAvailability() {
	const devAllowsMouseLock = Players.LocalPlayer.DevEnableMouseLock;
	const devMovementModeIsScriptable =
		Players.LocalPlayer.DevComputerMovementMode === Enum.DevComputerMovementMode.Scriptable;
	const userHasMouseLockModeEnabled = GameSettings.ControlMode === Enum.ControlMode.MouseLockSwitch;
	const userHasClickToMoveEnabled = GameSettings.ComputerMovementMode === Enum.ComputerMovementMode.ClickToMove;
	const MouseLockAvailable =
		devAllowsMouseLock && userHasMouseLockModeEnabled && !userHasClickToMoveEnabled && !devMovementModeIsScriptable;

	return MouseLockAvailable;
}

namespace PlayerState {
	type current = {
		cameraType: Enum.CameraType;
		cameraCFrame: CFrame;
		cameraFocus: CFrame;
		fieldOfView: number;
		mouseBehavior: Enum.MouseBehavior;
		/** Captured per humanoid: a respawn mid-freecam gives a fresh one that was never frozen. */
		humanoid: Humanoid | undefined;
		walkSpeed: number;
	};
	let current: current | undefined;

	export function Push() {
		const humanoid = LocalPlayer.humanoid.get();
		current = {
			cameraType: Camera.CameraType,
			cameraCFrame: Camera.CFrame,
			cameraFocus: Camera.Focus,
			fieldOfView: Camera.FieldOfView,
			mouseBehavior:
				FFlagUserExitFreecamBreaksWithShiftlock && CheckMouseLockAvailability()
					? Enum.MouseBehavior.Default
					: UserInputService.MouseBehavior,
			humanoid,
			walkSpeed: humanoid?.WalkSpeed ?? 16,
		};

		Camera.CameraType = Enum.CameraType.Custom;
		UserInputService.MouseBehavior = Enum.MouseBehavior.Default;
		// The thumbstick drives the camera, and it is a GUI element no ContextActionService bind can sink —
		// so without this the same drag walks the character around underneath the freecam.
		if (humanoid) humanoid.WalkSpeed = 0;
	}
	export function Pop() {
		if (!current) return;

		Camera.CameraType = current.cameraType;
		Camera.CFrame = current.cameraCFrame;
		Camera.Focus = current.cameraFocus;
		Camera.FieldOfView = current.fieldOfView;
		UserInputService.MouseBehavior = current.mouseBehavior;
		if (current.humanoid?.Parent !== undefined) current.humanoid.WalkSpeed = current.walkSpeed;

		current = undefined;
	}
}

export namespace Freecam {
	export type Bounds = { readonly center: CFrame; readonly size: Vector3 };

	function start() {
		if (freecaming.get()) return;
		freecaming.set(true);
		(LocalPlayer.getPlayerModule().GetCameras() as unknown as { tppaused: boolean }).tppaused = true;

		const cameraCFrame = Camera.CFrame;
		cameraPos = cameraCFrame.Position;
		cameraFov = Camera.FieldOfView;

		velSpring.Reset(new Vector3());
		fovSpring.Reset(0);

		PlayerState.Push();
		RunService.BindToRenderStep("Freecam", Enum.RenderPriority.Camera.Value, StepFreecam);
		Input.StartCapture();
	}
	function stop() {
		if (!freecaming.get()) return;
		freecaming.set(false);
		(LocalPlayer.getPlayerModule().GetCameras() as unknown as { tppaused: boolean }).tppaused = false;

		Input.StopCapture();
		RunService.UnbindFromRenderStep("Freecam");
		PlayerState.Pop();
	}

	const freecaming = new ObservableValue(false);
	export const isFreecaming = freecaming.asReadonly();

	/** Resolves the movement definitions into live registrations. Called by the controller, which owns the DI. */
	export function initKeybinds(keybinds: Keybinds) {
		movement = Objects.mapValues(movementKeydefs, (_, def) => keybinds.fromDefinition(def));
	}

	export const bounds = new OverlayValueStorage<Freecam.Bounds | undefined>(undefined);
	export const toggle = new Action(() => {
		if (freecaming.get()) stop();
		else start();
	});
	toggle.enable();

	toggle.canExecute.subscribe((can) => {
		if (!can && isFreecaming.get()) {
			stop();
		}
	});
}
