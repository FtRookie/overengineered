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

-- BlockAssertions parity ---------------------------------------------------------------------------
--
-- src/shared/blocks/BlockAssertions.ts runs in Studio (BlockListBuilder) and hard-throws, so a
-- committed block already passes it. Re-checking the raw .rbxm here runs the same checks in CI, before
-- Studio is ever opened.
--
-- The runtime model differs from the file, so the port compensates to match what the assertion sees:
--   * WeldRegions and MarkerPoints are both unparented before the assertion runs (weld init, and
--     BlockCreation.MarkerPositions), so those subtrees are skipped here.
--   * the Ball/Cylinder shape check only inspects the block's direct children, as the runtime one does.
--   * a single-part block's colbox + PrimaryPart are injected at runtime, so a nil PrimaryPart on the
--     raw asset defers its colbox/rotation checks.
--
-- A violation on a registered block is a hard `fail`; on an unregistered/placeholder asset it is a
-- `warn`, exactly as step 3 treats a missing model.

-- Roblox omits default-valued properties from the file, and lune throws when reading an absent property
-- that has no reflection default (e.g. WeldConstraint.Enabled); read through a fallback.
local function prop(inst: any, name: string, default: any): any
	local ok, value = pcall(function()
		return inst[name]
	end)
	return if ok then value else default
end

-- WeldRegions and MarkerPoints are both unparented from the model before the runtime assertion runs, so
-- exclude those subtrees to match it (see BlockCreation.MarkerPositions.fromModelFolder)
local STRIPPED_FOLDERS = { weldregions = true, markerpoints = true }
local function underStrippedFolder(inst: any, stop: any): boolean
	local parent = prop(inst, "Parent", nil)
	while parent ~= nil and parent ~= stop do
		if STRIPPED_FOLDERS[string.lower(parent.Name)] then
			return true
		end
		parent = prop(parent, "Parent", nil)
	end
	return false
end

-- Ported from BlockAssertions.getAllModelErrors
local function blockModelErrors(block: any): { string }
	local errors: { string } = {}
	local function push(message: string)
		table.insert(errors, message)
	end

	local descendants = {}
	for _, descendant in block:GetDescendants() do
		if not underStrippedFolder(descendant, block) then
			table.insert(descendants, descendant)
		end
	end

	-- every weld is enabled, has both parts, and both parts live inside the block
	for _, weld in descendants do
		if not weld:IsA("WeldConstraint") then
			continue
		end

		local part0, part1 = prop(weld, "Part0", nil), prop(weld, "Part1", nil)
		if not prop(weld, "Enabled", true) then
			push("has a disabled weld")
		end
		if part0 == nil or part1 == nil then
			push("has a partial weld (Part0 or Part1 is unset)")
		end
		if (part0 and not part0:IsDescendantOf(block)) or (part1 and not part1:IsDescendantOf(block)) then
			push("has a weld referencing a part outside the block")
		end
	end

	-- no part has fluid forces enabled
	for _, part in descendants do
		if part:IsA("BasePart") and prop(part, "EnableFluidForces", false) == true then
			push(`has fluid forces enabled on part '{part.Name}'`)
		end
	end

	-- at least one part is anchored
	local anchored = false
	for _, part in descendants do
		if part:IsA("BasePart") and prop(part, "Anchored", false) then
			anchored = true
			break
		end
	end
	if not anchored then
		push("has no anchored part")
	end

	-- no Ball/Cylinder Part directly under the block (they do not scale). Only direct children are checked,
	-- as the runtime assertion does — nested marker/detail parts are exempt.
	for _, child in block:GetChildren() do
		if underStrippedFolder(child, block) then
			continue
		end
		if child:IsA("Part") and not child:HasTag("UNSCALABLE") then
			local shape = prop(child, "Shape", nil)
			if shape == roblox.Enum.PartType.Ball or shape == roblox.Enum.PartType.Cylinder then
				push(`has a {tostring(shape)} part '{child.Name}' that does not scale (use a union or mesh)`)
			end
		end
	end

	-- unions keep UsePartColor on
	for _, part in descendants do
		if part:IsA("UnionOperation") and not prop(part, "UsePartColor", true) then
			push(`has UsePartColor disabled on union '{part.Name}'`)
		end
	end

	-- collidable parts are in the Blocks collision group
	for _, part in descendants do
		if part:IsA("BasePart") and prop(part, "CanCollide", true) then
			local group = prop(part, "CollisionGroup", "Default")
			local name = string.lower(part.Name)
			if group ~= "Blocks" and name ~= "colbox" and name ~= "radarview" then
				push(`has part '{part.Name}' in collision group '{group}' (expected Blocks)`)
			end
		end
	end

	-- single-part blocks get their colbox + PrimaryPart injected at runtime, so a nil PrimaryPart on the
	-- raw asset is left to the Studio check; once it is set, its colbox and rotation must be right
	local primary = block.PrimaryPart
	if primary ~= nil then
		for _, child in descendants do
			if string.lower(child.Name) == "colbox" and child ~= primary then
				push("has a colbox that is not the PrimaryPart")
			end
		end

		if string.lower(primary.Name) == "colbox" then
			local welded = false
			for _, weld in descendants do
				if not weld:IsA("WeldConstraint") then
					continue
				end
				local part0, part1 = prop(weld, "Part0", nil), prop(weld, "Part1", nil)
				if (part0 == primary and part1 and part1 ~= primary) or (part1 == primary and part0 and part0 ~= primary) then
					welded = true
				end
			end
			if not welded then
				push("has a colbox that is not welded to anything")
			end
		end

		if primary.CFrame.Rotation ~= roblox.CFrame.identity then
			push(`has a non-zero rotation in its PrimaryPart '{primary.Name}'`)
		end
	end

	-- no two sibling parts share a name
	local function checkNames(parent: any)
		local seen = {}
		for _, child in parent:GetChildren() do
			if STRIPPED_FOLDERS[string.lower(child.Name)] then
				continue
			end
			checkNames(child)
			if child:IsA("BasePart") then
				if seen[child.Name] then
					push(`has duplicate sibling part name '{child.Name}'`)
				end
				seen[child.Name] = true
			end
		end
	end
	checkNames(block)

	return errors
end

-- Model type parity --------------------------------------------------------------------------------
--
-- A block extending InstanceBlockLogic<typeof definition, TModel> declares its model's named children as
-- `type TModel = BlockModel & { … }`. Nothing validates that at runtime — a renamed or missing part only
-- crashes `this.instance.Foo` once the block is used in a ride. Parse TModel from the source and confirm
-- the .rbxm has those children with the declared class (IsA, so an abstract BasePart accepts any part,
-- while Part vs UnionOperation is caught). Type aliases and bare `{ … }` fields are resolved.
--
-- Limitations — this is a text parser over the .ts source, not the TypeScript type system, so it only
-- understands the type shapes the codebase uses today; anything else is silently skipped, and a drop in the
-- "typed blocks checked" count is the only signal that coverage quietly shrank. It does NOT handle, and
-- would mis-flag, the following if introduced:
--   * a field typed with an alias imported from another file — only a same-file `type X = …` is resolved
--   * an inline `A | B` union written without a leading pipe — only the first member gets the class check
--   * comments or strings containing { } ; | inside the type body — the brace scan counts them literally
--   * a type field naming a part injected at load (e.g. a single-part ColBox) — absent on the raw asset
-- A reported failure is always a true statement about the model (FindFirstChild/IsA are exact); the only
-- risk is that the expected shape was mis-parsed above, and that risk lands almost entirely on the class
-- check — a missing-child failure is the robust, high-value one (a guaranteed nil → ride crash).

local function isSpace(c: string): boolean
	return c ~= "" and string.match(c, "%s") ~= nil
end

local function braceMatch(src: string, open: number): number
	local depth, i = 0, open
	while i <= #src do
		local c = string.sub(src, i, i)
		if c == "{" then
			depth += 1
		elseif c == "}" then
			depth -= 1
			if depth == 0 then
				return i
			end
		end
		i += 1
	end
	return #src
end

local function mergeChildren(a, b)
	if a == nil then
		return b
	end
	if b == nil then
		return a
	end
	local merged = {}
	for _, f in a do
		table.insert(merged, f)
	end
	for _, f in b do
		table.insert(merged, f)
	end
	return merged
end

-- forward-declared for the mutual recursion between fields, nested blocks and alias resolution
local parseBody, resolveAlias

-- reads a field's type after the ":"; returns class (nil for a bare `{}`), the nested "{" index, isUnion
local function parseTypeExpr(src: string, start: number, stop: number): (string?, number?, boolean)
	local i, isUnion = start, false
	while i < stop do
		local c = string.sub(src, i, i)
		if isSpace(c) then
			i += 1
		elseif c == "|" then
			isUnion = true
			i += 1
		elseif c == "(" then
			i += 1
		else
			break
		end
	end
	if string.sub(src, i, i) == "{" then
		return nil, i, isUnion -- a bare `{ … }` field has no class of its own
	end
	local class = string.match(src, "^([%w_]+)", i)
	if class then
		i += #class
	end
	local childrenOpen = nil
	local j = i
	while j < stop do
		if string.sub(src, j, j) == "{" then
			childrenOpen = j
			break
		end
		j += 1
	end
	return class, childrenOpen, isUnion
end

local aliasCache = {}

parseBody = function(src, open)
	local close = braceMatch(src, open)
	local fields, i = {}, open + 1
	while i < close do
		while i < close and isSpace(string.sub(src, i, i)) do
			i += 1
		end
		if i >= close then
			break
		end
		if string.sub(src, i, i + 7) == "readonly" and isSpace(string.sub(src, i + 8, i + 8)) then
			i += 8
			while i < close and isSpace(string.sub(src, i, i)) do
				i += 1
			end
		end
		local name = string.match(src, "^([%w_]+)", i)
		if not name then
			i += 1
			continue
		end
		i += #name
		while i < close and isSpace(string.sub(src, i, i)) do
			i += 1
		end
		if string.sub(src, i, i) ~= ":" then
			continue
		end
		i += 1
		local fieldStart, depth = i, 0
		while i < close do
			local c = string.sub(src, i, i)
			if c == "{" then
				depth += 1
			elseif c == "}" then
				depth -= 1
			elseif c == ";" and depth == 0 then
				break
			end
			i += 1
		end
		local class, childrenOpen, isUnion = parseTypeExpr(src, fieldStart, i)
		i += 1
		local children = if childrenOpen and not isUnion then parseBody(src, childrenOpen) else nil
		if class and not isUnion then
			local resolved = resolveAlias(src, class)
			if resolved then
				class = resolved.class
				children = mergeChildren(resolved.children, children)
			end
		end
		table.insert(fields, { name = name, class = class, children = children, union = isUnion })
	end
	return fields
end

-- a field type may be a local alias (`type Emitter = UnionOperation & { … }`); follow it to a real class
resolveAlias = function(src, name)
	if aliasCache[name] ~= nil then
		return aliasCache[name] or nil
	end
	aliasCache[name] = false -- break cycles while resolving
	local _, e = string.find(src, "type%s+" .. name .. "%s*=%s*")
	if not e then
		return nil
	end
	local rhs, depth, j = e + 1, 0, e + 1
	while j <= #src do
		local c = string.sub(src, j, j)
		if c == "{" then
			depth += 1
		elseif c == "}" then
			depth -= 1
		elseif c == ";" and depth == 0 then
			break
		end
		j += 1
	end
	local class, childrenOpen, isUnion = parseTypeExpr(src, rhs, j)
	local children = if childrenOpen and not isUnion then parseBody(src, childrenOpen) else nil
	if class then
		local deeper = resolveAlias(src, class)
		if deeper then
			class = deeper.class
			children = mergeChildren(deeper.children, children)
		end
	end
	local result = { class = class, children = children }
	aliasCache[name] = result
	return result
end

local function modelTypeErrors(model: any, fields): { string }
	local errors: { string } = {}
	local function check(inst: any, flds, prefix: string)
		for _, f in flds do
			local child = inst:FindFirstChild(f.name)
			local here = if prefix == "" then f.name else `{prefix}.{f.name}`
			if child == nil then
				errors[#errors + 1] = `'{here}' is missing` .. (if f.class then ` (declared {f.class})` else "")
			else
				if not f.union and f.class and not child:IsA(f.class) then
					errors[#errors + 1] = `'{here}' is a {child.ClassName}, but the type declares {f.class}`
				end
				if f.children then
					check(child, f.children, here)
				end
			end
		end
	end
	check(model, fields, "")
	return errors
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
		local issues = blockModelErrors(instance)
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

-- 5. block models match their declared TModel ----------------------------------------------------

report.step("[5/5] checking model types")
local typedChecked = 0
walk("./src/shared/blocks", function(path)
	if string.match(path, "%.ts$") == nil then
		return
	end

	local src = fs.readFile(path)
	local typeName = string.match(src, "InstanceBlockLogic<typeof [%w_]+, ([%w_]+)>")
	if not typeName then
		return
	end
	local ts = string.find(src, "type%s+" .. typeName .. "%s*=%s*BlockModel%s*&%s*{")
	if not ts then
		return -- TModel is a reference or union, not an inline `BlockModel & { … }`
	end

	table.clear(aliasCache)
	local fields = parseBody(src, (string.find(src, "{", ts, true)) :: number)

	for id in string.gmatch(src, 'id: "([a-z0-9_]+)"') do
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
		local issues = modelTypeErrors(model, fields)
		if #issues > 0 then
			local emit = if registeredIds[id] then fail else warn
			local lines = { `{id} ({mpath}):` }
			for _, issue in issues do
				table.insert(lines, `        - {issue}`)
			end
			emit(table.concat(lines, "\n"))
		end
	end
end)
report.detail(`{typedChecked} typed blocks checked`)

report.finish(
	"assets parse, every registered block resolves to a model, block models pass their assertions, and match their declared types"
)
