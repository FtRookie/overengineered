import { ClientMachine } from "client/blocks/ClientMachine";
import { SoundController } from "client/controller/SoundController";
import { RideModeScene } from "client/gui/ridemode/RideModeScene";
import { LogControl } from "client/gui/static/LogControl";
import { PlayMode } from "client/modes/PlayMode";
import { RideToBuildModeSlotScheduler } from "client/modes/ride/RideToBuildModeSlotScheduler";
import { Interface } from "engine/client/gui/Interface";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { Colors } from "engine/shared/Colors";
import { CustomRemotes } from "shared/Remotes";
import type { RideModeSceneDefinition } from "client/gui/ridemode/RideModeScene";
import type { SharedPlot } from "shared/building/SharedPlot";
import type { ExplosionEffect } from "shared/effects/ExplosionEffect";

@injectable
export class RideMode extends PlayMode {
	// bad code
	static runWithoutLogicThisTime = false;

	private currentMachine?: ClientMachine;
	readonly rideModeScene;

	static readonly buildModeScheduler = new RideToBuildModeSlotScheduler();

	constructor(
		@inject private readonly explosion: ExplosionEffect,
		@inject private readonly plot: SharedPlot,
		@inject private readonly di: DIContainer,
	) {
		super();

		this.di = di = di.beginScope((builder) => {
			builder.registerSingletonValue(this);
		});

		this.rideModeScene = di.resolveForeignClass(RideModeScene, [
			Interface.getInterface<{ RideMode: RideModeSceneDefinition }>().RideMode,
		]);
		this.parentGui(this.rideModeScene);

		CustomRemotes.modes.set.sent.Connect((mode) => {
			if (mode.mode === "ride") return;
			if (!this.currentMachine) return;

			this.currentMachine.getImpactController()?.disable();
			this.currentMachine?.destroy();
			this.currentMachine = undefined;
		});

		const alignPositionInstance = new Instance("AlignPosition");
		alignPositionInstance.Name = "_AlignPosition";
		alignPositionInstance.Mode = Enum.PositionAlignmentMode.OneAttachment;
		alignPositionInstance.MaxForce = math.huge;
		alignPositionInstance.MaxVelocity = math.huge;
		alignPositionInstance.Responsiveness = 200;

		const alignOrientationInstance = new Instance("AlignOrientation");
		alignOrientationInstance.Name = "_AlignOrientation";
		alignOrientationInstance.Mode = Enum.OrientationAlignmentMode.OneAttachment;
		alignOrientationInstance.MaxAngularVelocity = math.huge;
		alignOrientationInstance.MaxTorque = math.huge;
		alignOrientationInstance.Responsiveness = 200;

		CustomRemotes.physics.normalizeRootparts.invoked.Connect((data) => {
			for (const part of data.parts) {
				const attachment = new Instance("Attachment", part);

				const alignPosition = alignPositionInstance.Clone();
				const alignOrientation = alignOrientationInstance.Clone();

				alignPosition.Attachment0 = attachment;
				alignOrientation.Attachment0 = attachment;

				alignPosition.Parent = part;
				alignOrientation.Parent = part;
			}
		});
	}

	static denormalizeRootparts(block: BlockModel): void {
		for (const child of block.GetDescendants()) {
			if (!child.IsA("BasePart")) continue;

			child.FindFirstChild("_AlignPosition")?.Destroy();
			child.FindFirstChild("_AlignOrientation")?.Destroy();
		}
	}

	getName(): PlayModes {
		return "ride";
	}

	getCurrentMachine() {
		return this.currentMachine;
	}

	onSwitchToNext(mode: PlayModes | undefined) {}
	onSwitchFromPrev(prev: PlayModes | undefined) {
		this.currentMachine?.destroy();
		this.currentMachine = undefined;

		if (prev === undefined) {
			//
		} else if (prev === "build") {
			const runLogic = !RideMode.runWithoutLogicThisTime;
			RideMode.runWithoutLogicThisTime = false;

			const di = this.di.beginScope((builder) => {
				builder.registerSingletonValue(RideMode.buildModeScheduler);
			});
			RideMode.buildModeScheduler.clear();
			this.currentMachine = di.resolveForeignClass(ClientMachine);

			let startErr: unknown;
			try {
				this.currentMachine.init(this.plot.getBlockDatas(), runLogic);
				SoundController.getUISounds().Start.Play();
			} catch (err) {
				startErr = err;
			}

			this.rideModeScene.start(this.currentMachine, runLogic);

			if (startErr) {
				LogControl.instance.addLine(`Error while starting the machine: ${startErr}`, Colors.red);
				SoundController.getUISounds().Warning.Play();

				task.spawn(() => {
					const expl = (part: BasePart | undefined) => {
						if (part) {
							this.explosion.justRun({ part });
						}
					};

					expl(LocalPlayer.rootPart.get());
					expl(this.plot.instance.BuildingArea);

					for (const block of this.plot.getBlocks()) {
						if (math.random() > 0.8) {
							expl(block.PrimaryPart);
						}
					}
				});
			}
		}
	}
}
