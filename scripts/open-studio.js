/* eslint-disable no-undef */
const { spawn } = require("child_process");
const path = require("path");

const place = path.resolve(__dirname, "../place.rbxl");

let cmd, args;

if (process.platform === "win32") {
	// Windows — Roblox Studio is natively installed
	cmd = "cmd";
	args = ["/c", "start", "", place]; // opens with default .rbxl handler
} else if (process.platform === "darwin") {
	cmd = "open";
	args = [place]; // opens with default .rbxl handler
} else {
	// Linux — via Flatpak/Vinegar. Its sandbox cannot see the project folder, so the file goes through the document
	// portal, as when it is double-clicked (flatpak export turns Vinegar's "Exec=vinegar %u" into this form).
	cmd = "flatpak";
	args = ["run", "--file-forwarding", "org.vinegarhq.Vinegar", "@@u", place, "@@"];
}

const child = spawn(cmd, args, {
	detached: true,
	stdio: "ignore",
	shell: process.platform === "win32",
});
child.on("error", (err) => console.warn(`Could not open Roblox Studio (${err.code}); open place.rbxl from Studio.`));
child.unref();
