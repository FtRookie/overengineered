--[[
	Checks place.rbxl before it is uploaded. `npm run publish` sends the place file exactly as it is on disk, and
	that file is whatever Studio last saved: with Rojo disconnected or a module patched by hand for a test, it can
	hold code the repo does not.

	Refuses the place when any of these hold:
	- a script under a Rojo-mapped folder differs from out/, or a compiled script is missing from the place
	- a test hook is left in it: an instance whose name starts with "zz", or "TEST ONLY" in any script

	Only warns about the Rojo-synced studioconfig a Studio save captures: it sits in ServerScriptService, which never
	replicates, and ExternalDatabase reads it only in Studio.
]]

local fs = require("@lune/fs")
local roblox = require("@lune/roblox")
local report = require("./_report")

report.command = "npm run checkplace"
report.title("place.rbxl matches the repo")

if not fs.isFile("place.rbxl") then
	report.fail("place.rbxl does not exist; run `lune run assemble` first")
	report.finish("")
end

local game = roblox.deserializePlace(fs.readFile("place.rbxl"))

-- default.project.json, the folders whose scripts come from out/
local mounts = {
	{ "out/server", "ServerScriptService", { "TS" } },
	{ "out/engine/server", "ServerScriptService", { "engine" } },
	{ "out/shared", "ReplicatedStorage", { "TS" } },
	{ "out/engine/shared", "ReplicatedStorage", { "engine" } },
	{ "out/client", "StarterPlayer", { "StarterPlayerScripts", "TS" } },
	{ "out/engine/client", "StarterPlayer", { "StarterPlayerScripts", "engine" } },
}

local checked = 0
local function walk(dir: string, node: Instance?)
	for _, name in fs.readDir(dir) do
		local full = `{dir}/{name}`
		if fs.isDir(full) then
			walk(full, node and node:FindFirstChild(name))
			continue
		end

		-- foo.server.luau and foo.client.luau sync as a Script/LocalScript named foo, init.luau as the folder itself
		local base = string.match(name, "^(.-)%.server%.luau$")
			or string.match(name, "^(.-)%.client%.luau$")
			or string.match(name, "^(.-)%.luau$")
		if base == nil then continue end

		local script = if base == "init" then node else node and node:FindFirstChild(base)
		if script == nil or not script:IsA("LuaSourceContainer") then
			report.fail(`{report.source(full)} is not in the place`)
			continue
		end

		checked += 1
		if (script :: any).Source ~= fs.readFile(full) then
			report.fail(`{script:GetFullName()} differs from {full}; sync it or re-assemble`)
		end
	end
end

for _, mount in mounts do
	local node: Instance? = game:GetService(mount[2])
	for _, segment in mount[3] do
		node = node and node:FindFirstChild(segment)
	end
	walk(mount[1], node)
end

-- Server-only, and ExternalDatabase reads it only in Studio, so a live server neither sees nor uses the token
local studioconfig = game:GetService("ServerScriptService"):FindFirstChild("studioconfig")
if studioconfig and studioconfig:IsA("LuaSourceContainer") then
	report.warn("ServerScriptService.studioconfig is a script in the place (Studio write token, server-only)")
end

for _, instance in game:GetDescendants() do
	if string.sub(instance.Name, 1, 2) == "zz" then
		report.fail(`test hook left in the place: {instance:GetFullName()}`)
	elseif instance:IsA("LuaSourceContainer") and string.find((instance :: any).Source, "TEST ONLY", 1, true) then
		report.fail(`{instance:GetFullName()} contains a TEST ONLY patch`)
	end
end

report.detail(`{checked} scripts compared with out/`)
report.finish(`place.rbxl holds exactly the compiled code, with no test hooks`)
