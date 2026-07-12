/* eslint-disable no-undef */
// Generates .studioconfig.json from .env.
//
// ExternalDatabase runs inside Roblox and cannot read .env, so the values have to reach it as a ModuleScript
// that Rojo syncs. This writes the one Rojo is pointed at. It lives beside .env rather than in src/, because
// it holds a token and nothing that holds a token belongs in the source tree.
//
// Run by `npm install` (so Rojo always has a file to sync) and by the watcher (so a change to .env lands).
// Rewritten every time, so .env stays the only thing anyone edits.

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
require("dotenv").config({ path: path.join(root, ".env"), quiet: true });

const file = path.join(root, ".studioconfig.json");
const config = {
	writetoken: process.env.WRITETOKEN ?? "",
	baseurl: process.env.DB_BASEURL ?? "",
};

fs.writeFileSync(file, JSON.stringify(config, undefined, "\t") + "\n", "utf8");

module.exports = config;
