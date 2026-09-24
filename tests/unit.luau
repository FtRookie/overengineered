--[[
	Headless unit tests.

	The `*.test.ts` suites run inside Studio via TestFramework, which means they never run in CI and never run
	before a commit. Anything that does not touch a Roblox service can be tested from the console instead, and
	this runs the *real* compiled modules through the Lune shim rather than a re-implementation.

	Scope is deliberately the code where a silent bug is expensive and a Studio session would not reveal it:
	the save-data upgrade chain above all. Add cases here rather than in a `.test.ts` whenever the subject does
	not need the engine.
]]

local roblox = require("@lune/roblox")
local report = require("./_report")
local rbxRequire = require("../node_modules/@rbxts/lunit/scripts/lune-shim")

local fail = report.fail
report.command = "npm run checkunit"

local passed = 0

local function test(name: string, body: () -> ())
	local ok, err = pcall(body)
	if ok then
		passed += 1
	else
		local message = string.match(tostring(err), "^([^\n]+)") or tostring(err)
		message = string.gsub(message, "^.*%.luau:%d+: ", "")
		fail(`{name}: {message}`)
	end
end

local function assertEq(actual, expected, what: string)
	if actual ~= expected then
		error(`{what}: expected {tostring(expected)}, got {tostring(actual)}`, 0)
	end
end

local function assertTrue(value, what: string)
	if not value then
		error(`{what}: expected truthy, got {tostring(value)}`, 0)
	end
end

report.title("headless unit tests")

--- save data ------------------------------------------------------------------------------------

local BlocksSerializer = rbxRequire("out/shared/building/BlocksSerializer").BlocksSerializer

-- Enough of a BlockList for the upgraders that consult one. They look blocks up by id; an unknown id has to
-- resolve to nil rather than throw, which is what an emptied plot would hit in production anyway.
local emptyBlockList = { blocks = {}, sorted = {} }

test("latestVersion is a positive integer", function()
	local v = BlocksSerializer.latestVersion
	assertTrue(type(v) == "number" and v > 0 and v % 1 == 0, `latestVersion={tostring(v)}`)
end)

-- The chain is only as good as its weakest link and nothing else exercises it. A save at the oldest version
-- has to arrive at the newest, or a player whose slot has not been touched in a year silently fails to load.
test("upgradeSave carries the oldest save shape to latestVersion", function()
	local oldest = {
		version = 4,
		blocks = {
			{
				id = "block",
				location = roblox.CFrame.new(0, 0, 0),
			},
		},
	}

	local upgraded = BlocksSerializer.upgradeSave(oldest, emptyBlockList)
	assertTrue(upgraded ~= nil, "upgradeSave returned nil")
	assertEq(upgraded.version, BlocksSerializer.latestVersion, "resulting version")
	assertTrue(upgraded.blocks ~= nil, "resulting blocks")
	assertEq(#upgraded.blocks, 1, "block count preserved")
end)

test("upgradeSave leaves a current-version save alone", function()
	local current = { version = BlocksSerializer.latestVersion, blocks = {} }
	local result = BlocksSerializer.upgradeSave(current, emptyBlockList)
	assertEq(result.version, BlocksSerializer.latestVersion, "version unchanged")
end)

test("upgradeSave is idempotent", function()
	local once = BlocksSerializer.upgradeSave({ version = 4, blocks = {} }, emptyBlockList)
	local twice = BlocksSerializer.upgradeSave(once, emptyBlockList)
	assertEq(twice.version, once.version, "second pass changed the version")
end)

--- player config -------------------------------------------------------------------------------

local PlayerConfigUpdater = rbxRequire("out/server/PlayerConfigVersioning").PlayerConfigUpdater

test("PlayerConfigUpdater carries the oldest config to the newest", function()
	local upgraded = PlayerConfigUpdater.update({ version = 1 })
	assertTrue(upgraded ~= nil, "update returned nil")
	assertTrue(type(upgraded.version) == "number", "no version on the result")
	-- running it again must not move further, which is what makes the result the latest version
	assertEq(PlayerConfigUpdater.update(upgraded).version, upgraded.version, "chain is not settled")
end)

test("PlayerConfigUpdater handles a config with no version", function()
	-- a save from before versioning existed; update() backfills v10 rather than throwing
	local upgraded = PlayerConfigUpdater.update({})
	assertTrue(type(upgraded.version) == "number", "no version assigned to an unversioned config")
end)

--- utility namespaces ---------------------------------------------------------------------------

test("Objects.deepCombine overrides only the named leaf", function()
	local Objects = rbxRequire("out/engine/shared/fixes/Objects").Objects
	local combined = Objects.deepCombine({ a = 1, b = { c = 2, d = 3 } }, { b = { c = 9 } })
	assertEq(combined.a, 1, "untouched top-level key")
	assertEq(combined.b.c, 9, "overridden leaf")
	assertEq(combined.b.d, 3, "sibling leaf preserved")
end)

test("t validates and rejects", function()
	local t = rbxRequire("out/engine/shared/t").t
	-- a compiled namespace method is a Luau method, so it takes the colon
	assertTrue(t:typeCheck(5, t.number), "5 should satisfy t.number")
	assertTrue(not t:typeCheck("5", t.number), '"5" should not satisfy t.number')
	assertTrue(t:typeCheck({ x = 1 }, t.interface({ x = t.number })), "interface should match")
end)

test("JSON round-trips a Roblox datatype", function()
	local JSON = rbxRequire("out/engine/shared/fixes/Json").JSON
	local original = roblox.Vector3.new(1, 2, 3)
	local restored = JSON.deserialize(JSON.serialize(original))
	assertEq(tostring(restored), tostring(original), "Vector3 round-trip")
end)

test("MathUtils.round honours the step", function()
	local MathUtils = rbxRequire("out/engine/shared/fixes/MathUtils").MathUtils
	assertEq(MathUtils.round(1.24, 0.5), 1, "1.24 to nearest 0.5")
	assertEq(MathUtils.round(1.26, 0.5), 1.5, "1.26 to nearest 0.5")
end)

--- luau semantics -------------------------------------------------------------------------------

-- The tripwires in CLAUDE.md, and the guards written against them, depend on these. A Luau or compiler change
-- that alters one fails here rather than silently changing what those guards test.

local function truthy(value): boolean
	return if value then true else false
end

test('0 and "" are truthy; only false and nil are falsy', function()
	assertEq(truthy(0), true, "0")
	assertEq(truthy(""), true, '""')
	assertEq(truthy(false), false, "false")
	assertEq(truthy(nil), false, "nil")
end)

test("nil == nil is true and nil ~= nil is false", function()
	local a, b = nil, nil
	assertEq(a == b, true, "nil == nil")
	assertEq(a ~= b, false, "nil ~= nil")
end)

test("NaN ~= NaN is true, so x ~= x catches NaN but not nil", function()
	local nan = 0 / 0
	local none = nil
	assertEq(nan ~= nan, true, "NaN ~= NaN")
	assertEq(none ~= none, false, "nil ~= nil")
end)

test("2^53 + 1 == 2^53, so integers above 2^53 are not all representable", function()
	assertEq(2 ^ 53 + 1 == 2 ^ 53, true, "2^53 + 1 == 2^53")
end)

local t = rbxRequire("out/engine/shared/t").t
local TTypeMacros = rbxRequire("out/engine/shared/t.propmacro").TTypeMacros

test("a namespace method called with a dot binds its first argument to self", function()
	assertEq(t.typeCheck(5, t.number), false, "t.typeCheck(5, t.number)")
	assertEq(t:typeCheck(5, t.number), true, "t:typeCheck(5, t.number)")
end)

test("TTypeMacros.as returns the checker it was given, so .as<T>() validates nothing", function()
	assertTrue(rawequal(TTypeMacros.as(t.number), t.number), "as(t.number) is t.number itself")
	assertEq(t:typeCheck("str", TTypeMacros.as(t.any)), true, 't.any.as<number>() accepts "str"')
end)

report.detail(`{passed} passed, {report.failures} failed`)
report.finish(`{passed} headless unit tests pass`)
