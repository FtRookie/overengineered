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

const owners = new Map<BackMountModel, Player | undefined>();
const updateWeld = (caller: Player, owner: Player, block: BackMountModel, connectToRootPart: boolean) => {
	const weldOwner = owners.get(block);

	if (weldOwner === undefined) {
		Logic.events.weldMountUpdate.send({
			block,
			weldedState: true,
			owner,
			connectToRootPart,
		});
		return;
	}

	if (weldOwner === caller) {
		Logic.events.weldMountUpdate.send({
			block,
			weldedState: false,
			owner,
			connectToRootPart,
		});
		return;
	}
};

const ownerSideInit = ({ block, key, owner, connectToRootPart }: proximityInferedType, pp: ProximityPrompt) => {
	// set activation key
	const k = Enum.KeyCode[key as unknown as never];
	const isUnknownKeybind = k === Enum.KeyCode.Unknown;

	const player = Players.LocalPlayer;
	const mainPart = block.FindFirstChild("mainPart") as BasePart;
	if (!mainPart) return;

	// remote client event handler
	const handler = new EventHandler();

	// subscribe to block being destroyed
	handler.subscribe(block.DescendantRemoving, () => handler.unsubscribeAll());
	handler.subscribe(pp.Triggered, () => updateWeld(player, owner, block, connectToRootPart));

	// subscribe to keypress
	handler.subscribe(UserInputService.InputBegan, (input, gameProccessed) => {
		if (gameProccessed) return;
		if (isUnknownKeybind) return;
		if (input.KeyCode !== k) return;

		updateWeld(player, owner, block, connectToRootPart);
	});

	// some checks so the prompt disappears when player wearing
	handler.subscribe(RunService.Heartbeat, () => {
		const weldOwner = owners.get(block);
		if (weldOwner !== player) return;

		const camera = Workspace.CurrentCamera;
		if (!camera) return;

		const distance = camera.CFrame.Position.sub(mainPart.Position).Magnitude;
		pp.MaxActivationDistance = distance > MAX_PROMPT_VISIBILITY_DISTANCE_EQUIPPED ? 0 : distance;
	});
};

const otherClientSideInit = (
	{ block, key, isPublic, owner, connectToRootPart }: proximityInferedType,
	pp: ProximityPrompt,
) => {
	// set activation key
	const k = Enum.KeyCode[key as unknown as never];
	const isUnknownKeybind = k === Enum.KeyCode.Unknown;

	const player = Players.LocalPlayer;
	const mainPart = block.FindFirstChild("mainPart") as BasePart;
	if (!mainPart) return;

	// remote client event handler
	const handler = new EventHandler();

	// subscribe to block being destroyed
	handler.subscribe(block.DescendantRemoving, () => handler.unsubscribeAll());
	handler.subscribe(pp.Triggered, () => updateWeld(player, owner, block, connectToRootPart));

	// subscribe to keypress
	handler.subscribe(UserInputService.InputBegan, (input, gameProccessed) => {
		if (gameProccessed) return;
		if (isUnknownKeybind) return;
		if (input.KeyCode !== k) return;

		// make it only available to unweld on the same key
		if (owners.get(block) !== player) return;

		updateWeld(player, owner, block, connectToRootPart);
	});

	// some checks so the prompt disappears when player wearing
	handler.subscribe(RunService.Heartbeat, () => {
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

const updateProximity = (data: proximityInferedType) => {
	const block = data.block;
	const key = data.key;
	const pp = block.FindFirstChild("ProximityPrompt") as typeof block.ProximityPrompt;
	if (!pp) return;

	// set activation key
	const k = Enum.KeyCode[key as unknown as never];
	const isUnknownKeybind = k === Enum.KeyCode.Unknown;

	block.DescendantRemoving.Connect(() => owners.delete(block));

	if (!isUnknownKeybind) {
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
	owner: t.any.as<Player>(),
	isPublic: t.boolean,
	key: t.string,
});

type proximityInferedType = t.Infer<typeof proximityEventType>;

type weldTypeEvent = {
	readonly block: BackMountModel;
	readonly weldedState: boolean;
	readonly owner: Player;
	readonly connectToRootPart: boolean;
};

type logicUpdateEvent = {
	readonly block: BackMountModel;
	readonly weldedTo: Player | undefined;
};

export type { Logic as BackMountBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, BackMountModel> {
	static readonly events = {
		updateLogic: new S2CRemoteEvent<logicUpdateEvent>("backmount_logic", "RemoteEvent"),
		weldMountUpdate: new A2SRemoteEvent<weldTypeEvent>("backmount_weld", "RemoteEvent"),
		updateProximity: new BlockSynchronizer<proximityInferedType>(
			"backmount_proximity",
			proximityEventType,
			updateProximity,
		),
	} as const;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		// update pressable key
		this.onk(["detachKey", "shared", "connectToRootPart"], ({ detachKey, shared, connectToRootPart }) => {
			Logic.events.updateProximity.send({
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
			Logic.events.weldMountUpdate.send({
				block: this.instance,
				weldedState: detachBool,
				owner: Players.LocalPlayer,
				connectToRootPart,
			});
		});

		if (RunService.IsClient()) {
			this.event.subscribe(Logic.events.updateLogic.invoked, ({ block, weldedTo }) => {
				if (block !== this.instance) return;
				this.output.mounted.set("bool", !!weldedTo);
			});
		}
	}
}

// add handler to make it constantly fill the map
Logic.events.updateLogic.invoked.Connect(({ block, weldedTo }) => {
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

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
