import { Assert } from "engine/shared/Assert";
import { Strings } from "engine/shared/fixes/String.propmacro";

export namespace Tests.StringTests {
	export function prettyNumber() {
		Assert.equals("0.05", Strings.prettyNumber(0.05, 0.01));
		Assert.equals("0", Strings.prettyNumber(0.000005, 0.01));
		Assert.equals("0.01", Strings.prettyNumber(0.012345, 0.01));
		Assert.equals("4545463550.01", Strings.prettyNumber(4545463550.012345, 0.01));
		Assert.equals("1.05", Strings.prettyNumber(1.05, 0.01));
		Assert.equals("1", Strings.prettyNumber(1, 0.01));
		Assert.equals("252", Strings.prettyNumber(252, 1));
		Assert.equals("253.1234", Strings.prettyNumber(253.123456, 0));
		Assert.equals("255.1234", Strings.prettyNumber(255.123456, undefined));
	}
}
