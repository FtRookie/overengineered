/* eslint-disable roblox-ts/no-regex */
/* eslint-disable no-undef */
// Keeps Studio's "Enable Studio as MCP server" switch (Assistant > Manage MCP Servers) on for every Roblox account
// that has used Studio on this machine. Studio keeps it per account in AssistantSettings/<userId>.json, and the
// Assistant plugin mirrors it in its own settings; both were written in the same second when the switch was turned
// on by hand (2026-10-03). Studio reads them at launch, so a change made while it runs applies from its next start.
// fixme: that Studio honours an edit made while it is closed is unverified; confirm the tools list a freshly
// launched Studio after this script has turned the switch on.
const fs = require("fs");
const path = require("path");

const root = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Roblox");

function update(file, change) {
	let data;
	try {
		data = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return false;
	}
	if (!change(data)) return false;
	fs.writeFileSync(file, JSON.stringify(data, undefined, 4));
	return true;
}

function ensureStudioMcpServer() {
	const changed = [];
	if (process.platform !== "win32" || !root) return changed;

	const assistant = path.join(root, "AssistantSettings");
	if (!fs.existsSync(assistant)) return changed;

	for (const name of fs.readdirSync(assistant)) {
		const account = name.match(/^(\d+)\.json$/)?.[1];
		if (!account) continue;

		const settings = path.join(assistant, name);
		const turnedOn = update(settings, (data) => {
			if (data["mcp-server"]?.enabled === true) return false;
			data["mcp-server"] = { ...data["mcp-server"], enabled: true };
			return true;
		});
		if (turnedOn) changed.push(settings);

		const plugins = path.join(root, account, "InstalledPlugins");
		if (!fs.existsSync(plugins)) continue;
		for (const plugin of fs.readdirSync(plugins)) {
			const pluginSettings = path.join(plugins, plugin, "settings.json");
			if (!fs.existsSync(pluginSettings)) continue;
			const mirrored = update(pluginSettings, (data) => {
				if (data["Assistant-ExternalMCPEnabled"] !== false) return false;
				data["Assistant-ExternalMCPEnabled"] = true;
				return true;
			});
			if (mirrored) changed.push(pluginSettings);
		}
	}
	return changed;
}

module.exports = { ensureStudioMcpServer };
