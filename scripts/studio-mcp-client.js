/* eslint-disable no-undef */
// A client for Roblox Studio's built-in MCP server (StudioMCP.exe over stdio), used by scripts/studio-mcp.js.
// Ported from operators-ts. Needs Studio open with Assistant > Manage MCP Servers > "Enable Studio as MCP server" on.

const { spawn } = require("node:child_process");

function connect() {
	const child = spawn("cmd.exe", ["/c", `${process.env.LOCALAPPDATA}\\Roblox\\mcp.bat`], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	const pending = new Map();
	let buffer = "";
	let nextId = 1;
	let closed;
	// the server gone, every request waiting on it and every one after gets an error, rather than a promise that never
	// settles: Node would then exit 0 with nothing said, as if the work were done
	child.on("exit", (code) => {
		closed = `StudioMCP exited (code ${code})`;
		for (const [, resolve] of pending) resolve({ error: { message: closed } });
		pending.clear();
	});
	child.stdout.on("data", (data) => {
		buffer += data;
		let newline;
		while ((newline = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (!line) continue;
			const message = JSON.parse(line);
			pending.get(message.id)?.(message);
		}
	});
	const request = (method, params) =>
		new Promise((resolve) => {
			if (closed !== undefined) return resolve({ error: { message: closed } });
			const id = nextId++;
			pending.set(id, resolve);
			child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
		});
	const call = (name, args) => request("tools/call", { name, arguments: args });
	return { child, request, call };
}

// a fresh StudioMCP.exe lists no Studio for its first second or so
async function open(clientName = "studio-mcp.js") {
	const client = connect();
	const fail = (message) => {
		console.error(`studio-mcp: ${message}`);
		client.child.kill();
		process.exit(2);
	};
	const hello = await client.request("initialize", {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: clientName, version: "1" },
	});
	if (hello.error) fail(`the MCP server refused the connection: ${hello.error.message}`);
	client.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
	for (let attempt = 0; attempt < 40; attempt++) {
		const res = await client.call("list_roblox_studios", {});
		if (res.error) fail(res.error.message);
		const studios = JSON.parse(res.result?.content?.[0]?.text ?? "{}").studios ?? [];
		if (studios.length > 0) return { ...client, studios };
		await sleep(500);
	}
	fail("no Studio connected. Is it open, with 'Enable Studio as MCP server' on?");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { open, sleep };
