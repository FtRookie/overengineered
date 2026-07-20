--[[
	Update log check.

	UpdateLogGui does `DateTime.fromIsoDate(log.Date)!` with a non-null assertion, so a date that is not a
	real ISO date returns nil and takes the whole update log GUI down at runtime. Nothing in the compiler
	catches that — `Date` is just a string. Everything else here is cosmetic and only warns.

	Entries are read out of the compiled table by walking from each Header to the Date that follows it,
	because the post-processing code below the table also contains a `Date =` assignment.
]]

local fs = require("@lune/fs")
local process = require("@lune/process")
local report = require("./_report")

local SOURCE = "./out/client/UpdateLogs.luau"

local fail, warn = report.fail, report.warn

if not fs.isFile(SOURCE) then
	print(`{report.source(SOURCE)} is not compiled — run "npm run build" first`)
	process.exit(1)
end

local monthDays = { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 }
local function isRealDate(y: number, m: number, d: number): boolean
	if m < 1 or m > 12 or d < 1 then
		return false
	end

	local limit = monthDays[m]
	if m == 2 and y % 4 == 0 and (y % 100 ~= 0 or y % 400 == 0) then
		limit = 29
	end

	return d <= limit
end

report.title("update logs")

local source = fs.readFile(SOURCE)
local entries = 0
local cursor = 1

while true do
	local _, headerEnd, _, header = string.find(source, "Header = ([\"'])(.-)%1", cursor)
	if headerEnd == nil then
		break
	end

	local dateStart, dateEnd, date = string.find(source, 'Date = "([^"]*)"', headerEnd)
	if dateStart == nil then
		break
	end

	entries += 1
	local label = `"{header}"`

	-- the date is the only field that can crash the GUI
	local y, m, d = string.match(date, "^(%d%d%d%d)-(%d%d)-(%d%d)$")
	if y == nil then
		fail(`{label} has date "{date}", which is not YYYY-MM-DD — DateTime.fromIsoDate will return nil`)
	elseif not isRealDate(tonumber(y) :: number, tonumber(m) :: number, tonumber(d) :: number) then
		fail(`{label} has date "{date}", which is not a real calendar date`)
	end

	-- an icon is rendered as rbxassetid://<icon>, so a non-numeric one just fails to load
	local icon = string.match(string.sub(source, headerEnd, dateStart), 'Icon = "([^"]*)"')
	if icon ~= nil and string.match(icon, "^%d+$") == nil then
		warn(`{label} has icon "{icon}", which is not an asset id`)
	end

	-- content is split on newlines and empty lines are dropped, so an entry can render as nothing at all
	local nextHeader = string.find(source, "Header = ", dateEnd) or #source
	local body = string.sub(source, dateEnd, nextHeader)
	local lines = 0
	for _ in string.gmatch(body, "%-%s") do
		lines += 1
	end
	if lines == 0 then
		warn(`{label} has no content lines`)
	end

	cursor = dateEnd
end

report.detail(`checked {entries} update log entries`)

if entries == 0 then
	fail("no entries were parsed — the compiled shape of UpdateLogs has probably changed")
end

report.finish("every update log entry has a valid date")
