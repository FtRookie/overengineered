import { HostedService } from "engine/shared/di/HostedService";
import { Objects } from "engine/shared/fixes/Objects";
import { BackMountBlockServerLogic } from "server/blocks/logic/BackMountBlockServerLogic";
import { BeaconServerLogic } from "server/blocks/logic/BeaconBlockServerLogic";
import { BracedShaftServerLogic } from "server/blocks/logic/BracedShaftServerLogic";
import { ButtonServerLogic } from "server/blocks/logic/ButtonServerLogic";
import { CameraBlockServerLogic } from "server/blocks/logic/CameraBlockServerLogic";
import { DisconnectBlockServerLogic } from "server/blocks/logic/DisconnectBlockServerLogic";
import { HandleBlockServerLogic } from "server/blocks/logic/HandleBlockServerLogic";
import { LEDDisplayServerLogic } from "server/blocks/logic/LEDDisplayServerLogic";
import { ParticleServerLogic } from "server/blocks/logic/ParticleBlockServerLogic";
import { PropellantBlockServerLogic } from "server/blocks/logic/PropellantBlocksServerLogic";
import { ScreenServerLogic } from "server/blocks/logic/ScreenServerLogic";
import { SeatBlocksServerLogic } from "server/blocks/logic/SeatBlocksLogic";
import { SevenSegmentDisplayServerLogic } from "server/blocks/logic/SevenSegmentDisplayServerLogic";
import { SpeakerServerLogic } from "server/blocks/logic/SpeakerBlockServerLogic";
import { TextToSpeechServerLogic } from "server/blocks/logic/TextToSpeechServerLogic";
import { TracerServerLogic } from "server/blocks/logic/TracerBlockServerLogic";
import { ServerBlockLogic } from "server/blocks/ServerBlockLogic";
import { ButtonBlocks } from "shared/blocks/blocks/grouped/ButtonBlocks";
import { PassengerSeatBlocks } from "shared/blocks/blocks/grouped/PassengerSeatBlocks";
import type { PlayModeController } from "server/modes/PlayModeController";
import type { GenericBlockLogicCtor } from "shared/blockLogic/BlockLogic";

type ServerBlockLogicRegistry = {
	readonly [k in BlockId]?: new (...args: never) => ServerBlockLogic<GenericBlockLogicCtor>;
};

@injectable
export class ServerBlockLogicController extends HostedService {
	constructor(
		@inject blockList: BlockList,
		@inject playModeController: PlayModeController,
		@inject container: DIContainer,
	) {
		super();
		container = container.beginScope();

		// Dedup by events object reference: grouped blocks (e.g. button + squarebutton) share one
		// events object, so we must not register validation middleware twice on the same synchronizer.
		const seenEvents = new Set<object>();
		for (const [, { logic }] of pairs(blockList.blocks)) {
			if (!logic?.events) continue;
			if (seenEvents.has(logic.events as object)) continue;
			seenEvents.add(logic.events as object);

			for (const [, event] of pairs(logic.events)) {
				event.addServerMiddleware((invoker, arg) => {
					if (!arg.block) return { success: false, message: "No block" };
					if (!arg.block?.PrimaryPart) return { success: false, message: "No primary part" };

					const err = ServerBlockLogic.staticIsValidBlockNamed(
						arg.block.PrimaryPart,
						invoker,
						playModeController,
						undefined,
						false,
					);
					if (err) {
						return { success: false, message: err };
					}

					return { success: true, value: arg };
				});
			}
		}

		const serverBlockLogicRegistry: ServerBlockLogicRegistry = {
			camera: CameraBlockServerLogic,
			disconnectblock: DisconnectBlockServerLogic,
			leddisplay: LEDDisplayServerLogic,
			screen: ScreenServerLogic,
			...Objects.fromEntries(ButtonBlocks.map((b) => [b.id, ButtonServerLogic] as const)),
			speaker: SpeakerServerLogic,
			texttospeech: TextToSpeechServerLogic,
			particleemitter: ParticleServerLogic,
			sevensegmentdisplay: SevenSegmentDisplayServerLogic,
			bracedshaft: BracedShaftServerLogic,
			beacon: BeaconServerLogic,
			backmount: BackMountBlockServerLogic,
			propellantblock: PropellantBlockServerLogic,
			tracerblock: TracerServerLogic,
			handle: HandleBlockServerLogic,
			vehicleseat: SeatBlocksServerLogic,
			...Objects.fromEntries(PassengerSeatBlocks.map((b) => [b.id, SeatBlocksServerLogic] as const)),
		};

		// Dedup by (ServerLogicCtor, bl) pair: grouped blocks that share both a ServerBlockLogic
		// class and a logic ctor (e.g. button + squarebutton) must only be instantiated once.
		// Blocks with different logic ctors for the same ServerBlockLogic (e.g. vehicleseat vs
		// passengerseat variants) are distinct pairs and each get their own instance.
		const seenLogicPairs = new Map<object, Set<object>>();
		const logics: object[] = [];
		for (const [id, logic] of pairs(serverBlockLogicRegistry)) {
			$log(`Initializing server logic for ${id}`);

			const bl = blockList.blocks[id]?.logic?.ctor;
			if (!bl) {
				throw `Unknown server block logic id ${id}`;
			}

			const blSet = seenLogicPairs.getOrSet(logic as object, () => new Set<object>());
			if (blSet.has(bl as object)) continue;
			blSet.add(bl as object);

			logics.push(container.resolveForeignClass(logic, [bl] as never));
		}
	}
}
