import { Assert } from "engine/shared/Assert";
import { ComponentDisabler } from "engine/shared/component/ComponentDisabler";

export namespace Tests.ComponentDisablerTests {
	const { test, expect } = Assert.Testing;

	export function test1() {
		const allItems = ["item1", "item2", "item3"] as const;
		const disabler = new ComponentDisabler();

		const expectEnabled = (items: readonly string[]) => {
			for (const item of items) {
				Assert.isTrue(disabler.isEnabled(item), `Item ${item} should be enabled`);
			}
		};
		const expectDisabled = (items: readonly string[]) => {
			for (const item of items) {
				Assert.isTrue(disabler.isDisabled(item), `Item ${item} should be disabled`);
			}
		};

		test("should initialize with all items enabled", () => {
			expectEnabled(allItems);
			expectDisabled([]);
		});

		test("should correctly report if an item is enabled or disabled", () => {
			expect(disabler.isEnabled("item1")).toBe(true);
			expect(disabler.isDisabled("item1")).toBe(false);
		});

		test("should enable and disable all items", () => {
			disabler.disableAll();
			expectEnabled([]);
			expectDisabled(allItems);

			disabler.enableAll();
			expectEnabled(allItems);
			expectDisabled([]);
		});

		test("should enable and disable specific items", () => {
			disabler.disable("item1");
			expectEnabled(["item2", "item3"]);
			expectDisabled(["item1"]);

			disabler.enable("item1");
			expectEnabled(allItems);
			expectDisabled([]);
		});

		test("should enable and disable only specific items", () => {
			disabler.enableOnly("item1");
			expectEnabled(["item1"]);
			expectDisabled(["item2", "item3"]);

			disabler.disableOnly("item1");
			expectEnabled(["item2", "item3"]);
			expectDisabled(["item1"]);
		});

		test("should set enabled and disabled items", () => {
			disabler.enableOnly("item1", "item2");
			expectEnabled(["item1", "item2"]);
			expectDisabled(["item3"]);

			disabler.enableOnly("item1", "item2");
			expectEnabled(["item3"]);
			expectDisabled(["item1", "item2"]);
		});
	}
}
