import { Players, RunService, UserInputService } from "@rbxts/services";
import { EventHandler } from "engine/shared/event/EventHandler";
import { C2SRemoteEvent } from "engine/shared/event/PERemoteEvent";
import { Keys } from "engine/shared/fixes/Keys";
import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		detachKey: {
			displayName: "Attach/Detach",
			tooltip: "Attach or detach the back mount.",
			types: {
				key: {
					config: "H" as KeyCode,
				},
			},
			connectorHidden: true,
		},

		detachBool: {
			displayName: "Attach/Detach",
			tooltip: "Attach or detach the back mount.",
			types: {
				bool: {
					config: false,
				},
			},
			configHidden: true,
		},

		connectToRootPart: {
			displayName: "RootPart attachment",
			tooltip: "Make back mount attached to your RootPart instead of your actual back.",
			types: {
				bool: {
					config: true,
				},
			},
			connectorHidden: true,
		},

		shared: {
			displayName: "Shared",
			tooltip: "Allows other players to wear your back mount. It doesn't work as it used to.",
			types: {
				bool: {
					config: false,
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		mounted: {
			displayName: "Occupied",
			tooltip: "Returns true if player is mounted",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

export type BackMountModel = BlockModel & {
	ProximityPrompt: ProximityPrompt;
	mainPart: BasePart & {
		BackMountAttachment: Attachment;
	};
};

const PROMPT_DISTANCE = 12;
const PROMPT_DISTANCE_WORN = 15;
const REQUEST_COOLDOWN = 0.2; // seconds
const MIN_FORWARD = 0.01; // below this a mount faces straight up or down and has no heading

const blockType = t.instance("Model").nominal("blockModel").as<BackMountModel>();

const stateType = t.interface({
	block: blockType,
	// Left as a plain string rather than checked against the enum: `keyCodeFromName` already refuses an unknown
	// name, and a stricter type here would kick a player over a key rather than ignore it
	key: t.string,
	isPublic: t.boolean,
	connectToRootPart: t.boolean,
	// Both replaced server-side: every client branches on them, so a client-supplied value cannot be trusted
	owner: t.instance("Player"),
	wearer: t.instance("Player").orUndefined(),
});
export type BackMountState = t.Infer<typeof stateType>;

const requestType = t.interface({ block: blockType, wear: t.boolean });

/** Undefined for a name that is not a KeyCode; indexing the enum directly raises on an unknown name. */
const keyCodeFromName = (name: string): Enum.KeyCode | undefined => (Keys.isKey(name) ? Keys.Keys[name] : undefined);

// @client, follows what the server decides
const clientMounts = new Map<BackMountModel, { state: BackMountState; readonly handler: EventHandler }>();

let lastRequest = 0; // one key press can reach a prompt and the key handler in the same frame

const getBackPart = (humanoid: Humanoid, connectToRootPart: boolean): BasePart | undefined => {
	if (connectToRootPart) return humanoid.RootPart;

	const torsoName = humanoid.RigType === Enum.HumanoidRigType.R15 ? "UpperTorso" : "Torso";
	return humanoid.Parent?.FindFirstChild(torsoName) as BasePart | undefined;
};
const getBackOffset = (back: BasePart) => new CFrame(0, 0, back.Size.Z / 2);

// Run here because a motor welds the build on clients only, so past one the server's position is stale.
const moveToMount = ({ block, connectToRootPart }: BackMountState) => {
	const humanoid = Players.LocalPlayer.Character?.FindFirstChildOfClass("Humanoid");
	const rootPart = humanoid?.RootPart;
	if (!humanoid || !rootPart) return;

	// a seat weld would drag the seat's build along
	if (humanoid.SeatPart) return;

	const back = getBackPart(humanoid, connectToRootPart);
	if (!back || block.mainPart.AssemblyRootPart?.Anchored) return;

	const target = block.mainPart.CFrame.mul(block.mainPart.BackMountAttachment.CFrame).mul(
		getBackOffset(back).Inverse(),
	);

	// stays upright: turning to match a tilted mount tips the character over, so the weld turns the build instead
	const forward = target.LookVector.mul(new Vector3(1, 0, 1));
	const upright =
		forward.Magnitude < MIN_FORWARD
			? new CFrame(target.Position).mul(rootPart.CFrame.Rotation)
			: CFrame.lookAt(target.Position, target.Position.add(forward));

	rootPart.CFrame = upright.mul(back.CFrame.ToObjectSpace(rootPart.CFrame));
	rootPart.AssemblyLinearVelocity = Vector3.zero;
	rootPart.AssemblyAngularVelocity = Vector3.zero;
};

const requestWear = (state: BackMountState, wear: boolean) => {
	if (os.clock() - lastRequest < REQUEST_COOLDOWN) return;

	lastRequest = os.clock();
	if (wear) moveToMount(state);
	events.request.send({ block: state.block, wear });
};

const isWearingAny = () => {
	for (const [, { state }] of clientMounts) {
		if (state.wearer === Players.LocalPlayer) return true;
	}
	return false;
};

const canWear = (state: BackMountState) =>
	state.wearer === undefined && (state.owner === Players.LocalPlayer || state.isPublic) && !isWearingAny();
const canRemove = (state: BackMountState) =>
	state.wearer !== undefined && (state.wearer === Players.LocalPlayer || state.owner === Players.LocalPlayer);

const toggle = (state: BackMountState) => {
	if (canWear(state)) requestWear(state, true);
	else if (canRemove(state)) requestWear(state, false);
};

const distanceTo = (block: BackMountModel) =>
	Players.LocalPlayer.Character?.GetPivot().Position.sub(block.GetPivot().Position).Magnitude ?? math.huge;

const findKeyTarget = (keyCode: Enum.KeyCode) => {
	const me = Players.LocalPlayer;

	let target: BackMountState | undefined;
	let targetDistance = math.huge;
	for (const [block, { state }] of clientMounts) {
		if (keyCodeFromName(state.key) !== keyCode) continue;
		if (state.wearer === me) return state;
		if (!canWear(state) && !canRemove(state)) continue;

		const distance = distanceTo(block);
		// putting one on takes standing next to it; only taking one off works from anywhere
		if (canWear(state) && distance > PROMPT_DISTANCE) continue;

		if (target === undefined || distance < targetDistance) {
			target = state;
			targetDistance = distance;
		}
	}

	return target;
};

if (RunService.IsClient()) {
	UserInputService.InputBegan.Connect((input, gameProcessed) => {
		if (gameProcessed) return;

		const target = findKeyTarget(input.KeyCode);
		if (target) toggle(target);
	});
}

// every prompt: whether one mount can be worn depends on the others
const updatePrompts = () => {
	for (const [, { state }] of clientMounts) {
		const pp = state.block.ProximityPrompt;
		const key = keyCodeFromName(state.key);

		pp.ActionText = state.wearer ? "Detach" : "Attach";
		pp.MaxActivationDistance = state.wearer ? PROMPT_DISTANCE_WORN : PROMPT_DISTANCE;
		pp.Enabled = key !== undefined && (canWear(state) || canRemove(state));
		if (key) {
			pp.KeyboardKeyCode = key;
			pp.GamepadKeyCode = key;
		}
	}
};

const trackMount = (block: BackMountModel) => {
	const handler = new EventHandler();

	handler.subscribe(block.ProximityPrompt.Triggered, () => {
		const state = clientMounts.get(block)?.state;
		if (state) toggle(state);
	});

	block.Destroying.Once(() => {
		handler.unsubscribeAll();
		clientMounts.delete(block);
		updatePrompts();
	});

	return handler;
};

const applyState = (state: BackMountState) => {
	const block = state.block;
	if (!block.FindFirstChild("ProximityPrompt")) return;

	const existing = clientMounts.get(block);
	if (existing) existing.state = state;
	else clientMounts.set(block, { state, handler: trackMount(block) });

	updatePrompts();
};

const events = {
	state: new BlockSynchronizer<BackMountState>("backmount_state", stateType, applyState),
	request: new C2SRemoteEvent<t.Infer<typeof requestType>>("backmount_request"),
} as const;

export type { Logic as BackMountBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, BackMountModel> {
	static readonly events = events;
	static readonly requestType = requestType; // `request` is a plain remote, the server checks with this
	static readonly getBackPart = getBackPart;
	static readonly getBackOffset = getBackOffset;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		this.output.mounted.set("bool", false);

		this.onkFirstInputs(["detachKey", "shared", "connectToRootPart"], (inputs) => {
			events.state.send({
				block: this.instance,
				key: inputs.detachKey,
				isPublic: inputs.shared,
				connectToRootPart: inputs.connectToRootPart,
				owner: Players.LocalPlayer,
				wearer: undefined,
			});
		});

		this.onk(["detachBool"], ({ detachBoolChanged, detachBool }) => {
			if (!detachBoolChanged) return;
			if (detachBool && distanceTo(this.instance) > PROMPT_DISTANCE) return;

			const state = clientMounts.get(this.instance)?.state;
			if (detachBool && state && canWear(state)) moveToMount(state);

			events.request.send({ block: this.instance, wear: detachBool });
		});

		if (RunService.IsClient()) {
			this.event.subscribe(events.state.invoked, ({ block, wearer }) => {
				if (block !== this.instance) return;
				this.output.mounted.set("bool", wearer !== undefined);
			});
		}
	}
}

export const BackMountBlock = {
	...BlockCreation.defaults,
	id: "backmount",
	displayName: "Back Mount",
	description: "A mountable backpack. You can weld stuff to it and wear it.",
	limit: 15,

	search: {
		partialAliases: ["body", "backpack"],
	},

	// Only the synchronizer: this is what the global block-validity middleware is registered on
	logic: { definition, ctor: Logic, events: { state: events.state } },
} as const satisfies BlockBuilder;
