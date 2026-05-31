import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { PassengerSeatBlockLogic } from "shared/blocks/blocks/grouped/PassengerSeatBlocks";
import type { VehicleSeatBlockLogic } from "shared/blocks/blocks/VehicleSeatBlock";

@injectable
export class SeatBlocksServerLogic extends ServerBlockLogic<
	typeof PassengerSeatBlockLogic | typeof VehicleSeatBlockLogic
> {
	constructor(
		logic: typeof PassengerSeatBlockLogic | typeof VehicleSeatBlockLogic,
		@inject playModeController: PlayModeController,
	) {
		super(logic, playModeController);

		logic.events.sittable.invoked.Connect((player, { block, sittable }) => {
			if (!this.isValidBlock(block, player)) return;
			block.VehicleSeat.Disabled = !sittable;
		});
	}
}
