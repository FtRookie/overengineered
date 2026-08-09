import { ContextActionService, Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { Action } from "engine/client/Action";
import { Keybinds } from "engine/client/Keybinds";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { OverlayValueStorage } from "engine/shared/component/OverlayValueStorage";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Instances } from "engine/shared/fixes/Instances";
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
	freeCursor: Keybinds.registerDefinition(
		"freecam_freeCursor",
		["Freecam", "Free cursor"],
		[["LeftAlt"], ["RightAlt"]],
		INPUT_PRIORITY,
	),
} as const;
type MovementKey = keyof typeof movementKeydefs;

let movement: { readonly [k in MovementKey]: KeybindRegistration } | undefined;

const NAV_GAIN = Vector3.one.mul(64);
/** Snappy, so the camera goes where a builder points it. */
const BUILD_VEL_STIFFNESS = 5;
/**
 * The stock freecam's own value. Soft enough that the camera eases into a move and coasts out of it, which is
 * the whole difference in feel between placing a camera and flying one for a shot.
 */
const CINEMATIC_VEL_STIFFNESS = 1.5;
/**
 * Cinematic steers itself the way the stock freecam does — accumulating its own yaw and pitch from raw mouse
 * and thumbstick deltas through a spring — rather than reading back whatever the core camera settled on.
 * These are the stock values.
 */
const PAN_GAIN = new Vector2(0.75, 1).mul(8);
const PAN_STIFFNESS = 1;
const PITCH_LIMIT = rad(90);

class PanSpring {
	p = Vector2.zero;
	v = Vector2.zero;

	Update(dt: number, goal: Vector2) {
		const f = PAN_STIFFNESS * 2 * pi;
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

	Reset(pos: Vector2) {
		this.p = pos;
		this.v = pos.mul(0);
	}
}

class VelocitySpring {
	p = Vector3.zero;
	v = Vector3.zero;
	stiffness = BUILD_VEL_STIFFNESS;

	Update(dt: number, goal: Vector3) {
		const f = this.stiffness * 2 * pi;
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
/** Pitch and yaw, in radians. Only cinematic drives these; build takes the core camera's rotation. */
let cameraAngles = Vector2.zero;
const cinematicMode = new ObservableValue(false);
const velSpring = new VelocitySpring();
const panSpring = new PanSpring();
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
		freeCursor: 0,
	};
	let movementSubs: SignalConnection[] | undefined;

	const _mouse = {
		Delta: new Vector2(),
		MouseWheel: 0,
	};
	const mouse: typeof _mouse & { [k in Enum.UserInputType["Name"]]?: number } = _mouse;

	/**
	 * Touch has no MouseMovement to bind, so panning needs its own capture, and it cannot be a blanket sink
	 * like the others — the movement thumbstick and every button are touches too. The rules here are the core
	 * camera's (`CameraInput` in PlayerModule), which are not guessable: the dynamic thumbstick does not sink
	 * its own touches, so a finger starting over it has to be excluded by area rather than by `sunk`.
	 */
	const touches = new Map<InputObject, boolean>();
	let thumbstickTouch: InputObject | undefined;
	let touchDelta = Vector2.zero;
	let touchSubs: RBXScriptConnection[] | undefined;

	/**
	 * Pinch is measured from the two panning touches rather than from `UserInputService.TouchPinch`, so that it
	 * inherits the same thumbstick and sunk exclusions the pan has — a finger steering the thumbstick must not
	 * count as half a pinch. Accumulated in viewport heights rather than pixels, so the gesture covers the same
	 * zoom on a phone as on a tablet.
	 */
	let pinchSpan: number | undefined;
	let pinchDelta = 0;

	const NAV_GAMEPAD_SPEED = new Vector3(1, 1, 1);
	const NAV_KEYBOARD_SPEED = new Vector3(1, 1, 1);
	const PAN_MOUSE_SPEED = new Vector2(1, 1).mul(pi / 64);
	/** A finger covers fewer pixels than a mouse flick; 2x is the core camera's own touch-to-mouse ratio. */
	const PAN_TOUCH_SPEED = PAN_MOUSE_SPEED.mul(2);
	const PAN_GAMEPAD_SPEED = new Vector2(1, 1).mul(pi / 8);
	const NAV_ADJ_SPEED = 0.75;
	const FOV_WHEEL_SPEED = 1;
	/** Wheel ticks that a pinch spanning the whole viewport height is worth. */
	const FOV_PINCH_SPEED = 8;
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
			.mul(navSpeed * Freecam.speed.get() * (held.slow > 0 ? NAV_SHIFT_MUL : 1));
	}

	/** Held, the pointer is handed back so it can reach the UI, and the camera holds still. */
	export function isCursorFree() {
		return held.freeCursor > 0;
	}

	/** Consumes the accumulated mouse delta, the same way {@link Fov} consumes the wheel. */
	export function Pan() {
		// dropped rather than banked, so letting go of the key does not snap the view through everything the
		// pointer did on its way to a button
		if (isCursorFree()) {
			mouse.Delta = new Vector2();
			touchDelta = Vector2.zero;
			return Vector2.zero;
		}

		const kGamepad = new Vector2(
			thumbstickCurve(gamepad.Thumbstick2.Y),
			-thumbstickCurve(gamepad.Thumbstick2.X),
		).mul(PAN_GAMEPAD_SPEED);
		const kMouse = mouse.Delta.mul(PAN_MOUSE_SPEED);
		mouse.Delta = new Vector2();
		const kTouch = touchDelta.mul(PAN_TOUCH_SPEED);
		touchDelta = Vector2.zero;

		return kGamepad.add(kMouse).add(kTouch);
	}

	/** Consumes the accumulated wheel delta, so a frame that reads it twice would see nothing the second time. */
	export function Fov() {
		const kGamepad = (held.fovOut - held.fovIn) * FOV_GAMEPAD_SPEED;
		const kMouse = mouse.MouseWheel * FOV_WHEEL_SPEED;
		mouse.MouseWheel = 0;
		const kTouch = pinchDelta * FOV_PINCH_SPEED;
		pinchDelta = 0;

		return kGamepad + kMouse + kTouch;
	}

	function MousePan(action: string, state: Enum.UserInputState, input: InputObject) {
		const delta = input.Delta;
		mouse.Delta = new Vector2(-delta.Y, -delta.X);
		return Enum.ContextActionResult.Sink;
	}
	function isOverThumbstick(position: Vector3) {
		const playerGui = Player.FindFirstChildOfClass("PlayerGui");
		if (!playerGui) return false;

		const gui = Instances.findChild<ScreenGui>(playerGui, "TouchGui");
		if (!gui?.Enabled) return false;

		const frame = Instances.findChild<GuiObject>(gui, "TouchControlFrame", "DynamicThumbstickFrame");
		if (!frame) return false;

		const min = frame.AbsolutePosition;
		const max = min.add(frame.AbsoluteSize);
		return position.X >= min.X && position.Y >= min.Y && position.X <= max.X && position.Y <= max.Y;
	}
	function TouchBegan(input: InputObject, sunk: boolean) {
		if (thumbstickTouch === undefined && !sunk && isOverThumbstick(input.Position)) {
			thumbstickTouch = input;
			return;
		}

		touches.set(input, sunk);
	}
	function TouchChanged(input: InputObject, sunk: boolean) {
		if (input === thumbstickTouch) return;

		// a touch that began before capture started has no entry yet
		const known = touches.get(input) ?? sunk;
		touches.set(input, known);
		if (known) return;

		let first: InputObject | undefined;
		let second: InputObject | undefined;
		let unsunk = 0;
		for (const [touch, s] of touches) {
			if (s) continue;
			unsunk++;
			if (unsunk === 1) first = touch;
			else if (unsunk === 2) second = touch;
		}

		// A second finger zooms rather than pans; panning from both would double the rate.
		if (unsunk === 2) {
			const span = first!.Position.sub(second!.Position).Magnitude / Camera.ViewportSize.Y;
			// spreading the fingers narrows the view, the direction the wheel gives for scrolling forward
			if (pinchSpan !== undefined) pinchDelta -= span - pinchSpan;
			pinchSpan = span;
			return;
		}

		pinchSpan = undefined;
		if (unsunk !== 1) return;

		const delta = input.Delta;
		touchDelta = touchDelta.add(new Vector2(-delta.Y, -delta.X));
	}
	function TouchEnded(input: InputObject) {
		if (input === thumbstickTouch) thumbstickTouch = undefined;
		touches.delete(input);
		// lifting one finger of a pinch must not carry its span into the next one
		pinchSpan = undefined;
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

		touchSubs = [
			UserInputService.TouchStarted.Connect(TouchBegan),
			UserInputService.TouchMoved.Connect(TouchChanged),
			UserInputService.TouchEnded.Connect(TouchEnded),
		];

		const t = task.spawn(() => {
			const controls = LocalPlayer.getPlayerModule().GetControls();
			while (true as boolean) {
				task.wait();
				base = controls.GetMoveVector();
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

		for (const sub of touchSubs ?? []) {
			sub.Disconnect();
		}
		touchSubs = undefined;
		touches.clear();
		thumbstickTouch = undefined;
		touchDelta = Vector2.zero;
		pinchSpan = undefined;
		pinchDelta = 0;

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

	// Build reads back whatever the core camera settled on. Cinematic steers itself: the pan spring gives the
	// look a weight of its own, and because travel is expressed relative to that rotation, the drift carries
	// into the movement too. Zoomed in, the same deflection covers less of the view, so panning tapers with
	// FOV exactly as the wheel does.
	// Locked only while cinematic is actually steering: the free-cursor key hands the pointer back mid-shot.
	PlayerState.ApplyMouse(cinematicMode.get() && !Input.isCursorFree());

	let rotation;
	if (cinematicMode.get()) {
		// The spring keeps running while the cursor is free, so it decays to rest instead of resuming a
		// half-finished turn on release; only the angles stop taking it.
		const pan = panSpring.Update(dt, Input.Pan());
		if (!Input.isCursorFree()) {
			cameraAngles = cameraAngles.add(pan.mul(PAN_GAIN).mul(dt / zoomFactor));
			cameraAngles = new Vector2(clamp(cameraAngles.X, -PITCH_LIMIT, PITCH_LIMIT), cameraAngles.Y % (2 * pi));
		}

		rotation = CFrame.fromOrientation(cameraAngles.X, cameraAngles.Y, 0);
	} else {
		rotation = Camera.CFrame.Rotation;
	}

	let cameraCFrame = new CFrame(cameraPos) //
		.mul(rotation)
		.mul(new CFrame(vel.mul(NAV_GAIN).mul(dt)));
	cameraPos = cameraCFrame.Position;

	const bounds = cinematicMode.get() ? undefined : Freecam.bounds.get();
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
		cameraCFrame = new CFrame(cameraPos).mul(cameraCFrame.Rotation);
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
	type Current = {
		cameraType: Enum.CameraType;
		cameraCFrame: CFrame;
		cameraFocus: CFrame;
		fieldOfView: number;
		mouseBehavior: Enum.MouseBehavior;
		mouseIconEnabled: boolean;
		/** Captured per humanoid: a respawn mid-freecam gives a fresh one that was never frozen. */
		humanoid: Humanoid | undefined;
		walkSpeed: number;
		jumpPower: number;
		jumpHeight: number;
	};
	let current: Current | undefined;

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
			mouseIconEnabled: UserInputService.MouseIconEnabled,
			humanoid,
			walkSpeed: humanoid?.WalkSpeed ?? 16,
			jumpPower: humanoid?.JumpPower ?? 50,
			jumpHeight: humanoid?.JumpHeight ?? 7.2,
		};

		UserInputService.MouseBehavior = Enum.MouseBehavior.Default;
		if (humanoid) {
			humanoid.WalkSpeed = 0;
			humanoid.JumpPower = 0;
			humanoid.JumpHeight = 0;
		}
	}

	export function ApplyMode(cinematic: boolean) {
		Camera.CameraType = cinematic ? Enum.CameraType.Scriptable : Enum.CameraType.Custom;
		appliedLock = undefined;
	}

	let appliedLock: boolean | undefined;
	export function ApplyMouse(locked: boolean) {
		if (appliedLock === locked) return;
		appliedLock = locked;
		UserInputService.MouseIconEnabled = locked ? false : (current?.mouseIconEnabled ?? true);
		UserInputService.MouseBehavior = locked ? Enum.MouseBehavior.LockCenter : Enum.MouseBehavior.Default;
	}

	export function Pop() {
		if (!current) return;
		appliedLock = undefined;

		Camera.CameraType = current.cameraType;
		Camera.CFrame = current.cameraCFrame;
		Camera.Focus = current.cameraFocus;
		Camera.FieldOfView = current.fieldOfView;
		UserInputService.MouseBehavior = current.mouseBehavior;
		UserInputService.MouseIconEnabled = current.mouseIconEnabled;
		if (current.humanoid?.Parent !== undefined) {
			current.humanoid.WalkSpeed = current.walkSpeed;
			current.humanoid.JumpPower = current.jumpPower;
			current.humanoid.JumpHeight = current.jumpHeight;
		}

		current = undefined;
	}
}

export namespace Freecam {
	export type Bounds = { readonly center: CFrame; readonly size: Vector3 };

	function start(cinematic: boolean) {
		cinematicMode.set(cinematic);
		velSpring.stiffness = cinematic ? CINEMATIC_VEL_STIFFNESS : BUILD_VEL_STIFFNESS;

		// The other key switches modes mid-flight, so the shot is picked up from wherever it currently points
		// rather than snapping. Only the first two returns matter — roll is not carried.
		const [pitch, yaw] = Camera.CFrame.ToEulerAnglesYXZ();
		cameraAngles = new Vector2(pitch, yaw);
		panSpring.Reset(Vector2.zero);

		if (freecaming.get()) {
			PlayerState.ApplyMode(cinematic);
			return;
		}
		freecaming.set(true);
		(LocalPlayer.getPlayerModule().GetCameras() as unknown as { tppaused: boolean }).tppaused = true;

		cameraPos = Camera.CFrame.Position;
		cameraFov = Camera.FieldOfView;

		velSpring.Reset(new Vector3());
		fovSpring.Reset(0);

		PlayerState.Push();
		PlayerState.ApplyMode(cinematic);
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
	export const speed = new ObservableValue(1, (value) => math.clamp(value, 0.05, 2));
	export const isFreecaming = freecaming.asReadonly();
	/** Which of the two cameras is running; meaningless unless {@link isFreecaming}. */
	export const isCinematic = cinematicMode.asReadonly();

	/** Resolves the movement definitions into live registrations. Called by the controller, which owns the DI. */
	export function initKeybinds(keybinds: Keybinds) {
		movement = Objects.mapValues(movementKeydefs, (_, def) => keybinds.fromDefinition(def));
	}

	export const bounds = new OverlayValueStorage<Freecam.Bounds | undefined>(undefined);

	export const toggle = new Action(() => {
		if (freecaming.get() && !cinematicMode.get()) stop();
		else start(false);
	});
	export const cinematicToggle = new Action(() => {
		if (freecaming.get() && cinematicMode.get()) stop();
		else start(true);
	});
	toggle.enable();
	cinematicToggle.enable();

	/** Both cameras share one running state, so each gate only stops the one it actually owns. */
	toggle.canExecute.subscribe((can) => {
		if (!can && isFreecaming.get() && !cinematicMode.get()) stop();
	});
	cinematicToggle.canExecute.subscribe((can) => {
		if (!can && isFreecaming.get() && cinematicMode.get()) stop();
	});

	/** The frozen character position and the pushed camera state belong to the mode freecam started in. */
	export function stopForModeChange() {
		stop();
	}
}
