import { ContentProvider, GuiService, Players, PolicyService, RunService } from "@rbxts/services";
import { BlockPreviewControl } from "client/gui/buildmode/BlockPreviewControl";
import { BlockPipetteButton } from "client/gui/controls/BlockPipetteButton";
import { GuiAnimator } from "client/gui/GuiAnimator";
import { AlertPopup } from "client/gui/popup/AlertPopup";
import { ServiceIntegrityChecker } from "client/integrity/ServiceIntegrityChecker";
import { Ponder } from "client/ponders/Ponder";
import { TextButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { HoldPress } from "engine/client/gui/HoldPress";
import { Interface } from "engine/client/gui/Interface";
import { PartialControl } from "engine/client/gui/PartialControl";
import { Keybinds } from "engine/client/Keybinds";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { Element } from "engine/shared/Element";
import { EventHandler } from "engine/shared/event/EventHandler";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Localization } from "engine/shared/Localization";
import { PlayerRank } from "engine/shared/PlayerRank";
import { BlockLimits } from "shared/blocks/BlockLimits";
import type { PopupController } from "client/gui/PopupController";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { Theme } from "client/Theme";
import type { InstanceComponent } from "engine/shared/component/InstanceComponent";
import type { BlockCategoryPath } from "shared/blocks/Block";
import type { ReadonlyPlot } from "shared/building/ReadonlyPlot";

const profiling = RunService.IsStudio();

type Category = {
	readonly path: BlockCategoryPath;
	readonly name: string;
	readonly sub: Categories;
};
type Categories = { readonly [k in string]: Category };

namespace Categories {
	type CategoryOnlyBlock = Pick<Block, "category">;

	export function createCategoryTreeFromBlocks(blocks: readonly CategoryOnlyBlock[]): Categories {
		// writable
		type Categories = { [k in string]: Category };
		type Category = {
			readonly path: BlockCategoryPath;
			readonly name: string;
			readonly sub: Categories;
		};

		const treeRoot: Category = {
			name: "_root",
			path: [],
			sub: {},
		};

		for (const { category: path } of blocks) {
			let part = treeRoot;
			const subPath: string[] = [];

			for (const pathPart of path) {
				subPath.push(pathPart);

				part = part.sub[pathPart] ??= {
					name: pathPart,
					path: [...subPath],
					sub: {},
				};
			}
		}

		return treeRoot.sub;
	}

	export function getCategoryByPath(allCategories: Categories, path: BlockCategoryPath): Category | undefined {
		let cat: Category | undefined = undefined;
		for (const part of path) {
			cat = cat === undefined ? allCategories[part] : cat.sub[part];
			if (!cat) return undefined;
		}

		return cat;
	}

	export function getCategoryDescendands(category: Category): Category[] {
		const get = (category: Category): Category[] => asMap(category.sub).flatmap((k, v) => [v, ...get(v)]);
		return get(category);
	}

	export function getBlocksByCategory<TBlock extends CategoryOnlyBlock>(
		allBlocks: readonly TBlock[],
		path: BlockCategoryPath,
	): TBlock[] {
		const ret: TBlock[] = [];
		for (const block of allBlocks) {
			if (block.category === path) {
				ret.push(block);
			} else if (block.category.sequenceEquals(path)) {
				path = block.category;
				ret.push(block);
			}
		}

		return ret;
	}
	export function getBlocksByCategoryRecursive<TBlock extends CategoryOnlyBlock>(
		allCategories: Categories,
		allBlocks: readonly TBlock[],
		path: BlockCategoryPath,
	): TBlock[] {
		const category = getCategoryByPath(allCategories, path);
		if (!category) return [];

		const all = [category, ...getCategoryDescendands(category)];
		return all.flatmap((c) => getBlocksByCategory(allBlocks, c.path));
	}
}

type CategoryControlDefinition = GuiButton & {
	readonly ViewportFrame: ViewportFrame;
	readonly TextLabel: TextLabel;
};
class CategoryControl extends TextButtonControl<CategoryControlDefinition> {
	constructor(template: CategoryControlDefinition, text: string, blocks: readonly BlockModel[]) {
		super(template);
		this.text.set(text);

		if (blocks.size() !== 0) {
			const preview = this.parent(new BlockPreviewControl(template.ViewportFrame));
			let blockIndex = 0;

			const update = () => preview.set(blocks[blockIndex++ % blocks.size()]);
			this.onEnable(update);
			this.event.loop(1, update);
		}
	}
}

type BlockControlParts = {
	readonly ViewportFrame: ViewportFrame;
	readonly TextLabel: TextLabel;
};
class BlockControl extends PartialControl<BlockControlParts, GuiButton> {
	constructor(gui: GuiButton, block: Block) {
		super(gui);

		this.parts.TextLabel.Text = block.displayName;
		this.parent(new BlockPreviewControl(this.parts.ViewportFrame, block.model));
	}
}

/** Seconds a block button is held before its ponder opens */
const ponderHoldTime = 0.6;

// Above the bare LeftControl binds so the modifier is seen here too, as with the grid combos.
const searchKeybind = Keybinds.registerDefinition(
	"build_block_search",
	["Building", "Search blocks"],
	[["LeftControl", "F"]],
	Enum.ContextActionPriority.Medium.Value + 100,
);

export type BlockSelectionControlDefinition = GuiObject & {
	readonly Content: {
		readonly SearchTextBox: TextBox;
		readonly Breadcrumbs: GuiObject & {
			readonly Content: ScrollingFrame & {
				readonly PathTemplate: TextButton;
			};
		};
		readonly ScrollingFrame: ScrollingFrame & {
			readonly NoResultsLabel: TextLabel;
			readonly BackButtonTemplate: CategoryControlDefinition;
			readonly BlockButtonTemplate: GuiButton & {
				readonly CountText: TextLabel;
			};
			readonly DiscordBlockButtonTemplate: GuiButton;
			readonly CategoryButtonTemplate: CategoryControlDefinition;
		};
	};
	readonly Header: {
		readonly Pipette: GuiButton;
	};
};

@injectable
export class BlockSelectionControl extends Control<BlockSelectionControlDefinition> {
	private readonly backTemplate;
	private readonly blockTemplate;
	private readonly featuredBlockTemplate;
	private readonly categoryTemplate;
	private readonly breadcrumbTemplate;
	private readonly list;

	private readonly categories: Categories;
	private readonly canSeeDevOnly: boolean;
	private readonly visibleBlocks: readonly Block[];
	readonly selectedCategory = new ObservableValue<BlockCategoryPath>([]);
	readonly selectedBlock = new ObservableValue<Block | undefined>(undefined);
	readonly highlightedBlocks = new ObservableValue<readonly BlockId[] | undefined>(undefined);

	readonly pipette;
	private readonly breadcrumbs;

	private readonly searchCache;

	private readonly blocksById: ReadonlyMap<BlockId, Block>;

	constructor(
		template: BlockSelectionControlDefinition,
		private readonly blocks: readonly Block[],
		@inject readonly blockList: BlockList,
		@inject private readonly theme: Theme,
		@inject private readonly popupController: PopupController,
		@inject private readonly playerData: PlayerDataStorage,
		@inject private readonly plot: ReadonlyPlot,
		@inject keybinds: Keybinds,
	) {
		super(template);

		// Only live while the block menu is, so the shortcut doesn't steal typing outside the build tool.
		this.event.subscribeRegistration(() =>
			keybinds.fromDefinition(searchKeybind).onDown(() => {
				this.gui.Content.SearchTextBox.CaptureFocus();
				return "Sink";
			}),
		);

		const buildSearchCache = () => {
			const generate = (block: Block) => {
				const displayNameLower = block.displayName.fullLower();
				const translatedLower = Localization.translateForPlayer(
					Players.LocalPlayer,
					block.displayName,
				).fullLower();

				return {
					exact: [block.id, ...(block.search?.aliases ?? []), displayNameLower, translatedLower],
					fuzzy: [...(block.search?.partialAliases ?? []), displayNameLower, translatedLower],
				};
			};

			return new Map(blocks.map((block) => [block.id, generate(block)]));
		};
		this.searchCache = buildSearchCache();
		this.blocksById = new Map(blocks.map((block) => [block.id, block]));

		this.canSeeDevOnly = RunService.IsStudio() || PlayerRank.isDev(Players.LocalPlayer);
		this.visibleBlocks = blocks.filter((block) => this.isVisible(block));
		this.categories = Categories.createCategoryTreeFromBlocks(this.visibleBlocks);

		this.list = this.parent(
			new ComponentChildren<BlockControl | CategoryControl>().withParentInstance(this.gui.Content.ScrollingFrame),
		);

		this.breadcrumbs = this.parent(
			new ComponentChildren<TextButtonControl>().withParentInstance(this.gui.Content.Breadcrumbs.Content),
		);
		this.breadcrumbTemplate = this.asTemplate(this.gui.Content.Breadcrumbs.Content.PathTemplate);

		this.backTemplate = this.asTemplate(this.gui.Content.ScrollingFrame.BackButtonTemplate);
		this.blockTemplate = this.asTemplate(this.gui.Content.ScrollingFrame.BlockButtonTemplate);
		this.featuredBlockTemplate = this.asTemplate(this.gui.Content.ScrollingFrame.DiscordBlockButtonTemplate);
		this.categoryTemplate = this.asTemplate(this.gui.Content.ScrollingFrame.CategoryButtonTemplate);

		this.event.subscribeObservable(this.selectedCategory, (category) => this.create(category, true), true);

		this.pipette = this.add(
			BlockPipetteButton.forBlockId(this.gui.Header.Pipette, (id) => {
				const block = this.blocksById.get(id);
				this.selectedBlock.set(block);

				if (!block || !Categories.getCategoryByPath(this.categories, block.category)) return;
				this.selectedCategory.set(block.category);
			}),
		);

		this.event.subscribeObservable(this.highlightedBlocks, () => this.create(this.selectedCategory.get(), false));
		this.event
			.addObservable(playerData.data.fReadonlyCreateBased((d) => d.blocks))
			.subscribe(() => this.create(this.selectedCategory.get(), false));

		this.event.subscribe(this.gui.Content.SearchTextBox.Focused, () => {
			if (!playerData.config.get().interface.searchBehaviour.resetOnSearch) return;
			this.selectedCategory.set([]);
			this.selectedBlock.set(undefined);
		});

		let apply: thread;
		const delayedSearch = (delay: number) => {
			if (apply) task.cancel(apply);
			apply = task.delay(delay, () => this.create(this.selectedCategory.get(), false));
		};

		const eh = new EventHandler();
		this.onDestroy(() => eh.unsubscribeAll());

		this.event
			.addObservable(playerData.config.fReadonlyCreateBased((c) => c.interface.searchBehaviour))
			.subscribe(({ onSubmit, delay }) => {
				eh.unsubscribeAll();
				if (onSubmit) {
					eh.subscribe(this.gui.Content.SearchTextBox.FocusLost, () => delayedSearch(delay));
				} else {
					eh.subscribe(this.gui.Content.SearchTextBox.GetPropertyChangedSignal("Text"), () =>
						delayedSearch(delay),
					);
				}
			}, true);
	}

	private isVisible(block: Block): boolean {
		return !block.hidden && (!block.devOnly || this.canSeeDevOnly);
	}

	private adsAllowed?: boolean;
	private create(selectedCategory: BlockCategoryPath, animated: boolean) {
		// while the menu points at some blocks, every button that does not lead to one is greyed out
		const targets = this.highlightedBlocks.get();
		const guiding = targets !== undefined && !targets.isEmpty();
		const dimUnless = (control: InstanceComponent<Instance>, leads: boolean) => {
			if (!guiding || leads) return;

			const dim = Interface.getTemplates<{ Dim: GuiObject }>().Dim.Clone();
			ServiceIntegrityChecker.whitelistInstance(dim);
			dim.Parent = control.instance;
		};

		let idx = 0;

		const createBackButton = (activated: () => void) => {
			const control = new TextButtonControl(this.backTemplate(), activated);
			this.list.add(control);

			// back leads to a target outside the category shown
			let leads = false;
			for (const targetBlock of targets ?? []) {
				const targetCategory = this.blockList.blocks[targetBlock]?.category;
				if (!targetCategory) continue;

				if (targetCategory.size() < selectedCategory.size()) {
					leads = true;
					break;
				}

				for (let i = 0; i < targetCategory.size(); i++) {
					if (!selectedCategory[i]) break;

					if (selectedCategory[i] !== targetCategory[i]) {
						leads = true;
						break;
					}
				}
				if (leads) break;
			}
			dimUnless(control, leads);

			control.instance.LayoutOrder = idx++;
			return control;
		};

		const createCategoryButton = (category: BlockCategoryPath, activated: () => void) => {
			const blocks = Categories.getBlocksByCategoryRecursive(this.categories, this.visibleBlocks, category).sort(
				(l, r) => l.model.Name > r.model.Name,
			);
			const models = blocks.map((b) => b.model);

			task.spawn(() => ContentProvider.PreloadAsync(models));

			const control = new CategoryControl(this.categoryTemplate(), category[category.size() - 1], models);
			control.activated.Connect(activated);
			this.list.add(control);

			dimUnless(control, targets !== undefined && blocks.any((b) => targets.includes(b.id)));

			control.instance.LayoutOrder = idx++;
			return control;
		};

		const limitOf = (block: Block) => BlockLimits.limitOf(block, this.playerData.data.get().blocks);

		/**
		 * Pressing and holding a block with a ponder fills its button like a bar, and opens the ponder once full.
		 * Returns whether the current press opened the ponder, so its release does not also select the block.
		 */
		const addPonderHold = (control: BlockControl, block: Block): (() => boolean) => {
			if (!block.ponder) return () => false;

			const gui = control.instance;
			const fill = Element.create("Frame", {
				Name: "PonderHold",
				BackgroundColor3: this.theme.get("buttonActive").get(),
				BackgroundTransparency: 0.4,
				BorderSizePixel: 0,
				Size: UDim2.fromScale(0, 1),
				// under the button's own children, over its background
				ZIndex: 0,
				Visible: false,
				Parent: gui,
			});
			const corner = gui.FindFirstChildOfClass("UICorner");
			if (corner) corner.Clone().Parent = fill;

			const hold = control.parent(
				new HoldPress(
					gui,
					ponderHoldTime,
					() => Ponder.open(block, this.blockList, this.popupController),
					(fraction) => {
						fill.Visible = fraction !== undefined;
						if (fraction !== undefined) fill.Size = UDim2.fromScale(fraction, 1);
					},
				),
			);
			return () => hold.held();
		};

		const createBlockButton = (block: Block, activated: () => void) => {
			const gui = this.blockTemplate();
			const control = new BlockControl(gui, block);
			const ponderOpened = addPonderHold(control, block);
			control.addButtonAction(() => {
				if (ponderOpened()) return;
				activated();
			});
			this.list.add(control);

			const upd = () => {
				if (profiling) debug.profilebegin("BlockSelection count");
				const family = BlockLimits.familyOf(block);
				const count = BlockLimits.countPlaced(this.plot.getBlocks(), this.blockList, family);
				gui.CountText.Text = tostring(`${count}/${limitOf(block)}`);
				if (profiling) debug.profileend();
			};
			control.event.subscribe(this.plot.instance.ChildAdded, upd);
			control.event.subscribe(this.plot.instance.ChildRemoved, upd);
			upd();

			control.instance.LayoutOrder = idx++;
			return control;
		};

		const createFeaturedBlockButton = (block: Block) => {
			const control = new BlockControl(this.featuredBlockTemplate(), block);
			control.addButtonAction(() =>
				this.popupController.showPopup(
					new AlertPopup(`This block is available for free in our community server`, undefined, 0),
				),
			);
			this.list.add(control);

			control.instance.LayoutOrder = idx++;
			return control;
		};

		this.list.clear();

		const addSlashBreadcrumb = () => {
			const control = this.breadcrumbs.add(new TextButtonControl(this.breadcrumbTemplate()));
			control.text.set("/");
			control.instance.Interactable = false;
		};

		this.breadcrumbs.clear();
		addSlashBreadcrumb();
		for (let i = 0; i < selectedCategory.size(); i++) {
			const path: BlockCategoryPath = selectedCategory.move(0, i, 0, []);
			const control = this.breadcrumbs.add(
				new TextButtonControl(this.breadcrumbTemplate(), () => this.selectedCategory.set(path)),
			);
			control.text.set(selectedCategory[i]);

			if (i < selectedCategory.size() - 1) {
				addSlashBreadcrumb();
			}
		}
		this.gui.Content.Breadcrumbs.Content.CanvasPosition = new Vector2(
			this.gui.Content.Breadcrumbs.Content.AbsoluteCanvasSize.X,
			0,
		);

		if (selectedCategory.size() !== 0) {
			createBackButton(() => {
				this.gui.Content.SearchTextBox.Text = "";
				this.selectedCategory.set(selectedCategory.filter((_, i) => i !== selectedCategory.size() - 1));
			});
		}

		let prev: BlockControl | CategoryControl | undefined;

		const lowerSearch = this.gui.Content.SearchTextBox.Text.fullLower();

		const processBlock = (block: Block) => {
			if (!this.isVisible(block)) return;

			const unavailable = !PlayerRank.isDev(Players.LocalPlayer) && limitOf(block) <= 0;
			if (unavailable && block.secret) return;

			let button: BlockControl;
			if (unavailable && block.featured) {
				// 13+ check
				if (
					!(this.adsAllowed ??= PolicyService.GetPolicyInfoForPlayerAsync(Players.LocalPlayer).AreAdsAllowed)
				) {
					return;
				}

				button = createFeaturedBlockButton(block);
			} else {
				button = createBlockButton(block, () => {
					if (this.gui.Content.SearchTextBox.Text !== "") {
						this.gui.Content.SearchTextBox.Text = "";
						this.selectedCategory.set(block.category);
					}
					this.selectedBlock.set(block);
				});

				button.event.subscribeObservable(
					this.selectedBlock,
					(newblock) => {
						button.overlayValue(
							"BackgroundColor3",
							newblock === block ? this.theme.get("buttonActive") : this.theme.get("backgroundSecondary"),
						);

						// Gamepad selection improvements
						button.instance.SelectionOrder = newblock === block ? 0 : 1;
					},
					true,
					true,
				);
			}
			dimUnless(button, targets?.includes(block.id) === true);

			if (prev) {
				button.instance.NextSelectionUp = prev.instance;
				prev.instance.NextSelectionDown = button.instance;
			}

			button.addButtonAction(() => {
				// Gamepad selection improvements
				GuiService.SelectedObject = undefined;
			});

			prev = button;
		};

		if (this.gui.Content.SearchTextBox.Text === "") {
			// The argument, like every other read here: taken from the observable instead, a redraw asked to draw
			// one category would list another one's blocks under it.
			for (const block of Categories.getBlocksByCategory(this.blocks, selectedCategory)) {
				processBlock(block);
			}
		} else {
			const similar1: Block[] = [];
			const similar2: Block[] = [];

			for (const block of this.blocks) {
				const cache = this.searchCache.get(block.id)!;

				if (cache.exact.contains(lowerSearch)) {
					processBlock(block);
				} else if (cache.fuzzy.any((f) => f.startsWith(lowerSearch))) {
					similar1.push(block);
				} else if (cache.fuzzy.any((f) => f.contains(lowerSearch))) {
					similar2.push(block);
				}
			}

			for (const block of similar1) {
				processBlock(block);
			}
			for (const block of similar2) {
				processBlock(block);
			}
		}

		if (this.gui.Content.SearchTextBox.Text === "") {
			const sorted = asMap(
				Categories.getCategoryByPath(this.categories, selectedCategory)?.sub ?? this.categories,
			)
				.values()
				.sort((l, r) => l.name < r.name);

			for (const category of sorted) {
				createCategoryButton(category.path, () => this.selectedCategory.set(category.path));
			}
		}

		// No results label for searching menu
		this.gui.Content.ScrollingFrame.NoResultsLabel.Visible =
			this.gui.Content.SearchTextBox.Text !== "" && this.list.getAll().size() === 0;

		// Gamepad selection improvements
		const isSelected = GuiService.SelectedObject !== undefined;
		GuiService.SelectedObject = isSelected ? this.list.getAll()[0].instance : undefined;
		this.gui.Content.ScrollingFrame.CanvasPosition = Vector2.zero;

		if (animated && this.gui.Content.SearchTextBox.Text === "") {
			GuiAnimator.transition(this.gui.Content.ScrollingFrame, 0.2, "up", 10);
			GuiAnimator.transition(this.gui.Content.ScrollingFrame.NoResultsLabel, 0.2, "down", 10);
		}
	}
}
