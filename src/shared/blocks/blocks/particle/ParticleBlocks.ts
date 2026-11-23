import { RunService } from "@rbxts/services";
import { Element } from "engine/shared/Element";
import { t } from "engine/shared/t";
import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockSynchronizer } from "shared/blockLogic/BlockSynchronizer";
import { ConfigSequences } from "shared/blockLogic/ConfigSequences";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { PublicEffects } from "shared/blocks/PublicEffects";
import { Colors } from "shared/Colors";
import type {
	BlockLogicFullBothDefinitions,
	BlockLogicFullInputDef,
	InstanceBlockLogicArgs,
} from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";
import type { BlockBuilder } from "shared/blocks/Block";

const defaultParticleID = "14198353638";

namespace ParticleEmitter {
	const definition = {
		input: {
			particle: {
				displayName: "Configured particle",
				types: {
					particle: {
						config: {
							particleID: defaultParticleID,
						},
					},
				},
				configHidden: true,
			},
			enabled: {
				displayName: "Enabled",
				types: {
					bool: {
						config: true,
					},
				},
			},
			emit: {
				// this was added
				displayName: "Emit",
				types: {
					bool: {
						config: false,
					},
				},
			},
		},
		output: {},
	} satisfies BlockLogicFullBothDefinitions;

	type ParticleEmitterBlock = BlockModel & {
		Body: BasePart & {
			ParticleEmitter: ParticleEmitter;
		};
	};

	/**
	 * The enum-valued fields arrive as the element key, not as an EnumItem — `ParticleValue` declares them as
	 * `Enum.*` but the creator block stores what its enum input produced, which is why every use below casts.
	 * Checking membership here is what keeps `Enum.X[…]` from indexing with a name that does not exist: that
	 * raises, and this handler runs on every client receiving the broadcast.
	 */
	const oneOf = <T extends string>(...names: readonly T[]) =>
		t.custom((value): value is T => typeIs(value, "string") && names.contains(value as T));

	const numberOrSequence = ConfigSequences.tNumber;

	const particleValueType = t.intersection(
		t.interface({ particleID: t.string }),
		t.partial({
			flipbookLayout: oneOf("None", "Grid2x2", "Grid4x4", "Grid8x8"),
			orientation: oneOf("FacingCamera", "FacingCameraWorldUp", "VelocityParallel", "VelocityPerpendicular"),
			emissionDirection: oneOf("Top", "Bottom", "Front", "Back", "Left", "Right"),
			shape: oneOf("Box", "Cylinder", "Disc", "Sphere"),
			shapeInOut: oneOf("InAndOut", "Inward", "Outward"),
			shapeStyle: oneOf("Volume", "Surface"),

			acceleration: t.vector3,
			spreadAngle: t.vector3,
			color: ConfigSequences.tColor,

			// bounds mirror the creator block's own clamps
			transparency: numberOrSequence(0, 1),
			timeScale: t.numberWithBounds(0, 1),
			lifetime: numberOrSequence(0, 20),
			velocityInheritance: t.number,
			rotationSpeed: numberOrSequence(),
			brightness: t.number,
			rotation: numberOrSequence(),
			squash: numberOrSequence(),
			speed: numberOrSequence(),
			rate: t.number,
			size: numberOrSequence(),
			drag: t.number,

			lockedToPart: t.boolean,
		}),
	) as unknown as t.Type<BlockLogicTypes.ParticleValue>;

	type UpdateData = t.Infer<typeof updateDataType>;
	const updateDataType = t.interface({
		block: t.instance("Model").nominal("blockModel").as<ParticleEmitterBlock>(),
		properties: particleValueType,
		enabled: t.boolean,
		/** Whether `properties` moved, so a bare toggle costs one property write instead of the whole sweep. */
		propertiesChanged: t.boolean,
	});

	type EmitData = t.Infer<typeof emitDataType>;
	const emitDataType = t.interface({
		block: t.instance("Model").nominal("blockModel").as<ParticleEmitterBlock>(),
		/** Monotonic. A joining player is replayed the latest value and adopts it without emitting. */
		count: t.number,
	});

	/** Blocks whose properties this client has applied at least once. */
	const applied = new Set<ParticleEmitterBlock>();

	const updateParametersFunc = ({ properties, block, enabled, propertiesChanged }: UpdateData) => {
		const emitter = block.Body.ParticleEmitter;
		emitter.Enabled = enabled;

		// A replayed payload carries whatever flag its last send had, so a joining player whose first payload
		// was a bare toggle still applies once.
		if (!propertiesChanged && applied.has(block)) return;
		if (!applied.has(block)) {
			applied.add(block);
			block.Destroying.Connect(() => applied.delete(block));
		}

		emitter.Texture = `rbxassetid://${properties.particleID}`;
		if (properties.rate !== undefined) emitter.Rate = properties.rate;
		if (properties.flipbookLayout !== undefined)
			emitter.FlipbookLayout = Enum.ParticleFlipbookLayout[properties.flipbookLayout as never];
		if (properties.speed !== undefined) emitter.Speed = ConfigSequences.toNumberRange(properties.speed);
		if (properties.acceleration !== undefined) emitter.Acceleration = properties.acceleration;
		if (properties.color !== undefined) emitter.Color = ConfigSequences.toColorSequence(properties.color);
		if (properties.lifetime !== undefined) {
			const lifetime = properties.lifetime;
			emitter.Lifetime = typeIs(lifetime, "number")
				? new NumberRange(lifetime * 0.95, lifetime * 1.05)
				: ConfigSequences.toNumberRange(lifetime);
		}
		if (properties.rotation !== undefined) emitter.Rotation = ConfigSequences.toNumberRange(properties.rotation);
		if (properties.rotationSpeed !== undefined)
			emitter.RotSpeed = ConfigSequences.toNumberRange(properties.rotationSpeed);
		if (properties.squash !== undefined) emitter.Squash = ConfigSequences.toNumberSequence(properties.squash);
		if (properties.transparency !== undefined)
			emitter.Transparency = ConfigSequences.toNumberSequence(properties.transparency);
		if (properties.spreadAngle !== undefined)
			emitter.SpreadAngle = new Vector2(properties.spreadAngle.X, properties.spreadAngle.Y);
		if (properties.velocityInheritance !== undefined) emitter.VelocityInheritance = properties.velocityInheritance;
		if (properties.lockedToPart !== undefined) emitter.LockedToPart = properties.lockedToPart;
		if (properties.orientation !== undefined)
			emitter.Orientation = Enum.ParticleOrientation[properties.orientation as never];
		if (properties.brightness !== undefined) emitter.Brightness = properties.brightness;
		if (properties.timeScale !== undefined) emitter.TimeScale = properties.timeScale;
		if (properties.size !== undefined) emitter.Size = ConfigSequences.toNumberSequence(properties.size);
		if (properties.drag !== undefined) emitter.Drag = properties.drag;

		if (properties.emissionDirection !== undefined)
			emitter.EmissionDirection = Enum.NormalId[properties.emissionDirection as never];
		if (properties.shape !== undefined) emitter.Shape = Enum.ParticleEmitterShape[properties.shape as never];
		if (properties.shapeInOut !== undefined)
			emitter.ShapeInOut = Enum.ParticleEmitterShapeInOut[properties.shapeInOut as never];
		if (properties.shapeStyle !== undefined)
			emitter.ShapeStyle = Enum.ParticleEmitterShapeStyle[properties.shapeStyle as never];
	};

	/** Last count seen per block, so a replayed payload is adopted rather than fired. */
	const emitted = new Map<ParticleEmitterBlock, number>();

	const emitState = ({ block, count }: EmitData) => {
		const previous = emitted.get(block);
		if (previous === undefined) {
			// first payload for this block on this client: a joining player is caught up, not made to emit
			emitted.set(block, count);
			block.Destroying.Connect(() => emitted.delete(block));
			return;
		}

		emitted.set(block, count);
		if (count <= previous) return;

		block.Body.ParticleEmitter.Emit(count - previous);
	};

	const stopParticles = (block: ParticleEmitterBlock) => {
		block.Body.ParticleEmitter.Enabled = false;
		block.Body.ParticleEmitter.Clear();
	};
	PublicEffects.register("publicParticles", (shouldStop) => {
		for (const block of applied) {
			if (shouldStop(block)) stopParticles(block);
		}
		for (const [block] of emitted) {
			if (shouldStop(block)) stopParticles(block);
		}
	});

	const events = {
		updateParameters: new BlockSynchronizer<UpdateData>("particle_update", updateDataType, updateParametersFunc),
		emit: new BlockSynchronizer<EmitData>("particle_emit", emitDataType, emitState),
	} as const;

	export class Logic extends InstanceBlockLogic<typeof definition, ParticleEmitterBlock> {
		static readonly events = events;

		constructor(block: InstanceBlockLogicArgs) {
			super(definition, block);

			const emitNode = this.initializeInputCache("emit");
			const particleNode = this.initializeInputCache("particle");
			let count = 0;

			this.event.subscribe(RunService.PostSimulation, () => {
				if (!updateNextTick) return;
				updateNextTick = false;
				if (emitNode.tryGet() ?? false) events.emit.send({ block: this.instance, count: ++count });
			});

			let updateNextTick = false;
			this.onTicc(() => (updateNextTick = true));

			// One payload: a synchronizer replays only its last one per block, so a joining player would
			// otherwise get whichever of the two arrived most recently and default the other.
			const sendState = (enabled: boolean, particle: BlockLogicTypes.ParticleValue, propertiesChanged: boolean) =>
				events.updateParameters.sendOrBurn(
					{ block: this.instance, properties: particle, enabled, propertiesChanged },
					this,
				);

			this.onk(["enabled", "particle"], ({ enabled, particle, particleChanged }) =>
				sendState(enabled, particle, particleChanged),
			);

			this.onDisable(() => {
				if (this.isDestroying()) return;

				const particle = particleNode.tryGet();
				if (particle) sendState(false, particle, false);
			});
		}
	}

	export const Block = {
		...BlockCreation.defaults,
		id: "particleemitter",
		logicPriority: BlockCreation.priority.Output,
		displayName: "Particle Emitter",
		description: `Spawns various prepared particles.`,

		limit: 20,

		logic: { definition, ctor: Logic, events },
	} as const satisfies BlockBuilder;
}

namespace ParticleCreator {
	const cnum = (config: number) => ({ number: { config } });
	const cnumrange = (config: number, min: number, max: number) => ({
		number: {
			config,
			clamp: {
				min,
				max,
				step: 0.01,
				showAsSlider: true,
			},
		},
	});
	/** Range inputs feed the emitter's NumberRange properties, curve inputs its NumberSequence ones */
	const cseq = (config: number, sequence: BlockLogicTypes.ConfigSequenceShape) => ({ number: { config, sequence } });
	const defaultNum = cnum(0);
	const defaultBool = { bool: { config: false } };
	const defaultVec = { vector3: { config: Vector3.zero } };
	const defaultNumRange = cnumrange(0, 0, 1);

	const stringIdType = {
		string: {
			config: defaultParticleID,
		},
	};

	const inpCreate = <T extends BlockLogicFullInputDef["types"]>(
		displayName: string,
		description: string,
		types: T,
	) => ({
		displayName,
		description,
		types,
	});

	const enumOptionGenerate = (base: string, options: string[]) => {
		const res: Record<string, { displayName: string }> = {};
		for (const v of options) res[v] = { displayName: `${base} ${v}` };
		return res;
	};

	const definition = {
		inputOrder: [
			"particleID",
			"color",
			"size",
			"speed",
			"rate",
			"lifetime",
			"rotation",
			"rotationSpeed",
			"transparency",
			"orientation",
			"squash",
			"acceleration",
			"spreadAngle",
			"velocityInheritance",
			"flipbookLayout",
			"brightness",
			"drag",
			"timeScale",
			"lockedToPart",
			"emissionDirection",
			"shape",
			"shapeInOut",
			"shapeStyle",
		] as const satisfies (keyof BlockLogicTypes.ParticleValue | "particleID")[],
		input: {
			particleID: inpCreate("Particle", "ID of the particle.", stringIdType),
			rotation: inpCreate("Rotation", "The rotation. Speaks for itself", cseq(0, "range")),
			rotationSpeed: inpCreate("Rotation Speed", "How fast your particles will rotate", cseq(0, "range")),
			transparency: inpCreate("Transparency", "It's like opaque-ness but the other way around", {
				number: { ...defaultNumRange.number, sequence: "curve" as const },
			}),
			color: inpCreate("Color", "The color of the spawned particles", {
				color: { config: Colors.white, sequence: "curve" as const },
			}),
			squash: inpCreate("Squash", "How squashed will the particles be", cseq(0, "curve")),
			lifetime: inpCreate("Lifetime", "How long will your particle exist until despawning", cseq(5, "range")),
			acceleration: inpCreate("Acceleration", "The acceleration of the spawned partice", defaultVec),
			speed: inpCreate("Particle Speed", "The speed. Ka-Chau.", cseq(2, "range")),
			rate: inpCreate("Spawn Rate", "How often the particles will spawn", cnum(5)),
			brightness: inpCreate("Brightness", "How bright the particle's texture is", cnum(1)),
			size: inpCreate("Size", "The size of the partice", cseq(1, "curve")),
			drag: inpCreate("Drag", "How fast the particle will decelerate", defaultNum),
			velocityInheritance: inpCreate("Velocity Inheritance", "", defaultNum),
			timeScale: inpCreate("Time Scale", "The speed of animation of the particle.", cnumrange(1, 0, 1)),
			spreadAngle: inpCreate(
				"Spread Angle",
				"The direction particles will spread. Z-axis isn't used.",
				defaultVec,
			),
			lockedToPart: inpCreate(
				"Locked To Part",
				"Determines if the particle gets affected by the spawner's movement",
				defaultBool,
			),
			flipbookLayout: inpCreate("Flipbook Layout", "idk ask the internet", {
				enum: {
					config: "None",
					elements: {
						None: { displayName: "None" },
						Grid2x2: { displayName: "Grid 2x2" },
						Grid4x4: { displayName: "Grid 4x4" },
						Grid8x8: { displayName: "Grid 8x8" },
					},
					elementOrder: ["None", "Grid2x2", "Grid4x4", "Grid8x8"],
				},
			}),
			orientation: inpCreate("Orientation", "Which way the paricle will be facing", {
				enum: {
					config: "FacingCamera",
					elements: {
						FacingCamera: { displayName: "Facing Camera" },
						FacingCameraWorldUp: { displayName: "Facing Camera World Up" },
						VelocityParallel: { displayName: "Velocity Parallel" },
						VelocityPerpendicular: { displayName: "Velocity Perpendicular" },
					},
					elementOrder: ["FacingCamera", "FacingCameraWorldUp", "VelocityParallel", "VelocityPerpendicular"],
				},
			}),
			emissionDirection: inpCreate("Emission Direction", "Which way the paricle will be facing", {
				enum: {
					config: "Top",
					elements: enumOptionGenerate("Emissions facing", [
						"Top",
						"Bottom",
						"Front",
						"Back",
						"Left",
						"Right",
					]),
					elementOrder: ["Top", "Bottom", "Front", "Back", "Left", "Right"],
				},
			}),
			shape: inpCreate("Emission Shape", "Kinda hard to explain. Check it out yourself.", {
				enum: {
					config: "Box",
					elements: enumOptionGenerate("Shape -", ["Box", "Cylinder", "Disc", "Sphere"]),
					elementOrder: ["Box", "Cylinder", "Disc", "Sphere"],
				},
			}),
			shapeInOut: inpCreate("Shape In/Out", "Determines if the particle will be emitted inwards or outwards", {
				enum: {
					config: "Outward",
					elements: enumOptionGenerate("Emits ", ["InAndOut", "Inward", "Outward"]),
					elementOrder: ["InAndOut", "Inward", "Outward"],
				},
			}),
			shapeStyle: inpCreate("Shape style", "Determines how particles will spread around", {
				enum: {
					config: "Volume",
					elements: enumOptionGenerate("Follow", ["Volume", "Surface"]),
					elementOrder: ["Volume", "Surface"],
				},
			}),
		} satisfies { [k in keyof BlockLogicTypes.ParticleValue]: BlockLogicFullInputDef },
		output: {
			output: {
				displayName: "Output particle",
				types: ["particle"],
			},
		},
	} satisfies BlockLogicFullBothDefinitions;

	class Logic extends InstanceBlockLogic<typeof definition> {
		constructor(block: InstanceBlockLogicArgs) {
			super(definition, block);

			this.on((arg) => {
				const res = {} as Record<string, unknown>;
				for (const [k, _] of pairs(this.definition.input)) {
					res[k] = arg[k];
				}
				this.output.output.set("particle", res as BlockLogicTypes.ParticleValue);
			});
		}
	}

	const flipbookFramesPerSide: { readonly [k in string]?: number } = {
		None: 1,
		Grid2x2: 2,
		Grid4x4: 4,
		Grid8x8: 8,
	};

	type PreviewGui = CanvasGroup & { Sheet: ImageLabel };

	/** Frames per side of each preview whose flipbook is playing. Its loop ends once the entry drops to 1. */
	const animating = new Map<PreviewGui, number>();

	// The emitter never sets its flipbook properties, so it plays the engine defaults: Loop at 1 frame per second
	// fixme: row-major frame order is assumed, not checked against the engine
	const animate = (gui: PreviewGui) =>
		task.spawn(() => {
			let side = 0;
			let frame = 0;
			while (gui.Parent) {
				const current = animating.get(gui) ?? 1;
				if (current <= 1) break;
				if (current !== side) {
					side = current;
					frame = 0;
				}

				gui.Sheet.Position = new UDim2(-(frame % side), 0, -math.floor(frame / side), 0);
				task.wait(1);
				frame = (frame + 1) % (side * side);
			}

			animating.delete(gui);
		});

	// A CanvasGroup rather than a clipping Frame: clipping by a rotated parent is unsupported (GuiObject.ClipsDescendants)
	const preview = BlockCreation.preview(
		definition,
		(Parent): PreviewGui =>
			Element.create(
				"CanvasGroup",
				{
					Name: "BlockParticlePreview",
					AnchorPoint: new Vector2(0.5, 0.5),
					Position: new UDim2(0.5, 0, 0.5, 0),
					SizeConstraint: Enum.SizeConstraint.RelativeYY,
					// a quarter of the screen height under the preview parent's UIScale of 8 (MainScreenLayout.fullScreenScaled8)
					Size: new UDim2(0.25 / 8, 0, 0.25 / 8, 0),
					BackgroundTransparency: 1,
					Parent,
				},
				{ Sheet: Element.create("ImageLabel", { BackgroundTransparency: 1 }) },
			),
		(group, config) => {
			const frames =
				flipbookFramesPerSide[
					BlockCreation.defaultIfWiredUnset(
						config.flipbookLayout,
						definition.input.flipbookLayout.types.enum.config,
					)
				] ?? 1;
			group.Sheet.Size = new UDim2(frames, 0, frames, 0);

			const previous = animating.get(group);
			if (previous !== frames) group.Sheet.Position = new UDim2(0, 0, 0, 0);
			if (frames > 1) {
				animating.set(group, frames);
				if (previous === undefined) animate(group);
			} else if (previous !== undefined) {
				animating.set(group, 1);
			}

			group.Sheet.Image = `rbxassetid://${BlockCreation.defaultIfWiredUnset(config.particleID, definition.input.particleID.types.string.config)}`;
			// these inputs can hold a config sequence, which the image shows by its value at time 0
			group.Sheet.ImageColor3 = ConfigSequences.firstColor(
				BlockCreation.defaultIfWiredUnset(config.color, definition.input.color.types.color.config),
			);
			group.Sheet.ImageTransparency = ConfigSequences.firstNumber(
				BlockCreation.defaultIfWiredUnset(
					config.transparency,
					definition.input.transparency.types.number.config,
				),
			);
			group.Rotation = ConfigSequences.firstNumber(
				BlockCreation.defaultIfWiredUnset(config.rotation, definition.input.rotation.types.number.config),
			);
		},
	);

	export const Block = {
		...BlockCreation.defaults,
		id: `particlecreator`,
		displayName: `Particle Creator`,
		description: `Creates the particle. Pass the result of the configuration to ${ParticleEmitter.Block.displayName}!`,

		logic: { definition, ctor: Logic, preview },
	};
}

export type ParticleEmitterBlockLogic = typeof ParticleEmitter.Logic;
export const ParticleBlocks: readonly BlockBuilder[] = [ParticleCreator.Block, ParticleEmitter.Block];
