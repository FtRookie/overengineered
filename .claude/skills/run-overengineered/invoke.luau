--[[
	Loads compiled game modules from out/ and runs Luau against them, outside Roblox.

	Lunit ships a Lune shim that stubs the Roblox globals a compiled roblox-ts module expects
	(script, game, task, Enum, CFrame, Vector3, Color3, Instance, ...). tests/assetcheck.luau uses it to
	run the real BlockAssertions; this exposes the same handle for anything else in out/.

	Usage (always from the repo root):
	  lune run .claude/skills/run-overengineered/invoke <file.luau>   run a script with `rbx` predefined
	  lune run .claude/skills/run-overengineered/invoke -e "<luau>"   run an inline snippet

	In both cases `rbx(path)` is the module loader, e.g.
	  local Objects = rbx("out/engine/shared/fixes/Objects").Objects
]]

local fs = require("@lune/fs")
local luau = require("@lune/luau")
local process = require("@lune/process")

local rbxRequire = require("../../../node_modules/@rbxts/lunit/scripts/lune-shim")

local mode = process.args[1]
local arg = process.args[2]

-- `-e <src>` takes two args; a bare file path takes one.
if mode and mode ~= "-e" and not arg then
	arg = mode
	mode = "-f"
end

if not mode or not arg then
	print("usage: lune run .claude/skills/run-overengineered/invoke <file.luau>")
	print("       lune run .claude/skills/run-overengineered/invoke -e \"<luau source>\"")
	process.exit(2)
end

local source
if mode == "-e" then
	source = arg
else
	source = arg
	if not fs.isFile(source) then
		print(`invoke: no such file: {source}`)
		process.exit(2)
	end
	source = fs.readFile(source)
end

-- `rbx` is passed in rather than injected as a global so a snippet reads the same either way.
local chunk = luau.load("local rbx = ...\n" .. source, { debugName = "invoke" })

local ok, err = pcall(chunk, rbxRequire)
if not ok then
	print(`invoke failed: {err}`)
	-- A module that imports @rbxts/services cannot load here; say so rather than leaving a raw stack.
	if tostring(err):find("@rbxts/services", 1, true) then
		print("")
		print("That module imports @rbxts/services, which the shim does not stub.")
		print("Only modules free of Roblox service imports are loadable — see the skill's Gotchas.")
	end
	process.exit(1)
end
