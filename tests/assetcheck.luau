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
-- Lunit's Lune shim (patched for this fork's classic RuntimeLib convention via patch-package) lets the
-- checks run the *actual* compiled game code from out/ rather than a re-implementation.
local rbxRequire = require("../node_modules/@rbxts/lunit/scripts/lune-shim")

local fail, warn = report.fail, report.warn
report.command = "npm run checkassets"

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

-- BlockAssertions ----------------------------------------------------------------------------------
--
-- src/shared/blocks/BlockAssertions.ts runs in Studio (BlockListBuilder) and hard-throws, so a committed
-- block already passes it. Rather than re-porting those checks (and drifting from them), step 4 loads the
-- actual compiled module through the patched Lunit shim and runs it here — one source of truth. Needs out/.
--
-- The raw .rbxm differs from the runtime model, so each is prepped to match what the assertion expects:
-- WeldRegions and MarkerPoints are unparented at runtime (weld init / BlockCreation.MarkerPositions), and
-- Lune throws reading an absent WeldConstraint.Enabled where real Roblox returns its default (true).
local STRIPPED_FOLDERS = { WeldRegions = true, MarkerPoints = true }
local function prepModel(model: any)
	local strip = {}
	for _, d in model:GetDescendants() do
		if d:IsA("Folder") and STRIPPED_FOLDERS[d.Name] then
			table.insert(strip, d)
		end
	end
	for _, folder in strip do
		folder.Parent = nil
	end
	for _, d in model:GetDescendants() do
		if d:IsA("WeldConstraint") and not pcall(function() return d.Enabled end) then
			d.Enabled = true
		end
	end
end

-- 1. every asset round-trips ---------------------------------------------------------------------

report.title("asset integrity")
report.step("[1/5] parsing assets")
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

report.step("[2/5] collecting placeable models")
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

-- populated by step 3 (needs out/); step 4 uses it to decide fail (registered) vs warn (not)
local registeredIds: { [string]: boolean } = {}

-- 3. every non-prefab block has a model -----------------------------------------------------------

report.step("[3/5] matching blocks to models")
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
			if registered[moduleName] then
				registeredIds[id] = true
			end

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

-- 4. block models pass BlockAssertions ----------------------------------------------------------

report.step("[4/5] checking block model integrity")
if not fs.isDir("./out/shared/blocks") then
	report.detail("out/ is not built, skipping (run `npm run build` first)")
else
	local BlockAssertions = rbxRequire("out/shared/blocks/BlockAssertions").BlockAssertions
	local integrityChecked = 0
	walk("./game/Assets/Placeable", function(path, name)
		if string.match(path, "%.rbxmx?$") == nil then
			return
		end

		local ok, tree = pcall(function()
			return roblox.deserializeModel(fs.readFile(path))
		end)
		if not ok then
			return -- step 1 already reports assets that do not parse
		end

		local base = string.match(name, "^(.*)%.rbxmx?$")
		local emit = if base and registeredIds[string.lower(base)] then fail else warn

		for _, instance in tree do
			if not instance:IsA("Model") then
				continue
			end

			integrityChecked += 1
			prepModel(instance)
			local issues = BlockAssertions.getAllErrors({ model = instance })
			if #issues > 0 then
				local lines = { `{instance.Name} ({path}):` }
				for _, issue in issues do
					table.insert(lines, `        - {issue}`)
				end
				emit(table.concat(lines, "\n"))
			end
		end
	end)
	report.detail(`{integrityChecked} block models checked`)
end

-- 5. block models match their declared TModel ----------------------------------------------------

-- Each InstanceBlockLogic block declares its model's children as `type TModel = BlockModel & { … }`.
-- genBlockValidators walks those types with the real TypeScript type system and emits a `t.instanceTree`
-- validator per block id; here we run the actual compiled validators against each raw model — the same
-- validators the runtime check in BlockListBuilder uses (one source of truth). Needs out/ (validators + t).
report.step("[5/5] checking model types")
local typedChecked = 0
if not fs.isFile("./out/shared/blocks/BlockModelValidators.generated.luau") then
	report.detail("model validators not generated, skipping (run `npm run genvalidators` then `npm run build`)")
else
	local t = rbxRequire("out/engine/shared/t").t
	local validators = rbxRequire("out/shared/blocks/BlockModelValidators.generated").BlockModelValidators

	for id, validator in validators do
		local mpath = models[id]
		if mpath == nil then
			continue
		end

		local ok, tree = pcall(function()
			return roblox.deserializeModel(fs.readFile(mpath))
		end)
		if not ok then
			continue
		end

		local model
		for _, inst in tree do
			if inst:IsA("Model") then
				model = inst
				break
			end
		end
		if model == nil then
			continue
		end

		typedChecked += 1
		local result = t.newResult()
		if not validator.func(model, result) then
			local emit = if registeredIds[id] then fail else warn
			emit(`{id} ({mpath}):\n        - ` .. (result:toString():gsub("\n", "\n        - ")))
		end
	end
end
report.detail(`{typedChecked} typed blocks checked`)

report.finish(
	"assets parse, every registered block resolves to a model, block models pass their assertions, and match their declared types"
)
