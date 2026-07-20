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

local report = {}

report.failures = 0
report.warnings = 0

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
	print(`  {YELLOW}warn{RESET}  {YELLOW}{message}{RESET}`)
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

	if report.failures > 0 then
		local plural = if report.failures == 1 then "" else "s"
		print(`{RED}{BOLD}FAILED{RESET}{RED} — {report.failures} problem{plural} found{RESET}`)
		process.exit(1)
	end

	local suffix = if report.warnings == 0
		then ""
		else `{YELLOW} ({report.warnings} warning{if report.warnings == 1 then "" else "s"}){RESET}`
	print(`{GREEN}{BOLD}OK{RESET}{GREEN}  {okMessage}{RESET}{suffix}`)
	process.exit(0)
end

return report
