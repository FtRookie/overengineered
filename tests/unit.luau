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

report.detail(`{passed} passed, {report.failures} failed`)
report.finish(`{passed} headless unit tests pass`)
