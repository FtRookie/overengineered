--[[
	Shared reporting for the headless checks.

	Failures are red, warnings yellow, and the final verdict is either green or red, so a red line in a
	CI log or a terminal cannot be mistaken for a passing run. GitHub Actions renders these codes.
]]

local process = require("@lune/process")

local RED = "\27[31m"
local YELLOW = "\27[33m"
local GREEN = "\27[32m"
local BOLD = "\27[1m"
local RESET = "\27[0m"

-- warnings are only counted by default; pass --full / -f / --all / -a to list each one
local verbose = false
for _, arg in process.args do
	if arg == "--full" or arg == "-f" or arg == "--all" or arg == "-a" then
		verbose = true
		break
	end
end

local report = {}

report.failures = 0
report.warnings = 0
-- a check may set this to its npm script, shown in the "run with <command> -- -f" warning hint
report.command = ""

-- out/ mirrors src/, so point at the TypeScript rather than the compiled Luau nobody edits
function report.source(path: string): string
	local rel = string.match(path, "^%.?/?out/(.*)%.luau$")
	if rel == nil then
		return path
	end

	local dir = string.match(rel, "^(.*)/init$")
	return if dir then `src/{dir}/index.ts` else `src/{rel}.ts`
end

function report.fail(message: string)
	report.failures += 1
	print(`  {RED}{BOLD}FAIL{RESET}  {RED}{message}{RESET}`)
end

function report.warn(message: string)
	report.warnings += 1
	if verbose then
		print(`  {YELLOW}warn{RESET}  {YELLOW}{message}{RESET}`)
	end
end

-- announces which check is running, so a chain of them cannot read as one
function report.title(name: string)
	print(`{BOLD}── {name} {string.rep("─", math.max(0, 60 - #name))}{RESET}`)
end

function report.step(message: string)
	print(`{message}`)
end

function report.detail(message: string)
	print(`      {message}`)
end

-- prints the verdict and exits; never returns
function report.finish(okMessage: string)
	print("")

	local warnLine = ""
	if report.warnings > 0 then
		local plural = if report.warnings == 1 then "" else "s"
		local hint = ""
		if not verbose then
			local how = if report.command ~= "" then `{report.command} -- -f` else "-f"
			hint = ` — run with {how} to list`
		end
		warnLine = `    {YELLOW}{report.warnings} warning{plural}{hint}{RESET}`
	end

	if report.failures > 0 then
		local plural = if report.failures == 1 then "" else "s"
		print(`{RED}{BOLD}FAILED{RESET}{RED} — {report.failures} problem{plural} found{RESET}`)
		if warnLine ~= "" then
			print(warnLine)
		end
		process.exit(1)
	end

	print(`{GREEN}{BOLD}OK{RESET}{GREEN}  {okMessage}{RESET}`)
	if warnLine ~= "" then
		print(warnLine)
	end
	process.exit(0)
end

return report
