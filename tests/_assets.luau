--[[
	Reading `.rbxm` / `.rbxmx` assets outside Studio.

	Everything goes through `@lune/roblox`, which sniffs binary vs XML, so both extensions take the same call.
	`deserializeModel` returns a *table of root instances*, not a single Model — hence `firstModel`.

	`parse` caches per path and hands every caller an independent copy. That is the whole point: consumers want
	the same file in different states — the block assertions need `prepModel` applied (WeldRegions unparented),
	while the generated model validators must see the raw children that strips. Sharing one tree would couple
	them through mutation, and the coupling would be invisible until someone reordered the callers.

	Copying is not a compromise for correctness: a clone measured 41x cheaper than re-parsing, it serialises
	back to byte-identical output, and running the real BlockAssertions over all 330 block models gave
	identical results via clone and via a fresh parse.
]]

local fs = require("@lune/fs")
local roblox = require("@lune/roblox")

local module = {}

--- Recurse `dir`, calling `visit(path, name)` for every file.
function module.walk(dir: string, visit: (path: string, name: string) -> ())
	for _, entry in fs.readDir(dir) do
		local path = `{dir}/{entry}`
		if fs.isDir(path) then
			module.walk(path, visit)
		else
			visit(path, entry)
		end
	end
end

--- `isAsset, isXml` for a path. `.rbxmx` is XML, `.rbxm` binary.
function module.isAsset(path: string): (boolean, boolean)
	local isXml = string.match(path, "%.rbxmx$") ~= nil
	return isXml or string.match(path, "%.rbxm$") ~= nil, isXml
end

local bytesCache: { [string]: string } = {}

--- File contents, cached. Round-trip checks compare against this.
function module.bytes(path: string): string
	local cached = bytesCache[path]
	if cached == nil then
		cached = fs.readFile(path)
		bytesCache[path] = cached
	end
	return cached
end

-- Never handed out; only clones of it are.
local parsedCache: { [string]: { any } } = {}

--- Root instances of an asset, or `nil, err` if it does not parse. Always an independent copy: mutate freely.
function module.parse(path: string): ({ any }?, string?)
	local roots = parsedCache[path]
	if roots == nil then
		local ok, result = pcall(function()
			return roblox.deserializeModel(module.bytes(path))
		end)
		if not ok then
			return nil, tostring(result)
		end
		parsedCache[path] = result
		roots = result
	end

	local copy = table.create(#roots)
	for i, instance in roots do
		copy[i] = instance:Clone()
	end
	return copy
end

-- An `.rbxmx` only stores non-default properties, and rbx-dom knows some properties without recording a
-- default for them — reading one the file omitted throws where real Roblox returns the default. Measured over
-- every block asset: 42101 reads succeed, 22 (class, property) pairs throw, 2082 instances affected (~4.7%).
-- The set is mostly `Active` on every constraint class, `WeldConstraint.Enabled`, and legacy properties such as
-- `TextLabel.Transparency`. The trap is that it depends on what the file happened to store, so validation can
-- pass on one asset and throw on the next.
local NO_DEFAULT = "missing default value"

--- Read `property`, falling back to `default` only when Lune has no recorded default for it.
--- A genuine mistake — misspelled name, wrong class — still throws, so a typo cannot read as `default` forever.
function module.prop(instance: any, property: string, default: any): any
	local ok, value = pcall(function()
		return instance[property]
	end)
	if ok then
		return value
	end
	if string.find(tostring(value), NO_DEFAULT, 1, true) then
		return default
	end
	error(value, 2)
end

--- First root that is a Model, or nil. A block asset holds exactly one.
function module.firstModel(roots: { any }): any?
	for _, instance in roots do
		if instance:IsA("Model") then
			return instance
		end
	end
	return nil
end

-- Unparented at runtime by weld init and BlockCreation.MarkerPositions, so the assertions never see them.
local STRIPPED_FOLDERS = { WeldRegions = true, MarkerPoints = true }

--- Bring a raw asset model to the shape the runtime asserts against.
function module.prepModel(model: any)
	local strip = {}
	for _, d in model:GetDescendants() do
		if d:IsA("Folder") and STRIPPED_FOLDERS[d.Name] then
			table.insert(strip, d)
		end
	end
	for _, folder in strip do
		folder.Parent = nil
	end

	-- Materialise Enabled where the file omitted it, so the assertions can read it directly. Real Roblox
	-- returns true for an unstored value; a weld that stores `false` is left alone.
	for _, d in model:GetDescendants() do
		if d:IsA("WeldConstraint") and module.prop(d, "Enabled", nil) == nil then
			d.Enabled = true
		end
	end
end

--- `models` keyed by lowercased filename (how BlockCreation resolves a block id to a model), and `prefabs`
--- keyed by exact filename (how `Model.fAutoCreated` names them).
function module.indexPlaceable(): ({ [string]: string }, { [string]: boolean })
	local models: { [string]: string } = {}
	module.walk("./game/Assets/Placeable", function(path, name)
		local base = string.match(name, "^(.*)%.rbxmx?$")
		if base then
			models[string.lower(base)] = path
		end
	end)

	local prefabs: { [string]: boolean } = {}
	module.walk("./game/Assets/Prefabs", function(_, name)
		local base = string.match(name, "^(.*)%.rbxmx?$")
		if base then
			prefabs[base] = true
		end
	end)

	return models, prefabs
end

return module
