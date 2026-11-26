import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { BlockCreation } from "shared/blocks/BlockCreation";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		key: {
			displayName: "Key",
			types: {
				bool: {
					config: false,
					control: {
						config: {
							enabled: true,
							key: "F",
							switch: false,
							reversed: false,
						},
						canBeSwitch: true,
						canBeReversed: true,
					},
				},
			},
			connectorHidden: true,
		},
		threshold: {
			displayName: "Hold Threshold",
			tooltip: "How long in seconds it takes to activate",
			types: {
				number: {
					config: 0,
					clamp: { min: 0, max: 60, step: 0.01, showAsSlider: true },
				},
			},
			connectorHidden: true,
		},
	},
	output: {
		result: {
			displayName: "Pressed",
			types: ["bool"],
		},
	},
} satisfies BlockLogicFullBothDefinitions;

const litColor = Color3.fromRGB(255, 255, 255);
/** The key cap's own look while it is lit, so a painted cap gets its paint back */
const unlit = new Map<BasePart, { readonly color: Color3; readonly material: Enum.Material }>();

const updateLampType = t.interface({
	block: t.instance("Model").nominal("blockModel").as<BlockModel>(),
	lit: t.boolean,
});
const updateLamp = ({ block, lit }: t.Infer<typeof updateLampType>) => {
	// the key cap in the middle, under the key icon; resolved, as a synchronizer only proves the block is the sender's
	const panel = block.FindFirstChild("untitled");
	if (!panel?.IsA("BasePart")) return;

	if (lit) {
		if (!unlit.has(panel)) unlit.set(panel, { color: panel.Color, material: panel.Material });
		panel.Color = litColor;
		panel.Material = Enum.Material.Neon;
		return;
	}

	const original = unlit.get(panel);
	if (!original) return;

	unlit.delete(panel);
	panel.Color = original.color;
	panel.Material = original.material;
};

const events = {
	updateLamp: new BlockSynchronizer("b_keysensor_lamp", updateLampType, updateLamp),
} as const;

export type { Logic as KeySensorBlockLogic };
@injectable
class Logic extends InstanceBlockLogic<typeof definition> {
	constructor(block: InstanceBlockLogicArgs, @tryInject playerDataStorage?: PlayerDataStorage) {
		super(definition, block);

		const effects = playerDataStorage?.config.get().graphics.logicEffects === true;
		let lit = false;
		const light = (on: boolean) => {
			if (!effects || on === lit) return;

			lit = on;
			events.updateLamp.sendOrBurn({ block: this.instance, lit }, this);
		};

		let heldFor: number | undefined;
		this.onAlwaysInputs(({ key, threshold }, ctx) => {
			if (!key) {
				heldFor = undefined;
				this.output.result.set("bool", false);
				light(false);
				return;
			}

			heldFor = heldFor === undefined ? 0 : heldFor + ctx.dt;
			this.output.result.set("bool", heldFor >= threshold);
			light(heldFor >= threshold);
		});

		this.unsetOutputsOnDisable();
		this.onDisable(() => (heldFor = undefined));
	}
}

export const KeySensorBlock = {
	...BlockCreation.defaults,
	id: "keysensor",
	displayName: "Key Sensor",
	description: "Returns true when the chosen button is pressed",

	logic: { definition, ctor: Logic, events },
} as const satisfies BlockBuilder;
