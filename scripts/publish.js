/* eslint-disable no-undef */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const binary = fs.readFileSync(path.resolve("./place.rbxl"));
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
