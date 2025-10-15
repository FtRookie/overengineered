--[[
  Place Builder Script
  Reads a `structure.json` manifest to build a Roblox place file (`.rbxl`).
  This script recursively processes a structure of folders and model files (.rbxm/.rbxmx)
  and assembles them into a new DataModel.
]]

-- Required modules
local fs = require("@lune/fs")
local roblox = require("@lune/roblox")
local process = require("@lune/process")
local serde = require("@lune/serde")

--------------------------------------------------------------------------------
-- Configuration
--------------------------------------------------------------------------------
local CONFIG = {
	ManifestPath = "./lune/structure.json",
	OutputPath = "place.rbxl",
	RojoConfigPath = process.args[1],
}

-- Table for special containers
local SPECIAL_CONTAINERS = {
	StarterPlayerScripts = "StarterPlayerScripts",
	StarterCharacterScripts = "StarterCharacterScripts",
}

--------------------------------------------------------------------------------
-- Utility Functions
--------------------------------------------------------------------------------
local missingFiles = {}
local criticalErrors = {}

local BLUE = "\27[34m"
local LIME = "\27[32m"
local RESET = "\27[0m"

local function logError(message: string, errorDetail: string?)
	local fullMessage = message .. (errorDetail and ": " .. tostring(errorDetail) or "")
	print(fullMessage)
	table.insert(criticalErrors, fullMessage)
end

local function protectedCall(func: () -> any, errorMessage: string): (boolean, any)
	local success, result = pcall(func)
	if not success then
		logError(errorMessage, tostring(result))
		return false, result
	end
	return true, result
end

--------------------------------------------------------------------------------
-- Type Definitions
--------------------------------------------------------------------------------
type InstanceProps = {
	kind: nil | { kind: "folder", root: string },
	path: string | nil,
	children: { [string]: any },
}
type Manifest = {
	game: { [string]: any },
}

--------------------------------------------------------------------------------
-- Core Functions
--------------------------------------------------------------------------------
local function loadAndPlaceModel(filePath: string, parent: roblox.Instance, name: string): { roblox.Instance }
	if not fs.isFile(filePath) then
		table.insert(missingFiles, filePath)
		return {}
	end

	local success, contents = protectedCall(function() return fs.readFile(filePath) end, "Failed to read file: " .. filePath)
	if not success then return {} end

	local success2, localInstances = protectedCall(function() return roblox.deserializeModel(contents) end, "Failed to deserialize: " .. filePath)
	if not success2 then return {} end

	if #localInstances == 0 then
		return {}
	end

	for _, inst in ipairs(localInstances) do
		inst.Name = name
		print("Placing instance " .. BLUE .. inst.Name .. RESET)
		print("  from " .. LIME .. filePath .. RESET)
		print("  into " .. LIME .. (if parent:IsA('DataModel') then "game" else parent:GetFullName()) .. RESET .. "..")
		local success3 = protectedCall(function() inst.Parent = parent end, "Failed to parent instance '" .. inst.Name .. "' from " .. filePath .. " to " .. parent:GetFullName())
		if not success3 then
			return {}
		end
	end

	return localInstances
end

local function createOrFindInstance(name: string, parent: roblox.Instance, className: string?): roblox.Instance
	local instance = parent:FindFirstChild(name)
	if not instance then
		local actualClassName = SPECIAL_CONTAINERS[name] or className or "Folder"
		print("Creating instance: " .. BLUE .. name .. RESET .. " of class " .. BLUE .. actualClassName .. RESET .. " in " .. LIME .. parent:GetFullName() .. RESET)
		instance = roblox.Instance.new(actualClassName)
		instance.Name = name
		instance.Parent = parent
	else
		print("Found existing container: " .. LIME .. instance:GetFullName() .. RESET .. " of class " .. BLUE .. instance.ClassName .. RESET)
	end
	return instance
end

local function processFolder(rootPath: string, parent: roblox.Instance)
	if not fs.isDir(rootPath) then fs.writeDir(rootPath) end

	local files = fs.readDir(rootPath)
	for _, fname in files do
		local fpath = rootPath .. '/' .. fname
		local baseName = fname:match("(.+)%..+") or fname

		if fs.isFile(fpath) then
			loadAndPlaceModel(fpath, parent, baseName)
		else
			local instance = createOrFindInstance(baseName, parent)
			processFolder(fpath, instance)
		end
	end
end

local function processNode(props: any, name: string, parent: roblox.Instance): boolean
	if props.kind and props.kind.kind == "folder" then
		local instance = createOrFindInstance(name, parent)
		processFolder(props.kind.root, instance)
		return true
	end

	local instance: roblox.Instance
	if props.path then
		local models = loadAndPlaceModel(props.path, parent, name)
		instance = models[1]
		if not instance then return false end
	else
		if parent:IsA('DataModel') then
			instance = (parent :: roblox.DataModel):GetService(name)
		else
			instance = createOrFindInstance(name, parent)
		end
	end

	if props.children then
		local allChildrenProcessed = true
		for childName, childProps in pairs(props.children) do
			if not processNode(childProps, childName, instance) then
				allChildrenProcessed = false
			end
		end
		return allChildrenProcessed
	end

	return true
end

local function processStructureJson(dataModel: roblox.DataModel): boolean
	print("Reading manifest from: " .. LIME .. CONFIG.ManifestPath .. RESET)
	local success, manifestJson = protectedCall(function() return fs.readFile(CONFIG.ManifestPath) end, "Failed to read manifest file '" .. CONFIG.ManifestPath .. "'")
	if not success then return false end

	local success2, manifest: Manifest = protectedCall(function() return serde.decode("json", manifestJson) end, "Failed to parse manifest JSON")
	if not success2 then return false end
	print(LIME .. "Manifest parsed successfully." .. RESET)

	for name, props in pairs(manifest.game) do
		processNode(props, name, dataModel)
	end

	print("Finished processing all services")
	return true
end

--------------------------------------------------------------------------------
-- Rojo Integration Functions
--------------------------------------------------------------------------------
local function getScriptType(file: string): string
	if file:match("%.server%.lua[u]?$") then return "Script"
	elseif file:match("%.client%.lua[u]?$") then return "LocalScript"
	else return "ModuleScript" end
end

local function insertFromPath(path: string, instance: roblox.Instance, level: number?)
	local levelNum = level or 0
	if not fs.isDir(path) then return end
	local items = fs.readDir(path)
	for _, file in items do
		local full = path .. "/" .. file
		if fs.isFile(full) then
			if file:match("%.lua[u]?$") and file ~= "init.lua" and file ~= "init.luau" then
				local script = roblox.Instance.new(getScriptType(file))
				script.Name = file:gsub("%.lua[u]?$", "")
				script.Source = fs.readFile(full)
				script.Parent = instance
				print(string.rep("  ", levelNum) .. "├── " .. BLUE .. script.ClassName .. RESET .. ": " .. LIME .. script:GetFullName() .. RESET)
			elseif file:match("%.rbxm?$") then
				local instances = roblox.deserializeModel(fs.readFile(full))
				for _, inst in instances do inst.Parent = instance end
				print(string.rep("  ", levelNum) .. "├── Inserted model: " .. LIME .. file .. RESET)
			end
		elseif fs.isDir(full) then
			local initPath = full .. "/init.lua"
			if not fs.isFile(initPath) then initPath = full .. "/init.luau" end
			if fs.isFile(initPath) then
				local script = roblox.Instance.new("ModuleScript")
				script.Name = file
				script.Source = fs.readFile(initPath)
				script.Parent = instance
				print(string.rep("  ", levelNum) .. "├── " .. BLUE .. "ModuleScript" .. RESET .. " from init: " .. LIME .. script:GetFullName() .. RESET)
				insertFromPath(full, script, levelNum + 1)
			else
				local folder = roblox.Instance.new("Folder")
				folder.Name = file
				folder.Parent = instance
				print(string.rep("  ", levelNum) .. "├── " .. BLUE .. "Folder" .. RESET .. ": " .. LIME .. folder:GetFullName() .. RESET)
				insertFromPath(full, folder, levelNum + 1)
			end
		end
	end
end

local function processTree(tree: any, currentInstance: roblox.Instance)
	local pathValue: string?
	for key, value in tree do
		if key == "$path" then
			pathValue = value
		elseif key ~= "$className" then
			if key == "$properties" then
				for prop, val in value do
					currentInstance[prop] = val
				end
			elseif type(value) == "table" then
				local child = currentInstance:FindFirstChild(key) or roblox.Instance.new(value["$className"] or "Folder")
				child.Name = key
				child.Parent = currentInstance
				print("Processed: " .. LIME .. key .. RESET)
				processTree(value, child)
			end
		end
	end
	if pathValue then
		-- pretty stupid fix for relative paths, required for building from nested rojo projects, specifically when using ../../ to go up directories
		local adjustedPath = if pathValue:sub(1, 6) == "../../" then pathValue:sub(7) else pathValue
		if currentInstance.Name ~= "rbxts_include" then
			for _, child in currentInstance:GetChildren() do
				child.Parent = nil
			end
		end
		print("Inserting from: " .. LIME .. adjustedPath .. RESET)
		insertFromPath(adjustedPath, currentInstance, 0)
	end
end

local function integrateRojoScripts(dataModel: roblox.DataModel)
	if not CONFIG.RojoConfigPath then
		print("No Rojo config path provided, skipping Rojo integration.")
		return
	end

	print("Loading rojo config from: " .. LIME .. CONFIG.RojoConfigPath .. RESET)
	local success, rojoConfig = protectedCall(function() return fs.readFile(CONFIG.RojoConfigPath) end, "Failed to read rojo config")
	if not success then return end

	local success2, rojo = protectedCall(function() return serde.decode("json", rojoConfig) end, "Failed to parse rojo config")
	if not success2 then return end
	print(LIME .. "Rojo config loaded." .. RESET)

	print("Processing rojo tree...")
	processTree(rojo.tree, dataModel)
end

--------------------------------------------------------------------------------
-- Main Function
--------------------------------------------------------------------------------
local function main(): boolean
	print("Starting place build process...")
	local dataModel = roblox.Instance.new("DataModel") :: roblox.DataModel

	print("Processing manifest...")
	local success = processStructureJson(dataModel)
	if not success then return false end

	-- Required for database HTTP requests
	dataModel:GetService("HttpService").HttpEnabled = true

	-- Set up default camera
	print("Updating default camera position...")
	local camera = dataModel.Workspace.CurrentCamera
	if camera then
		camera.Name = "Camera"
		local robloxModule = roblox
		local CFrame = robloxModule.CFrame
		local Vector3 = robloxModule.Vector3
		local fromOrientation = CFrame.fromOrientation
		local rad = math.rad
		camera.Focus = CFrame.new(Vector3.new(104.5, -16379.115, 64))
		camera.CFrame = CFrame.new(Vector3.new(165.52, -16352.801, 108.668)) * fromOrientation(rad(-19.818), rad(52.103), -0)
	end

	print("Serializing the place...")
	local success2, output = protectedCall(function() return roblox.serializePlace(dataModel) end, "Failed to serialize place")
	if not success2 then return false end
	print("Writing place to: " .. LIME .. CONFIG.OutputPath .. RESET)
	local success3 = protectedCall(function() fs.writeFile(CONFIG.OutputPath, output) end, "Failed to write place.rbxl")
	if not success3 then return false end
	print("Place saved successfully to " .. LIME .. CONFIG.OutputPath .. RESET)

	integrateRojoScripts(dataModel)

	if CONFIG.RojoConfigPath then
		print("Serializing place after rojo integration...")
		local success4, serialized = protectedCall(function() return roblox.serializePlace(dataModel) end, "Failed to serialize place after rojo")
		if not success4 then return false end
		local success5 = protectedCall(function() fs.writeFile(CONFIG.OutputPath, serialized) end, "Failed to write updated place.rbxl")
		if not success5 then return false end
		print(LIME .. "Place updated!" .. RESET)
	end

	return #criticalErrors == 0
end

--------------------------------------------------------------------------------
-- Script Execution and Final Report
--------------------------------------------------------------------------------
print("--- Starting Build ---")
local buildSuccessful = protectedCall(main, "Main build function failed unexpectedly")

print("\n--- Build Summary ---")
if #missingFiles > 0 then
	print("The following files were missing (and skipped):")
	for _, file in ipairs(missingFiles) do
		print("  - " .. file)
	end
else
	print(LIME .. "No missing files detected." .. RESET)
end

if #criticalErrors > 0 then
	print("\nCritical errors occurred during build:")
	for i, err in ipairs(criticalErrors) do
		print(string.format("  %d. %s", i, err))
	end
end

if buildSuccessful and #criticalErrors == 0 then
	print("\n" .. LIME .. "Build completed successfully!" .. RESET)
elseif not buildSuccessful then
	print("\nBuild failed due to critical errors.")
else
	print("\nBuild completed with warnings (e.g., missing files, but no critical failures).")
end
print("--- End of Build Summary ---")

if not buildSuccessful or #criticalErrors > 0 then
	os.exit(1)
end
