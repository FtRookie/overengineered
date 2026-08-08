import { ObservableValue } from "engine/shared/event/ObservableValue";
import { BlockConfig } from "shared/blockLogic/BlockConfig";
import { Colors } from "shared/Colors";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type { BlockLogicFullInputDef, BlockLogicFullOutputDef } from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { SharedPlot } from "shared/building/SharedPlot";

export namespace BlockWireManager {
	type DataType = keyof BlockLogicTypes.Primitives;
	type MarkerData = {
		readonly id: BlockConnectionName;
		readonly name: string;
		readonly blockId: BlockId;
		readonly blockUuid: BlockUuid;
		readonly dataTypes: readonly DataType[];
		readonly group: string | undefined;
	};

	export const types: { readonly [k in DataType]: { readonly color: Color3 } } = {
		bool: { color: Color3.fromRGB(252, 252, 105) },
		vector3: { color: Color3.fromRGB(244, 142, 255) },
		number: { color: Color3.fromRGB(48, 173, 85) },
		string: { color: Color3.fromRGB(120, 18, 120) },
		key: { color: Color3.fromRGB(237, 184, 51) },
		color: { color: Color3.fromRGB(255, 73, 76) },
		byte: { color: Color3.fromRGB(97, 138, 255) },
		bytearray: { color: Color3.fromRGB(15, 69, 217) },
		code: { color: Color3.fromRGB(0, 0, 0) },
		enum: { color: Color3.fromRGB(100, 100, 100) },
		sound: { color: Color3.fromRGB(61, 217, 227) },
		unset: { color: Colors.white },
		wire: { color: Colors.white },
		particle: { color: Color3.fromRGB(110, 237, 26) },
	};

	export function intersectTypes(types: readonly (readonly DataType[])[]): readonly DataType[] {
		if (types.size() === 1) {
			return types[0];
		}

		let result: readonly DataType[] | undefined;
		for (const typearr of types) {
			if (!result) {
				result = typearr;
				continue;
			}
			if (result.size() === 0) {
				break;
			}

			const setA = new Set(typearr);
			result = result.filter((value) => setA.has(value));
		}

		if (!result) {
			throw "AAAAAAAAAAAAAAAAAAAAA";
		}

		return result;
	}
	export function canConnect(output: Markers.Marker, input: Markers.Input): boolean {
		const isNotConnected = (input: Markers.Input): boolean => {
			return !input.isConnected();
		};
		const areSameType = (output: Markers.Marker, input: Markers.Input): boolean => {
			const intypes = input.availableTypes.get();
			const outtypes = output.availableTypes.get();

			return (
				outtypes.find((t) => intypes.includes(t)) !== undefined &&
				intypes.find((t) => outtypes.includes(t)) !== undefined
			);
		};

		return isNotConnected(input) && areSameType(output, input);
	}

	export function fromPlot(plot: SharedPlot, blockList: BlockList, treatDisconnectedAsUnset?: readonly BlockUuid[]) {
		return from(plot.getBlockDatas(), blockList, treatDisconnectedAsUnset);
	}

	export type BlockDataForWireManager = {
		readonly id: BlockId;
		readonly uuid: BlockUuid;
		readonly config?: PlacedBlockConfig;
	};
	export function from(
		blocks: readonly BlockDataForWireManager[],
		blockList: BlockList,
		treatDisconnectedAsUnset?: readonly BlockUuid[],
		treatUnsetAsUnset: boolean = false,
	) {
		const toNarrow: Markers.Marker[] = [];
		const markersByBlock = new Map<BlockUuid, Map<string, Markers.Input | Markers.Output>>();
		const markers = new Map<string, Markers.Marker>();

		for (const block of blocks) {
			const definition = blockList.blocks[block.id]?.logic?.definition;
			if (!definition) continue;
			const cfg = BlockConfig.addDefaults(block.config, definition.input, treatUnsetAsUnset);

			const add = (
				key: string,
				def: BlockLogicFullInputDef | BlockLogicFullOutputDef,
				types: readonly (keyof BlockLogicTypes.Primitives)[],
				markerType: "input" | "output",
			) => {
				let narrow = false;
				let dataTypes: readonly DataType[];

				{
					const existingcfg = cfg[key];
					if (
						treatDisconnectedAsUnset?.includes(block.uuid) ||
						existingcfg === undefined ||
						existingcfg.type === "unset" ||
						existingcfg.type === "wire"
					) {
						dataTypes = types;
					} else {
						dataTypes = [existingcfg.type];
						narrow = true;
					}
				}

				const data: MarkerData = {
					blockId: block.id,
					blockUuid: block.uuid,
					dataTypes,
					group: def.group,
					id: key as BlockConnectionName,
					name: def.displayName,
				};

				const marker = markerType === "input" ? new Markers.Input(data) : new Markers.Output(data);
				markers.set(`${block.uuid} ${markerType} ${key}`, marker);

				{
					let bb = markersByBlock.get(block.uuid);
					if (!bb) markersByBlock.set(block.uuid, (bb = new Map()));

					bb.set(key, marker);
				}

				if (narrow) {
					toNarrow.push(marker);
				}
			};

			for (const [key, def] of pairs(definition.input)) {
				add(key, def, asMap(def.types).keys().sort(), "input");
			}
			for (const [key, def] of pairs(definition.output)) {
				add(key, def, [...def.types].sort(), "output");
			}
		}

		groupMarkers(markers.values());

		for (const block of blocks) {
			if (!block.config) continue;

			for (const [connectionName, config] of pairs(block.config)) {
				if (config.type !== "wire") {
					continue;
				}

				const connection = config.config;
				const fromstr = `${block.uuid} input ${connectionName}`;
				const tostr = `${connection.blockUuid} output ${connection.connectionName}`;

				const from = markers.get(fromstr) as Markers.Input;
				if (!from) {
					$err(`Not found '${fromstr}' to '${tostr}'`);
					continue;
				}
				const to = markers.get(tostr) as Markers.Output;
				if (!to) {
					$err(`Not found '${tostr}' from '${fromstr}'`);
					continue;
				}

				to.connect(from);
			}
		}

		for (const marker of toNarrow) {
			marker.narrowDownTypesSelfAndOther();
		}

		return markersByBlock;
	}
	export function groupMarkers(markers: readonly Markers.Marker[]) {
		const groupedMarkers = markers.groupBy((m) => m.data.group + " " + m.data.blockUuid);
		for (const marker of markers) {
			if (marker.data.group === undefined) continue;
			marker.sameGroupMarkers = groupedMarkers.get(marker.data.group + " " + marker.data.blockUuid);
		}
	}

	export namespace Markers {
		export abstract class Marker {
			private readonly _availableTypes;
			readonly availableTypes;
			sameGroupMarkers?: readonly Marker[];

			constructor(readonly data: MarkerData) {
				this._availableTypes = new ObservableValue<readonly DataType[]>(data.dataTypes);
				this.availableTypes = this._availableTypes.asReadonly();
			}

			narrowDownTypesSelfAndOther(): void {
				const grouped = this.getFullSameGroupTree();
				const types = intersectTypes(grouped.map((m) => m.availableTypes.get()));

				this._availableTypes.set(types);
				for (const marker of grouped) {
					marker._availableTypes.set(types);
				}
			}
			widenTypesSelfAndOther(): void {
				const grouped = this.getFullSameGroupTree();
				const types = intersectTypes(grouped.map((m) => m.data.dataTypes));

				this._availableTypes.set(types);
				for (const marker of grouped) {
					marker._availableTypes.set(types);
				}
			}

			getFullSameGroupTree(): ReadonlySet<Marker> {
				const set = new Set<Marker>();
				const addd = (marker: Marker) => {
					if (set.has(marker)) return;
					set.add(marker);

					for (const m of marker.getConnected()) {
						addd(m);
					}

					if (marker.sameGroupMarkers) {
						for (const m of marker.sameGroupMarkers) {
							addd(m);
						}
					}
				};
				const add = (addset: ReadonlySet<Marker>) => {
					for (const marker of addset) {
						if (set.has(marker)) continue;

						set.add(marker);
						add(marker.getConnected());
						if (marker.sameGroupMarkers) {
							add(new Set(marker.sameGroupMarkers));
						}
					}
				};

				addd(this);
				return set;
			}

			abstract getConnected(): ReadonlySet<Marker>;
		}
		export class Input extends Marker {
			private readonly _connected = new ObservableValue<Output | undefined>(undefined);
			readonly connected = this._connected.asReadonly();

			isConnected() {
				return this._connected.get() !== undefined;
			}

			onConnected(marker: Output) {
				this._connected.set(marker);
			}
			disconnect() {
				const prev = this._connected.get();
				if (!prev) return;

				this._connected.set(undefined);
				prev.onDisconnected(this);
				this.widenTypesSelfAndOther();
			}

			getConnected(): ReadonlySet<Marker> {
				return new Set(this._connected.get() ? [this._connected.get()!] : []);
			}
		}
		export class Output extends Marker {
			private readonly connected = new Set<Marker>();

			connect(marker: Input) {
				this.connected.add(marker);
				marker.onConnected(this);
				this.narrowDownTypesSelfAndOther();
			}
			onDisconnected(marker: Input) {
				if (!this.connected.has(marker)) {
					return;
				}

				this.connected.delete(marker);
				this.widenTypesSelfAndOther();
			}

			getConnected(): ReadonlySet<Marker> {
				return this.connected;
			}
		}
	}
}
