import { LoadingController } from "client/controller/LoadingController";
import { JSON } from "engine/shared/fixes/Json";
import { Operation } from "engine/shared/Operation";
import { BlockManager } from "shared/building/BlockManager";
import { SharedBuilding } from "shared/building/SharedBuilding";
import { Color4 } from "shared/Color4";
import type { ActionController } from "client/modes/build/ActionController";
import type { PlacedBlockConfig } from "shared/blockLogic/BlockConfig";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { SharedPlot } from "shared/building/SharedPlot";
import type { PlayerDataStorageRemotes } from "shared/remotes/PlayerDataRemotes";

export namespace ClientBuildingTypes {
	export type PlaceBlocksArgs = {
		readonly plot: SharedPlot;
		readonly blocks: readonly PlaceBlockRequest[];
	};

	export type DeleteBlocksArgs = {
		readonly plot: SharedPlot;
		readonly blocks: readonly BlockModel[] | "all";
	};

	export type EditBlockInfoBase = {
		readonly origPosition: CFrame;
		readonly newPosition?: CFrame;
		readonly origScale?: Vector3;
		readonly newScale?: Vector3;
	};
	export type EditBlockInfo = EditBlockInfoBase & { readonly instance: BlockModel };
	export type EditBlockRequestInfo = EditBlocksRequest["blocks"][number];
	export type EditBlocksArgs = {
		readonly plot: SharedPlot;
		readonly blocks: readonly EditBlockInfo[];
	};

	export type PaintBlocksArgs = {
		readonly plot: SharedPlot;
		readonly blocks: readonly BlockModel[] | "all";
		readonly material: Enum.Material | undefined;
		readonly color: Color4 | undefined;
		readonly original?: ReadonlyMap<BlockModel, { readonly material: Enum.Material; readonly color: Color4 }>;
	};

	export type UpdateConfigArgs = {
		readonly plot: SharedPlot;
		readonly configs: readonly {
			readonly block: BlockModel;
			readonly cfg: PlacedBlockConfig;
		}[];
	};

	export type UpdateCustomDataArgs = {
		readonly plot: SharedPlot;
		readonly datas: readonly {
			readonly block: BlockModel;
			readonly data: PlacedBlockData["customData"];
		}[];
	};

	export type ResetConfigArgs = {
		readonly plot: SharedPlot;
		readonly blocks: readonly BlockModel[];
	};

	export type LogicConnectArgs = {
		readonly plot: SharedPlot;
		readonly inputBlock: BlockModel;
		readonly inputConnection: BlockConnectionName;
		readonly outputBlock: BlockModel;
		readonly outputConnection: BlockConnectionName;
	};

	export type LogicDisconnectArgs = {
		readonly plot: SharedPlot;
		readonly inputBlock: BlockModel;
		readonly inputConnection: BlockConnectionName;
	};

	export type WeldArgs = {
		readonly plot: SharedPlot;
		readonly datas: readonly {
			readonly thisUuid: BlockUuid;
			readonly thisPart: readonly string[];
			readonly otherUuid: BlockUuid;
			readonly otherPart: readonly string[];
			readonly welded: boolean;
		}[];
	};

	export type RecollideArgs = {
		readonly plot: SharedPlot;
		readonly datas: readonly {
			readonly uuid: BlockUuid;
			readonly enabled: boolean;
		}[];
	};
}

/** Methods to send building requests to the server, with undo/redo support. No validation is performed. */
@injectable
export class ClientBuilding {
	readonly placeOperation = new Operation(this.placeBlocks.bind(this));
	readonly deleteOperation = new Operation(this.deleteBlocks.bind(this));
	readonly editOperation = new Operation(this.editBlocks.bind(this));
	readonly paintOperation = new Operation(this.paintBlocks.bind(this));
	readonly updateConfigOperation = new Operation(this.updateConfig.bind(this));
	readonly resetConfigOperation = new Operation(this.resetConfig.bind(this));
	readonly logicConnectOperation = new Operation(this.logicConnect.bind(this));
	readonly logicDisconnectOperation = new Operation(this.logicDisconnect.bind(this));
	readonly weldOperation = new Operation(this.weld.bind(this));
	readonly recollideOperation = new Operation(this.recollide.bind(this));

	private readonly building;

	constructor(
		@inject private readonly actionController: ActionController,
		@inject remotes: PlayerDataStorageRemotes,
	) {
		this.building = remotes.building;
	}

	placeBlocks({ plot, blocks }: ClientBuildingTypes.PlaceBlocksArgs) {
		let placed: readonly BlockUuid[];
		const result = this.actionController.execute(
			"Place blocks",
			() => {
				const execute = () =>
					this.building.deleteBlocks.send({
						plot: plot.instance,
						blocks: placed.map((uuid) => plot.getBlock(uuid)),
					});

				if (blocks.size() > 10) {
					return LoadingController.run("Deleting blocks", execute);
				}

				return execute();
			},
			() => {
				const execute = () => {
					const response = this.building.placeBlocks.send({ plot: plot.instance, blocks });
					if (response.success) {
						placed = response.models.map(BlockManager.manager.uuid.get);
					}

					return response;
				};

				if (blocks.size() > 10) {
					return LoadingController.run("Placing blocks", execute);
				}
				return execute();
			},
		);

		if (result.success) {
			for (const model of result.models) {
				while (!model.PrimaryPart) {
					task.wait();
				}
			}
		}

		task.wait();
		plot.changed.Fire();
		return result;
	}

	deleteBlocks({ plot, blocks: _blocks }: ClientBuildingTypes.DeleteBlocksArgs) {
		const uuids = _blocks === "all" ? "all" : _blocks.map(BlockManager.manager.uuid.get);
		const blockCount = uuids === "all" ? plot.getBlocks().size() : uuids.size();

		type SavedConnection = {
			readonly inputBlock: BlockUuid;
			readonly outputBlock: BlockUuid;
			readonly inputConnection: BlockConnectionName;
			readonly outputConnection: BlockConnectionName;
		};
		const connectedByLogic: SavedConnection[] = [];

		if (uuids !== "all") {
			const connections = SharedBuilding.getBlocksConnectedByLogicToMulti(plot.getBlockDatas(), new Set(uuids));

			for (const [blockUuid, c] of connections) {
				for (const [otherblock, connectionName, connection] of c) {
					connectedByLogic.push({
						inputBlock: otherblock.uuid,
						outputBlock: blockUuid,
						inputConnection: connectionName,
						outputConnection: connection.connectionName,
					});
				}
			}
		}

		const undo: PlaceBlocksRequest = {
			plot: plot.instance,
			blocks: (_blocks === "all" ? plot.getBlocks() : _blocks).map((block): PlaceBlockRequest => {
				const data = BlockManager.getBlockDataByBlockModel(block);

				return {
					...data,
					location: block.GetPivot(),
					["instance" as never]: undefined,
				};
			}),
		};

		const getBlocks = (): readonly BlockModel[] | "all" =>
			uuids === "all" ? ("all" as const) : uuids.map((uuid) => plot.getBlock(uuid));
		const getConnectRequest = (connection: SavedConnection): LogicConnectRequest => {
			return {
				plot: plot.instance,
				inputBlock: plot.getBlock(connection.inputBlock),
				inputConnection: connection.inputConnection,
				outputBlock: plot.getBlock(connection.outputBlock),
				outputConnection: connection.outputConnection,
			};
		};

		const result = this.actionController.execute(
			uuids === "all" ? "Clear plot" : "Remove blocks",
			() => {
				const execute = (): Response => {
					const response = this.building.placeBlocks.send(undo);
					if (!response.success) {
						return response;
					}

					for (const connection of connectedByLogic) {
						const response = this.building.logicConnect.send(getConnectRequest(connection));

						if (!response.success) {
							return response;
						}
					}

					for (const model of response.models) {
						while (!model.PrimaryPart) {
							task.wait();
						}
					}

					return { success: true };
				};

				if (blockCount > 10) {
					return LoadingController.run("Placing blocks", execute);
				}

				return execute();
			},
			() => {
				const execute = () => this.building.deleteBlocks.send({ plot: plot.instance, blocks: getBlocks() });

				if (blockCount > 10) {
					return LoadingController.run("Removing blocks", execute);
				}

				return execute();
			},
		);

		plot.changed.Fire();
		return result;
	}

	editBlocks({ plot, blocks: _blocks }: ClientBuildingTypes.EditBlocksArgs) {
		const blocks = _blocks.map((b): ClientBuildingTypes.EditBlockInfoBase & { readonly uuid: BlockUuid } => ({
			uuid: BlockManager.manager.uuid.get(b.instance),
			newPosition: b.newPosition,
			origPosition: b.origPosition,
			origScale: b.origScale,
			newScale: b.newScale,
		}));

		const getOrigBlocks = (): readonly ClientBuildingTypes.EditBlockRequestInfo[] =>
			blocks.map(
				(b): ClientBuildingTypes.EditBlockRequestInfo => ({
					instance: plot.getBlock(b.uuid),
					position: b.origPosition,
					scale: b.origScale,
				}),
			);
		const getBlocks = (): readonly ClientBuildingTypes.EditBlockRequestInfo[] =>
			blocks.map(
				(b): ClientBuildingTypes.EditBlockRequestInfo => ({
					instance: plot.getBlock(b.uuid),
					position: b.newPosition,
					scale: b.newScale,
				}),
			);

		const result = this.actionController.execute(
			"Edit blocks",
			() => {
				const execute = () => this.building.editBlocks.send({ plot: plot.instance, blocks: getOrigBlocks() });

				if (blocks.size() > 10) {
					return LoadingController.run("Editing blocks", execute);
				}
				return execute();
			},
			() => {
				const execute = () => this.building.editBlocks.send({ plot: plot.instance, blocks: getBlocks() });

				if (blocks.size() > 10) {
					return LoadingController.run("Editing blocks", execute);
				}
				return execute();
			},
		);

		plot.changed.Fire();
		return result;
	}

	paintBlocks({ plot, blocks: _blocks, material, color, original: _original }: ClientBuildingTypes.PaintBlocksArgs) {
		$trace("Executing painting operation", { plot, _blocks, material, color, _original });

		const origData = _original
			? new ReadonlyMap(_original.map((block, value) => [BlockManager.manager.uuid.get(block), value] as const))
			: new ReadonlyMap(
					(_blocks === "all" ? plot.getBlocks() : _blocks).map(
						(b) =>
							[
								BlockManager.manager.uuid.get(b),
								{
									material: BlockManager.manager.material.get(b),
									color: BlockManager.manager.color.get(b),
								},
							] as const,
					),
				);
		const getBlocks = (): readonly BlockModel[] => origData.map((uuid) => plot.getBlock(uuid));

		const result = this.actionController.execute(
			"Paint blocks",
			() => {
				const grouped = new Map<Enum.Material, Map<string, BlockUuid[]>>();
				for (const [uuid, { material, color }] of origData) {
					let matmap = grouped.get(material);
					if (!matmap) {
						matmap = new Map();
						grouped.set(material, matmap);
					}

					let colormap = matmap.get(Color4.toHex(color));
					if (!colormap) {
						colormap = [];
						matmap.set(Color4.toHex(color), colormap);
					}

					colormap.push(uuid);
				}

				for (const [material, colorgroup] of grouped) {
					for (const [color, uuids] of colorgroup) {
						const blocks = uuids.map((uuid) => plot.getBlock(uuid));

						const result = this.building.paintBlocks.send({
							plot: plot.instance,
							material,
							color: Color4.fromHex(color),
							blocks,
						});

						if (!result.success) {
							return result;
						}
					}
				}

				return { success: true };
			},
			() =>
				this.building.paintBlocks.send({
					plot: plot.instance,
					material,
					color,
					blocks: getBlocks(),
				}),
		);

		plot.changed.Fire();
		return result;
	}

	updateCustomData({ plot, datas: _datas }: ClientBuildingTypes.UpdateCustomDataArgs) {
		const newConfigs = asObject(_datas.mapToMap((c) => $tuple(BlockManager.manager.uuid.get(c.block), c.data)));

		const getBlocks = (
			data: Record<BlockUuid, PlacedBlockData["customData"]>,
		): { readonly block: BlockModel; readonly sdata: string }[] => {
			return asMap(data).map((k, v) => ({ block: plot.getBlock(k), sdata: JSON.serialize(v) }));
		};

		this.building.updateCustomData.send({
			plot: plot.instance,
			datas: getBlocks(newConfigs),
		});
	}

	updateConfig({ plot, configs: _configs }: ClientBuildingTypes.UpdateConfigArgs) {
		const newConfigs = asObject(_configs.mapToMap((c) => $tuple(BlockManager.manager.uuid.get(c.block), c.cfg)));
		const origConfigs = asObject(
			_configs.mapToMap((c) =>
				$tuple(BlockManager.manager.uuid.get(c.block), BlockManager.manager.config.get(c.block)),
			),
		);

		const getBlocks = (
			data: Record<BlockUuid, PlacedBlockConfig>,
		): { readonly block: BlockModel; readonly scfg: string }[] => {
			return asMap(data).map((k, v) => ({ block: plot.getBlock(k), scfg: JSON.serialize(v) }));
		};

		return this.actionController.execute(
			"Update config",
			() =>
				this.building.updateConfig.send({
					plot: plot.instance,
					configs: getBlocks(origConfigs),
				}),
			() =>
				this.building.updateConfig.send({
					plot: plot.instance,
					configs: getBlocks(newConfigs),
				}),
		);
	}

	resetConfig({ plot, blocks: _blocks }: ClientBuildingTypes.ResetConfigArgs) {
		const origConfigs = asObject(
			_blocks.mapToMap((b) => $tuple(BlockManager.manager.uuid.get(b), BlockManager.manager.config.get(b))),
		);

		const getBlocks = (
			data: Record<BlockUuid, PlacedBlockConfig>,
		): { readonly block: BlockModel; readonly scfg: string }[] => {
			return asMap(data).map((k, v) => ({ block: plot.getBlock(k), scfg: JSON.serialize(v) }));
		};

		return this.actionController.execute(
			"Reset config",
			() =>
				this.building.updateConfig.send({
					plot: plot.instance,
					configs: getBlocks(origConfigs),
				}),
			() => this.building.resetConfig.send({ plot: plot.instance, blocks: _blocks }),
		);
	}

	logicConnect({
		plot,
		inputBlock: _inputBlock,
		inputConnection,
		outputBlock: _outputBlock,
		outputConnection,
	}: ClientBuildingTypes.LogicConnectArgs) {
		const inputBlock = BlockManager.manager.uuid.get(_inputBlock);
		const outputBlock = BlockManager.manager.uuid.get(_outputBlock);

		return this.actionController.execute(
			"Connect logic",
			() => {
				return this.building.logicDisconnect.send({
					plot: plot.instance,
					inputBlock: plot.getBlock(inputBlock),
					inputConnection,
				});
			},
			() => {
				return this.building.logicConnect.send({
					plot: plot.instance,
					inputBlock: plot.getBlock(inputBlock),
					inputConnection,
					outputBlock: plot.getBlock(outputBlock),
					outputConnection,
				});
			},
		);
	}

	logicDisconnect({ plot, inputBlock: _inputBlock, inputConnection }: ClientBuildingTypes.LogicDisconnectArgs) {
		const inputBlock = BlockManager.manager.uuid.get(_inputBlock);
		const output = BlockManager.manager.config.get(_inputBlock)![inputConnection]
			.config as BlockLogicTypes.WireValue;

		return this.actionController.execute(
			"Disconnect logic",
			() => {
				return this.building.logicConnect.send({
					plot: plot.instance,
					inputBlock: plot.getBlock(inputBlock),
					inputConnection,
					outputBlock: plot.getBlock(output.blockUuid),
					outputConnection: output.connectionName,
				});
			},
			() => {
				return this.building.logicDisconnect.send({
					plot: plot.instance,
					inputBlock: plot.getBlock(inputBlock),
					inputConnection,
				});
			},
		);
	}

	weld({ plot, datas }: ClientBuildingTypes.WeldArgs) {
		return this.actionController.execute(
			"Toggle weld",
			() => {
				return this.building.weld.send({
					plot: plot.instance,
					datas: datas.map((c) => ({ ...c, welded: !c.welded })),
				});
			},
			() => {
				return this.building.weld.send({
					plot: plot.instance,
					datas,
				});
			},
		);
	}

	recollide({ plot, datas }: ClientBuildingTypes.RecollideArgs) {
		return this.actionController.execute(
			"Toggle collisions",
			() => {
				return this.building.recollide.send({
					plot: plot.instance,
					datas: datas.map((c) => ({ ...c, enabled: !c.enabled })),
				});
			},
			() => {
				return this.building.recollide.send({ plot: plot.instance, datas });
			},
		);
	}
}
