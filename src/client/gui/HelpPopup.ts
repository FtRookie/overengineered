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
import { Component } from "engine/shared/component/Component";
import { ComponentChild } from "engine/shared/component/ComponentChild";
import { ComponentChildren } from "engine/shared/component/ComponentChildren";
import { Transforms } from "engine/shared/component/Transforms";
import { ObservableValue } from "engine/shared/event/ObservableValue";
import type { HelpArticle, HelpArticleDefinition } from "client/gui/help/HelpArticle";
import type { Theme } from "client/Theme";

export type HelpArticleCtor = new (gui: HelpArticleDefinition) => HelpArticle;

type SectionButton = TextButton & {
	readonly TextLabel: TextLabel;
};
export type HelpIndexDefinition = ScrollingFrame & {
	readonly ChapterTemplate: TextLabel;
	readonly SectionTemplate: SectionButton;
};
/** The help sidebar: chapter headings, each followed by its sections, in the order they are added. */
export class HelpIndex extends Control<HelpIndexDefinition> {
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

export type HelpPageDefinition = GuiObject & {
	readonly Article: HelpArticleDefinition;
};
export type HelpFooterDefinition = GuiObject & {
	readonly PreviousButton: GuiButton;
	readonly NextButton: TextButton;
	readonly Pages: GuiObject & {
		readonly DotTemplate: GuiButton;
	};
};

const nextText = "NEXT →";
const dotSize = new UDim2(0, 13, 0, 13);
const activeDotSize = new UDim2(0, 35, 0, 13);

/**
 * The reading side of a help popup: the article area and its footer. Each section is an article class built into a
 * fresh clone of the article template when opened. Back and Next step through every page in section order, crossing
 * into the neighbouring section at either end; the dots pick a page within the current article.
 */
export class HelpPages extends Component {
	readonly section = new ObservableValue(-1);
	private readonly sections: HelpArticleCtor[] = [];
	private article?: HelpArticle;
	private page = 0;
	private readonly pageChanged = new ObservableValue(0);
	private finish?: { readonly text: string; readonly action: () => void };

	constructor(page: HelpPageDefinition, footer: HelpFooterDefinition) {
		super();

		this.parent(new ButtonControl(footer.PreviousButton, () => this.turn(-1)));
		this.parent(
			new ButtonControl(footer.NextButton, () => {
				if (this.finish && this.atEnd()) this.finish.action();
				else this.turn(1);
			}),
		);

		const articleTemplate = page.Article;
		for (const child of [
			articleTemplate.HeaderTemplate,
			articleTemplate.BodyTemplate,
			articleTemplate.ImageTemplate,
			articleTemplate.FlowTemplate,
			articleTemplate.ButtonTemplate,
		]) {
			child.Visible = false;
		}
		const newArticle = this.asTemplate(articleTemplate);
		const content = this.parent(new ComponentChild<HelpArticle>(true)).withParentInstance(page);

		const newDot = this.asTemplate(footer.Pages.DotTemplate);
		const dots = this.parent(new ComponentChildren<ButtonControl>().withParentInstance(footer.Pages));
		let dotButtons: GuiButton[] = [];

		this.event.subscribeObservable(this.section, (sectionIndex) => {
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
			footer.Pages.Visible = pageCount > 1;
		});

		this.event.subscribeObservable(this.pageChanged, () => {
			const article = this.article;
			if (!article) return;

			article.showPage(this.page);
			footer.PreviousButton.Visible = this.section.get() > 0 || this.page > 0;
			const finish = this.atEnd() ? this.finish : undefined;
			footer.NextButton.Visible = finish !== undefined || !this.atEnd();
			footer.NextButton.Text = finish?.text ?? nextText;

			for (let i = 0; i < dotButtons.size(); i++) {
				const active = i === this.page;
				dotButtons[i].BackgroundTransparency = active ? 0 : 0.65;
				Transforms.create()
					.resize(dotButtons[i], active ? activeDotSize : dotSize, Transforms.quadOut02)
					.run(dotButtons[i], true);
			}
		});
	}

	/** Adds a section after the others and returns its index */
	addSection(clazz: HelpArticleCtor): number {
		this.sections.push(clazz);
		return this.sections.size() - 1;
	}
	/** Keeps Next on the last page, labelled `text`, running `action` instead of stopping there */
	setFinish(text: string, action: () => void) {
		this.finish = { text, action };
	}

	open(sectionIndex: number, page: number) {
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

	private atEnd() {
		return this.section.get() === this.sections.size() - 1 && this.page === (this.article?.pageCount() ?? 1) - 1;
	}
}

const template = Interface.getInterface<{
	Popups: { Crossplatform: { Help: HelpPopupDefinition } };
}>().Popups.Crossplatform.Help;
template.Visible = false;

export type HelpPopupDefinition = GuiObject & {
	readonly Heading: GuiObject & {
		readonly TitleLabel: TextLabel;
		readonly CloseButton: GuiButton;
	};
	readonly Content: GuiObject & {
		readonly Sidebar: GuiObject & {
			readonly Sections: HelpIndexDefinition;
		};
		readonly Page: HelpPageDefinition;
	};
	readonly Footer: HelpFooterDefinition;
};
/** Every help article, grouped into chapters in the sidebar, laid out like the settings popup */
export class HelpPopup extends Control<HelpPopupDefinition> {
	constructor() {
		const gui = template.Clone();
		super(gui);

		this.$onInjectAuto((theme: Theme) => {
			const pages = this.parent(new HelpPages(gui.Content.Page, gui.Footer));
			const index = this.parent(new HelpIndex(gui.Content.Sidebar.Sections));

			const sectionButtons: GuiObject[] = [];
			const addSection = (name: string, clazz: HelpArticleCtor) => {
				const at = pages.addSection(clazz);
				sectionButtons.push(index.addSection(name, () => pages.open(at, 0)).instance);
			};

			index.addChapter("Basics");
			{
				addSection("Getting started", HelpGettingStarted);
				addSection("Building", HelpBuilding);
				addSection("Editing", HelpEditing);
				addSection("Deleting", HelpDeleting);
			}
			index.addChapter("Tools");
			{
				addSection("Painting", HelpPainting);
				addSection("Welding", HelpWelding);
				addSection("Triangles", HelpTriangles);
			}
			index.addChapter("Logic");
			{
				addSection("Wiring", HelpWiring);
				addSection("Configuring", HelpConfiguring);
			}
			index.addChapter("Playing");
			{
				addSection("Ride Mode", HelpRiding);
				addSection("Camera", HelpCamera);
				addSection("Saving builds", HelpSaving);
			}
			index.addChapter("Menus");
			{
				addSection("Top bar", HelpTopBar);
				addSection("Handy buttons", HelpHandyButtons);
				addSection("Settings", HelpSettingsMenu);
			}

			const activeColor = theme.get("buttonActive");
			const idleColor = theme.get("backgroundSecondary");
			this.event.subscribeObservable(pages.section, (sectionIndex) => {
				for (let i = 0; i < sectionButtons.size(); i++) {
					sectionButtons[i].BackgroundColor3 = i === sectionIndex ? activeColor.get() : idleColor.get();
				}
			});

			this.parent(new ButtonControl(gui.Heading.CloseButton, () => this.destroy()));
			pages.open(0, 0);
		});
	}
}
