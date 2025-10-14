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
local missingInstances = {} -- Table for storing paths to objects not found in the .rbxl file
local criticalErrors = {}   -- Table for storing critical errors

-- Simplified logging function
local function log(message, depth)
	if CONFIG.Debug then
		depth = depth or 0
		print(("[DEBUG] %s%s"):format(string.rep("  ", depth), tostring(message)))
	end
end

-- Warning function (always displayed)
local function warn(message: unknown, depth: number)
	depth = depth or 0
	local fullMessage = ("[WARN] %s%s"):format(string.rep("  ", depth), tostring(message))
	print(fullMessage)
end

-- Critical error function (always displayed and saved)
local function error(message)
	print("[ERROR] " .. tostring(message))
	table.insert(criticalErrors, message)
end

-- Helper function for protected calls
local function protectedCall(func, errorMessage, ...)
	local success, result = pcall(func, ...)
	if not success then
		error(errorMessage .. ": " .. tostring(result))
	end
	return success, result
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
		log("Serializing '" .. instance:GetFullName() .. "' to " .. filePath .. " (XML format)", depth)
	else
		log("Serializing '" .. instance:GetFullName() .. "' to " .. filePath .. " (binary format)", depth)
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
	local success, data = protectedCall(
		roblox.serializeModel,
		"Failed to serialize instance " .. instance:GetFullName(),
		{ instance },
		isXml
	)
	if not success then return false end

	success, _ = protectedCall(fs.writeFile, "Failed to write file " .. filePath, filePath, data)
	return success
end

type instanceProps = {
	kind: nil | { kind: "folder", root: string },
	path: string | nil,
	children: { [string]: instanceProps },
}
type manifest = {
	game: { [string]: instanceProps },
}

local function processNode(name: string, node: instanceProps, parentInstance: roblox.Instance, depth: number)
	log("Looking for instance: '" .. name .. "' in " .. parentInstance:GetFullName(), depth)

	local childInstance;
	if parentInstance:IsA("DataModel") then
		childInstance = (parentInstance :: roblox.DataModel):GetService(name)
	else
		childInstance = parentInstance:FindFirstChild(name)
	end

	if not childInstance then
		local fullPath = parentInstance:GetFullName() .. "." .. name
		warn("Could not find instance: " .. fullPath, depth)
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
				if parentInstance:IsA("Folder") then
					for i, v in parentInstance:GetChildren() do
						processFoldered(v, depth + 1)
					end
				else
					saveInstanceToFile(parentInstance, node.kind.root .. '/' .. parentInstance:GetFullName():sub(root):gsub("%.", "/") .. '.rbxmx', depth + 1)
				end
			end

			processFoldered(childInstance, depth)
			return
		end
	end

	if node.path then
		-- if has both path and children, save only properties
		if node.children then
			local clone = childInstance:Clone();
			clone:ClearAllChildren()
			saveInstanceToFile(clone, node.path, depth + 1)
			clone:Destroy()
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
	log("Starting place extraction process...")

	-- 1. Reading and parsing the manifest
	log("Reading manifest from: " .. CONFIG.ManifestPath)
	local manifestJson, readErr = fs.readFile(CONFIG.ManifestPath)
	if not manifestJson then
		error("Failed to read manifest file '" .. CONFIG.ManifestPath .. "': " .. tostring(readErr))
		return false
	end

	local success, manifest: manifest = protectedCall(serde.decode, "Failed to parse manifest JSON", "json", manifestJson)
	if not success then return false end
	log("Manifest parsed successfully.")

	-- 2. Reading and deserializing the .rbxl file
	log("Reading place file from: " .. CONFIG.InputPath)
	local placeData, readErr2 = fs.readFile(CONFIG.InputPath)
	if not placeData then
		error("Failed to read place file '" .. CONFIG.InputPath .. "': " .. tostring(readErr2))
		return false
	end

	local success2, dataModel = protectedCall(roblox.deserializePlace, "Failed to deserialize place file", placeData)
	if not success2 then return false end
	log("Place file deserialized successfully.")

	-- 3. Traversing the manifest and exporting models
	log("Starting instance export based on manifest...")
	for name, props in pairs(manifest.game) do
		processNode(name, props, dataModel, 0)
	end

	return #criticalErrors == 0
end

--------------------------------------------------------------------------------
-- Script Execution and Final Report
--------------------------------------------------------------------------------
print("--- Starting Extraction ---")
local extractionSuccessful = protectedCall(main, "Main extraction function failed unexpectedly")

print("\n--- Extraction Summary ---")
if #missingInstances > 0 then
	print("The following instances were NOT found in the place file (and were not exported):")
	for _, path in ipairs(missingInstances) do
		print("  - " .. path)
	end
else
	print("All instances from the manifest were found in the place file.")
end

if #criticalErrors > 0 then
	print("\nCritical errors occurred during extraction:")
	for i, err in ipairs(criticalErrors) do
		print(string.format("  %d. %s", i, err))
	end
end

if extractionSuccessful and #criticalErrors == 0 then
	if #missingInstances > 0 then
		print("\nExtraction completed with warnings (some instances were missing).")
	else
		print("\nExtraction completed successfully!")
	end
else
	print("\nExtraction failed due to critical errors.")
end
print("--- End of Extraction Summary ---")
