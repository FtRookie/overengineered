import { Players } from "@rbxts/services";
import { EventHandler } from "engine/shared/event/EventHandler";
import { t } from "engine/shared/t";
import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { BackMountBlockLogic, BackMountModel, BackMountState } from "shared/blocks/blocks/BackMountBlock";

const JOINT_NAME = "BackMountJoint";
const CHARACTER_ROOT_PRIORITY = 127;
const ROOT_PRIORITY_LEAD = 0.1; // seconds; every client must have the priority before the joint makes it pick a root
const WEAR_REACH = 22; // studs; the prompt allows 12, and the positions read here lag behind the wearer's client

type Mount = {
	readonly owner: Player;
	key: string;
	isPublic: boolean;
	connectToRootPart: boolean;
	wearer?: Player;
	joint?: Weld;
	rootPart?: BasePart;
	wearing?: EventHandler;
};

@injectable
export class BackMountBlockServerLogic extends ServerBlockLogic<typeof BackMountBlockLogic> {
	private readonly mounts = new Map<BackMountModel, Mount>();
	private readonly wornBy = new Map<Player, BackMountModel>();

	constructor(logic: typeof BackMountBlockLogic, @inject playModeController: PlayModeController) {
		super(logic, playModeController);

		logic.events.state.getExisting = ((stored: BackMountState): BackMountState => ({
			...stored,
			wearer: this.mounts.get(stored.block)?.wearer,
		})) as typeof logic.events.state.getExisting;

		logic.events.state.addServerMiddleware((invoker, arg) => {
			if (!invoker) return { success: true, value: arg };

			// a mount being worn keeps its wearer through a resend; only the configuration can change
			let mount = this.mounts.get(arg.block);
			if (mount) {
				mount.key = arg.key;
				mount.isPublic = arg.isPublic;
				mount.connectToRootPart = arg.connectToRootPart;
			} else {
				mount = {
					owner: invoker,
					key: arg.key,
					isPublic: arg.isPublic,
					connectToRootPart: arg.connectToRootPart,
				};
				this.mounts.set(arg.block, mount);
				arg.block.Destroying.Once(() => {
					this.release(arg.block, mount!);
					this.mounts.delete(arg.block);
				});
			}

			return { success: true, value: this.stateOf(arg.block, mount) };
		});

		logic.events.request.invoked.Connect((player, data) => {
			// a plain remote validates nothing, so the payload is checked before anything reads it
			if (!t.typeCheck(data, logic.requestType)) return;

			// ownership is decided below: a shared mount is worn by someone who does not own it
			if (!this.isValidBlock(data.block, player, false)) return;

			const mount = this.mounts.get(data.block);
			if (!mount) return;

			if (data.wear) this.tryWear(data.block, mount, player);
			else if (mount.wearer === player || mount.owner === player) this.release(data.block, mount);
		});

		Players.PlayerRemoving.Connect((player) => this.releaseWornBy(player));

		// the owner's despawn destroys the block, but someone wearing a shared mount gets no other event for theirs
		playModeController.playerModeChanged.Connect((player, mode) => {
			if (mode !== "ride") this.releaseWornBy(player);
		});
	}

	private stateOf(block: BackMountModel, mount: Mount): BackMountState {
		return {
			block,
			key: mount.key,
			isPublic: mount.isPublic,
			connectToRootPart: mount.connectToRootPart,
			owner: mount.owner,
			wearer: mount.wearer,
		};
	}

	private tryWear(block: BackMountModel, mount: Mount, player: Player) {
		if (mount.wearer || this.wornBy.has(player)) return;
		if (player !== mount.owner && !mount.isPublic) return;

		const character = player.Character;
		const humanoid = character?.FindFirstChildOfClass("Humanoid");
		const rootPart = humanoid?.RootPart;
		if (!character || !humanoid || !rootPart || humanoid.Health <= 0) return;

		const back = this.logic.getBackPart(humanoid, mount.connectToRootPart);
		const mainPart = block.FindFirstChild("mainPart") as BackMountModel["mainPart"] | undefined;
		const attachment = mainPart?.FindFirstChild("BackMountAttachment") as Attachment | undefined;
		if (!back || !mainPart || !attachment) return;

		// also refuses a build holding an anchored part, which would pin the wearer in place
		const [canOwn] = mainPart.CanSetNetworkOwnership();
		if (!canOwn) return;

		// the owner's reach is checked on their client: a motor welds the build there only, so past one the server's
		// assembly has a different root and its position stops updating
		if (player !== mount.owner && rootPart.Position.sub(mainPart.Position).Magnitude > WEAR_REACH) return;

		// a seat weld into the same build would close a loop with the joint made below
		if (humanoid.SeatPart) {
			humanoid.SeatPart.FindFirstChild("SeatWeld")?.Destroy();
			humanoid.Sit = false;
		}

		mount.wearer = player;
		mount.rootPart = rootPart;
		this.wornBy.set(player, block);

		const wearing = new EventHandler();
		mount.wearing = wearing;
		const release = () => this.release(block, mount);
		wearing.subscribe(humanoid.Died, release);
		wearing.subscribe(player.CharacterRemoving, release);
		// a joint outlives its Part0, so losing a character part would otherwise leave the mount claimed
		wearing.subscribe(rootPart.Destroying, release);
		wearing.subscribe(back.Destroying, release);

		// A large block outranks HumanoidRootPart by size. The root is also what replicates, so a client that picks
		// a different one stops following the wearer: this has to reach everyone before the joint does.
		rootPart.RootPriority = CHARACTER_ROOT_PRIORITY;
		mainPart.SetNetworkOwner(player);
		task.wait(ROOT_PRIORITY_LEAD);
		if (mount.wearing !== wearing) return;
		if (!mainPart.Parent || !back.Parent) {
			release();
			return;
		}

		const joint = new Instance("Weld");
		joint.Name = JOINT_NAME;
		joint.Part0 = back;
		joint.Part1 = mainPart;
		joint.C0 = this.logic.getBackOffset(back);
		joint.C1 = attachment.CFrame;
		joint.Parent = mainPart;

		mount.joint = joint;
		wearing.subscribe(joint.Destroying, () => {
			// destroying an instance from its own Destroying raises, and ownership handed back before the joint is
			// gone stays with the wearer once the assemblies split
			mount.joint = undefined;
			task.defer(release);
		});

		this.logic.events.state.send(this.stateOf(block, mount));
	}

	private releaseWornBy(player: Player) {
		const block = this.wornBy.get(player);
		const mount = block && this.mounts.get(block);
		if (block && mount) this.release(block, mount);
	}

	private release(block: BackMountModel, mount: Mount) {
		const { wearer, joint, rootPart, wearing } = mount;
		if (!wearer) return;

		mount.wearer = undefined;
		mount.joint = undefined;
		mount.rootPart = undefined;
		mount.wearing = undefined;
		this.wornBy.delete(wearer);

		wearing?.unsubscribeAll();
		joint?.Destroy();
		if (rootPart) rootPart.RootPriority = 0;

		const mainPart = block.FindFirstChild("mainPart") as BasePart | undefined;
		if (mainPart?.Parent) {
			const [canOwn] = mainPart.CanSetNetworkOwnership();
			if (canOwn) {
				if (mount.owner.Parent) mainPart.SetNetworkOwner(mount.owner);
				else mainPart.SetNetworkOwnershipAuto();
			}
		}

		if (block.Parent) this.logic.events.state.send(this.stateOf(block, mount));
	}
}
