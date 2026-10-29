/* eslint-disable no-undef */
// Drives the open Roblox Studio through its built-in MCP server, for sessions where the Roblox_Studio tools did not
// load and for anything that has to address one window of a Server & Clients playtest. See docs/claude/STUDIO_MCP.md.
//
//   node scripts/studio-mcp.js studios                          every connected window and what it is
//   node scripts/studio-mcp.js luau <target> [file.luau]       run Luau (stdin without a file), print every return value
//   node scripts/studio-mcp.js console [target]                 the window's console output
//   node scripts/studio-mcp.js play | stop                      solo playtest in the edit window
//   node scripts/studio-mcp.js tool <name> ['<json>'] [target]  any MCP tool, studio_id and datamodel_type filled in
//
// A target is `edit`, `server`, `client` (the only client) or `client:<PlayerName>`, or a raw studio id.

const fs = require("node:fs");
const { open } = require("./studio-mcp-client");

const [command, ...rest] = process.argv.slice(2);

const textOf = (res) => res.result?.content?.find((c) => c.type === "text")?.text;
const failed = (res) => res.error !== undefined || res.result?.isError === true;
const reasonOf = (res) => res.error?.message ?? textOf(res) ?? "no reason given";

// the console's Luau VM is not the game's: it sees instances, not module state, and only the first return value comes
// back as text, so every value is packed into one JSON string, with anything JSON cannot hold passed through tostring
const wrap = (code) => `
local HttpService = game:GetService("HttpService")
local function plain(v, depth)
	local kind = typeof(v)
	if kind == "number" or kind == "string" or kind == "boolean" then return v end
	if v == nil then return "nil" end
	if kind == "table" and depth < 4 then
		local out = {}
		-- an array keeps its integer keys, so JSONEncode writes a list rather than {"1": ...}
		if #v > 0 then
			for i, x in ipairs(v) do out[i] = plain(x, depth + 1) end
			return out
		end
		for k, x in v do out[tostring(k)] = plain(x, depth + 1) end
		return out
	end
	return tostring(v)
end
local packed = table.pack(pcall(function()
${code}
end))
if not packed[1] then return HttpService:JSONEncode({ ok = false, error = tostring(packed[2]) }) end
local values = {}
for i = 2, packed.n do values[i - 1] = plain(packed[i], 0) end
return HttpService:JSONEncode({ ok = true, values = values })`;

const probes = {
	Edit: `return "edit"`,
	Server: `local n = {} for _, p in game:GetService("Players"):GetPlayers() do table.insert(n, p.Name) end return "server " .. table.concat(n, ",")`,
	Client: `local p = game:GetService("Players").LocalPlayer return "client " .. (p and p.Name or "?")`,
};

// one window can be several things: a solo playtest is edit, server and client at once
async function describe(client) {
	const windows = [];
	for (const studio of client.studios) {
		const roles = [];
		for (const [datamodel, code] of Object.entries(probes)) {
			const res = await client.call("execute_luau", { studio_id: studio.id, datamodel_type: datamodel, code });
			if (!failed(res)) roles.push({ datamodel, text: textOf(res) });
		}
		windows.push({ id: studio.id, name: studio.name, roles });
	}
	return windows;
}

async function resolve(client, target = "edit") {
	if (/^[0-9a-f-]{36}$/.test(target)) return { studio_id: target };

	const [kind, player] = target.split(":");
	const datamodel = { edit: "Edit", server: "Server", client: "Client" }[kind];
	if (datamodel === undefined) throw new Error(`unknown target '${target}': edit, server, client[:Player] or an id`);

	const matches = [];
	for (const window of await describe(client)) {
		const role = window.roles.find((r) => r.datamodel === datamodel);
		if (role && (player === undefined || role.text === `client ${player}`)) matches.push(window.id);
	}
	if (matches.length === 0) throw new Error(`no window is '${target}'; run 'studios'`);
	if (matches.length > 1)
		throw new Error(`'${target}' matches ${matches.length} windows; name the player or pass an id`);
	return { studio_id: matches[0], datamodel_type: datamodel };
}

function print(res) {
	if (failed(res)) {
		console.error(`FAILED: ${reasonOf(res)}`);
		process.exitCode = 1;
		return;
	}
	for (const content of res.result.content) {
		if (content.type === "text") console.log(content.text);
		else console.log(`(${content.type} content not shown)`);
	}
}

async function main() {
	if (!["studios", "luau", "console", "play", "stop", "tool"].includes(command)) {
		console.error(
			fs
				.readFileSync(__filename, "utf8")
				.split("\n")
				.slice(4, 12)
				.join("\n")
				.replace(/^\/\/ ?/gm, ""),
		);
		process.exit(1);
	}

	const client = await open();
	try {
		if (command === "studios") {
			for (const window of await describe(client)) {
				const roles = window.roles.map((r) => r.text).join(" + ") || "(no datamodel answered)";
				console.log(`${window.id}  ${window.name ?? "(unnamed)"}  ${roles}`);
			}
		} else if (command === "luau") {
			const where = await resolve(client, rest[0]);
			const code = fs.readFileSync(rest[1] ?? 0, "utf8");
			const res = await client.call("execute_luau", { datamodel_type: "Edit", ...where, code: wrap(code) });
			if (failed(res)) return print(res);

			const reply = JSON.parse(textOf(res));
			if (!reply.ok) {
				console.error(`ERROR: ${reply.error}`);
				process.exitCode = 1;
				return;
			}
			for (const value of reply.values) console.log(typeof value === "string" ? value : JSON.stringify(value));
		} else if (command === "console") {
			const where = await resolve(client, rest[0]);
			print(await client.call("get_console_output", { studio_id: where.studio_id }));
		} else if (command === "play" || command === "stop") {
			const where = await resolve(client, "edit");
			print(await client.call("start_stop_play", { studio_id: where.studio_id, is_start: command === "play" }));
		} else if (command === "tool") {
			const args = rest[1] ? JSON.parse(rest[1]) : {};
			const where = rest[2] ? await resolve(client, rest[2]) : {};
			print(await client.call(rest[0], { ...where, ...args }));
		}
	} catch (err) {
		console.error(`studio-mcp: ${err.message}`);
		process.exitCode = 1;
	} finally {
		client.child.kill();
	}
}

main();
