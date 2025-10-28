import { ContentProvider, GuiService, Players, PolicyService, RunService } from "@rbxts/services";
import { BlockPreviewControl } from "client/gui/buildmode/BlockPreviewControl";
import { BlockPipetteButton } from "client/gui/controls/BlockPipetteButton";
import { GuiAnimator } from "client/gui/GuiAnimator";
import { AlertPopup } from "client/gui/popup/AlertPopup";
import { ServiceIntegrityChecker } from "client/integrity/ServiceIntegrityChecker";
import { TextButtonControl } from "engine/client/gui/Button";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { PartialControl } from "engine/client/gui/PartialControl";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import { Objects } from "engine/shared/fixes/Objects";
import { Localization } from "engine/shared/Localization";
import { PlayerRank } from "engine/shared/PlayerRank";
import { BlockManager } from "shared/building/BlockManager";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { PopupController } from "client/gui/PopupController";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { Theme } from "client/Theme";
import type { InstanceComponent } from "engine/shared/component/InstanceComponent";
import type { BlockCategoryPath } from "shared/blocks/Block";
import type { ReadonlyPlot } from "shared/building/ReadonlyPlot";

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
			if (!cat) {
				cat = allCategories[part];
				continue;
			}

			cat = cat.sub[part];
			if (!cat) {
				return undefined;
			}
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
		const sequenceEquals = <T>(left: readonly T[], right: readonly T[]): boolean => {
			if (left.size() !== right.size()) {
				return false;
			}

			for (let i = 0; i < left.size(); i++) {
				if (left[i] !== right[i]) {
					return false;
				}
			}

			return true;
		};

		const ret: TBlock[] = [];
		for (const block of allBlocks) {
			if (block.category === path) {
				ret.push(block);
			} else if (sequenceEquals(block.category, path)) {
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

/** Block chooser control */
@injectable
export class BlockSelectionControl extends Control<BlockSelectionControlDefinition> {
	private readonly backTemplate;
	private readonly blockTemplate;
	private readonly featuredBlockTemplate;
	private readonly categoryTemplate;
	private readonly breadcrumbTemplate;
	private readonly list;

	private readonly categories: Categories;
	readonly selectedCategory = new ObservableValue<BlockCategoryPath>([]);
	readonly selectedBlock = new ObservableValue<Block | undefined>(undefined);
	readonly highlightedBlocks = new ObservableValue<readonly BlockId[] | undefined>(undefined);

	readonly pipette;
	private readonly breadcrumbs;

	private readonly searchCache;

	constructor(
		template: BlockSelectionControlDefinition,
		@inject readonly blockList: BlockList,
		@inject private readonly theme: Theme,
		@inject private readonly popupController: PopupController,
		@inject private readonly playerData: PlayerDataStorage,
		@inject private readonly plot: ReadonlyPlot,
	) {
		super(template);

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

			return asObject(asMap(blockList.blocks).mapToMap((k, v) => $tuple(k, generate(v))));
		};
		this.searchCache = buildSearchCache();

		this.categories = Categories.createCategoryTreeFromBlocks(blockList.sorted);

		this.list = this.parent(
			new ComponentChildren<BlockControl | CategoryControl>().withParentInstance(this.gui.Content.ScrollingFrame),
		);

		this.breadcrumbs = this.parent(
			new ComponentChildren<TextButtonControl>().withParentInstance(this.gui.Content.Breadcrumbs.Content),
		);
		this.breadcrumbTemplate = this.asTemplate(this.gui.Content.Breadcrumbs.Content.PathTemplate);

		// Prepare templates
		this.backTemplate = this.asTemplate(this.gui.Content.ScrollingFrame.BackButtonTemplate);
		this.blockTemplate = this.asTemplate(this.gui.Content.ScrollingFrame.BlockButtonTemplate);
		this.featuredBlockTemplate = this.asTemplate(this.gui.Content.ScrollingFrame.DiscordBlockButtonTemplate);
		this.categoryTemplate = this.asTemplate(this.gui.Content.ScrollingFrame.CategoryButtonTemplate);

		this.event.subscribeObservable(this.selectedCategory, (category) => this.create(category, true), true);

		this.pipette = this.add(
			BlockPipetteButton.forBlockId(this.gui.Header.Pipette, (id) => {
				this.selectedBlock.set(blockList.blocks[id]);
				this.selectedCategory.set(this.selectedBlock.get()!.category);
			}),
		);

		this.event.subscribeObservable(this.highlightedBlocks, () => this.create(this.selectedCategory.get(), false));

		// might be useful
		// const searchText = this.event.observableFromGuiParam(this.gui.SearchTextBox, "Text");
		this.event.subscribe(this.gui.Content.SearchTextBox.GetPropertyChangedSignal("Text"), () => {
			this.selectedCategory.set([]);
			this.selectedBlock.set(undefined);

			this.create([], false);
		});
	}

	private adsAllowed?: boolean;
	private create(selectedCategory: BlockCategoryPath, animated: boolean) {
		const highlightButton = (control: InstanceComponent<Instance>) => {
			const button = Interface.getTemplates<{ Highlight: GuiObject }>().Highlight.Clone();
			ServiceIntegrityChecker.whitelistInstance(button);
			button.Parent = control.instance;
		};

		let idx = 0;

		const createBackButton = (activated: () => void) => {
			const control = new TextButtonControl(this.backTemplate(), activated);
			this.list.add(control);

			const highlightedBlocks = this.highlightedBlocks.get();
			if (highlightedBlocks) {
				for (const targetBlock of highlightedBlocks) {
					const targetCategory = this.blockList.blocks[targetBlock]?.category;
					if (!targetCategory) continue;

					if (targetCategory.size() < selectedCategory.size()) {
						highlightButton(control);

						break;
					}

					for (let i = 0; i < targetCategory.size(); i++) {
						if (!selectedCategory[i]) break;

						if (selectedCategory[i] !== targetCategory[i]) {
							highlightButton(control);

							break;
						}
					}
				}
			}

			control.instance.LayoutOrder = idx++;
			return control;
		};

		const createCategoryButton = (category: BlockCategoryPath, activated: () => void) => {
			const blocks = Categories.getBlocksByCategoryRecursive(
				this.categories,
				this.blockList.sorted,
				category,
			).sort((l, r) => l.model.Name > r.model.Name);
			const models = blocks.map((b) => b.model);

			task.spawn(() => ContentProvider.PreloadAsync(models));

			const control = new CategoryControl(this.categoryTemplate(), category[category.size() - 1], models);
			control.activated.Connect(activated);
			this.list.add(control);

			const targetBlocks = this.highlightedBlocks.get();
			if (targetBlocks && blocks.any((b) => targetBlocks.includes(b.id))) {
				highlightButton(control);
			}

			control.instance.LayoutOrder = idx++;
			return control;
		};

		const createBlockButton = (block: Block, activated: () => void) => {
			const gui = this.blockTemplate();
			const control = new BlockControl(gui, block);
			control.addButtonAction(activated);
			this.list.add(control);

			const upd = () => {
				const count = this.plot.getBlocks().count((c) => BlockManager.manager.id.get(c) === block.id);
				gui.CountText.Text = tostring(`${count}/${block.limit}`);
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

		// Back button
		if (selectedCategory.size() !== 0) {
			createBackButton(() => {
				this.gui.Content.SearchTextBox.Text = "";
				this.selectedCategory.set(selectedCategory.filter((_, i) => i !== selectedCategory.size() - 1));
			});
		}

		// Block buttons
		let prev: BlockControl | CategoryControl | undefined;

		const lowerSearch = this.gui.Content.SearchTextBox.Text.fullLower();

		const processBlock = (block: Block) => {
			if (block.hidden) return;
			if (block.devOnly && !RunService.IsStudio() && !PlayerRank.isAdmin(Players.LocalPlayer)) return;

			let button: BlockControl;
			const features = this.playerData.data.get().features;
			if (
				GameDefinitions.isOfficialAwms &&
				!PlayerRank.isAdmin(Players.LocalPlayer) &&
				!(block.requiredFeatures ?? Objects.empty).all((c) => features.contains(c))
			) {
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

						button.instance.FindFirstChild("Highlight")?.Destroy();
						const targetBlocks = this.highlightedBlocks.get();
						if (targetBlocks && newblock !== block && targetBlocks.includes(block.id)) {
							highlightButton(button);
						}

						// Gamepad selection improvements
						button.instance.SelectionOrder = newblock === block ? 0 : 1;
					},
					true,
					true,
				);
			}

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
			for (const block of Categories.getBlocksByCategory(this.blockList.sorted, this.selectedCategory.get())) {
				processBlock(block);
			}
		} else {
			const similar1: Block[] = [];
			const similar2: Block[] = [];

			for (const block of this.blockList.sorted) {
				const cache = this.searchCache[block.id];

				if (cache.exact.find((e) => e === lowerSearch) !== undefined) {
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

			// Category buttons
			for (const category of sorted) {
				createCategoryButton(category.path, () =>
					this.selectedCategory.set([...selectedCategory, category.name]),
				);
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
