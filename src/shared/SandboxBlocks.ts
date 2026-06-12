import { BlockListBuilder } from "shared/blocks/BlockListBuilder";
import { AltimeterBlock } from "shared/blocks/blocks/AltimeterBlock";
import { AngleSensorBlock } from "shared/blocks/blocks/AngleSensorBlock";
import { BackMountBlock } from "shared/blocks/blocks/BackMountBlock";
import { BallastBlock } from "shared/blocks/blocks/BallastBlock";
import { BeaconBlock } from "shared/blocks/blocks/BeaconBlock";
import { BearingShaftBlock } from "shared/blocks/blocks/BearingShaftBlock";
import { BracedShaftBlock } from "shared/blocks/blocks/BracedShaftBlock";
import { CameraBlock } from "shared/blocks/blocks/CameraBlock";
import { ChatSensorBlock } from "shared/blocks/blocks/ChatSensorBlock";
import { ClockTimeSensorBlock } from "shared/blocks/blocks/ClockTimeSensorBlock";
import { ControllerBlock } from "shared/blocks/blocks/ControllerBlock";
import { ControllerSensorBlock } from "shared/blocks/blocks/ControllerSensorBlock";
import { CounterBlock } from "shared/blocks/blocks/CounterBlock";
import { DelayBlock } from "shared/blocks/blocks/DelayBlock";
import { DisconnectBlock } from "shared/blocks/blocks/DisconnectBlock";
import { ExtinguisherBombBlock } from "shared/blocks/blocks/ExtinguisherBombBlock";
import { FallbackBlock } from "shared/blocks/blocks/FallbackBlock";
import { FireSensorBlock } from "shared/blocks/blocks/FireSensorBlock";
import { FunctionBlock } from "shared/blocks/blocks/FunctionBlock";
import { GPSSensorBlock } from "shared/blocks/blocks/GPSSensorBlock";
import { GraviEngineBlocks } from "shared/blocks/blocks/GraviEngineBlocks";
import { GravitySensorBlock } from "shared/blocks/blocks/GravitySensorBlock";
import { BasicLogicGateBlocks } from "shared/blocks/blocks/grouped/BasicLogicGateBlocks";
import { BasicOperationBlocks } from "shared/blocks/blocks/grouped/BasicOperationBlocks";
import { BuildingBlocks } from "shared/blocks/blocks/grouped/BuildingBlocks";
import { ButtonBlocks } from "shared/blocks/blocks/grouped/ButtonBlocks";
import { HingeBlocks } from "shared/blocks/blocks/grouped/HingeBlocks";
import { LampBlocks } from "shared/blocks/blocks/grouped/LampBlocks";
import { LedDisplayBlocks } from "shared/blocks/blocks/grouped/LedDisplayBlocks";
import { LinearSliderBlocks } from "shared/blocks/blocks/grouped/LinearSliders";
import { MechanicalBlocks } from "shared/blocks/blocks/grouped/MechanicalBlocks";
import { PassengerSeatBlocks } from "shared/blocks/blocks/grouped/PassengerSeatBlocks";
import { PropellantBlocks } from "shared/blocks/blocks/grouped/PropellantBlocks";
import { ProximityBlocks } from "shared/blocks/blocks/grouped/ProximityBlocks";
import { RandomAccessMemoryBlocks } from "shared/blocks/blocks/grouped/RandomAccessMemoryBlocks";
import { RopeBlocks } from "shared/blocks/blocks/grouped/RopeBlocks";
import { ServoMotorBlocks } from "shared/blocks/blocks/grouped/ServoMotorBlocks";
import { StringOperationBlocks } from "shared/blocks/blocks/grouped/StringOperationBlocks";
import { TNTBlocks } from "shared/blocks/blocks/grouped/TNTBlocks";
import { TurnTables } from "shared/blocks/blocks/grouped/TurnTables";
import { WheelBlocks } from "shared/blocks/blocks/grouped/WheelBlocks";
import { WingBlocks } from "shared/blocks/blocks/grouped/WingsBlocks";
import { GuiButtonBlock } from "shared/blocks/blocks/gui/GuiButtonBlock";
import { GuiImageBlock } from "shared/blocks/blocks/gui/GuiImageBlock";
import { GuiStatBlock } from "shared/blocks/blocks/gui/GuiStatBlock";
import { GuiTextBlock } from "shared/blocks/blocks/gui/GuiTextBlock";
import { GyroscopeBlock } from "shared/blocks/blocks/GyroscopeBlock";
import { HandleBlock } from "shared/blocks/blocks/HandleBlock";
import { HeliumBlock } from "shared/blocks/blocks/HeliumBlock";
import { ImpulseExtenderBlock } from "shared/blocks/blocks/ImpulseExtenderBlock";
import { ImpulseGeneratorBlock } from "shared/blocks/blocks/ImpulseGeneratorBlock";
import { JetEngineBlocks } from "shared/blocks/blocks/JetEngineBlocks";
import { JoystickSensorBlock } from "shared/blocks/blocks/JoystickSensorBlock";
import { KeyboardBlock } from "shared/blocks/blocks/KeyboardBlock";
import { KeySensorBlock } from "shared/blocks/blocks/KeySensorBlock";
import { LaserBlock } from "shared/blocks/blocks/LaserBlock";
import { LinearEasingBlock } from "shared/blocks/blocks/LinearEasingBlock";
import { LogicMemoryBlock } from "shared/blocks/blocks/LogicMemoryBlock";
import { LogicMemoryLegacyBlock } from "shared/blocks/blocks/LogicMemoryOldBlock";
import { LogicOverclockBlock } from "shared/blocks/blocks/LogicOverclockBlock";
import { LuaCircuitBlock } from "shared/blocks/blocks/LuaCircuitBlock";
import { MagnetBlock } from "shared/blocks/blocks/MagnetBlock";
import { MassSensorBlock } from "shared/blocks/blocks/MassSensorBlock";
import { MotorBlock } from "shared/blocks/blocks/MotorBlock";
import { MouseSensorBlock } from "shared/blocks/blocks/MouseSensorBlock";
import { NonVolatileMemoryBlock } from "shared/blocks/blocks/NonVolatileMemoryBlock";
import { OwnerCameraLocatorBlock } from "shared/blocks/blocks/OwnerCameraLocatorBlock";
import { OwnerLocatorBlock } from "shared/blocks/blocks/OwnerLocatorBlock";
import { ParticleBlocks } from "shared/blocks/blocks/particle/ParticleBlocks";
import { PIDControllerBlock } from "shared/blocks/blocks/PIDControllerBlock";
import { PingSensor } from "shared/blocks/blocks/PingSensor";
import { PistonBlock } from "shared/blocks/blocks/PistonBlock";
import { PointToScreenSpaceBlock } from "shared/blocks/blocks/PointToScreenSpaceBlock";
import { QueueMemoryBlock } from "shared/blocks/blocks/QueueMemoryBlock";
import { RadarBlocks } from "shared/blocks/blocks/RadarSectionBlock";
import { RadarWarningReceiver } from "shared/blocks/blocks/RadarWarningReceiver";
import { RadioReceiverBlock } from "shared/blocks/blocks/RadioReceiverBlock";
import { RadioTransmitterBlock } from "shared/blocks/blocks/RadioTransmitterBlock";
import { RandomBlock } from "shared/blocks/blocks/RandomBlock";
import { RCSEngineBlock } from "shared/blocks/blocks/RCSEngineBlock";
import { ReadonlyMemoryBlock } from "shared/blocks/blocks/ReadonlyMemoryBlock";
import { RelativeVectorBlock } from "shared/blocks/blocks/RelativeVectorBlock";
import { RocketBlocks } from "shared/blocks/blocks/RocketEngineBlocks";
import { ScreenBlock } from "shared/blocks/blocks/ScreenBlock";
import { SelfVectorToTarget } from "shared/blocks/blocks/SelfVectorToTargetBlock";
import { SevenSegmentDisplayBlock } from "shared/blocks/blocks/SevenSegmentDisplayBlock";
import { SingleImpulseBlock } from "shared/blocks/blocks/SingleImpulseBlock";
import { SizeBlock } from "shared/blocks/blocks/SizeBlock";
import { SoundEffectBlockCreator } from "shared/blocks/blocks/sound/SoundEffectBlockCreator";
import { SoundFromIdBlock } from "shared/blocks/blocks/sound/SoundFromIdBlock";
import { SoundLengthBlock } from "shared/blocks/blocks/sound/SoundLengthBlock";
import { SpeakerBlock } from "shared/blocks/blocks/sound/SpeakerBlock";
import { SpeedometerBlock } from "shared/blocks/blocks/SpeedometerBlock";
import { SplineLerpBlock } from "shared/blocks/blocks/SplineLerpBlock";
import { StackMemoryBlock } from "shared/blocks/blocks/StackMemoryBlock";
import { SuspensionBlock } from "shared/blocks/blocks/SuspensionBlock";
import { TTSBlock } from "shared/blocks/blocks/TextToSpeechBlock";
import { TextureBlock } from "shared/blocks/blocks/TextureBlock";
import { TintBlock } from "shared/blocks/blocks/TintBlock";
import { TpsCounterBlock } from "shared/blocks/blocks/TpsCounterBlock";
import { TracerBlock } from "shared/blocks/blocks/TracerBlock";
import { ValueExtenderBlock } from "shared/blocks/blocks/ValueExtenderBlock";
import { VehicleSeatBlock } from "shared/blocks/blocks/VehicleSeatBlock";
import { CannonBarrels } from "shared/blocks/blocks/Weaponry/Cannon/CannonBarrels";
import { CannonBases } from "shared/blocks/blocks/Weaponry/Cannon/CannonBases";
import { CannonBreech } from "shared/blocks/blocks/Weaponry/Cannon/CannonBreechBlock";
import { LaserEmitterBlock } from "shared/blocks/blocks/Weaponry/Laser/LaserEmitterBlock";
import { LaserLensBlock } from "shared/blocks/blocks/Weaponry/Laser/LaserLensBlock";
import { ArmoredMachineGunBarrels } from "shared/blocks/blocks/Weaponry/Machinegun/ArmoredMachineGunBarrels";
import { MachineGunAmmoBlocks } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunAmmoBlocks";
import { MachineGunBarrels } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunBarrels";
import { MachineGunLoader } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunLoaderBlock";
import { MachineGunMuzzleBrakes } from "shared/blocks/blocks/Weaponry/Machinegun/MachineGunMuzzleBrakes";
import { MediumMachineGunBlocks } from "shared/blocks/blocks/Weaponry/Machinegun/MediumMachineGunBlocks";
import { PlasmaGunBarrelBlock } from "shared/blocks/blocks/Weaponry/Plasma/PlasmaGunBarrelBlock";
import { PlasmaGunBlock } from "shared/blocks/blocks/Weaponry/Plasma/PlasmaGunBlock";
import { PlasmaSeparatorMuzzleBlock } from "shared/blocks/blocks/Weaponry/Plasma/PlasmaSeparatorMuzzleBlock";
import { PlasmaShotgunMuzzleBlock } from "shared/blocks/blocks/Weaponry/Plasma/PlasmaShotgunMuzzleBlock";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { BlockBuilder } from "shared/blocks/Block";

export const CreateSandboxBlocks = (di: DIContainer): BlockList => {
	const weapons: BlockBuilder[] = [
		// PlasmaCoilAcceleratorUpgradeBlock, //todo: remove later

		//laser stuff
		LaserLensBlock,
		LaserEmitterBlock,

		//plasma stuff
		PlasmaShotgunMuzzleBlock,
		PlasmaSeparatorMuzzleBlock,
		PlasmaGunBarrelBlock,
		PlasmaGunBlock,
		//PlasmaCoilAcceleratorUpgradeBlock, // No model yet?

		//cannon stuff
		CannonBreech,
		...CannonBases,
		...CannonBarrels,

		// machinegun stuff
		MachineGunLoader,
		...MachineGunAmmoBlocks,
		...ArmoredMachineGunBarrels,
		...MachineGunBarrels,
		...MachineGunMuzzleBrakes,
		...MediumMachineGunBlocks,
	];

	const blocksArr: BlockBuilder[] = [
		...BuildingBlocks,
		...MechanicalBlocks,
		...BasicOperationBlocks,
		...BasicLogicGateBlocks,
		...WheelBlocks,
		...WingBlocks,
		...LampBlocks,
		...RocketBlocks,
		...ServoMotorBlocks,
		...TNTBlocks,
		...RopeBlocks,
		ExtinguisherBombBlock,
		...PropellantBlocks,
		...HingeBlocks,
		...StringOperationBlocks,
		...LinearSliderBlocks,
		...ProximityBlocks,
		...TurnTables,
		...RandomAccessMemoryBlocks,

		PistonBlock,
		MotorBlock,
		RCSEngineBlock,
		DisconnectBlock,
		SuspensionBlock,
		BallastBlock,
		HeliumBlock,
		MagnetBlock,
		BracedShaftBlock,
		BearingShaftBlock,

		ScreenBlock,
		...LedDisplayBlocks,
		TintBlock,
		SevenSegmentDisplayBlock,
		CameraBlock,
		BeaconBlock,
		TextureBlock,
		SizeBlock,
		HandleBlock,
		TracerBlock,

		VehicleSeatBlock,
		...PassengerSeatBlocks,
		BackMountBlock,

		DelayBlock,
		ValueExtenderBlock,
		FallbackBlock,
		SingleImpulseBlock,
		ImpulseGeneratorBlock,
		ImpulseExtenderBlock,
		CounterBlock,
		TpsCounterBlock,
		PingSensor,
		LogicMemoryBlock,
		NonVolatileMemoryBlock,
		LogicMemoryLegacyBlock,
		StackMemoryBlock,
		QueueMemoryBlock,
		ReadonlyMemoryBlock,
		RandomBlock,
		LogicOverclockBlock,
		LuaCircuitBlock,
		PIDControllerBlock,
		SplineLerpBlock,
		SelfVectorToTarget,
		RelativeVectorBlock,
		PointToScreenSpaceBlock,

		AltimeterBlock,
		KeyboardBlock,
		KeySensorBlock,
		...ButtonBlocks,
		LinearEasingBlock,
		ControllerBlock,
		AngleSensorBlock,
		GPSSensorBlock,
		FireSensorBlock,
		OwnerLocatorBlock,
		OwnerCameraLocatorBlock,
		GravitySensorBlock,
		MassSensorBlock,
		MouseSensorBlock,
		ChatSensorBlock,
		ClockTimeSensorBlock,
		JoystickSensorBlock,
		ControllerSensorBlock,
		RadioReceiverBlock,
		RadioTransmitterBlock,
		...RadarBlocks,
		RadarWarningReceiver,
		SpeedometerBlock,
		LaserBlock,
		FunctionBlock,

		SpeakerBlock,
		TTSBlock,
		SoundLengthBlock,
		SoundFromIdBlock,
		...SoundEffectBlockCreator.all,

		GuiTextBlock,
		GuiImageBlock,
		GuiButtonBlock,
		GuiStatBlock,

		...ParticleBlocks,

		GyroscopeBlock,
		...JetEngineBlocks,
		...GraviEngineBlocks,
	];

	// DEVELOPER ACCESS ONLY
	for (const devBlock of weapons) {
		blocksArr.push({
			...devBlock,
			devOnly: true,
		});
	}

	if (GameDefinitions.isTesting) {
		const testBlocks: readonly BlockBuilder[] = [...weapons];
		for (const block of testBlocks) {
			blocksArr.push(block);
		}
	}

	return BlockListBuilder.buildBlockList(blocksArr, di);
};
