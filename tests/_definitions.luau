--[[
	Block definitions for the headless checks.

	Prefers the *real* builder objects. Block modules load outside Roblox now that the shim stands in for the
	DataModel, so `logic.definition` and `search` can be read as the game sees them — no static analysis, and
	therefore none of its limits: a definition composed by `Objects.deepCombine`, assembled by a loop, or spread
	from a shared base is just an ordinary table here.

	13 of 127 block modules still do not load (they reach `shared/Modules`, which requires the place-resident
	`vLuau`). Those fall back to `genBlockValidators`' static extraction, which is why both sources exist.

	Where a block appears in both, the two are compared: a disagreement means the generator is wrong about a
	block it *can* read, which is worth knowing before it is trusted for one it cannot.
]]

local fs = require("@lune/fs")
local serde = require("@lune/serde")
local rbxRequire = require("../node_modules/@rbxts/lunit/scripts/lune-shim")

local GENERATED = "./tests/generated/BlockDefinitions.generated.json"
local BLOCKS_DIR = "out/shared/blocks/blocks"

local module = {}

local function sortedKeys(map): { string }
	local keys = {}
	if type(map) == "table" then
		for key in pairs(map) do
			table.insert(keys, key)
		end
	end
	table.sort(keys)
	return keys
end

-- `search`/`logic` are handed to BlockAssertions untouched, so it sees exactly what BlockListBuilder sees.
-- The flat key lists are what the save-safety baseline diffs.
local function normalise(id: string, logic, search, source: string)
	local definition = if logic then logic.definition else nil
	local inputs = if definition then sortedKeys(definition.input) else {}
	local outputs = if definition then sortedKeys(definition.output) else {}

	local hidden = {}
	if definition and type(definition.input) == "table" then
		for key, def in pairs(definition.input) do
			if type(def) == "table" and def.connectorHidden == true then
				table.insert(hidden, key)
			end
		end
	end
	table.sort(hidden)

	return {
		id = id,
		logic = logic,
		search = search,
		inputs = inputs,
		outputs = outputs,
		connectorHidden = hidden,
		-- a live definition is fully known; the generator may not have been able to read every input's shape
		connectorHiddenKnown = true,
		source = source,
	}
end

local function collectLive(): ({ [string]: any }, number, number)
	local byId: { [string]: any } = {}
	local loaded, failed = 0, 0

	local function walk(dir: string)
		if not fs.isDir(dir) then return end
		for _, entry in fs.readDir(dir) do
			local path = `{dir}/{entry}`
			if fs.isDir(path) then
				walk(path)
				continue
			end
			if string.match(path, "%.luau$") == nil then continue end

			local moduleName = string.sub(path, 1, -6)
			local ok, exports = pcall(function()
				return rbxRequire(moduleName)
			end)
			if not ok then
				failed += 1
				continue
			end
			loaded += 1

			-- a module exports one namespace holding either a single builder or an array of them
			for _, exported in pairs(exports) do
				if type(exported) ~= "table" then continue end

				local candidates = if type(exported.id) == "string" then { exported } else exported
				for _, block in pairs(candidates) do
					-- displayName separates a real BlockBuilder from a config default that happens to carry an id
					if
						type(block) == "table"
						and type(block.id) == "string"
						and type(block.displayName) == "string"
						and byId[block.id] == nil
					then
						byId[block.id] = normalise(block.id, block.logic, block.search, "live")
					end
				end
			end
		end
	end

	walk(BLOCKS_DIR)
	return byId, loaded, failed
end

local function collectGenerated(): ({ [string]: any }, { string })
	local byId: { [string]: any } = {}
	if not fs.isFile(GENERATED) then
		return byId, {}
	end

	local payload = serde.decode("json", fs.readFile(GENERATED))
	for id, meta in payload.definitions do
		local logic = if meta.input
			then {
				definition = {
					input = meta.input,
					output = meta.output or {},
					inputOrder = meta.inputOrder,
					outputOrder = meta.outputOrder,
				},
			}
			else nil
		local search = if meta.aliases or meta.partialAliases
			then { aliases = meta.aliases, partialAliases = meta.partialAliases }
			else nil

		local entry = normalise(id, logic, search, "generated")
		entry.connectorHidden = meta.connectorHidden or {}
		entry.connectorHiddenKnown = not meta.connectorHiddenIncomplete
		byId[id] = entry
	end

	return byId, payload.skipped or {}
end

local function sameList(a, b): boolean
	if #a ~= #b then return false end
	for i, value in a do
		if b[i] ~= value then return false end
	end
	return true
end

--- Every block definition the checks can see, keyed by id, plus where each came from.
function module.collect()
	local live, modulesLoaded, modulesFailed = collectLive()
	local generated, skipped = collectGenerated()

	local byId: { [string]: any } = {}
	local liveCount, generatedCount = 0, 0
	for id, entry in live do
		byId[id] = entry
		liveCount += 1
	end
	for id, entry in generated do
		if byId[id] == nil then
			byId[id] = entry
			generatedCount += 1
		end
	end

	-- the generator is only trustworthy for the blocks it cannot be checked against if it agrees on the ones it can
	local mismatches = {}
	for id, gen in generated do
		local real = live[id]
		if real == nil then continue end
		if not sameList(real.inputs, gen.inputs) then
			table.insert(mismatches, `{id}: generated inputs [{table.concat(gen.inputs, ",")}] vs real [{table.concat(real.inputs, ",")}]`)
		elseif not sameList(real.outputs, gen.outputs) then
			table.insert(mismatches, `{id}: generated outputs [{table.concat(gen.outputs, ",")}] vs real [{table.concat(real.outputs, ",")}]`)
		elseif gen.connectorHiddenKnown and not sameList(real.connectorHidden, gen.connectorHidden) then
			table.insert(mismatches, `{id}: generated connectorHidden [{table.concat(gen.connectorHidden, ",")}] vs real [{table.concat(real.connectorHidden, ",")}]`)
		end
	end
	table.sort(mismatches)

	return {
		byId = byId,
		liveCount = liveCount,
		generatedCount = generatedCount,
		modulesLoaded = modulesLoaded,
		modulesFailed = modulesFailed,
		mismatches = mismatches,
		staticallySkipped = skipped,
	}
end

return module
