/* eslint-disable no-undef */
// Uploads place.rbxl to Roblox. `npm run publish` runs the asset checks first; the guards below cover the
// things those checks cannot see — a missing key, a missing place file, and a place file older than the
// code it is supposed to contain, which is the quiet way to ship a build from last week.

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const placePath = path.resolve("./place.rbxl");
const outPath = path.resolve("./out");

const refuse = (message) => {
	console.error(`publish: ${message}`);
	process.exit(1);
};

if (!process.env.PUBLISH_KEY) {
	refuse("PUBLISH_KEY is not set in .env — nothing to authenticate with.");
}

if (!fs.existsSync(placePath)) {
	refuse("place.rbxl does not exist. Run `lune run assemble` first.");
}

const newestMtimeIn = (dir) => {
	let newest = 0;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		const mtime = entry.isDirectory() ? newestMtimeIn(full) : fs.statSync(full).mtimeMs;
		if (mtime > newest) newest = mtime;
	}

	return newest;
};

if (fs.existsSync(outPath)) {
	const placeMtime = fs.statSync(placePath).mtimeMs;
	const outMtime = newestMtimeIn(outPath);
	if (outMtime > placeMtime) {
		const age = Math.round((outMtime - placeMtime) / 1000);
		refuse(
			`place.rbxl is ${age}s older than the compiled output in out/, so it does not contain the ` +
				"current code. Run `npm run build && lune run assemble` first.",
		);
	}
}

const binary = fs.readFileSync(placePath);
const run = async () => {
	const response = await fetch(
		"https://apis.roblox.com/universes/v1/10112329226/places/86822363308738/versions?versionType=Published",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/octet-stream",
				"x-api-key": process.env.PUBLISH_KEY,
			},
			body: binary,
		},
	);
	if (!response.ok) {
		return console.log(`Upload failed: ${response.status} ${response.statusText}`);
	}
	const result = await response.json();
	console.log("Upload successful:", result);
};
run();
