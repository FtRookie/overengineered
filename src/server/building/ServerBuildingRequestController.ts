import { RunService } from "@rbxts/services";
import { Component } from "engine/shared/component/Component";
import { PlayerRank } from "engine/shared/PlayerRank";
import { PlacementValidation } from "server/building/PlacementValidation";
import { BlockLimits } from "shared/blocks/BlockLimits";
import { BuildingManager } from "shared/building/BuildingManager";
import type { PlayerDatabase } from "server/database/PlayerDatabase";
import type { PlayerId } from "server/PlayerId";
import type { BuildingPlot } from "shared/building/BuildingPlot";
import type { SharedPlot } from "shared/building/SharedPlot";
import type { SharedPlots } from "shared/building/SharedPlots";
import type { PlayerDataStorageRemotesBuilding } from "shared/remotes/PlayerDataRemotes";

const err = (message: string): ErrorResponse => ({ success: false, message });
const errBuildingNotPermitted = err("Building is not permitted");

const isBlockOnPlot = (block: BlockModel, plot: PlotModel): boolean => block.IsDescendantOf(plot);
const areAllBlocksOnPlot = (blocks: readonly BlockModel[], plot: PlotModel): boolean => {
	for (const block of blocks) {
		if (!isBlockOnPlot(block, plot)) {
			return false;
		}
	}

	return true;
};

@injectable
export class ServerBuildingRequestController extends Component {
	constructor(
		@inject buildingRemotes: PlayerDataStorageRemotesBuilding,
		@inject private readonly playerId: PlayerId,
		@inject private readonly plot: SharedPlot,
		@inject private readonly blocks: BuildingPlot,

		@inject private readonly plots: SharedPlots,
		@inject private readonly blockList: BlockList,
		@inject private readonly database: PlayerDatabase,
	) {
		super();

		const b = buildingRemotes;
		b.placeBlocks.subscribe((p, arg) => this.placeBlocks(arg));
		b.deleteBlocks.subscribe((p, arg) => this.deleteBlocks(arg));
		b.editBlocks.subscribe((p, arg) => this.editBlocks(arg));
		b.logicConnect.subscribe((p, arg) => this.logicConnect(arg));
		b.logicDisconnect.subscribe((p, arg) => this.logicDisconnect(arg));
		b.paintBlocks.subscribe((p, arg) => this.paintBlocks(arg));
		b.updateConfig.subscribe((p, arg) => this.updateConfig(arg));
		b.updateCustomData.subscribe((p, arg) => this.updateCustomData(arg));
		b.resetConfig.subscribe((p, arg) => this.resetConfig(arg));
		b.weld.subscribe((p, arg) => this.weld(arg));
		b.recollide.subscribe((p, arg) => this.recollide(arg));
	}

	private placeBlocks(request: PlaceBlocksRequest): MultiBuildResponse {
		if (!this.plots.isBuildingAllowed(request.plot, this.playerId)) {
			return errBuildingNotPermitted;
		}

		return this._placeBlocks(this.plot, this.blocks, request.blocks);
	}
	private _placeBlocks(
		plot: SharedPlot,
		bplot: BuildingPlot,
		blocks: readonly PlaceBlockRequest[],
	): MultiBuildResponse {
		for (const block of blocks) {
			const b = this.blockList.blocks[block.id];
			if (!b) return err("Unknown block id");

			const validationError = PlacementValidation.validatePlace(block);
			if (validationError !== undefined) return err(validationError);

			if (b.devOnly && !RunService.IsStudio() && !PlayerRank.isDevById(this.playerId)) {
				return err(`Unknown block id ${b.id}`);
			}

			if (
				!BuildingManager.serverBlockCanBePlacedAt(
					plot,
					b,
					block.location,
					block.scale ?? Vector3.one,
					this.playerId,
				)
			) {
				return err("Can't be placed here");
			}

			// if block with the same uuid already exists
			if (block.uuid !== undefined && bplot.tryGetBlock(block.uuid)) {
				return err("Invalid block placement data");
			}
		}

		// Counted by family, not by id: two members of one family in the same batch draw from the same pool,
		// so counting them separately would let a batch place twice the family's limit. Every id is known to
		// be registered by the loop above, so one member is kept per family to resolve the limit against.
		const counts = new Map<string, number>();
		const member = new Map<string, Block>();
		for (const { id } of blocks) {
			const regblock = this.blockList.blocks[id]!;
			const family = BlockLimits.familyOf(regblock);

			counts.set(family, (counts.get(family) ?? 0) + BlockLimits.costOf(regblock));
			member.set(family, regblock);
		}

		const limits = this.database.get(this.playerId).blocks;
		const onPlot = bplot.getBlocks();

		for (const [family, count] of counts) {
			const regblock = member.get(family)!;
			const limit = BlockLimits.limitOf(regblock, limits);
			const placed = BlockLimits.countPlaced(onPlot, this.blockList, family);

			// limit <= 1 rather than === 1: a private server lifts ordinary limits, but not a unique or granted block.
			if (placed + count > limit && (game.PrivateServerOwnerId === 0 || limit <= 1)) {
				return err(
					`Type limit exceeded for ${regblock.id}. ${limit !== 1 ? " Maybe you should play on a private server?" : ""}`,
				);
			}
		}

		return bplot.multiPlaceOperation.execute(blocks);
	}

	private deleteBlocks(request: DeleteBlocksRequest): Response {
		if (!this.plots.isBuildingAllowed(request.plot, this.playerId)) {
			return errBuildingNotPermitted;
		}
		if (request.blocks !== "all" && !areAllBlocksOnPlot(request.blocks, request.plot)) {
			return errBuildingNotPermitted;
		}

		return this.blocks.deleteOperation.execute(request.blocks);
	}
	private editBlocks(request: EditBlocksRequest): Response {
		if (!this.plots.isBuildingAllowed(request.plot, this.playerId)) {
			return errBuildingNotPermitted;
		}
		for (const { instance } of request.blocks) {
			if (!isBlockOnPlot(instance, request.plot)) {
				return errBuildingNotPermitted;
			}
		}

		const validationError = PlacementValidation.validateEdit(request.blocks);
		if (validationError !== undefined) return err(validationError);

		return this.blocks.editOperation.execute(request.blocks);
	}

	private logicConnect(request: LogicConnectRequest): LogicWireResponse {
		if (!this.plots.isBuildingAllowed(request.plot, this.playerId)) {
			return errBuildingNotPermitted;
		}
		if (!isBlockOnPlot(request.inputBlock, request.plot)) {
			return errBuildingNotPermitted;
		}
		if (!isBlockOnPlot(request.outputBlock, request.plot)) {
			return errBuildingNotPermitted;
		}

		return this.blocks.logicConnect(request);
	}
	private logicDisconnect(request: LogicDisconnectRequest): LogicWireResponse {
		if (!this.plots.isBuildingAllowed(request.plot, this.playerId)) {
			return errBuildingNotPermitted;
		}
		if (!isBlockOnPlot(request.inputBlock, request.plot)) {
			return errBuildingNotPermitted;
		}

		return this.blocks.logicDisconnect(request);
	}
	private paintBlocks(request: PaintBlocksRequest): Response {
		if (!this.plots.isBuildingAllowed(request.plot, this.playerId)) {
			return errBuildingNotPermitted;
		}
		if (request.blocks !== "all" && !areAllBlocksOnPlot(request.blocks, request.plot)) {
			return errBuildingNotPermitted;
		}

		const validationError = PlacementValidation.validatePaint(request);
		if (validationError !== undefined) return err(validationError);

		return this.blocks.paintBlocks(request);
	}
	private updateConfig(request: ConfigUpdateRequest): Response {
		if (!this.plots.isBuildingAllowed(request.plot, this.playerId)) {
			return errBuildingNotPermitted;
		}
		for (const config of request.configs) {
			if (!isBlockOnPlot(config.block, request.plot)) {
				return errBuildingNotPermitted;
			}
		}

		return this.blocks.updateConfig(request.configs);
	}
	private updateCustomData(request: CustomDataUpdateRequest): Response {
		if (!this.plots.isBuildingAllowed(request.plot, this.playerId)) {
			return errBuildingNotPermitted;
		}
		for (const config of request.datas) {
			if (!isBlockOnPlot(config.block, request.plot)) {
				return errBuildingNotPermitted;
			}
		}

		return this.blocks.updateCustomData(request.datas);
	}
	private resetConfig(request: ConfigResetRequest): Response {
		if (!this.plots.isBuildingAllowed(request.plot, this.playerId)) {
			return errBuildingNotPermitted;
		}
		if (!areAllBlocksOnPlot(request.blocks, request.plot)) {
			return errBuildingNotPermitted;
		}

		return this.blocks.resetConfig(request.blocks);
	}
	private weld(request: WeldRequest): Response {
		if (!this.plots.isBuildingAllowed(request.plot, this.playerId)) {
			return errBuildingNotPermitted;
		}

		for (const { thisUuid, otherUuid } of request.datas) {
			const thisBlock = this.plot.tryGetBlock(thisUuid);
			if (!thisBlock || !isBlockOnPlot(thisBlock, request.plot)) {
				return errBuildingNotPermitted;
			}

			const otherBlock = this.plot.tryGetBlock(otherUuid);
			if (!otherBlock || !isBlockOnPlot(otherBlock, request.plot)) {
				return errBuildingNotPermitted;
			}
		}

		return this.blocks.weld(request.datas);
	}
	private recollide(request: RecollideRequest): Response {
		if (!this.plots.isBuildingAllowed(request.plot, this.playerId)) {
			return errBuildingNotPermitted;
		}

		for (const { uuid } of request.datas) {
			const block = this.plot.tryGetBlock(uuid);
			if (!block || !isBlockOnPlot(block, request.plot)) {
				return errBuildingNotPermitted;
			}
		}

		return this.blocks.recollide(request.datas);
	}
}
