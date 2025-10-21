--[[
  Place Extractor Script
  Reads a Roblox place file (`.rbxl`) and a `structure.json` manifest.
  It finds the instances specified in the manifest within the place file
  and serializes them back into individual .rbxm/.rbxmx model files.
]]

-- Required modules
local fs = require("@lune/fs")
local roblox = require("@lune/roblox")
local serde = require("@lune/serde")
local shared = require("./shared")

--------------------------------------------------------------------------------
-- Configuration
--------------------------------------------------------------------------------
local CONFIG = {
	-- Enable/disable debug messages
	Debug = true,

	-- Path to the structure manifest file
	ManifestPath = "./lune/structure.json",

	-- Path to the input .rbxl file from which models will be extracted
	InputPath = "place.rbxl",
}

--------------------------------------------------------------------------------
-- State and Helper Functions
--------------------------------------------------------------------------------
local missingInstances = {}
local criticalErrors = shared.criticalErrors

local function debugLog(message, depth)
	if CONFIG.Debug then
		shared.log(`[DEBUG] {string.rep("  ", depth or 0)}{message}`)
	end
end

local function log(message: string, depth: number?)
	shared.log(`{string.rep("  ", depth or 0)}{message}`)
end

-- Utility to create the directory in which the file should reside
local function ensureDirectoryExists(filePath)
	-- Extract the directory path from the full file path
	local dirPath = filePath:match("(.+)/")
	if dirPath then
		-- fs.writeDir creates the directory if it does not exist, and does nothing if it already exists.
		fs.writeDir(dirPath)
	end
end


-- Saves a single Instance to a file, automatically determining the format (binary or XML)
local function saveInstanceToFile(instance, filePath, depth)
	-- Check the file extension to determine if XML format should be used
	local isXml = filePath:lower():match("%.rbxmx$")

	if isXml then
		debugLog(`Serializing {shared.colors.BLUE}{instance:GetFullName()}{shared.colors.RESET} to {shared.colors.LIME}{filePath}{shared.colors.RESET} (XML format)`, depth)
	else
		debugLog(`Serializing {shared.colors.BLUE}{instance:GetFullName()}{shared.colors.RESET} to {shared.colors.LIME}{filePath}{shared.colors.RESET} (binary format)`, depth)
	end

	ensureDirectoryExists(filePath)

	if instance:IsA("Model") and instance.PrimaryPart then
		instance.WorldPivotData = nil
	end

	for _, child in ipairs(instance:GetDescendants()) do
		if child:IsA("Model") and child.PrimaryPart then
			child.WorldPivotData = nil
		end
	end

	-- roblox.serializeModel expects a table of instances.
	-- If isXml is true, XML format will be used, otherwise binary.
	local success, data = shared.protectedCall(
		roblox.serializeModel,
		"Failed to serialize instance " .. instance:GetFullName(),
		{ instance },
		isXml
	)
	if not success then return false end

	success, _ = shared.protectedCall(fs.writeFile, "Failed to write file " .. filePath, filePath, data)
	return success
end

type InstanceProps = shared.InstanceProps
type Manifest = shared.Manifest;

local function saveProps(instance: Instance, filePath: string, depth: number)
	local clone = instance:Clone();
	clone:ClearAllChildren()
	saveInstanceToFile(clone, filePath, depth + 1)
	clone:Destroy()
end

local function processNode(name: string, node: InstanceProps, parentInstance: roblox.Instance, depth: number)
	debugLog(`Looking for instance {shared.colors.BLUE}{name}{shared.colors.RESET} in {shared.colors.LIME}{parentInstance:GetFullName()}`, depth)

	local childInstance;
	if parentInstance:IsA("DataModel") then
		childInstance = (parentInstance :: roblox.DataModel):GetService(name)
	else
		childInstance = parentInstance:FindFirstChild(name)
	end

	if not childInstance then
		local fullPath = parentInstance:GetFullName() .. "." .. name
		shared.warn(`Could not find instance {fullPath}`, depth)
		table.insert(missingInstances, fullPath)
		return
	end

	if node.kind then
		if node.kind.kind == 'folder' then
			if fs.isDir(node.kind.root) then
				fs.removeDir(node.kind.root)
			end

			local root = #childInstance:GetFullName() + 1;
			local function processFoldered(parentInstance: roblox.Instance, depth: number)
				if parentInstance:IsA("Folder") or (node.kind.realtype and parentInstance:IsA(node.kind.realtype)) then
					for i, v in parentInstance:GetChildren() do
						processFoldered(v, depth + 1)
					end
				else
					saveInstanceToFile(parentInstance, node.kind.root .. '/' .. parentInstance:GetFullName():sub(root):gsub("%.", "/") .. '.rbxmx', depth + 1)
				end
			end

			processFoldered(childInstance, depth)

			if node.kind.props then
				saveProps(childInstance, node.kind.props, depth)
			end
			return
		end
	end

	if node.path then
		-- if has both path and children, save only properties
		if node.children then
			saveProps(childInstance, node.path, depth)
		else
			saveInstanceToFile(childInstance, node.path, depth + 1)
		end
	end
	if node.children then
		for k, v in pairs(node.children) do
			processNode(k, v, childInstance, depth + 1)
		end
	end
end

local function main()
	debugLog("Starting place extraction process...")

	-- 1. Reading and parsing the manifest
	debugLog("Reading manifest from: " .. CONFIG.ManifestPath)
	local manifestJson, readErr = fs.readFile(CONFIG.ManifestPath)
	if not manifestJson then
		shared.logError("Failed to read manifest file '" .. CONFIG.ManifestPath .. "': " .. tostring(readErr))
		return false
	end

	local success, manifest: Manifest = shared.protectedCall(serde.decode, "Failed to parse manifest JSON", "json", manifestJson)
	if not success then return false end
	debugLog("Manifest parsed successfully.")

	-- 2. Reading and deserializing the .rbxl file
	debugLog("Reading place file from: " .. CONFIG.InputPath)
	local placeData, readErr2 = fs.readFile(CONFIG.InputPath)
	if not placeData then
		shared.logError("Failed to read place file '" .. CONFIG.InputPath .. "': " .. tostring(readErr2))
		return false
	end

	local success2, dataModel = shared.protectedCall(roblox.deserializePlace, "Failed to deserialize place file", placeData)
	if not success2 then return false end
	debugLog("Place file deserialized successfully.")

	-- 3. Traversing the manifest and exporting models
	debugLog("Starting instance export based on manifest...")
	for name, props in pairs(manifest.game) do
		processNode(name, props, dataModel, 0)
	end

	return #criticalErrors == 0
end

--------------------------------------------------------------------------------
-- Script Execution and Final Report
--------------------------------------------------------------------------------
log("--- Starting Extraction ---")
local extractionSuccessful = shared.protectedCall(main, "Main extraction function failed unexpectedly")

log("\n--- Extraction Summary ---")
if #missingInstances > 0 then
	log(`{shared.colors.RED}The following instances were NOT found in the place file (and were not exported):`)
	for _, path in ipairs(missingInstances) do
		log(`{shared.colors.RED}  - {path}`)
	end
else
	log(`{shared.colors.LIME}All instances from the manifest were found in the place file.`)
end

if #criticalErrors > 0 then
	log(`\n{shared.colors.RED}Critical errors occurred during extraction:`)
	for i, err in ipairs(criticalErrors) do
		log(shared.colors.LIME .. string.format("  %d. %s", i, err))
	end
end

if extractionSuccessful and #criticalErrors == 0 then
	if #missingInstances > 0 then
		log(`\n{shared.colors.YELLOW}Extraction completed with warnings (some instances were missing).`)
	else
		log(`\n{shared.colors.LIME}Extraction completed successfully!`)
	end
else
	log(`\n{shared.colors.RED}Extraction failed due to critical errors.`)
end
log("--- End of Extraction Summary ---")
