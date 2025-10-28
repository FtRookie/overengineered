export type InstanceProps = {
	kind: nil | {
		kind: "folder",
		realtype: string | nil,
		props: string | nil,
		root: string,
	},
	path: string | nil,
	children: { [string]: InstanceProps },
}
export type Manifest = {
	game: { [string]: any },
}

local module = { }

module.colors = {
	BLUE = "\27[34m",
	YELLOW = "\27[33m",
	LIME = "\27[32m",
	RESET = "\27[0m",
}

module.criticalErrors = {}
function module.log(message: string)
	print(message .. module.colors.RESET)
end
function module.warn(message: unknown, depth: number?)
	module.log(`{module.colors.YELLOW}[WARN] {string.rep("  ", depth or 0)}{message}`)
end
function module.logError(message: string, errorDetail: string?)
	local fullMessage = message .. (errorDetail and ": " .. tostring(errorDetail) or "")
	module.log(fullMessage)
	table.insert(module.criticalErrors, fullMessage)
end

function module.protectedCall<T>(func: (...any) -> T, errorMessage: string, ...): (boolean, T)
	local success, result = pcall(func, ...)
	if not success then
		module.logError(errorMessage .. ": " .. tostring(result))
	end
	return success, result
end

return module
