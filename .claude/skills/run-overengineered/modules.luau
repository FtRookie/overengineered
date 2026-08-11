--[[
	Which compiled modules actually load outside Roblox.

	This used to grep each file for a direct `@rbxts/services` import and call the rest loadable. That was wrong
	in both directions: it missed transitive imports (of 40 modules it listed, 1 loaded) and it could not know
	about module-scope code that needs world state. So it loads them for real and reports what happened.

	A full pass is fast (~0.7s for 634 modules) because the shim caches. The one hazard is module-scope code
	that spin-waits — driver.sh wraps this in a timeout for that reason.

	Usage (from the repo root, via driver.sh):
	  ./driver.sh modules                 every loadable module
	  ./driver.sh modules fixes           filtered by substring
	  ./driver.sh modules --failures      what does not load, grouped by reason
]]

local fs = require("@lune/fs")
local process = require("@lune/process")
local rbxRequire = require("../../../node_modules/@rbxts/lunit/scripts/lune-shim")

local wantFailures = false
local filter: string? = nil
for _, arg in process.args do
	if arg == "--failures" then
		wantFailures = true
	elseif string.sub(arg, 1, 2) ~= "--" then
		filter = arg
	end
end

local candidates: { string } = {}
local function walk(dir: string)
	for _, entry in fs.readDir(dir) do
		local path = `{dir}/{entry}`
		if fs.isDir(path) then
			walk(path)
		elseif string.match(path, "%.luau$") and not string.find(path, "transformer", 1, true) then
			table.insert(candidates, string.sub(path, 1, -6))
		end
	end
end
walk("out")
table.sort(candidates)

local loadable: { string } = {}
local failures: { { module: string, reason: string } } = {}

for _, module in candidates do
	local ok, err = pcall(function()
		return rbxRequire(module)
	end)
	if ok then
		table.insert(loadable, module)
	else
		-- the message is the first line; everything after it is a Lune traceback
		local reason = string.match(tostring(err), "^([^\n]+)") or tostring(err)
		reason = string.gsub(reason, "^.*lune%-shim:%d+: ", "")
		reason = string.gsub(reason, "^.*%.luau:%d+: ", "")
		table.insert(failures, { module = module, reason = reason })
	end
end

if wantFailures then
	local byReason: { [string]: { string } } = {}
	for _, entry in failures do
		local bucket = byReason[entry.reason]
		if bucket == nil then
			bucket = {}
			byReason[entry.reason] = bucket
		end
		table.insert(bucket, entry.module)
	end

	local reasons = {}
	for reason in byReason do
		table.insert(reasons, reason)
	end
	table.sort(reasons, function(a, b)
		return #byReason[a] > #byReason[b]
	end)

	for _, reason in reasons do
		local hit = byReason[reason]
		print(`{#hit}x  {reason}`)
		for i = 1, math.min(3, #hit) do
			print(`      {hit[i]}`)
		end
		if #hit > 3 then
			print(`      ... and {#hit - 3} more`)
		end
	end
	print(`\n{#failures} of {#candidates} modules do not load`)
	return
end

local shown = 0
for _, module in loadable do
	if filter == nil or string.find(module, filter, 1, true) then
		print(module)
		shown += 1
	end
end

local suffix = if filter then ` matching "{filter}"` else ""
print(`\n{shown}{suffix} of {#loadable} loadable ({#candidates} compiled, {#failures} not loadable — see --failures)`)
