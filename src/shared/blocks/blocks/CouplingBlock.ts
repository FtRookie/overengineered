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

type CouplingModel = BlockModel & {
	readonly Connector: BasePart;
};

const LATCH_TOLERANCE = math.rad(3);
const AXIAL_STEP = math.pi / 4;
const AXIAL = Vector3.xAxis; // The direction pointing towards the mating surface
const FACE_FLIP = CFrame.fromAxisAngle(Vector3.yAxis, math.pi);

const allCouplings = new Map<CouplingModel, Logic>();

const nearestLatch = (c0: CFrame, c1: CFrame) => {
	const rel = c0.ToObjectSpace(c1);
	const rotation = rel.Rotation;

	let best = FACE_FLIP;
	let bestAngle = math.huge;
	for (let k = 0; k < 8; k++) {
		const candidate = FACE_FLIP.mul(CFrame.fromAxisAngle(AXIAL, k * AXIAL_STEP));
		const [, angle] = rotation.ToObjectSpace(candidate).ToAxisAngle();
		if (angle < bestAngle) {
			bestAngle = angle;
			best = candidate;
		}
	}

	return $tuple(new CFrame(rel.Position).mul(best), bestAngle);
};

export type { Logic as CouplingBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, CouplingModel> {
	readonly connector: BasePart;
	partner?: Logic;
	weld?: Weld;
	enabled = false;
	private readonly touching = new Set<Logic>();

	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);
		const connector = this.instance.Connector;
		this.connector = connector;

		const connectable = (other: Logic) => {
			if (!this.enabled || !other.enabled) return false;
			if (this.partner !== undefined || other.partner !== undefined) return false;

			const [, angle] = nearestLatch(connector.CFrame, other.connector.CFrame);
			return angle <= LATCH_TOLERANCE;
		};

		const connect = (other: Logic) => {
			const [offset] = nearestLatch(connector.CFrame, other.connector.CFrame);

			const weld = new Instance("Weld");
			weld.Part0 = connector;
			weld.Part1 = other.connector;
			weld.C0 = offset;
			weld.Parent = connector;

			this.partner = other;
			this.weld = weld;
			other.partner = this;
			other.weld = weld;
			this.updateOutput();
			other.updateOutput();
		};
		const disconnect = () => {
			const other = this.partner;
			if (other === undefined) return;

			this.weld?.Destroy();
			this.partner = undefined;
			this.weld = undefined;
			other.partner = undefined;
			other.weld = undefined;
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
			const other = allCouplings.get(model as CouplingModel);
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
			allCouplings.set(this.instance, this);
			this.updateOutput();
		});
		this.onDisable(() => {
			this.touching.clear();
			disconnect();
			allCouplings.delete(this.instance);
		});
	}

	updateOutput() {
		this.output.connected.set("bool", this.partner !== undefined);
	}
}

export const CouplingBlock = {
	...BlockCreation.defaults,
	id: "coupling",
	displayName: "Coupling",
	description: "Connects to another coupling when enabled, rigid version of Hitch",

	search: {
		partialAliases: ["hitch", "tow", "trailer", "connector", "coupler"],
	},

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
