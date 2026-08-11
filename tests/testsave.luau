--[[
	Save-compatibility guard.

	Three edits to a block silently break every existing player build, and nothing in the compiler or the other
	checks notices:

	  1. removing (or renaming) a block id — the saved block no longer resolves to anything
	  2. removing an input or output key — saved config and wires are keyed by name, so they orphan
	  3. flipping an input to `connectorHidden: true` — a wire to a hidden connector is not valid

	Each is legitimate *with* a serializer upgrade. So this compares the current definitions against a committed
	baseline and only fails when something disappeared while `BlocksSerializer.latestVersion` stayed put. Bumping
	the version is the documented way to say "this is handled".

	  lune run tests/testsave             check
	  lune run tests/testsave --accept    rewrite the baseline from the current state

	`--accept` is the deliberate act of recording a breaking change as handled. Run it after adding the upgrader,
	never to make a red check go green.
]]

local fs = require("@lune/fs")
local process = require("@lune/process")
local serde = require("@lune/serde")
local report = require("./_report")
local definitions = require("./_definitions")
local rbxRequire = require("../node_modules/@rbxts/lunit/scripts/lune-shim")

local fail, warn = report.fail, report.warn
report.command = "npm run testsave"

local BASELINE = "./tests/save-safety.json"

local accept = false
for _, arg in process.args do
	if arg == "--accept" then
		accept = true
	end
end

report.title("save compatibility")

if not fs.isDir("./out/shared/building") then
	report.detail("out/ is not built, skipping (run `npm run build` first)")
	report.finish("nothing to compare")
end

-- Real builder objects where the module loads, static extraction for the rest.
local collected = definitions.collect()
local current = collected.byId

-- A block that stopped being statically readable would look like every key vanished at once. Track those so a
-- refactor into `Objects.deepCombine` cannot masquerade as a save-breaking removal.
local unreadable: { [string]: boolean } = {}
for _, entry in collected.staticallySkipped do
	local id = string.match(entry, "^([%w_]+) ")
	if id then
		unreadable[id] = true
	end
end

local version = rbxRequire("out/shared/building/BlocksSerializer").BlocksSerializer.latestVersion

-- Player settings are saved data too. `Config.addDefaults` walks PlayerConfigDefinition and fills anything a
-- save is missing, so an ADDED or REMOVED key is harmless — an unused key just sits in the saved table. What it
-- cannot do is reinterpret: when a field's stored type no longer matches the definition it overwrites with the
-- default, silently discarding whatever the player had chosen. That is the only case worth failing on.
local PlayerConfigDefinition = rbxRequire("out/shared/config/PlayerConfig").PlayerConfigDefinition
local PlayerConfigUpdater = rbxRequire("out/server/PlayerConfigVersioning").PlayerConfigUpdater
-- the namespace exposes no latest-version constant, so run the chain and read where it lands
local configVersion = PlayerConfigUpdater.update({ version = 1 }).version

local function shapeInto(value, path: string, out: { [string]: string })
	if typeof(value) == "table" then
		for key, inner in pairs(value) do
			shapeInto(inner, if path == "" then tostring(key) else `{path}.{tostring(key)}`, out)
		end
	else
		out[path] = typeof(value)
	end
	return out
end

local configShape: { [string]: string } = {}
for field, def in pairs(PlayerConfigDefinition) do
	shapeInto(def.config, field, configShape)
end

local function writeBaseline()
	local blocks = {}
	for id, entry in current do
		blocks[id] = {
			inputs = entry.inputs,
			outputs = entry.outputs,
			connectorHidden = entry.connectorHidden,
		}
	end
	fs.writeFile(
		BASELINE,
		serde.encode(
			"json",
			{ serializerVersion = version, configVersion = configVersion, configShape = configShape, blocks = blocks },
			true
		) .. "\n"
	)
end

if not fs.isFile(BASELINE) then
	writeBaseline()
	report.step(`no baseline yet — recorded {#keysOf(current)} blocks at serializer version {version}`)
	report.detail(`wrote {BASELINE}; commit it so future removals can be detected`)
	report.finish("baseline created")
end

local baseline = serde.decode("json", fs.readFile(BASELINE))

if accept then
	writeBaseline()
	report.step(`baseline updated: serializer version {baseline.serializerVersion} -> {version}`)
	report.finish("baseline accepted")
end

local function contains(list, value): boolean
	for _, item in list do
		if item == value then
			return true
		end
	end
	return false
end

local breaking: { string } = {}
local checked, skipped = 0, 0

for id, was in baseline.blocks do
	local now = current[id]
	if now == nil then
		if unreadable[id] then
			-- still exists, just no longer readable statically; nothing can be concluded either way
			skipped += 1
			warn(`{id}: definition is no longer statically readable, cannot be compared`)
		else
			-- a module that stopped loading contributes no ids at all, which looks identical to a deletion
			local hint = if collected.modulesFailed > 0
				then ` (or its module stopped loading — {collected.modulesFailed} did)`
				else ""
			table.insert(breaking, `block "{id}" no longer exists{hint} — every saved copy of it is orphaned`)
		end
		continue
	end

	checked += 1

	for _, key in was.inputs do
		if not contains(now.inputs, key) then
			table.insert(breaking, `{id}: input "{key}" removed — saved config under that key is orphaned`)
		end
	end
	for _, key in was.outputs do
		if not contains(now.outputs, key) then
			table.insert(breaking, `{id}: output "{key}" removed — saved wires from it are orphaned`)
		end
	end

	if now.connectorHiddenKnown then
		for _, key in now.connectorHidden do
			if contains(was.inputs, key) and not contains(was.connectorHidden, key) then
				table.insert(
					breaking,
					`{id}: input "{key}" became connectorHidden — saved wires to it are no longer valid`
				)
			end
		end
	else
		warn(`{id}: connectorHidden could not be read for every input, that dimension was not compared`)
	end
end

local configChanged: { string } = {}
local configFieldsCompared = 0
for path, wasType in baseline.configShape or {} do
	local nowType = configShape[path]
	-- absent is fine: an unused key is left in the saved table and simply never read
	if nowType ~= nil then
		configFieldsCompared += 1
		if nowType ~= wasType then
			table.insert(
				configChanged,
				`player config "{path}" changed type {wasType} -> {nowType} — addDefaults will overwrite every stored value with the default`
			)
		end
	end
end

report.step(`{checked} blocks compared against the baseline (serializer version {baseline.serializerVersion} -> {version})`)
report.detail(`{configFieldsCompared} player config fields compared (config version {baseline.configVersion} -> {configVersion})`)
if skipped > 0 then
	report.detail(`{skipped} could not be compared`)
end

if #configChanged > 0 and configVersion > (baseline.configVersion or 0) then
	report.detail(`{#configChanged} player config change(s), covered by the config version bump`)
	configChanged = {}
end
for _, message in configChanged do
	table.insert(breaking, message)
end

if #breaking == 0 then
	report.finish("no save-breaking definition or player config changes")
end

-- A version bump is the signal that an upgrader now handles this.
if version > baseline.serializerVersion then
	report.detail(`{#breaking} breaking change(s), covered by the serializer version bump:`)
	for _, message in breaking do
		report.detail(`  - {message}`)
	end
	report.detail(`run \`npm run testsave -- --accept\` to move the baseline forward`)
	report.finish("breaking changes are covered by a serializer upgrade")
end

for _, message in breaking do
	fail(message)
end
report.detail(`BlocksSerializer.latestVersion is still {version}. Add a serializer version with an`)
report.detail(`upgradeFrom that migrates these, then \`npm run testsave -- --accept\`.`)
report.finish("unreachable")
