import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		enabled: {
			displayName: "Enabled",
			types: {
				bool: {
					config: true,
				},
			},
		},
	},
	output: {
		connected: {
			displayName: "Connected",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

type HitchConnector = BasePart & {
	readonly Attachment: Attachment;
};
type HitchModel = BlockModel & {
	readonly Connector: HitchConnector;
};

const MATE_TOLERANCE = 0.2;
const allHitches = new Map<HitchModel, Logic>();

export type { Logic as HitchBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, HitchModel> {
	readonly connector: HitchConnector;
	private readonly touching = new Set<Logic>();
	partner?: Logic;
	joint?: BallSocketConstraint;
	enabled = false;

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
		const connector = this.instance.Connector;
		this.connector = connector;

		const nested = (other: Logic) => {
			const offset = connector.CFrame.PointToObjectSpace(other.connector.Position);
			const half = connector.Size.div(2);
			return math.abs(offset.X) <= half.X && math.abs(offset.Y) <= half.Y && math.abs(offset.Z) <= half.Z;
		};

		const connectable = (other: Logic) =>
			this.enabled &&
			other.enabled &&
			this.partner === undefined &&
			other.partner === undefined &&
			nested(other) &&
			connector.Attachment.WorldPosition.sub(other.connector.Attachment.WorldPosition).Magnitude <=
				MATE_TOLERANCE;

		const connect = (other: Logic) => {
			const joint = new Instance("BallSocketConstraint");
			joint.Attachment0 = connector.Attachment;
			joint.Attachment1 = other.connector.Attachment;
			joint.Parent = connector;

			this.partner = other;
			this.joint = joint;
			other.partner = this;
			other.joint = joint;
			this.updateOutput();
			other.updateOutput();
		};
		const disconnect = () => {
			const other = this.partner;
			if (other === undefined) return;

			this.joint?.Destroy();
			this.partner = undefined;
			this.joint = undefined;
			other.partner = undefined;
			other.joint = undefined;
			this.updateOutput();
			other.updateOutput();
		};

		const tryConnect = () => {
			if (this.partner !== undefined) return;
			for (const other of this.touching) {
				if (connectable(other)) {
					connect(other);
					return;
				}
			}
		};

		const connectorContact = (part: BasePart): Logic | undefined => {
			const model = BlockManager.tryGetBlockModelByPart(part);
			if (!model) return;
			const other = allHitches.get(model as HitchModel);
			if (other === undefined || other === this) return;
			return other;
		};

		this.onk(["enabled"], ({ enabled }) => {
			this.enabled = enabled;
			connector.CanTouch = enabled;
			if (!enabled) {
				this.touching.clear();
				disconnect();
			}
		});

		this.event.subscribe(connector.Touched, (part) => {
			const other = connectorContact(part);
			if (other === undefined) return;
			this.touching.add(other);
			tryConnect();
		});
		this.event.subscribe(connector.TouchEnded, (part) => {
			const other = connectorContact(part);
			if (other === undefined) return;
			this.touching.delete(other);
		});

		this.onEnable(() => {
			allHitches.set(this.instance, this);
			this.updateOutput();
		});
		this.onDisable(() => {
			this.touching.clear();
			disconnect();
			allHitches.delete(this.instance);
		});
	}

	updateOutput() {
		this.output.connected.set("bool", this.partner !== undefined);
	}
}

export const HitchBlock = {
	...BlockCreation.defaults,
	id: "hitch",
	displayName: "Hitch",
	description: "Connects to another hitch when enabled, swivel version of Coupling",

	search: {
		partialAliases: ["coupling", "tow", "trailer", "connector", "coupler"],
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
