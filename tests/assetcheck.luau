--[[
	Asset integrity check.

	Two things Studio will not tell you until something breaks at runtime:
	  1. every .rbxm / .rbxmx under game/ still parses
	  2. every block that is not built from a prefab has a model to be built from

	Block models resolve by name: BlockCreation searches the Placeable folder and keys each Model by
	`child.Name.lower()`, and assemble names each instance after its file, so a block's id must match
	the lowercased filename of its model. Blocks created with Model.fAutoCreated are stamped out of a
	prefab instead and have no model of their own.
]]

local fs = require("@lune/fs")
local roblox = require("@lune/roblox")
local report = require("./_report")

local fail, warn = report.fail, report.warn

local function walk(dir: string, visit: (path: string, name: string) -> ())
	for _, entry in fs.readDir(dir) do
		local path = `{dir}/{entry}`
		if fs.isDir(path) then
			walk(path, visit)
		else
			visit(path, entry)
		end
	end
end

-- 1. every asset round-trips ---------------------------------------------------------------------

report.title("asset integrity")
report.step("[1/3] parsing assets")
local assetCount = 0
walk("./game", function(path)
	local isXml = string.match(path, "%.rbxmx$") ~= nil
	if not isXml and string.match(path, "%.rbxm$") == nil then
		return
	end

	assetCount += 1
	local original = fs.readFile(path)
	local ok, result = pcall(function()
		return roblox.serializeModel(roblox.deserializeModel(original), isXml)
	end)

	if not ok then
		fail(`{path} does not parse: {result}`)
	elseif result ~= original then
		fail(`{path} does not round-trip ({#original} -> {#result} bytes)`)
	end
end)
report.detail(`{assetCount} assets parsed`)

-- 2. collect the models a block could resolve to --------------------------------------------------

report.step("[2/3] collecting placeable models")
local models: { [string]: string } = {}
walk("./game/Assets/Placeable", function(path, name)
	local base = string.match(name, "^(.*)%.rbxmx?$")
	if base then
		models[string.lower(base)] = path
	end
end)

local prefabs: { [string]: boolean } = {}
walk("./game/Assets/Prefabs", function(_, name)
	local base = string.match(name, "^(.*)%.rbxmx?$")
	if base then
		prefabs[base] = true
	end
end)

local function count(t): number
	local n = 0
	for _ in pairs(t) do
		n += 1
	end
	return n
end
report.detail(`{count(models)} models, {count(prefabs)} prefabs`)

-- 3. every non-prefab block has a model -----------------------------------------------------------

report.step("[3/3] matching blocks to models")
if not fs.isDir("./out/shared/blocks") then
	report.detail("out/ is not built, skipping (run `npm run build` first)")
else
	-- a block that SandboxBlocks never imports is never instantiated, so a missing model cannot break
	-- anything yet; it is still worth reporting, because registering it later would throw on the server
	local registered: { [string]: boolean } = {}
	local sandbox = "./out/shared/SandboxBlocks.luau"
	if fs.isFile(sandbox) then
		for name in string.gmatch(fs.readFile(sandbox), '"([%w_]+)"%)') do
			registered[name] = true
		end
	end

	local blockCount, prefabCount = 0, 0

	walk("./out/shared/blocks", function(path, name)
		if string.match(path, "%.luau$") == nil then
			return
		end

		local moduleName = string.match(name, "^(.*)%.luau$")
		local source = fs.readFile(path)
		-- a file that stamps blocks out of a prefab needs no model of its own
		local usesPrefab = string.match(source, "fAutoCreated") ~= nil

		for id in string.gmatch(source, 'id = "([a-z0-9_]+)"') do
			-- config defaults carry ids too (sound asset ids, for one); a block id is always a word
			if string.match(id, "%a") == nil then
				continue
			end

			blockCount += 1
			if usesPrefab then
				prefabCount += 1
			elseif models[id] == nil then
				if registered[moduleName] then
					-- registered means the code exists, so an unsaved Studio session is the likely cause
					fail(`block "{id}" has no model — did you forget to save in Studio? (lune run savechanges)`)
				else
					warn(`block "{id}" has no model, but is not registered yet ({report.source(path)})`)
				end
			end
		end
	end)

	report.detail(`{blockCount} block ids identified, {prefabCount} blocks from prefab`)

	-- referenced prefabs must exist
	walk("./out/shared/blocks", function(path)
		if string.match(path, "%.luau$") == nil then
			return
		end

		for name in string.gmatch(fs.readFile(path), 'fAutoCreated%("([%w_]+)"') do
			if not prefabs[name] then
				fail(`prefab "{name}" referenced by {report.source(path)} is missing from game/Assets/Prefabs`)
			end
		end
	end)
end

report.finish("assets parse, and every registered block resolves to a model")
