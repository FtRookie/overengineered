type PreProcess = { Header: string; Icon?: string; Date: string; Content: string };
export type UpdateLog = {
	Header: string;
	Icon?: string;
	Date: string;
	Content: string[];
};

const logs: PreProcess[] = [
	// Remember to uncomment PVP toggle before pushing this update
	// {
	// 	Header: "<b>Si vis pacem, Para bellum.</b>",
	// 	Icon: "72678352495549",
	// 	Date: "2026-06-01",
	// 	Content: `
	// 	- Added PvP toggle
	// 	- Added Cannons [ammo, loader, base, barrel]
	// 	- Added Machine guns [ammo, loader, barrel, muzzle, armored barrel]
	// 	- Added Laser (weapon) [emitter, lens]
	// 	- Added Plasma [breech, barrel, muzzles, upgrader]
	// 	`,
	// },

	{
		Header: "",
		Date: "2026-07-dd",
		Content: `
			- Improved terrain frame budget (allows to generate the terrain much faster)
			- Fixed terrain memory leak
			- Reworked how damage is applied to rotating parts
			`,
	},
	{
		Header: "New Horizons",
		Date: "2026-07-18",
		Content: `
			- New world shape! Settings -> Environment -> Terrain -> Shape -> Realistic
			- ^^^^ optional. Leave it on Default and your world stays exactly as it was
			- Continents and oceans instead of the same hills everywhere
			- Real coastlines with beaches, bays and headlands
			- Mountain ranges that actually run in chains, with snow on the peaks
			- Plains that are properly flat, so there is somewhere to take off from
			- Rare plateau country: flat tops with steep sides, good for landing on
			- Terrain also loads noticeably faster now
			- ^^^^ new terrain type might be too heavy for low-end devices
			- fixed triangle terrain type having flipped normals sometimes
		`,
	},
	{
		Header: 'print("Hello Engineers!")',
		Date: "2026-07-16",
		Content: `
			- Lua IDE complete overhaul
			- > Live byte size counter of current code
			- > Syntax highlighting (with different colors)
			- > Auto Indent/Dedent + automatic \\t conversion
			- > Syntax check while editing
			- > Automatic "end" when starting a new block
			- > Automatically closes ( [ {
			- > Comment line/block toggle (Ctrl + /)
			- > Tab / Shift+Tab block indenting/dedenting
			- > Unknown variable highlighting
		`,
	},
	{
		Header: "Radars Ready",
		Date: "2026-07-16",
		Content: `
			- AESA Radar
			- Display hex string instant write
			- Add Vector to PID
			- Raise limits of Block, Wedge, and Half Block to 5000
			- Fix lamp off color
			- Fixed terrain overtaking main island
		`,
	},
	{
		Header: "Safe Keeping 💾",
		Date: "2026-07-12",
		Content: `
		- ⚠️ EXPERIMENTAL — your builds have moved to a new home
		- ^^^^ everything should look exactly as you left it. If anything is missing or wrong, please tell us on Discord BEFORE saving over it
		- Lots more room for slots
		- Your builds now live somewhere safer (external database), so they survive even if something happens to the game itself
		- The game now tells you when a save fails, instead of quietly pretending it worked
		- If saving is ever unavailable, the game will say so plainly and refuse to touch your builds rather than risk them
		- Fixed saves that could silently fail and be lost forever
		- Fixed a build being wiped when loading a slot went wrong
		`,
	},
	{
		Header: "Flight Boredom",
		Date: "2026-07-11",
		Content: `
		- Added configuration to most sensors to change output unit
		- Slider bugfixes (ek)
		- Water color config
		`,
	},
	{
		Header: "Freedom of Creation",
		Date: "2026-06-28",
		Content: `
		- Added Triangle Tool (inspired by other engineering games like Elite Engineering and Flightpoint)
		- ^^^^ if you're an owner or a developer of said games with the tool alike then reach out to @samlovebutter to get mentioned
		- Added logic to new wheels
		- Arrows on the sliders are now disabled in ride mode
		- Added new building theme by lookatel
		- Fixed not changing icons when music gets muted
		- Fixed achievements not loading
		- Fixed display block network and ui logic
		`,
	},
	{
		Header: "Lua, Laser, Links 🌽",
		Date: "2026-06-13",
		Content: `
		- New Achievements
		- Added Semi Truck wheel set
		- Added Aircraft wheel set
		- Various LuaCircuitBlock improvements
		- LuaCircuitBlock now has the following libraries
		- > JSON (encode, decode)
		- > coroutine
		- > task.spawn, task.delay, task.defer
		- Various LaserBlock improvements
		- Raise Suspension damping limit to 100,000
		- Fixed Classic terrain generation
		- Fixed laser capping out at 15k
		- Fixed snapping build when teleporting to seat
		- Fixed gravity sensor not adjusting for player config
		- Many block weld fixes by cee
		- Fire spreading is now actually affected by the material properties
		- Fixed fire not getting extinguished by extinguisher bomb
		- Fixed some achievements leaking memory
		- Music now can be muted by pressing the speaker and music note icons
		`,
	},
	{
		Header: "Mirrored Madness",
		Date: "2026-06-10",
		Content: `
		- Cooling rate now increases based on current temperature
		- Added tank sprocket 2
		- Added tank wheel 2
		- Added military wheel set
		- Added mirrored version of orthoscheme, concave corner wedges
		- Added chain block
		- Added center plot teleport
		- Added search behaviour options
		- Added Controller sensor, by cee
		- Added textures to Tank Wheel 1
		- Added Square Button, model imported from NOE
		- Added torque configuration to Handle block
		- Increased scale limit range (1/128 - 512)
		- Changed all sound blocks to have proper node layout + sizing
		- Fixed lua block indent, by ek
		- Fixed logic node pairs flashing the wrong color
		- Fixed freecam teleporting build
		- Fixed locked seats not unlocking on disable
		- Fixed angle sensor normal output not accounting for rotation
		`,
	},
	{
		Header: "Additive free",
		Date: "2026-06-06",
		Content: `
		- Added Steelie Wheel, Rim, Tire
		- Added Text To Speech Block
		- Added Orthoscheme (I don't know what else to call it)
		- Added Baseless Rope
		- Added color and thickness to rope
		- Mirror blocks moved to its own folder
		- Added tank sprocket 1
		- Aliases for steelie wheels
		- Raised max motor speed to 250
		- Fire now spreads more aggresively
		- Fire now does heat damage to the closest blocks
		`,
	},
	{
		Header: "Flamin' Hot",
		Icon: "89747760666734",
		Date: "2026-06-02",
		Content: `
		- Heat damage is now cumulative! (builds up)
		- A fraction of impact damage is converted to heat damage
		- Some materials glow when hot! (may get laggy)
		- Separated tires and rims as new blocks
		- Added Hollow Wedges (half,quarter,eigth)
		- Added screen max distance scaling
		- Removed runtime value rounding
		- Added angle normalizer block
		- Added Tint Block
		- Added Tank Wheel 1
		- Added Pickle for scale block
		- Lamps are now colorable
		- Increased laser range to (36k -> 100k)
		- Suspension can now be changed to be flexible
		- ExternalDatabase V5
		`,
	},
	{
		Header: "Fix Frenzy",
		Date: "2026-05-31",
		Content: `
		- Fixed RadarWarningReceiver relative output
		- Better handling of LED on LuaCircuitBlock
		- Seat Locking & toggling (kicks players off)
		- Various cleanups
		- Fixed typo in SoundFromID block logic
		- Fixed music controller not setting volume on join
		`,
	},
	{
		Header: "Kaboom!",
		Date: "2026-05-30",
		Content: `
		- Increased motor torque precision (0.1 -> 0.001)
		- Fixed playlist not setting volumes properly when player joins the game
		- TNT rework: TNT is finally a part of the unified damage system!
		- TNT rework: effects now scaled with TNT's force
		- TNT rework: forces now applied properly
		- TNT rework: TNT explosion scale now follows inverse square law (or something like it). Which means that strength of the explosion will become exponentially smaller.
		- TNT rework: now chance of TNT not breaking connections between blocks is now scaling with block's strength (health)
		`,
	},
	{
		Header: "Now Playing",
		Date: "2026-05-29",
		Content: `
		- Added new "Playlist" tab to the settings
		- General music volume was moved to "Playlist" tabe
		- Each music track now has a separate volume setting so you can adjust them
		- Note: the UI is not finished. Custom tracks support will be added in the future updates, as well as the ability to assign tracks to specific playlists.
		- New joystick and keyboard sensor icons
		`,
	},
	{
		Header: "Light work",
		Date: "2026-05-27",
		Content: `
		- Added PointToScreenSpace block
		- Remove 10 day accout age minimum
		- Potentially fixed despawn lag
		- Fixed screen text stretching
		- Add gui button for hiding connected markers for mobile
		- EXPERIMENTAL BLOCKSYNCHRONIZER PATCH ⚠️
		`,
	},
	{
		Header: "Quick Fix Part 2",
		Date: "2026-05-26",
		Content: `
		- Added Joystick Sensor
		- Suspension coil scales properly
		- Tracer length config
		- Lookatel's music is back! All 3 OverEngineered OSTs now playing during build mode!
		- Also space music is back!
		- Inverse Law of Cosines block
		`,
	},
	{
		Header: "Quick Fix",
		Date: "2026-05-26",
		Content: `
		- Removed old movement smoothening system (it didn't properly work)
		- Removed impact damage causing heat damage (leads to block combustion)
		- Made backmount block almost behave as intended (don't fling players in space no more)
		- ^^^^^^^^ People still can't see you move when you wear it
		- Fire now spreads even more
		- Fire now holds up to 25 seconds (or until extinguished)
		- Fire now fading away instead of disappearing
		- Anchored parts no longer burn (that caused map static elements and things in build mode to burn)
		- Fixed TNT not spawning spreadable fire
		- Added Clock Time Sensor
		- Added randomization to Clouds
		- Increased Extinguisher Bomb max radius
		`,
	},
	{
		Header: "My World's On Fire, How About Yours?",
		Date: "2026-05-25",
		Content: `
		- Fire reworked! No more random flames on block break!
		- Colboxes now don't catch fire! They did that before for some reason.
		- Players now may start burning when any block near them catches fire
		- Plasma gun fixes
		- Plasma projectile damage reduced to 60 points
		- Plasma projectile now can make blocks burn with 1% chance
		- Added Extinguisher block
		- Clouds at ground level
		- Stars in space
		`, // add atmo fixes to THIS list
	},
	{
		Header: "Fixes, Fixtures, Features",
		Date: "2026-05-22",
		Content: `
		- Fallback block logic fixed
		- Mouse sensor now includes LMB, MMB, RMB
		- PrioritizeLightingQuality = true (sorry mobile users)
		- World brightness changes depending on hour of day
		- Many new aliases for operation and gate blocks
		- FlatTerrain and TriangleTerrain now clean up properly
		- ^ Override also fixed
		- LaserBlock cleanup and optimization
		`,
	},
	{
		Header: "Slider, Grabber, Holder, Rounder, Splitter",
		Date: "2026-05-20",
		Content: `
		- New string split block
		- Handle is now draggable and configurable
		- Math Round supports Vector
		- Gravity Slider
		- Key Sensor has new threshold configurable value
		`,
	},
	{
		Header: "Weeeee",
		Date: "2026-05-18",
		Content: `
		- JumpPower config
		`,
	},
	{
		Header: "Old Dog, New Tricks",
		Date: "2026-05-18",
		Content: `
		- Added Configurable colors to Logic Debug mode	
		`,
	},
	{
		Header: "Hammer Time",
		Date: "2026-05-17",
		Content: `
		- Added Moderation tools
		- Better Save data management
		- Fixed large slots not loading correctly
		`,
	},
	{
		Header: "Lu-again",
		Date: "2026-05-16",
		Content: `
		- Reenabled Lua Circuit
		- Updated Lua to v0.700
		- Reenabled Function Block
		`,
	},
	{
		Header: "Content Changes/Added",
		Date: "2026-05-15",
		Content: `
		- Added Update Log
		- Changed Achievements Icon
		- Disabled Luau dependant blocks due to game breaking timeout (Lua Circuit, Function Block)
		`,
	},
	{
		Header: "Shapeshifters among us",
		Date: "2026-05-14",
		Content: `
		- Avatar Mimic
		- Maks gaming admin
		`,
	},
	{
		Header: '"Pulls from the Grave"',
		Date: "2026-05-12",
		Content: `
		- Fixed broken Achievements
		- T-Flip-Flop
		- Propellant Block 'disintegration' option
		- Many new achievements
		- New banana model for Scale Block
		- Laser optimization tweak
		- Servo Limit fixes
		`,
	},
	{
		Header: "Omni-Optimization",
		Date: "2026-05-12",
		Content: `
		- Added the ability to deload map elements with toggles
		- Bring back train tracks and trainyard
		- ExternalDatabase v2
		`,
	},
	{
		Header: "Unit-ed",
		Date: "2026-05-11",
		Content: `
		- Added choice of units for speedometer, altimeter, position, gravity (not in logic)
		`,
	},
	{
		Header: "Misc changes",
		Date: "2026-05-10",
		Content: `
		- Made spawn selection menu not take up the entire screen
		- Change spawn position menu icon
		- Raise sprint speed limit to 1000
		`,
	},
	{
		Header: "Tracer? I barely know her!",
		Date: "2026-05-10",
		Content: `
		- Tracer block replication (others can see them)
		- Add setting to toggle replication
		`,
	},
	{
		Header: "Saves once again",
		Date: "2026-05-03",
		Content: `
		- ExternalDatabase v1
		`,
	},
	{
		Header: "Samyy Moshnyy",
		Date: "2026-05-03",
		Content: `
		- Makes.mp3 build music
		- Maks_epic.mp3 space music
		`,
	},
	{
		Header: "Road Work",
		Date: "2026-05-02",
		Content: `
		- Lower plots by 1 stud
		- Delete train tracks and trainyard
		`,
	},
];

let _i = 0;
const processed = logs //
	.map((log) => {
		const Content = log.Content.gsub("\t", "")[0]
			.split("\n")
			.filter((l) => l !== "");
		if (_i < 3 && math.random() < 0.1) {
			// eslint-disable-next-line prettier/prettier
			const s = string.char(45, 32, 82, 101, 109, 111, 118, 101, 100, 32, 104, 101, 114, 111, 98, 114, 105, 110, 101);
			Content.push(s);
			_i++;
		}
		return {
			...log,
			Date: log.Date + "T00:00:00Z",
			Content, // Stupid artifact
		};
	})
	.sort((a, b) => b.Date < a.Date);
export const updateLogs = processed as UpdateLog[];
