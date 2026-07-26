import { RunService, UserInputService, Workspace } from "@rbxts/services";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { HostedService } from "engine/shared/di/HostedService";
import { ObservableValue } from "engine/shared/event/ObservableValue";

const BASE_SPEED = 60; // studs/s at 1x speed
const BOOST_RATE = 2; // speed-multiplier change per second at hold start
const BOOST_ACCEL = 4; // growth of that rate per second held

/**
 * Admin noclip/fly, toggled from the admin panel. Client-only (no server movement anti-cheat). A LinearVelocity
 * holds the target velocity (gravity cancelled, zero input hovers) and an AlignOrientation matches the camera.
 * WASD + E/Q move; Shift/Ctrl ramp the speed up/down, accelerating the longer held.
 */
@injectable
export class FlyController extends HostedService {
	/** True while flying — read by CharacterIntegrityChecker (whitelist) and RagdollController (no auto-ragdoll). */
	static active = false;

	readonly enabled = new ObservableValue<boolean>(false);
	private restore?: () => void;
	private speedMultiplier = 1;
	private holdTime = 0; // seconds Shift/Ctrl held, feeds the accelerating ramp

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

		this.restore = () => {
			for (const connection of connections) connection.Disconnect();
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

		const shift = UserInputService.IsKeyDown(Enum.KeyCode.LeftShift);
		const ctrl = UserInputService.IsKeyDown(Enum.KeyCode.LeftControl);
		if (shift || ctrl) {
			this.holdTime += dt;
			const delta = (BOOST_RATE + BOOST_ACCEL * this.holdTime) * dt;
			if (shift) this.speedMultiplier += delta;
			if (ctrl) this.speedMultiplier = math.max(0, this.speedMultiplier - delta);
		} else {
			this.holdTime = 0;
		}

		const forward =
			(UserInputService.IsKeyDown(Enum.KeyCode.W) ? 1 : 0) - (UserInputService.IsKeyDown(Enum.KeyCode.S) ? 1 : 0);
		const strafe =
			(UserInputService.IsKeyDown(Enum.KeyCode.D) ? 1 : 0) - (UserInputService.IsKeyDown(Enum.KeyCode.A) ? 1 : 0);
		const vertical =
			(UserInputService.IsKeyDown(Enum.KeyCode.E) ? 1 : 0) - (UserInputService.IsKeyDown(Enum.KeyCode.Q) ? 1 : 0);

		const direction = camcf.LookVector.mul(forward)
			.add(camcf.RightVector.mul(strafe))
			.add(new Vector3(0, vertical, 0));
		const speed = BASE_SPEED * this.speedMultiplier;
		velocity.VectorVelocity = direction.Magnitude > 0.001 ? direction.Unit.mul(speed) : Vector3.zero;
	}
}
