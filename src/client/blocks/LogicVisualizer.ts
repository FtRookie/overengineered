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

		const parent = new Instance("Folder", Workspace);
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
		this.onEnable(() => setLabelsEnabled(false));

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
			let formatted = info.value;
			switch (info.type) {
				case "disabled":
					formatted = applyColor(info.value, config.DISABLED.color.ToHex());
					break;
				case "GARBAGE":
					formatted = applyColor(info.value, config.GARBAGE.color.ToHex());
					break;
				case "AVAILABLELATER":
					formatted = applyColor(info.value, config.AVAILATER.color.ToHex());
					break;
				case "bool":
					if (info.value === "true") {
						formatted = applyColor(info.value, config.true.color.ToHex());
						break;
					}
					if (info.value === "false") {
						formatted = applyColor(info.value, config.false.color.ToHex());
						break;
					}
					break;
				case "number": {
					formatted = applyColor(info.value, colorNumber(tonumber(info.value) ?? 0));
					break;
				}
				case "color": {
					if (!config.colorAsColor) break;
					const s = info.value.split(",").map((n) => tonumber(n) ?? 0);
					formatted = applyColor(info.value, new Color3(s[0], s[1], s[2]).ToHex());
					break;
				}
				case "vector3": {
					const s = info.value.split(",");
					const n = s.map((n) => tonumber(n) ?? 0);
					formatted = `${applyColor(s[0], colorNumber(n[0]))}, ${applyColor(s[1], colorNumber(n[1]))}, ${applyColor(s[2], colorNumber(n[2]))}`;
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
