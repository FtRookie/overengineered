--[[
	ARCHIVED — not wired into any check. The checks load compiled game code through the patched Lunit
	shim (node_modules/@rbxts/lunit/scripts/lune-shim.luau + patches/@rbxts+lunit+4.0.2.patch) instead,
	so this stays only as a self-contained fallback in case that maintained path ever needs replacing.

	Minimal roblox-ts -> Lune loader.

	Lets the headless checks run *the actual game code* (compiled to out/) instead of a hand-ported copy.
	roblox-ts output isn't standalone: every module bootstraps with `require(game:GetService(...):
	WaitForChild("rbxts_include"):WaitForChild("RuntimeLib"))` and resolves imports through `TS.import`
	by walking the DataModel tree. Lune has none of that, so this shims it:
	  * a fake `game`/`script` and the Roblox globals the runtime assumes (Enum, CFrame, task, typeIs, …),
	    with datatypes taken from @lune/roblox;
	  * instances modelled as filesystem paths, so `script.Parent.Promise` and `TS.import(script, RS,
	    "engine", …)` resolve onto out/ and node_modules (mapping mirrors default.project.json);
	  * `require` and `TS.import` overridden to load those paths with @lune/luau, cached like ModuleScripts.

	Scope: enough to load the shared, instance-reading modules the checks need (e.g. BlockAssertions).
	It is NOT a general roblox-ts runtime — a module that touches services, physics or networking at load
	will fail here. Extend the shimmed globals / roots below when a newly-needed module needs more.
]]

local fs = require("@lune/fs")
local roblox = require("@lune/roblox")
local luau = require("@lune/luau")

local moduleCache = {}
local sharedEnv
local TS

local instMeta
local function mkInst(path)
	return setmetatable({ __path = path }, instMeta)
end
instMeta = {
	__index = function(t, k)
		if k == "Parent" then
			local parent = string.match(t.__path, "^(.*)/[^/]+$")
			return parent and mkInst(parent) or nil
		end
		if k == "Name" then
			return string.match(t.__path, "[^/]+$")
		end
		if k == "WaitForChild" or k == "FindFirstChild" then
			return function(_, name)
				return mkInst(t.__path .. "/" .. name)
			end
		end
		return mkInst(t.__path .. "/" .. k)
	end,
}

-- ReplicatedStorage is virtual: its top-level children map to different fs roots (default.project.json)
local rsRoots = { rbxts_include = "node_modules/roblox-ts/include", TS = "out/shared", engine = "out/engine/shared" }
local fakeRS = {}
local function rsChild(_, name)
	local root = rsRoots[name]
	assert(root, "rbxts loader: unmapped ReplicatedStorage child '" .. tostring(name) .. "'")
	return mkInst(root)
end
setmetatable(fakeRS, { __index = { WaitForChild = rsChild, FindFirstChild = rsChild } })

local fakeRunService = {
	IsStudio = function() return false end,
	IsRunning = function() return false end,
	IsClient = function() return false end,
}
local fakeGame = {
	GetService = function(_, n)
		if n == "RunService" then return fakeRunService end
		if n == "ReplicatedStorage" then return fakeRS end
		error("rbxts loader: unshimmed service '" .. tostring(n) .. "'")
	end,
	IsLoaded = function() return true end,
}

local function loadFile(path)
	local actual
	for _, c in { path .. ".luau", path .. ".lua", path .. "/init.luau", path .. "/init.lua" } do
		if fs.isFile(c) then
			actual = c
			break
		end
	end
	assert(actual, "rbxts loader: module not found: " .. path)
	if moduleCache[actual] ~= nil then
		return moduleCache[actual]
	end

	local env = table.clone(sharedEnv)
	env.script = mkInst(path)
	local result = luau.load(luau.compile(fs.readFile(actual)), { environment = env })()
	moduleCache[actual] = result
	return result
end

local function shimRequire(arg)
	if type(arg) == "table" and getmetatable(arg) == instMeta then
		return loadFile(arg.__path)
	end
	error("rbxts loader: require of a non-module value")
end

local function typeIs(v, t)
	local tn = typeof(v)
	if tn == t then return true end
	if tn == "Instance" then
		local ok, r = pcall(function() return v:IsA(t) end)
		return ok and r or false
	end
	return false
end

sharedEnv = {
	game = fakeGame, require = shimRequire, typeIs = typeIs,
	Enum = roblox.Enum, CFrame = roblox.CFrame, Vector3 = roblox.Vector3, Vector2 = roblox.Vector2,
	Color3 = roblox.Color3, Instance = roblox.Instance, Random = roblox.Random, DateTime = roblox.DateTime,
	task = {
		spawn = function(f, ...) return f(...) end,
		defer = function(f, ...) return f(...) end,
		wait = function() return 0 end,
		delay = function() end,
		cancel = function() end,
	},
	print = print, warn = warn, error = error, assert = assert, pcall = pcall, xpcall = xpcall,
	type = type, typeof = typeof, tostring = tostring, tonumber = tonumber,
	pairs = pairs, ipairs = ipairs, next = next, select = select, rawlen = rawlen,
	setmetatable = setmetatable, getmetatable = getmetatable, rawget = rawget, rawset = rawset, rawequal = rawequal,
	string = string, table = table, math = math, coroutine = coroutine, os = os, utf8 = utf8, bit32 = bit32,
	buffer = buffer, unpack = table.unpack, tick = os.clock, time = os.clock, newproxy = newproxy,
	_G = {},
}

TS = loadFile("node_modules/roblox-ts/include/RuntimeLib")
TS.getModule = function(_context, scope, name)
	return mkInst("node_modules/" .. scope .. "/" .. name)
end
TS.import = function(_context, module, ...)
	local segments = { ... }
	if module == fakeRS then
		local root = rsRoots[segments[1]]
		assert(root, "rbxts loader: unmapped import root '" .. tostring(segments[1]) .. "'")
		local parts = { root }
		for i = 2, #segments do parts[#parts + 1] = segments[i] end
		return loadFile(table.concat(parts, "/"))
	end
	local base = module.__path
	for _, seg in segments do base = base .. "/" .. seg end
	return loadFile(base)
end

-- `load("shared/blocks/BlockAssertions")` -> the module's exports (path is relative to out/)
local function load(outPath: string)
	return loadFile("out/" .. outPath)
end

return { load = load, roblox = roblox }
