/* eslint-disable no-undef */
const { spawn } = require("child_process");
const path = require("path");

const place = path.resolve(__dirname, "../place.rbxl");

let cmd, args;

if (process.platform === "win32") {
	// Windows — Roblox Studio is natively installed
	cmd = "cmd";
	args = ["/c", "start", "", place]; // opens with default .rbxl handler
} else {
	// Linux — via Flatpak/Vinegar
	cmd = "flatpak";
	args = ["run", "org.vinegarhq.Vinegar", "studio", place];
}

spawn(cmd, args, {
	detached: true,
	stdio: "ignore",
	shell: process.platform === "win32",
}).unref();
