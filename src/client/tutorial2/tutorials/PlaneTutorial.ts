import { RunService } from "@rbxts/services";
import { ConfirmPopup } from "client/gui/popup/ConfirmPopup";
import { NewBasicPlaneTutorialDiffs } from "client/tutorial/tutorials/NewBasicPlaneTutorial.diff";
import { BuildingDiffer } from "client/tutorial2/BuildingDiffer";
import { TutorialTimeline } from "client/tutorial2/TutorialTimeline";
import { InputController } from "engine/client/InputController";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { PopupController } from "client/gui/PopupController";
import type { BuildingMode } from "client/modes/build/BuildingMode";
import type { EditToolMode } from "client/tools/EditTool";
import type { ToolBase } from "client/tools/ToolBase";
import type { ToolController } from "client/tools/ToolController";
import type { BuildingDiffChange } from "client/tutorial2/BuildingDiffer";
import type { TutorialDescription } from "client/tutorial2/TutorialDescription";
import type { TutorialStarter } from "client/tutorial2/TutorialStarter";
import type { Component } from "engine/shared/component/Component";

type DiffName = keyof (typeof NewBasicPlaneTutorialDiffs)["diffs"];

// the first tutorial system's plane, step for step
const start = (tutorial: TutorialStarter, _firstTime: boolean) => {
	tutorial.$onInjectAuto(
		(
			toolController: ToolController,
			buildingMode: BuildingMode,
			popupController: PopupController,
			blockList: BlockList,
			mainScreen: MainScreenLayout,
		) => {
			const gui = tutorial.controller.gui;
			const plot = tutorial.plot;
			const runner = tutorial.runner;
			const tools = buildingMode.tools;
			const desktop = InputController.inputType.get() === "Desktop";

			// popups go over the tutorial's own screen
			const confirm = (title: string, action: () => void) => {
				const popup = popupController.showPopup(
					new ConfirmPopup(title, "This way you will learn this lesson worse!", action, () => {}),
				);
				popup.instance.DisplayOrder = gui.instance.DisplayOrder + 1;
			};

			gui.progress.setTitle("Basic plane");
			gui.progress.setStopAction((stop) => confirm("Are you sure you want to skip the tutorial?", stop));
			gui.progress.enableSkip();
			gui.progress.setSkipAction((skip) => {
				if (RunService.IsStudio()) return skip();
				confirm("Are you sure you want to skip this step?", skip);
			});

			// the plot as each step leaves it, replayed in the order the steps are set up, which is the order they run in
			const timeline = new TutorialTimeline();
			const diff = (name: DiffName, adjust?: (change: BuildingDiffChange) => BuildingDiffChange) => {
				const change = BuildingDiffer.fromChangeList(
					NewBasicPlaneTutorialDiffs.diffs[name],
					NewBasicPlaneTutorialDiffs.saveVersion,
				);
				return adjust ? adjust(change) : change;
			};

			const useTools = (scope: Component, enabled: readonly ToolBase[], modes?: readonly EditToolMode[]) => {
				toolController.enabledTools.enableOnly(...enabled);
				scope.onDestroy(() => toolController.enabledTools.disableAll());
				if (!modes) return;

				tools.editTool.enabledModes.enableOnly(...modes);
				scope.onDestroy(() => tools.editTool.enabledModes.enableAll());
			};
			const say = (scope: Component, text: string, hints: readonly string[] = []) => {
				// at the right margin, beside the selection buttons rather than over them
				const box = gui.createText().withPositionAround(mainScreen.right.instance, "left").withText(text);
				for (const hint of hints) {
					if (hint === "") continue;
					box.withText(`• ${hint}`);
				}

				return scope.parent(box);
			};

			// a message to read, then Next; Skip counts as Next
			const message = (text: string, hints?: readonly string[]) => {
				let pressed = false;
				runner.add({
					begin: (scope) => {
						pressed = false;
						say(scope, text, hints).withNext(() => (pressed = true));
					},
					done: () => pressed,
					skip: () => (pressed = true),
				});
			};
			// a step that is done once the plot matches what a change asks for; Skip sends what is still missing
			const ask = (
				change: BuildingDiffChange,
				enabled: readonly ToolBase[],
				text: string,
				hints: readonly string[],
				modes?: readonly EditToolMode[],
			) => {
				const requests = plot.requests(timeline.apply(change));
				runner.add({
					begin: (scope) => {
						useTools(scope, enabled, modes);
						say(scope, text, hints);
						for (const request of requests) request.begin(scope);
					},
					done: () => requests.all((request) => request.done()),
					skip: () => {
						for (const request of requests) request.skip();
					},
				});
			};
			const goal = (name: DiffName, enabled: readonly ToolBase[], text: string, hints: readonly string[]) =>
				ask(diff(name), enabled, text, hints);
			// placing what a recorded change adds; deprecated 1xN blocks in it are placed as their base block, then
			// stretched to their full size in a step of their own
			const build = (
				name: DiffName,
				text: string,
				hints: readonly string[],
				adjust?: (change: BuildingDiffChange) => BuildingDiffChange,
			) => {
				// a stretched block starts in its corner nearest the plane so far, so it is placed against the frame
				const { place, stretch } = BuildingDiffer.splitScaled(diff(name, adjust), blockList, timeline.centre());
				ask(place, [tools.buildTool], text, hints);
				if (!stretch) return;

				ask(
					stretch,
					[tools.editTool],
					"Now stretch them to fill their outlines.",
					[
						"Select the edit tool",
						`Press "Single Selection" on the right`,
						"Select one of the highlighted blocks",
						`Press "Scale" on the bottom`,
						"Drag the arrows on its far sides until it fills the outline",
						"Do the same for every highlighted block",
					],
					["Scale"],
				);
			};

			message("Welcome to OverEngineered!\nThis tutorial will teach you how to build a basic plane.", [
				`Hint: Press "next" to advance`,
				"Hint: You can play this tutorial again.\nLook for it in the settings.",
			]);

			build("base", "First, let's build the frame for your plane.", [
				"Select the build tool",
				`Select "Beam 4x1"`,
				"Place all the highlighted blocks",
				desktop ? "Hint: Hold shift to build multiple blocks" : 'Hint: Press "++" to build multiple blocks',
			]);
			goal(
				"engineAndSeat",
				[tools.buildTool],
				"Now let's place the engine and the seat.\nThe engine will power your plane and the seat will provide a comfortable flight!",
				["Select the build tool", `Select and place "Small Rocket Engine"`, `Select and place "Driver Seat"`],
			);
			build("basicWings", "Well done! Now place some wings.", [
				"Select the build tool",
				`Select and place "Wedge Wing"`,
				`Select and place "Wing Panel"`,
			]);

			ask(
				diff("moveAll"),
				[tools.editTool],
				"Before the next step, let's move your creation a bit higher.",
				[
					"Select the edit tool",
					`Press "Structure Selection" on the right`,
					"Press anywhere on your creation",
					`Press "Move" on the bottom`,
					"Drag the green arrow (the one on the top)",
				],
				["Move"],
			);

			goal(
				"servo",
				[tools.buildTool],
				"It's time to place the servos.\nThese are used to precisely rotate something to an angle.\nWe're going to control many things using these.",
				[
					"Select the build tool",
					`Select "Movement"`,
					`Select "Motor"`,
					`Select "Servo"`,
					"Place all the highlighted blocks",
				],
			);
			goal(
				"removeExtraServo",
				[tools.deleteTool],
				"Oh, what's that? Seems that we placed an extra servo!\nLet's remove it.",
				["Select the delete tool", "Remove the highlighted block"],
			);
			// the elevators and the tail fin were each two 1x2 wings side by side, 4x4 studs together: one wing panel
			// stretched both ways covers each pair, keeping the first wing's uuid and rotation
			const merged = new Map<BlockUuid, Vector3>([
				["3277b070-5d5e-44e1-b41d-8b63b11cbfdc" as BlockUuid, new Vector3(8, 9.5, 5)],
				["982133c1-045d-495f-a360-a6ea73626fd0" as BlockUuid, new Vector3(8, 9.5, -5)],
				["48c7b42d-3bbc-49ec-9546-8e9278842868" as BlockUuid, new Vector3(8, 14.5, 0)],
			]);
			const coveredByMerged = new ReadonlySet([
				"713d4f01-c77d-4f2c-aa91-bb3afcbbc908" as BlockUuid,
				"e70da516-eb85-45ef-837e-1455208d44fc" as BlockUuid,
				"a87e50ea-ab5c-4237-bffa-6db1ec646934" as BlockUuid,
			]);
			const mergeWingPairs = (change: BuildingDiffChange): BuildingDiffChange => ({
				...change,
				added: change.added
					?.filter((block) => !coveredByMerged.has(block.uuid))
					.map((block) => {
						const at = merged.get(block.uuid);
						if (!at) return block;

						return {
							id: "wing1x1" as BlockId,
							uuid: block.uuid,
							location: block.location.Rotation.add(at),
							scale: new Vector3(2, 1, 2),
						};
					}),
			});

			build(
				"controlWings",
				"Alright, let's place the rest of the wings.",
				["Select the build tool", `Select "Wings"`, `Select "Wing Panel"`, "Place all the highlighted blocks"],
				mergeWingPairs,
			);
			goal(
				"prepareForWheels",
				[tools.buildTool],
				"All your plane lacks now is wheels.\nBut how do we connect them?\nUsing bearings and hinges of course!",
				[
					"Select the build tool",
					`Select and place "Wedge 1x1" on the tail`,
					`Select and place "Bearing Shaft" under the wedges`,
					`Select and place "Small Hinge" on the front servo`,
				],
			);
			goal("placeWheels", [tools.buildTool], "Almost done! Now just place wheels and we're done with building.", [
				"Select the build tool",
				`Select "Old Wheel"`,
				"Place all the highlighted old fashioned wheels",
			]);

			message(
				"Great, now all that remains is to set everything up. Let's begin with base configuration first...",
			);
			goal("configureAllServos", [tools.configTool], "Let's configure these servos!", [
				"Select the configuration tool",
				"Select every servo",
				"",
				"Take a close look at the menu",
				"Don't change anything yet",
				"if you did then don't worry, we'll get to that",
				"In this menu you can configure things to your liking",
				"",
				"Select number field (left of red trashbin button)",
				`Select the first field and enter "15"`,
				`Select the second field and enter "-15"`,
				"",
				"If you deleted a field use '+' button to add it back",
				"Don't forget to set S and W keys back",
			]);
			message(
				"Very good! You just configured your first blocks.\nRemember: a lot of the blocks are configurable.",
			);
			goal(
				"configureRoll",
				[tools.configTool],
				"Set up the servos that are used to control horizontal tilt (roll) of your plane.\nThese are located just behind your front main pair of wings.",
				[
					"Select the config tool",
					"Select two servo motors behind your front wings",
					"Press 'R' and replace it with 'D'",
					"Press 'F' and replace it with 'A'",
				],
			);
			goal(
				"configurePitch",
				[tools.configTool],
				"Great. Now we need to adjust the back wings.\nThey are responsible for the forward tilt (pitch)",
				[
					"Select the config tool",
					"",
					"Select the tail servo on the left side of your plane",
					"Replace first key 'R' with key 'W'",
					"Replace second key 'F' with key 'S'",
					"",
					"Select the tail servo on the right side of your plane",
					"Replace first key 'R' with key 'S'",
					"Replace second key 'F' with key 'W'",
				],
			);
			message("We're almost done! Very soon you'll have your plane flying.");
			goal(
				"configureYaw",
				[tools.configTool],
				"Time to configure the last two servos. One is on the back (on top of your tail) and another right under the nose of your plane",
				[
					"Select the config tool",
					"Select servomotors",
					"Replace first key with 'A'",
					"Replace second key with 'D'",
				],
			);
			goal("configureEngine", [tools.configTool], "And, finally, adjust the engine controls", [
				"Select the config tool",
				"Select the small rocket engine",
				"Replace first key with 'R'",
				"Replace second key with 'F'",
			]);
			message(
				"Your plane is ready! When you're ready, just press the triangle button on the top of your screen.",
			);
			message(
				"This is the last message. You can replay this tutorial any moment, just go to the settings (next to the play button)\nGood luck!",
			);

			tutorial.start();
		},
	);
};

export const PlaneTutorial = {
	name: "Basics/plane",
	description: "Build a simple plane",
	start,
} satisfies TutorialDescription;
