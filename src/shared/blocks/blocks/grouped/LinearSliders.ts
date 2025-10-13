import { InstanceBlockLogic } from "shared/blockLogic/BlockLogic";
import { BlockCreation } from "shared/blocks/BlockCreation";
import { BlockManager } from "shared/building/BlockManager";
import type { BlockLogicFullBothDefinitions, InstanceBlockLogicArgs } from "shared/blockLogic/BlockLogic";
import type { BlockBuildersWithoutIdAndDefaults } from "shared/blocks/Block";

type SliderBlockModel = BlockModel & {
	TrackBase: BasePart & {
		PrismaticConstraint: PrismaticConstraint;
	};
};

// the true width of the sliders
// DO NOT CHANGE
const sliderWidth = 6;

const sliderDefinition = {
	// change order if ya want
	inputOrder: ["powered", "targetPos", "speed", "stiffness", "max_force"],
	input: {
		powered: {
			displayName: "Powered",
			tooltip: "If the slider actively asserts force.",
			types: {
				bool: {
					config: true,
				},
			},
		},
		speed: {
			displayName: "Speed",
			tooltip: "Specifies the speed of the slider.",
			unit: "studs/second",
			types: {
				number: {
					config: 15,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 100,
						step: 0.01,
					},
				},
			},
		},
		targetPos: {
			displayName: "Target Position (%)",
			unit: "Percent", // I dident want to deal with changing max values with scaling
			tooltip: "Use `(studs/(total_length/2))*100` to get the offset-to-percent",
			types: {
				number: {
					config: 0,
					clamp: {
						showAsSlider: false,
						min: -100,
						max: 100,
					},
					control: {
						config: {
							enabled: true,
							startValue: 0,
							mode: {
								type: "instant",
								instant: {
									mode: "onRelease",
								},
								smooth: {
									mode: "stopOnRelease",
									speed: 20,
								},
							},
							keys: [
								{ key: "R", value: 100 },
								{ key: "F", value: -100 },
							],
						},
					},
				},
			},
		},
		stiffness: {
			displayName: "Responsiveness",
			tooltip: "Specifies the sharpness of the servo motor in reaching the Target Angle.",
			types: {
				number: {
					config: 45,
					clamp: {
						showAsSlider: true,
						min: 0,
						max: 100,
						step: 0.01,
					},
				},
			},
			connectorHidden: true,
		},
		max_force: {
			displayName: "Max Force",
			tooltip: "Specifies the maximum force of the slider.",
			types: {
				number: {
					config: 200,
					clamp: {
						showAsSlider: true,
						max: 600,
						min: 0,
						step: 0.1,
					},
				},
			},
		},
	},
	output: {},
} satisfies BlockLogicFullBothDefinitions;

const sd_tpos = sliderDefinition.input.targetPos;
const sliderDefinition_edge = {
	...sliderDefinition,
	input: {
		...sliderDefinition.input,
		targetPos: {
			...sd_tpos,
			types: {
				number: {
					...sd_tpos.types.number,
					clamp: {
						...sd_tpos.types.number.clamp,
						min: 0, // override -100 to 0
					},
					control: {
						config: {
							...sd_tpos.types.number.control!.config,
							keys: [
								{ key: "R", value: 100 },
								{ key: "F", value: 0 }, // override -100 to 0
							],
						},
					},
				},
			},
		},
	},
} satisfies BlockLogicFullBothDefinitions;

// get studs extended for a given percent
function getPercent2Studs(percent: number, totalLength: number) {
	return (percent / 100) * totalLength;
}

// base slider class (NO DEFINITION)
abstract class SliderBlockLogic_Base extends InstanceBlockLogic<typeof sliderDefinition, SliderBlockModel> {
	constructor(
		def: typeof sliderDefinition,
		block: InstanceBlockLogicArgs,
		default_length: number = sliderWidth / 2,
		isCentered: boolean = true,
	) {
		super(def, block);

		// base definitions here because we do things this way
		const slider = this.instance.TrackBase.PrismaticConstraint;

		const blockScale = BlockManager.manager.scale.get(this.instance) ?? Vector3.one;
		const scale = blockScale.X * blockScale.Y * blockScale.Z;

		this.onk(["powered"], ({ powered }) => {
			slider.ActuatorType = powered ? Enum.ActuatorType.Servo : Enum.ActuatorType.None;
		});

		this.onk(["targetPos"], ({ targetPos }) => {
			// calculate the position based on percent
			let pos = getPercent2Studs(targetPos, default_length * blockScale.Z);
			if (!isCentered) {
				pos = math.max(pos, 0);
			}
			slider.TargetPosition = pos;
		});

		this.onk(["stiffness"], ({ stiffness }) => {
			slider.LinearResponsiveness = stiffness;
		});

		this.onk(["max_force"], ({ max_force }) => {
			slider.ServoMaxForce = max_force * 1_000 * math.max(0.95, scale);
		});

		this.onk(["speed"], ({ speed }) => {
			slider.Speed = speed;
		});

		this.onFirstInputs(() => {
			const limit = default_length * blockScale.Z;
			slider.LowerLimit = isCentered ? -limit : 0;
			slider.UpperLimit = isCentered ? limit : limit * 2;
		});
	}
}

// base class with definition
class SliderBlockLogic extends SliderBlockLogic_Base {
	constructor(block: InstanceBlockLogicArgs) {
		super(sliderDefinition, block);
	}
}

// limit range to account for carriage
class Limit_SliderBlockLogic extends SliderBlockLogic_Base {
	constructor(block: InstanceBlockLogicArgs) {
		super(sliderDefinition, block, sliderWidth / 2 - 0.5);
	}
}

// make on edge
class Edge_Limit_SliderBlockLogic extends SliderBlockLogic_Base {
	constructor(block: InstanceBlockLogicArgs) {
		// use custom definition for edge
		// _, _, default_length, isCentered
		super(sliderDefinition_edge, block, sliderWidth - 1, false);
	}
}

// the WIDE ones
// limit range to account for carriage
class Limit_SliderBlockLogic_Wide extends SliderBlockLogic_Base {
	constructor(block: InstanceBlockLogicArgs) {
		super(sliderDefinition, block, sliderWidth / 2 - 1.5);
	}
}

// make on edge
class Edge_Limit_SliderBlockLogic_Wide extends SliderBlockLogic_Base {
	constructor(block: InstanceBlockLogicArgs) {
		// use custom definition for edge
		// _, _, default_length, isCentered
		super(sliderDefinition_edge, block, sliderWidth - 3, false);
	}
}

const search = {
	aliases: ["rail"],
};
const list: BlockBuildersWithoutIdAndDefaults = {
	// the id VVV
	// 2 plates
	// TSliderDualPlate
	tsliderdualplate: {
		displayName: "Linear Rail Slider",
		description: "It slides along, waiting to be destroyed like my sanity.", // gotta make sure it fits with the theme of depres.. warm happiness!
		search,
		logic: { definition: sliderDefinition, ctor: SliderBlockLogic },
	},
	// TSliderFull
	// above but with a guide
	tsliderfull: {
		displayName: "Linear Guide-Rail Slider",
		description: "A 'Linear Rail Slider' but a different model.",
		search,
		logic: { definition: sliderDefinition, ctor: SliderBlockLogic },
	},

	// TSliderCenter
	// above but with a smaller carriage (and centered)
	tslidercenter: {
		displayName: "Linear Carriage Slider (Centered)",
		description: "Slides linearly with a carriage in the center.",
		search,
		logic: { definition: sliderDefinition, ctor: Limit_SliderBlockLogic },
	},
	// TSliderEdge
	// above but the carriage is at the end
	tslideredge: {
		displayName: "Linear Carriage Slider (Edge)",
		description: "Slides linearly with a carriage at the edge.",
		search,
		logic: { definition: sliderDefinition, ctor: Edge_Limit_SliderBlockLogic },
	},

	// TSliderCenterWide
	// TSliderCenter but with a wide carriage
	tslidercenterwide: {
		displayName: "Linear Wide Carriage Slider (Centered)",
		description: "Slides linearly with a carriage in the center. But its a wide carriage.",
		search,
		logic: { definition: sliderDefinition, ctor: Limit_SliderBlockLogic_Wide },
	},
	// TSliderEdgeWide
	// TSliderEdge but with a wide carriage
	tslideredgewide: {
		displayName: "Linear Wide Carriage Slider (Edge)",
		description: "Slides linearly with a carriage at the edge. But its a wide carriage.",
		search,
		logic: { definition: sliderDefinition, ctor: Edge_Limit_SliderBlockLogic_Wide },
	},
};
export const LinearSliderBlocks = BlockCreation.arrayFromObject(list);
