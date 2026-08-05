import { Players } from "@rbxts/services";
import { t } from "engine/shared/t";
import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { BackMountBlockLogic, BackMountModel } from "shared/blocks/blocks/BackMountBlock";

const ATTACHMENT_NAME = "BackMountAttachment";
const ACCESSORY_NAME = "BackMountAccessory";
const WELD_NAME = "BackMountBlockWeld";

// Sets up everything on the character once per spawn:
//   - BackMountAttachment on torso (target for the Accessory)
//   - A persistent Accessory with an invisible Handle (welded to torso via Roblox's
//     auto-weld, putting it into the character-rig replication path)
//   - A pre-created WeldConstraint inside the Handle (Part1 unset until a block is worn)
// At equip we just point Part1 of that weld at the block's mainPart.
function ensureCharacterSetup(character: Model): void {
	const humanoid = character.FindFirstChildOfClass("Humanoid");
	if (!humanoid) return;

	const torso =
		humanoid.RigType === Enum.HumanoidRigType.R15
			? (character.FindFirstChild("UpperTorso") as BasePart | undefined)
			: (character.FindFirstChild("Torso") as BasePart | undefined);
	if (!torso) return;

	if (!torso.FindFirstChild(ATTACHMENT_NAME)) {
		const a = new Instance("Attachment");
		a.Name = ATTACHMENT_NAME;
		a.CFrame = new CFrame(0, 0, torso.Size.Z / 2);
		a.Parent = torso;
	}

	if (character.FindFirstChild(ACCESSORY_NAME)) return;

	const accessory = new Instance("Accessory");
	accessory.Name = ACCESSORY_NAME;

	const handle = new Instance("Part");
	handle.Name = "Handle";
	handle.Size = new Vector3(0.2, 0.2, 0.2);
	handle.Transparency = 1;
	handle.CanCollide = false;
	handle.CanQuery = false;
	handle.CanTouch = false;
	handle.Massless = true;

	const handleAttachment = new Instance("Attachment");
	handleAttachment.Name = ATTACHMENT_NAME;
	handleAttachment.Parent = handle;

	const weld = new Instance("WeldConstraint");
	weld.Name = WELD_NAME;
	weld.Part0 = handle;
	weld.Parent = handle;

	handle.Parent = accessory;
	humanoid.AddAccessory(accessory);
}

function hookPlayer(player: Player): void {
	if (player.Character) ensureCharacterSetup(player.Character);
	player.CharacterAdded.Connect(ensureCharacterSetup);
}

for (const player of Players.GetPlayers()) hookPlayer(player);
Players.PlayerAdded.Connect(hookPlayer);

@injectable
export class BackMountBlockServerLogic extends ServerBlockLogic<typeof BackMountBlockLogic> {
	constructor(logic: typeof BackMountBlockLogic, @inject playModeController: PlayModeController) {
		super(logic, playModeController);

		// Single-mount-per-player tracking + reverse lookup for isAlreadyWelded.
		const wornBlockByPlayer = new Map<Player, BackMountModel>();

		const isAlreadyWelded = (block: BackMountModel): boolean => {
			for (const [, b] of wornBlockByPlayer) {
				if (b === block) return true;
			}
			return false;
		};

		const getWeldFor = (character: Model): { handle: BasePart; weld: WeldConstraint } | undefined => {
			const accessory = character.FindFirstChild(ACCESSORY_NAME) as Accessory | undefined;
			const handle = accessory?.FindFirstChild("Handle") as BasePart | undefined;
			const weld = handle?.FindFirstChild(WELD_NAME) as WeldConstraint | undefined;
			if (!handle || !weld) return undefined;
			return { handle, weld };
		};

		/**
		 * What each block's owner declared about it, stamped from the sender rather than taken from the
		 * payload. The weld handler needs both: who may wear a private mount, and whether a public one is
		 * open to everyone.
		 */
		const declared = new Map<BackMountModel, { readonly owner: Player; readonly isPublic: boolean }>();

		logic.events.updateProximity.addServerMiddleware((invoker, arg) => {
			if (!invoker) return { success: true, value: arg };

			// Only the block's own owner configures it, and `owner` is what every client branches on, so it is
			// replaced with the sender instead of trusted.
			if (!this.isValidBlock(arg.block, invoker)) return "dontsend";

			if (!declared.has(arg.block)) {
				arg.block.Destroying.Connect(() => declared.delete(arg.block));
			}
			declared.set(arg.block, { owner: invoker, isPublic: arg.isPublic });

			return { success: true, value: { ...arg, owner: invoker } };
		});

		logic.events.weldMountUpdate.invoked.Connect((player, data) => {
			if (!player) return;
			// A2S validates nothing on its own, so the payload is checked before anything reads it
			if (!t.typeCheck(data, logic.weldType)) return;

			// Ownership is deliberately not checked here: a shared mount is worn by someone who does not own
			// it. What may be worn is decided below, from what the block's owner declared.
			if (!this.isValidBlock(data.block, player, false)) return;

			const mount = declared.get(data.block);
			if (!mount) return;
			if (player !== mount.owner && !mount.isPublic) return;

			const isWeldRequest = data.weldedState && !isAlreadyWelded(data.block);

			//weld if unwelded
			if (isWeldRequest) {
				const character = player.Character;
				if (!character) return;

				// Refuse if this player already wears another mount.
				if (wornBlockByPlayer.has(player)) return;

				const slot = getWeldFor(character);
				if (!slot) return;

				const mainPart = data.block.FindFirstChild("mainPart") as BasePart | undefined;
				if (!mainPart) return;

				// Position mainPart so its BackMountAttachment aligns with the Handle's.
				const blockAttachment = mainPart.FindFirstChild(ATTACHMENT_NAME) as Attachment | undefined;
				if (blockAttachment) mainPart.CFrame = slot.handle.CFrame.mul(blockAttachment.CFrame.Inverse());
				else mainPart.CFrame = slot.handle.CFrame;

				// Activate the pre-created weld.
				slot.weld.Part1 = mainPart;

				wornBlockByPlayer.set(player, data.block);

				// Hand the block + structure ownership to wearer so placer's client doesn't
				// fight the new welded position.
				task.defer(() => {
					if (!mainPart.Parent) return;
					const parts = [mainPart, ...mainPart.GetConnectedParts(true)];
					for (const p of parts) {
						if (!p.CanSetNetworkOwnership()[0]) continue;
						p.SetNetworkOwner(player);
					}
				});

				logic.events.updateLogic.send("everyone", {
					block: data.block,
					weldedTo: player,
				});
				return;
			}

			//unweld otherwise
			const character = player.Character;
			if (character) {
				const slot = getWeldFor(character);
				if (slot) slot.weld.Part1 = undefined;
			}
			wornBlockByPlayer.delete(player);

			logic.events.updateLogic.send("everyone", {
				block: data.block,
				weldedTo: undefined,
			});
		});

		// Clean up tracking if a player leaves while wearing a block.
		Players.PlayerRemoving.Connect((leaving) => {
			wornBlockByPlayer.delete(leaving);
		});
	}
}
