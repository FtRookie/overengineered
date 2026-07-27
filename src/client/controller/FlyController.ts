import { ContextActionService, RunService, UserInputService, Workspace } from "@rbxts/services";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { HostedService } from "engine/shared/di/HostedService";
import { ObservableValue } from "engine/shared/event/ObservableValue";

const BASE_SPEED = 60; // studs/s at 1x speed
const BOOST_RATE = 2; // speed-multiplier change per second at hold start
const BOOST_ACCEL = 4; // growth of that rate per second held

/**
 * Admin noclip/fly, toggled from the admin panel. Client-only (no server movement anti-cheat). A LinearVelocity
 * holds the target velocity (gravity cancelled, zero input hovers) and an AlignOrientation matches the camera.
 * Movement comes from the active control scheme (WASD, mobile thumbstick, gamepad) plus E/Q for up/down; Shift/Ctrl
 * ramp the speed up/down, accelerating the longer held. On mobile, up/down and faster/slower get on-screen buttons.
 */
@injectable
export class FlyController extends HostedService {
	/** True while flying — read by CharacterIntegrityChecker (whitelist) and RagdollController (no auto-ragdoll). */
	static active = false;

	readonly enabled = new ObservableValue<boolean>(false);
	private restore?: () => void;
	private speedMultiplier = 1;
	private holdTime = 0; // seconds Shift/Ctrl held, feeds the accelerating ramp
	private controls?: { GetMoveVector(): Vector3 };
	// Mobile touch-button hold states, OR-ed with the keyboard axes in step().
	private upHeld = false;
	private downHeld = false;
	private speedUpHeld = false;
	private slowDownHeld = false;

	constructor() {
		super();

		this.event.subscribeObservable(this.enabled, (on) => (on ? this.start() : this.stop()), true);
		// re-apply across respawns while flying (root becomes undefined on death, a fresh one on spawn)
		this.event.subscribeObservable(LocalPlayer.rootPart, (root) => {
			if (!this.enabled.get()) return;
			this.stop();
			if (root) this.start();
		});
		this.onDestroy(() => this.stop());
	}

	private start() {
		if (this.restore) return;
		const character = LocalPlayer.character.get();
		const humanoid = LocalPlayer.humanoid.get();
		const root = LocalPlayer.rootPart.get();
		if (!character || !humanoid || !root) return; // no character yet; the rootPart subscription retries on spawn

		FlyController.active = true;
		this.speedMultiplier = 1;
		this.holdTime = 0;

		const connections: RBXScriptConnection[] = [];
		const originalCollide = new Map<BasePart, boolean>();

		// Force collision off and watch it: the humanoid can flip it back on, and accessories appear late.
		const noclip = (part: BasePart) => {
			if (originalCollide.has(part)) return;
			originalCollide.set(part, part.CanCollide);
			part.CanCollide = false;
			connections.push(
				part.GetPropertyChangedSignal("CanCollide").Connect(() => {
					if (part.CanCollide) part.CanCollide = false;
				}),
			);
		};
		for (const part of character.GetDescendants()) {
			if (part.IsA("BasePart")) noclip(part);
		}
		connections.push(
			character.DescendantAdded.Connect((desc) => {
				if (desc.IsA("BasePart")) noclip(desc);
			}),
		);

		const prevPlatformStand = humanoid.PlatformStand;
		humanoid.PlatformStand = true; // stop the humanoid fighting the constraints below

		const attachment = new Instance("Attachment");
		attachment.Parent = root;

		const velocity = new Instance("LinearVelocity");
		velocity.Attachment0 = attachment;
		velocity.RelativeTo = Enum.ActuatorRelativeTo.World;
		velocity.VelocityConstraintMode = Enum.VelocityConstraintMode.Vector;
		velocity.ForceLimitMode = Enum.ForceLimitMode.Magnitude;
		velocity.MaxForce = math.huge;
		velocity.VectorVelocity = Vector3.zero;
		velocity.Parent = root;

		const orientation = new Instance("AlignOrientation");
		orientation.Attachment0 = attachment;
		orientation.Mode = Enum.OrientationAlignmentMode.OneAttachment;
		orientation.RigidityEnabled = true;
		orientation.CFrame = root.CFrame.Rotation;
		orientation.Parent = root;

		connections.push(RunService.PreRender.Connect((dt) => this.step(dt, root, velocity, orientation)));

		this.controls = LocalPlayer.getPlayerModule().GetControls();

		// Mobile touch buttons for the axes the keyboard covers with E/Q and Shift/Ctrl. createTouchButton renders
		// only on touch devices, so desktop is unaffected. Positions are rough — tune to taste.
		const buttons: readonly [action: string, title: string, position: UDim2, set: (held: boolean) => void][] = [
			["flyUp", "↑", new UDim2(1, -100, 0.5, -60), (h) => (this.upHeld = h)],
			["flyDown", "↓", new UDim2(1, -100, 0.5, 30), (h) => (this.downHeld = h)],
			["flyFaster", "+", new UDim2(1, -190, 0.5, -60), (h) => (this.speedUpHeld = h)],
			["flySlower", "−", new UDim2(1, -190, 0.5, 30), (h) => (this.slowDownHeld = h)],
		];
		for (const [action, title, position, set] of buttons) {
			ContextActionService.BindAction(
				action,
				(_name, state) => {
					set(state === Enum.UserInputState.Begin);
					return Enum.ContextActionResult.Pass;
				},
				true,
			);
			ContextActionService.SetTitle(action, title);
			ContextActionService.SetPosition(action, position);
		}

		this.restore = () => {
			for (const connection of connections) connection.Disconnect();
			for (const [action] of buttons) ContextActionService.UnbindAction(action);
			this.upHeld = this.downHeld = this.speedUpHeld = this.slowDownHeld = false;
			this.controls = undefined;
			velocity.Destroy();
			orientation.Destroy();
			attachment.Destroy();
			for (const [part, collide] of originalCollide) {
				if (part.Parent !== undefined) part.CanCollide = collide;
			}
			if (humanoid.Parent !== undefined) humanoid.PlatformStand = prevPlatformStand;
			FlyController.active = false;
		};
	}

	private stop() {
		this.restore?.();
		this.restore = undefined;
	}

	private step(dt: number, root: BasePart, velocity: LinearVelocity, orientation: AlignOrientation) {
		if (root.Parent === undefined) return;
		const camera = Workspace.CurrentCamera;
		if (!camera) return;
		const camcf = camera.CFrame;

		orientation.CFrame = camcf.Rotation;

		if (UserInputService.GetFocusedTextBox() !== undefined) {
			velocity.VectorVelocity = Vector3.zero; // hover, don't fly while typing
			return;
		}

		// Keyboard Shift/Ctrl, or the mobile faster/slower buttons — ramp the speed multiplier, accelerating held.
		const shift = this.speedUpHeld || UserInputService.IsKeyDown(Enum.KeyCode.LeftShift);
		const ctrl = this.slowDownHeld || UserInputService.IsKeyDown(Enum.KeyCode.LeftControl);
		if (shift || ctrl) {
			this.holdTime += dt;
			const delta = (BOOST_RATE + BOOST_ACCEL * this.holdTime) * dt;
			if (shift) this.speedMultiplier += delta;
			if (ctrl) this.speedMultiplier = math.max(0, this.speedMultiplier - delta);
		} else {
			this.holdTime = 0;
		}

		// Horizontal input from the active control scheme (WASD, mobile thumbstick, or gamepad). GetMoveVector is
		// camera-relative, so VectorToWorldSpace maps it onto the look/right axes — the same feel as the old WASD.
		const horizontal = camcf.VectorToWorldSpace(this.controls?.GetMoveVector() ?? Vector3.zero);
		// Keyboard E/Q, or the mobile up/down buttons.
		const vertical =
			(this.upHeld || UserInputService.IsKeyDown(Enum.KeyCode.E) ? 1 : 0) -
			(this.downHeld || UserInputService.IsKeyDown(Enum.KeyCode.Q) ? 1 : 0);

		const direction = horizontal.add(new Vector3(0, vertical, 0));
		const speed = BASE_SPEED * this.speedMultiplier;
		velocity.VectorVelocity = direction.Magnitude > 0.001 ? direction.Unit.mul(speed) : Vector3.zero;
	}
}
