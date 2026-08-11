import { Workspace } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { ComponentInstance } from "engine/shared/component/ComponentInstance";
import { ReplicatedAssets } from "shared/ReplicatedAssets";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { BlockLogicTickContext, DebugInfo, GenericBlockLogic } from "shared/blockLogic/BlockLogic";
import type { BlockLogicRunner } from "shared/blockLogic/BlockLogicRunner";

@injectable
export class LogicVisualizer extends Component {
	constructor(runner: BlockLogicRunner, blocks: readonly GenericBlockLogic[], @inject playerData: PlayerDataStorage) {
		super();

		const parent = new Instance("Folder");
		parent.Parent = Workspace;
		parent.Name = "LogicVisualizer";
		ComponentInstance.init(this, parent);

		type label = BillboardGui & { readonly Label: TextLabel };
		const labelMap = new Map<GenericBlockLogic, label>();

		const labelTemplate = this.asTemplate(ReplicatedAssets.waitForAsset<label>("Wires", "MarkerValue"), false);

		const setLabelsEnabled = (enabled: boolean) => {
			for (const [, label] of labelMap) {
				label.Enabled = enabled;
			}
		};
		this.onEnable(() => setLabelsEnabled(true));
		this.onDisable(() => setLabelsEnabled(false));

		const config = playerData.config.get().visuals.logicDebug;
		const color = "FFFFFF";
		const applyColor = (val: string, color: string) => {
			return `<font color = "#${color}">${val}</font>`;
		};
		const colorNumber = (val: number): string => {
			if (!val) return color;
			if (val !== val) return config.nan.color.ToHex();
			return val === 0
				? config.numberZero.color.ToHex()
				: val > 0
					? config.numberPositive.color.ToHex()
					: config.numberNegative.color.ToHex();
		};
		const formatDebugInfo = (info: DebugInfo) => {
			// The sentinels carry no value; the type name is the text.
			switch (info.type) {
				case "disabled":
					return `${info.label} ${applyColor("!DISABLED!", config.DISABLED.color.ToHex())}`;
				case "GARBAGE":
					return `${info.label} ${applyColor("GARBAGE", config.GARBAGE.color.ToHex())}`;
				case "AVAILABLELATER":
					return `${info.label} ${applyColor("AVAILABLELATER", config.AVAILATER.color.ToHex())}`;
			}

			const value = info.value;
			if (value === undefined) return info.label;

			let formatted = tostring(value);
			switch (info.type) {
				case "bool":
					formatted = applyColor(formatted, (value === true ? config.true : config.false).color.ToHex());
					break;
				case "number": {
					formatted = applyColor(formatted, colorNumber(value as number));
					break;
				}
				case "color": {
					if (!config.colorAsColor) break;
					formatted = applyColor(formatted, (value as Color3).ToHex());
					break;
				}
				case "vector3": {
					const { X: x, Y: y, Z: z } = value as Vector3;
					formatted = `${applyColor(tostring(x), colorNumber(x))}, ${applyColor(tostring(y), colorNumber(y))}, ${applyColor(tostring(z), colorNumber(z))}`;
					break;
				}
			}

			return `${info.label} ${formatted}`;
		};
		const tick = (ctx: BlockLogicTickContext) => {
			for (const block of blocks) {
				const label = labelMap.getOrSet(block, () => {
					const label = labelTemplate();
					label.AlwaysOnTop = true;
					label.Name = block.instance!.Name;
					label.Adornee = block.instance!;
					label.Parent = parent;
					label.Label.TextStrokeColor3 = config.textStroke.color;
					label.Label.TextStrokeTransparency = 1 - config.textStroke.alpha;
					label.Label.TextSize = config.fontSize;

					return label;
				});

				const info = block.getDebugInfo(ctx).map((i) => formatDebugInfo(i));
				label.Label.Text = info.join("\n");
			}
		};
		this.event.subscribeRegistration(() => runner.onAfterTick(tick));
		this.onEnable(() => tick(runner.getContext(false)));
	}
}
