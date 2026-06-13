import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { ParticleEffect } from "shared/effects/ParticleEffect";
import { SoundEffect } from "shared/effects/SoundEffect";
import { RemoteEvents } from "shared/RemoteEvents";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuilder } from "shared/blocks/Block";

const definition = {
	input: {
		extinguish: {
			displayName: "Extinguish",
			types: {
				bool: {
					config: false,
					control: {
						config: {
							enabled: true,
							key: "V",
							switch: false,
							reversed: false,
						},
						canBeSwitch: false,
						canBeReversed: false,
					},
				},
			},
		},
		radius: {
			displayName: "Radius",
			types: {
				number: {
					config: 20,
					clamp: {
						showAsSlider: true,
						min: 1,
						max: 35,
					},
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

type BombModel = BlockModel & {
	readonly Body: BasePart & {
		SmokeSound: Sound;
		ParticleEmitter: ParticleEmitter;
	};
	readonly Cap: MeshPart;
	readonly Charge: BasePart;
};

// server-only (A2S); cap physics + effects — fire teardown is in SpreadingFireController
RemoteEvents.Extinguish.invoked.Connect((_, { part, radius, sound, particle }) => {
	const block = part.Parent as BombModel;
	if (!part || !block) return;

	radius = math.clamp(radius, 0, definition.input.radius.types.number.config);

	const force = math.sqrt(radius) * block.Cap.Mass * 50;
	block.Charge.Destroy();
	block.Cap.CanCollide = false;
	block.Cap.CanQuery = false;
	block.Cap.SetNetworkOwner(undefined); // undefined = server
	block.Cap.ApplyImpulse(block.Cap.GetPivot().UpVector.mul(force));

	if (sound) SoundEffect.instance?.send(part, { sound, isPlaying: true, volume: 1 });
	if (particle) {
		// Scale smoke proportionally to radius — default radius gives default size.
		const scale = radius / definition.input.radius.types.number.config;
		ParticleEffect.instance?.send(part, { particle, isEnabled: true, scale });
		task.delay(2, () => {
			if (!particle.Parent) return;
			ParticleEffect.instance?.send(part, { particle, isEnabled: false });
		});
	}
});

export type { Logic as ExtinguisherBombBlockLogic };
class Logic extends InstanceBlockLogic<typeof definition, BombModel> {
	constructor(block: InstanceBlockLogicArgs) {
		super(definition, block);

		const inst = this.instance;
		const pp = inst.PrimaryPart;
		if (!pp) return;

		const sound = inst.Body.SmokeSound;
		const particle = inst.Body.ParticleEmitter;

		const radius = this.initializeInputCache("radius");

		this.on(({ extinguish }) => {
			if (!extinguish) return;

			RemoteEvents.Extinguish.send({
				part: pp,
				radius: radius.get(),
				sound,
				particle,
			});

			this.disable();
		});
	}
}

export const ExtinguisherBombBlock = {
	...BlockCreation.defaults,
	id: "extinguisherbomb",
	displayName: "Extinguisher Bomb",
	description: "Extinguishes fire on nearby blocks within the configured radius.",
	search: { partialAliases: ["fire"] },
	limit: 100,

	logic: { definition, ctor: Logic },
} as const satisfies BlockBuilder;
