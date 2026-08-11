--[[
	Inspect a block asset outside Studio.

	Reuses tests/_assets (the same reader the asset check runs on), so a model is resolved, parsed and
	prepped here exactly as it is there — no second implementation to drift.

	Usage (from the repo root, via driver.sh):
	  ./driver.sh assets <block-id|path>            dump the model tree
	  ./driver.sh assets <block-id|path> --assert    also run the real BlockAssertions
	  ./driver.sh assets --find <substring>          list matching block ids and their files
]]

local process = require("@lune/process")
local fs = require("@lune/fs")
local assets = require("../../../tests/_assets")

local args = process.args
local models, prefabs = assets.indexPlaceable()

local function die(message: string): never
	print("assets: " .. message)
	process.exit(2)
	error("unreachable")
end

-- --find: the friction this exists for. Models sit in nested category folders (Logic/Communication/Beacon.rbxmx),
-- so guessing a path fails; block ids key off the lowercased filename.
if args[1] == "--find" then
	local needle = string.lower(args[2] or "")
	local hits = {}
	for id, path in models do
		if needle == "" or string.find(id, needle, 1, true) then
			table.insert(hits, `{id}\t{path}`)
		end
	end
	table.sort(hits)
	for _, line in hits do
		print(line)
	end
	print(`\n{#hits} of {(function() local n = 0 for _ in models do n += 1 end return n end)()} models`)
	return
end

local target = args[1] or die("needs a block id, a path, or --find <substring>")
local wantAssert = table.find(args, "--assert") ~= nil

local path = if fs.isFile(target) then target else models[string.lower(target)]
if path == nil then
	die(`no model for "{target}". Try: --find {string.lower(target)}`)
end

local roots, parseErr = assets.parse(path)
if not roots then
	die(`{path} does not parse: {parseErr}`)
end

local model = assets.firstModel(roots)
if model == nil then
	die(`{path} holds no Model (roots: {#roots})`)
end

print(`{path}`)
if prefabs[model.Name] then
	print(`  (a prefab of this name also exists in game/Assets/Prefabs)`)
end

local primary = model.PrimaryPart

-- Only the properties the block assertions actually read, so a failure can be explained from this output.
local function describe(instance: any): string
	local bits = {}
	if instance:IsA("BasePart") then
		if instance == primary then
			table.insert(bits, "PRIMARY")
		end
		if instance.Anchored then
			table.insert(bits, "anchored")
		end
		if instance.Massless then
			table.insert(bits, "massless")
		end
		if not instance.CanCollide then
			table.insert(bits, "noCollide")
		end
		table.insert(bits, `group={instance.CollisionGroup}`)
		if instance.EnableFluidForces then
			table.insert(bits, "FLUIDFORCES")
		end
		if instance:IsA("Part") then
			table.insert(bits, `shape={string.match(tostring(instance.Shape), "[^.]+$")}`)
		end
		if instance:IsA("UnionOperation") and not instance.UsePartColor then
			table.insert(bits, "noUsePartColor")
		end
	elseif instance:IsA("WeldConstraint") then
		table.insert(bits, `Part0={if instance.Part0 then instance.Part0.Name else "nil"}`)
		table.insert(bits, `Part1={if instance.Part1 then instance.Part1.Name else "nil"}`)
		-- unstored reads as nil rather than throwing; real Roblox would return true
		local enabled = assets.prop(instance, "Enabled", nil)
		if enabled == nil then
			table.insert(bits, "Enabled=unstored")
		elseif not enabled then
			table.insert(bits, "DISABLED")
		end
	end

	local tags = instance:GetTags()
	if #tags > 0 then
		table.insert(bits, `tags=[{table.concat(tags, ",")}]`)
	end

	return if #bits > 0 then "  " .. table.concat(bits, " ") else ""
end

local function dump(instance: any, depth: number)
	print(`{string.rep("  ", depth)}{instance.ClassName} {instance.Name}{describe(instance)}`)
	for _, child in instance:GetChildren() do
		dump(child, depth + 1)
	end
end

dump(model, 1)

if wantAssert then
	local rbxRequire = require("../../../node_modules/@rbxts/lunit/scripts/lune-shim")
	local BlockAssertions = rbxRequire("out/shared/blocks/BlockAssertions").BlockAssertions

	-- prep after dumping, so the tree above shows the file as committed
	assets.prepModel(model)
	local issues = BlockAssertions.getAllErrors({ model = model })
	print("")
	if #issues == 0 then
		print("BlockAssertions: clean")
	else
		print(`BlockAssertions: {#issues} issue(s)`)
		for _, issue in issues do
			print("  - " .. issue)
		end
	end
end
