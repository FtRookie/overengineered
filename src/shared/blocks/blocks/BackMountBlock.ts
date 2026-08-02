import { Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { EventHandler } from "engine/shared/event/EventHandler";
import { A2SRemoteEvent, S2CRemoteEvent } from "engine/shared/event/PERemoteEvent";
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

// declaring constants here
const MAX_PROMPT_VISIBILITY_DISTANCE = 5;
const MAX_PROMPT_VISIBILITY_DISTANCE_EQUIPPED = 15;

/**
 * Undefined for a name that is not a KeyCode. Indexing the enum directly raises on an unknown name, and this
 * runs inside the synchronizer's shared handler, so one bad payload would throw on every client receiving it.
 */
const keyCodeFromName = (name: string): Enum.KeyCode | undefined =>
	Enum.KeyCode.GetEnumItems().find((item) => item.Name === name);

const owners = new Map<BackMountModel, Player | undefined>();
const updateWeld = (caller: Player, block: BackMountModel, connectToRootPart: boolean) => {
	const weldOwner = owners.get(block);

	if (weldOwner === undefined) {
		events.weldMountUpdate.send({
			block,
			weldedState: true,
			connectToRootPart,
		});
		return;
	}

	if (weldOwner === caller) {
		events.weldMountUpdate.send({
			block,
			weldedState: false,
			connectToRootPart,
		});
		return;
	}
};

const ownerSideInit = ({ block, key, connectToRootPart }: ProximityInferedType, pp: ProximityPrompt) => {
	// set activation key
	const k = keyCodeFromName(key);

	const player = Players.LocalPlayer;
	const mainPart = block.FindFirstChild("mainPart") as BasePart;
	if (!mainPart) return;

	// remote client event handler
	const handler = new EventHandler();

	// subscribe to block being destroyed
	handler.subscribe(block.DescendantRemoving, () => handler.unsubscribeAll());
	handler.subscribe(pp.Triggered, () => updateWeld(player, block, connectToRootPart));

	// subscribe to keypress
	handler.subscribe(UserInputService.InputBegan, (input, gameProccessed) => {
		if (gameProccessed) return;
		if (k === undefined) return;
		if (input.KeyCode !== k) return;

		updateWeld(player, block, connectToRootPart);
	});

	// some checks so the prompt disappears when player wearing
	handler.subscribe(RunService.PostSimulation, () => {
		const weldOwner = owners.get(block);
		if (weldOwner !== player) return;

		const camera = Workspace.CurrentCamera;
		if (!camera) return;

		const distance = camera.CFrame.Position.sub(mainPart.Position).Magnitude;
		pp.MaxActivationDistance = distance > MAX_PROMPT_VISIBILITY_DISTANCE_EQUIPPED ? 0 : distance;
	});
};

const otherClientSideInit = (
	{ block, key, isPublic, connectToRootPart }: ProximityInferedType,
	pp: ProximityPrompt,
) => {
	// set activation key
	const k = keyCodeFromName(key);

	const player = Players.LocalPlayer;
	const mainPart = block.FindFirstChild("mainPart") as BasePart;
	if (!mainPart) return;

	// remote client event handler
	const handler = new EventHandler();

	// subscribe to block being destroyed
	handler.subscribe(block.DescendantRemoving, () => handler.unsubscribeAll());
	handler.subscribe(pp.Triggered, () => updateWeld(player, block, connectToRootPart));

	// subscribe to keypress
	handler.subscribe(UserInputService.InputBegan, (input, gameProccessed) => {
		if (gameProccessed) return;
		if (k === undefined) return;
		if (input.KeyCode !== k) return;

		// make it only available to unweld on the same key
		if (owners.get(block) !== player) return;

		updateWeld(player, block, connectToRootPart);
	});

	// some checks so the prompt disappears when player wearing
	handler.subscribe(RunService.PostSimulation, () => {
		if (!isPublic) return;
		const weldOwner = owners.get(block);
		// these two checks are placed here ON PURPOSE
		// allows the owner of the block to unequip the block off other players
		if (weldOwner === undefined) {
			pp.MaxActivationDistance = MAX_PROMPT_VISIBILITY_DISTANCE_EQUIPPED;
			return;
		}

		if (weldOwner !== player) {
			pp.MaxActivationDistance = 0;
			return;
		}

		const camera = Workspace.CurrentCamera;
		if (!camera) return;

		const distance = camera.CFrame.Position.sub(mainPart.Position).Magnitude;
		pp.MaxActivationDistance = distance > MAX_PROMPT_VISIBILITY_DISTANCE_EQUIPPED ? 0 : distance;
	});
};

const updateProximity = (data: ProximityInferedType) => {
	const block = data.block;
	const key = data.key;
	const pp = block.FindFirstChild("ProximityPrompt") as typeof block.ProximityPrompt;
	if (!pp) return;

	// set activation key
	const k = keyCodeFromName(key);

	block.DescendantRemoving.Connect(() => owners.delete(block));

	if (k) {
		pp.KeyboardKeyCode = k;
		pp.GamepadKeyCode = k;
	} else pp.Enabled = false;

	if (data.owner === Players.LocalPlayer) {
		pp.Enabled = true;
		pp.MaxActivationDistance = MAX_PROMPT_VISIBILITY_DISTANCE;
		ownerSideInit(data, pp);
	} else {
		pp.Enabled = data.isPublic;
		pp.MaxActivationDistance = data.isPublic ? MAX_PROMPT_VISIBILITY_DISTANCE : 0;
		otherClientSideInit(data, pp);
	}
};

const proximityEventType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<BackMountModel>(),
	connectToRootPart: t.boolean,
	// Overwritten server-side with the actual sender; a client-supplied value decides which client takes the
	// owner branch below, so it cannot be taken on trust
	owner: t.instance("Player"),
	isPublic: t.boolean,
	// Left as a plain string rather than checked against the enum: `keyCodeFromName` already refuses an
	// unknown name, and a stricter type here would kick a player over a key rather than ignore it
	key: t.string,
});

type ProximityInferedType = t.Infer<typeof proximityEventType>;

/** Carries no owner: the server welds to whoever sent it, so a field naming someone else is only a spoof. */
const weldEventType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<BackMountModel>(),
	weldedState: t.boolean,
	connectToRootPart: t.boolean,
});

type WeldTypeEvent = t.Infer<typeof weldEventType>;

type LogicUpdateEvent = {
	readonly block: BackMountModel;
	readonly weldedTo: Player | undefined;
};

const events = {
	updateLogic: new S2CRemoteEvent<LogicUpdateEvent>("backmount_logic", "RemoteEvent"),
	weldMountUpdate: new A2SRemoteEvent<WeldTypeEvent>("backmount_weld", "RemoteEvent"),
	updateProximity: new BlockSynchronizer<ProximityInferedType>(
		"backmount_proximity",
		proximityEventType,
		updateProximity,
	),
} as const;

export type { Logic as BackMountBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, BackMountModel> {
	static readonly events = events;
	/** `weldMountUpdate` is an A2S event, which validates nothing on its own — the server checks with this. */
	static readonly weldType = weldEventType;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		// update pressable key
		this.onk(["detachKey", "shared", "connectToRootPart"], ({ detachKey, shared, connectToRootPart }) => {
			events.updateProximity.send({
				block: this.instance,
				key: detachKey,
				isPublic: shared,
				owner: Players.LocalPlayer,
				connectToRootPart,
			});
		});

		// call weld stuff on detach bool
		this.onk(["detachBool", "connectToRootPart"], ({ detachBoolChanged, detachBool, connectToRootPart }) => {
			if (!detachBoolChanged) return;
			events.weldMountUpdate.send({
				block: this.instance,
				weldedState: detachBool,
				connectToRootPart,
			});
		});

		if (RunService.IsClient()) {
			this.event.subscribe(events.updateLogic.invoked, ({ block, weldedTo }) => {
				if (block !== this.instance) return;
				this.output.mounted.set("bool", !!weldedTo);
			});
		}
	}
}

// add handler to make it constantly fill the map
events.updateLogic.invoked.Connect(({ block, weldedTo }) => {
	owners.set(block, weldedTo);
	const pp = block.FindFirstChild("ProximityPrompt") as typeof block.ProximityPrompt;
	if (!pp) return;
	pp.ActionText = weldedTo ? "Detach" : "Attach";
	pp.MaxActivationDistance = !weldedTo ? MAX_PROMPT_VISIBILITY_DISTANCE : 0;
});

export const BackMountBlock = {
	...BlockCreation.defaults,
	id: "backmount",
	displayName: "Back Mount",
	description: "A mountable backpack. You can weld stuff to it and wear it.",
	limit: 15,

	search: {
		partialAliases: ["body", "backpack"],
	},

	// Only the synchronizer: this is what the global block-validity middleware is registered on, and the other
	// two are plain remotes rather than synchronizers
	logic: { definition, ctor: Logic, events: { updateProximity: events.updateProximity } },
} as const satisfies BlockBuilder;
