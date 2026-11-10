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

test("v39 turns the lost-target hold off on saved radars only", function()
	local saved = {
		version = 38,
		blocks = {
			{ id = "radarsection", uuid = "a", location = roblox.CFrame.new(), config = {} },
			{ id = "aesaradar", uuid = "b", location = roblox.CFrame.new() },
			{ id = "block", uuid = "c", location = roblox.CFrame.new() },
		},
	}

	local upgraded = BlocksSerializer.upgradeSave(saved, emptyBlockList)
	assertEq(upgraded.blocks[1].config.holdLostTarget.config, false, "radarsection hold")
	assertEq(upgraded.blocks[2].config.holdLostTarget.config, false, "aesaradar hold, no config before")
	assertEq(upgraded.blocks[3].config, nil, "other block config")
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

test("Strings.parseDuration reads unit forms, bare seconds, and rejects the rest", function()
	local Strings = rbxRequire("out/engine/shared/fixes/String.propmacro").Strings
	for input, expected in { ["30s"] = 30, ["1m"] = 60, ["1d"] = 86400, ["30d"] = 2592000, ["1w"] = 604800 } do
		assertEq(Strings.parseDuration(input), expected, input)
	end
	assertEq(Strings.parseDuration("1w2d"), 777600, "1w2d")
	assertEq(Strings.parseDuration(" 1D 12H "), 129600, "spaced, uppercase")
	assertEq(Strings.parseDuration("3600"), 3600, "bare number is seconds")
	for _, input in { "", "  ", "-1", "1.5h", "1y", "d", "1d x", "1dd", "s30" } do
		assertEq(Strings.parseDuration(input), nil, `"{input}"`)
	end
end)

test("Strings.commaSeparated groups integer digits in threes", function()
	local Strings = rbxRequire("out/engine/shared/fixes/String.propmacro").Strings
	for input, expected in {
		[0] = "0", [7] = "7", [999] = "999", [1000] = "1,000", [113519] = "113,519",
		[1234567] = "1,234,567", [-1234567] = "-1,234,567", [1234.5] = "1,234.5", [-999] = "-999",
	} do
		assertEq(Strings.commaSeparated(input), expected, tostring(input))
	end
	assertEq(Strings.commaSeparated(0 / 0), tostring(0 / 0), "nan passes through")
	assertEq(Strings.commaSeparated(math.huge), "inf", "inf passes through")
end)

--- signals ----------------------------------------------------------------------------------------

-- onkFirstInputs disconnects itself from the block's tick signal on its first call. When Fire stepped over the
-- subscriber after it, every block handler registered after one missed its first tick.
local ArgsSignal = rbxRequire("out/engine/shared/event/Signal").ArgsSignal

local function fireLog(setup: (signal: any, log: { string }) -> ()): string
	local signal = ArgsSignal.new()
	local log = {}
	setup(signal, log)
	signal:Fire()
	table.insert(log, "|")
	signal:Fire()
	return table.concat(log, " ")
end

test("Fire calls every subscriber in connection order", function()
	local got = fireLog(function(signal, log)
		for _, name in { "A", "B", "C" } do
			signal:Connect(function() table.insert(log, name) end)
		end
	end)
	assertEq(got, "A B C | A B C", "order")
end)

test("a subscriber disconnecting itself mid-Fire does not skip the next", function()
	local got = fireLog(function(signal, log)
		local a
		a = signal:Connect(function()
			table.insert(log, "A")
			a:Disconnect()
		end)
		signal:Connect(function() table.insert(log, "B") end)
		signal:Connect(function() table.insert(log, "C") end)
	end)
	assertEq(got, "A B C | B C", "calls")
end)

test("a subscriber disconnecting an earlier one mid-Fire does not skip or repeat", function()
	local got = fireLog(function(signal, log)
		local a = signal:Connect(function() table.insert(log, "A") end)
		signal:Connect(function()
			table.insert(log, "B")
			a:Disconnect()
		end)
		signal:Connect(function() table.insert(log, "C") end)
	end)
	assertEq(got, "A B C | B C", "calls")
end)

test("a subscriber disconnecting a later one mid-Fire stops it being called", function()
	local got = fireLog(function(signal, log)
		local c
		signal:Connect(function()
			table.insert(log, "A")
			if c then c:Disconnect() end
		end)
		signal:Connect(function() table.insert(log, "B") end)
		c = signal:Connect(function() table.insert(log, "C") end)
	end)
	assertEq(got, "A B | A B", "calls")
end)

test("a function connected twice still runs twice when the first copy disconnects itself", function()
	local got = fireLog(function(signal, log)
		local first
		local calls = 0
		local function f()
			calls += 1
			table.insert(log, "F" .. calls)
			if calls == 1 then first:Disconnect() end
		end
		first = signal:Connect(f)
		signal:Connect(f)
		signal:Connect(function() table.insert(log, "C") end)
	end)
	assertEq(got, "F1 F2 C | F3 C", "calls")
end)

test("a subscriber disconnecting an earlier one and itself mid-Fire does not skip the next", function()
	local got = fireLog(function(signal, log)
		local a = signal:Connect(function() table.insert(log, "A") end)
		local b
		b = signal:Connect(function()
			table.insert(log, "B")
			a:Disconnect()
			b:Disconnect()
		end)
		signal:Connect(function() table.insert(log, "C") end)
	end)
	assertEq(got, "A B C | C", "calls")
end)

test("a disconnected subscriber is removed once the Fire that disconnected it finishes", function()
	local signal = ArgsSignal.new()
	local count = 0
	local a
	a = signal:Connect(function()
		count += 1
		a:Disconnect()
	end)
	signal:Fire()
	signal:Fire()
	assertEq(count, 1, "calls")
	assertEq(#signal.subscribed, 0, "subscribers left")
end)

--- logic value storage ----------------------------------------------------------------------------

-- A wired consumer re-filters only when the source's result object changes, so a set of the value already stored
-- must keep that object, and anything that can differ underneath (a new value, NaN, a mutated table) must not.
local LogicValueStorageContainer =
	rbxRequire("out/shared/blockLogic/BlockLogicValueStorage").LogicValueStorageContainer
local tickCtx = { tick = 1, dt = 0 }

test("re-setting an equal value keeps the stored result", function()
	local storage = LogicValueStorageContainer.new({ number = { config = 0 } })
	storage:set("number", 5)
	local first = storage:get(tickCtx)
	storage:set("number", 5)
	assertTrue(rawequal(storage:get(tickCtx), first), "same result after an equal set")
	storage:set("number", 6)
	assertTrue(not rawequal(storage:get(tickCtx), first), "new result after a different set")
	assertEq(storage:get(tickCtx).value, 6, "value")
end)

test("NaN and tables are never skipped as equal", function()
	local storage = LogicValueStorageContainer.new({ number = { config = 0 } })
	local nan = 0 / 0
	storage:set("number", nan)
	local first = storage:get(tickCtx)
	storage:set("number", nan)
	assertTrue(not rawequal(storage:get(tickCtx), first), "NaN re-set invalidates")

	local bytes = LogicValueStorageContainer.new({ bytearray = { config = {} } })
	local buffer = { 1, 2 }
	bytes:set("bytearray", buffer)
	local before = bytes:get(tickCtx)
	bytes:set("bytearray", buffer)
	assertTrue(not rawequal(bytes:get(tickCtx), before), "same table re-set invalidates")
end)

--- logic loops ----------------------------------------------------------------------------------

-- Fake blocks wired with the real wire storage; `ticks` marks a stateful definition (Counter, Memory...). A wire
-- reading a register inside its own loop must read the start-of-tick value, and every other wire must not.
local LogicLoops = rbxRequire("out/shared/blockLogic/LogicLoops").LogicLoops
local BlockBackedInputLogicValueStorage =
	rbxRequire("out/shared/blockLogic/BlockLogicValueStorage").BlockBackedInputLogicValueStorage

local function loopGraph(spec: { { name: string, ticks: boolean, id: string? } }, wires: { { string } })
	local blocks, entries = {}, {}
	for i, s in spec do
		blocks[s.name] = { input = {}, definition = { stateful = s.ticks } }
		table.insert(entries, { uuid = string.format("%02d", i), id = s.id or "x", logic = blocks[s.name] })
	end
	local storages = {}
	for i, w in wires do
		local storage = BlockBackedInputLogicValueStorage.new({ types = {} }, blocks[w[1]], "result")
		blocks[w[2]].input["in" .. i] = storage
		storages[w[1] .. ">" .. w[2]] = storage
	end
	local registers = {}
	for _, r in LogicLoops.cutLoops(entries) do
		for name, b in blocks do
			if b == r then table.insert(registers, name) end
		end
	end
	table.sort(registers)
	local delayed = {}
	for key, storage in storages do
		if storage.readsStartOfTick then table.insert(delayed, key) end
	end
	table.sort(delayed)
	return table.concat(registers, ","), table.concat(delayed, ",")
end

test("wiring without loops gets no registers", function()
	local registers, delayed = loopGraph(
		{ { name = "S", ticks = true }, { name = "M", ticks = true }, { name = "A", ticks = false } },
		{ { "S", "M" }, { "M", "A" } }
	)
	assertEq(registers, "", "registers")
	assertEq(delayed, "", "delayed wires")
end)

test("two cross-wired memories both become registers", function()
	local registers, delayed = loopGraph(
		{ { name = "M1", ticks = true }, { name = "M2", ticks = true } },
		{ { "M1", "M2" }, { "M2", "M1" } }
	)
	assertEq(registers, "M1,M2", "registers")
	assertEq(delayed, "M1>M2,M2>M1", "delayed wires")
end)

test("a counter loop is cut at the counter only, and a reader outside the loop reads it fresh", function()
	local registers, delayed = loopGraph(
		{ { name = "C", ticks = true }, { name = "G", ticks = false }, { name = "Screen", ticks = true } },
		{ { "C", "G" }, { "G", "C" }, { "C", "Screen" } }
	)
	assertEq(registers, "C", "registers")
	assertEq(delayed, "C>G", "delayed wires")
end)

test("a gate loop with no stateful block is cut at its Fallback", function()
	local registers, delayed = loopGraph(
		{ { name = "N", ticks = false }, { name = "F", ticks = false, id = "fallback" } },
		{ { "N", "F" }, { "F", "N" } }
	)
	assertEq(registers, "F", "registers")
	assertEq(delayed, "F>N", "delayed wires")
end)

test("a gate wired to itself is its own register", function()
	local registers, delayed = loopGraph({ { name = "N", ticks = false } }, { { "N", "N" } })
	assertEq(registers, "N", "registers")
	assertEq(delayed, "N>N", "delayed wires")
end)

test("a Delay in a Fallback loop is the only register", function()
	local registers, delayed = loopGraph(
		{ { name = "N", ticks = false }, { name = "D", ticks = true }, { name = "F", ticks = false, id = "fallback" } },
		{ { "N", "D" }, { "D", "F" }, { "F", "N" } }
	)
	assertEq(registers, "D", "registers")
	assertEq(delayed, "D>F", "delayed wires")
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
