import { HelpBuilding } from "client/gui/help/HelpBuilding";
import { HelpCamera } from "client/gui/help/HelpCamera";
import { HelpConfiguring } from "client/gui/help/HelpConfiguring";
import { HelpDeleting } from "client/gui/help/HelpDeleting";
import { HelpEditing } from "client/gui/help/HelpEditing";
import { HelpGettingStarted } from "client/gui/help/HelpGettingStarted";
import { HelpHandyButtons } from "client/gui/help/HelpHandyButtons";
import { HelpPainting } from "client/gui/help/HelpPainting";
import { HelpRiding } from "client/gui/help/HelpRiding";
import { HelpSaving } from "client/gui/help/HelpSaving";
import { HelpSettingsMenu } from "client/gui/help/HelpSettingsMenu";
import { HelpTopBar } from "client/gui/help/HelpTopBar";
import { HelpTriangles } from "client/gui/help/HelpTriangles";
import { HelpWelding } from "client/gui/help/HelpWelding";
import { HelpWiring } from "client/gui/help/HelpWiring";
import { AnimationWrapperComponent } from "engine/client/gui/AnimationWrapperComponent";
import { ButtonControl } from "engine/client/gui/Button";
import { ButtonAnimatedClickComponent } from "engine/client/gui/ButtonAnimatedClickComponent";
import { Control } from "engine/client/gui/Control";
import { Interface } from "engine/client/gui/Interface";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { Transforms } from "engine/shared/component/Transforms";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { HelpArticle, HelpArticleDefinition } from "client/gui/help/HelpArticle";
import type { Theme } from "client/Theme";

type HelpArticleCtor = new (gui: HelpArticleDefinition) => HelpArticle;

type SectionButton = TextButton & {
	readonly TextLabel: TextLabel;
};
type HelpIndexDefinition = ScrollingFrame & {
	readonly ChapterTemplate: TextLabel;
	readonly SectionTemplate: SectionButton;
};
/** The help sidebar: chapter headings, each followed by its sections, in the order they are added. */
class HelpIndex extends Control<HelpIndexDefinition> {
	private readonly chapterTemplate;
	private readonly sectionTemplate;
	private order = 1;

	constructor(gui: HelpIndexDefinition) {
		super(gui);
		this.chapterTemplate = this.asTemplate(gui.ChapterTemplate);
		this.sectionTemplate = this.asTemplate(gui.SectionTemplate);
	}

	addChapter(name: string) {
		const heading = this.parent(new Control(this.chapterTemplate()));
		heading.instance.Text = name.upper();
		heading.instance.LayoutOrder = this.order++;
		return heading;
	}
	addSection(name: string, action: () => void) {
		const button = this.parent(new Control(this.sectionTemplate()));
		button.instance.TextLabel.Text = name;
		button.addButtonAction(action);
		button.getComponent(ButtonAnimatedClickComponent);
		// the click animation moves the button into this wrapper on enable, so the list lays out the wrapper
		button.getComponent(AnimationWrapperComponent).wrapper.LayoutOrder = this.order++;
		return button;
	}
}

const template = Interface.getInterface<{
	Popups: { Crossplatform: { Help: HelpPopupDefinition } };
}>().Popups.Crossplatform.Help;
template.Visible = false;

type HelpPopupDefinition = GuiObject & {
	readonly Heading: GuiObject & {
		readonly CloseButton: GuiButton;
	};
	readonly Content: GuiObject & {
		readonly Sidebar: GuiObject & {
			readonly Sections: HelpIndexDefinition;
		};
		readonly Page: GuiObject & {
			readonly Article: HelpArticleDefinition;
		};
	};
	readonly Footer: GuiObject & {
		readonly PreviousButton: GuiButton;
		readonly NextButton: GuiButton;
		readonly Pages: GuiObject & {
			readonly DotTemplate: GuiButton;
		};
	};
};

const dotSize = new UDim2(0, 13, 0, 13);
const activeDotSize = new UDim2(0, 35, 0, 13);

/**
 * Help, laid out like the settings popup: an index of chapters and sections, and each section an article class that is
 * built into a fresh clone of the article template when opened. Back and Next step through every page in index order,
 * crossing into the neighbouring section at either end; the dots pick a page within the current article.
 */
export class HelpPopup extends Control<HelpPopupDefinition> {
	private readonly sections: HelpArticleCtor[] = [];
	private readonly section = new ObservableValue(-1);
	private article?: HelpArticle;
	private page = 0;
	private readonly pageChanged = new ObservableValue(0);

	constructor() {
		const gui = template.Clone();
		super(gui);

		this.parent(new ButtonControl(gui.Heading.CloseButton, () => this.destroy()));
		this.parent(new ButtonControl(gui.Footer.PreviousButton, () => this.turn(-1)));
		this.parent(new ButtonControl(gui.Footer.NextButton, () => this.turn(1)));

		const articleTemplate = gui.Content.Page.Article;
		for (const child of [
			articleTemplate.HeaderTemplate,
			articleTemplate.BodyTemplate,
			articleTemplate.ImageTemplate,
			articleTemplate.FlowTemplate,
		]) {
			child.Visible = false;
		}
		const newArticle = this.asTemplate(articleTemplate);
		const content = this.parent(new ComponentChild<HelpArticle>(true)).withParentInstance(gui.Content.Page);

		const index = this.parent(new HelpIndex(gui.Content.Sidebar.Sections));
		const sectionButtons: GuiObject[] = [];
		const addSection = (name: string, clazz: HelpArticleCtor) => {
			const at = this.sections.size();
			this.sections.push(clazz);
			sectionButtons.push(index.addSection(name, () => this.open(at, 0)).instance);
		};

		index.addChapter("Basics");
		addSection("Getting started", HelpGettingStarted);
		addSection("Building", HelpBuilding);
		addSection("Editing", HelpEditing);
		addSection("Deleting", HelpDeleting);
		index.addChapter("Tools");
		addSection("Painting", HelpPainting);
		addSection("Welding", HelpWelding);
		addSection("Triangles", HelpTriangles);
		index.addChapter("Logic");
		addSection("Wiring", HelpWiring);
		addSection("Configuring", HelpConfiguring);
		index.addChapter("Playing");
		addSection("Ride Mode", HelpRiding);
		addSection("Camera", HelpCamera);
		addSection("Saving builds", HelpSaving);
		index.addChapter("Menus");
		addSection("Top bar", HelpTopBar);
		addSection("Handy buttons", HelpHandyButtons);
		addSection("Settings", HelpSettingsMenu);

		const newDot = this.asTemplate(gui.Footer.Pages.DotTemplate);
		const dots = this.parent(new ComponentChildren<ButtonControl>().withParentInstance(gui.Footer.Pages));
		let dotButtons: GuiButton[] = [];

		this.$onInjectAuto((theme: Theme) => {
			const activeColor = theme.get("buttonActive");
			const idleColor = theme.get("backgroundSecondary");

			this.event.subscribeObservable(this.section, (sectionIndex) => {
				for (let i = 0; i < sectionButtons.size(); i++) {
					sectionButtons[i].BackgroundColor3 = i === sectionIndex ? activeColor.get() : idleColor.get();
				}

				const clazz = this.sections[sectionIndex];
				if (!clazz) return;

				this.article = content.set(new clazz(newArticle()));
				dots.clear();
				dotButtons = [];
				const pageCount = this.article.pageCount();
				for (let i = 0; i < pageCount; i++) {
					const dot = newDot();
					dot.LayoutOrder = i + 1;
					dots.add(new ButtonControl(dot, () => this.open(this.section.get(), i)));
					dotButtons.push(dot);
				}
				gui.Footer.Pages.Visible = pageCount > 1;
			});

			this.event.subscribeObservable(this.pageChanged, () => {
				const article = this.article;
				if (!article) return;

				article.showPage(this.page);
				const sectionIndex = this.section.get();
				gui.Footer.PreviousButton.Visible = sectionIndex > 0 || this.page > 0;
				gui.Footer.NextButton.Visible =
					sectionIndex < this.sections.size() - 1 || this.page < article.pageCount() - 1;

				for (let i = 0; i < dotButtons.size(); i++) {
					const active = i === this.page;
					dotButtons[i].BackgroundTransparency = active ? 0 : 0.65;
					Transforms.create()
						.resize(dotButtons[i], active ? activeDotSize : dotSize, Transforms.quadOut02)
						.run(dotButtons[i], true);
				}
			});

			this.open(0, 0);
		});
	}

	private open(sectionIndex: number, page: number) {
		this.section.set(sectionIndex);
		this.page = page;
		this.pageChanged.set(this.pageChanged.get() + 1);
	}

	turn(by: number) {
		const article = this.article;
		if (!article) return;

		const page = this.page + by;
		if (page >= 0 && page < article.pageCount()) {
			this.open(this.section.get(), page);
			return;
		}

		const sectionIndex = this.section.get() + by;
		if (sectionIndex < 0 || sectionIndex >= this.sections.size()) return;

		this.section.set(sectionIndex);
		this.open(sectionIndex, by > 0 ? 0 : (this.article?.pageCount() ?? 1) - 1);
	}
}
