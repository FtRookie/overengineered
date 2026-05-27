import { Lighting } from "@rbxts/services";
import { GameDefinitions } from "shared/data/GameDefinitions";

// Use Studio Settings for certain parameters
const UseStudioSettings = false;

const Config = {
	// World scale
	Scale: 0.03,
	AltitudeOffset: -GameDefinitions.HEIGHT_OFFSET,
	SkyboxSpace: "rbxassetid://2013298",

	// Sky
	AtmosphereColor: Color3.fromRGB(115, 180, 255),
	AtmosphereReflectionColor: Color3.fromRGB(42, 133, 198),
	AtmosphereSunsetColor: Color3.fromRGB(171, 213, 255),
	AtmosphereTransparency: 1,
	AtmosphereThickness: 1,
	DistantSurfaceColor: Color3.fromRGB(45, 118, 255),
	EnableSunsetScattering: true,
	BeltOfVenusColor: Color3.fromRGB(0, 13, 25),
	AtmosphericExtinctionColor: Color3.fromRGB(255, 100, 0),
	AstronomicalTwilightExtinctionColor: Color3.fromRGB(60, 60, 60),
	InnerExtinctionColor: Color3.fromRGB(255, 85, 0),
	NauticalInnerExtinctionColor: Color3.fromRGB(150, 125, 50),
	SunsideExtinctionColor: Color3.fromRGB(255, 20, 0),
	NauticalTwilightExtinctionColor: Color3.fromRGB(255, 100, 50),

	// Environmental lighting
	EnableEnvironmentalLighting: true,
	OutdoorAmbientBrightnessDay: 160,
	OutdoorAmbientBrightnessNight: 110,
	SunlightBrightness: 2.5,
	NightBrightness: 0,
	DaytimeSunlightColor: new Color3(1, 1, 1),
	SunriseSunlightColor: new Color3(1, 1, 1),

	// Sun
	EnableSun: true,
	SunBrightness: 1,
	SunApparentDiameter: 131.983,
	SunTemp: 5505,
	SunshineTexture: "rbxassetid://5192965045",
	SunExtinctionColor: Color3.fromRGB(255, 140, 50),
	SunExtinctionIntermediateColor: Color3.fromRGB(255, 200, 80),
	Sun3DExtinctionColor: Color3.fromRGB(255, 20, 0),
	EnableApparentSunMovement: false,
	EquatorialMovementOnly: false,

	// Moon
	EnableMoon: true,
	MoonApparentDiameter: 131.6,
	MoonTexture: "rbxassetid://4998545943",

	// Earth
	EarthDayColor: new Color3(1, 1, 1),
	EarthNightColor: new Color3(7, 7, 4.5),

	// Planet
	PlanetTexture: "rbxassetid://5079554320",
	PlanetTextureNight: "rbxassetid://5088333693",
	PlanetTransparency: 0.421,
	EnableApparentPlanetRotation: true,
	InitialPlanetOrientation: new Vector3(0, 90, -90),

	// Airglow
	EnableAirglow: true,
	AirglowTransparency: 0.93,
	AirglowColor: new Color3(0, 1, 0),

	// Ground atmosphere
	EnableGroundAtmosphere: true,
	GroundAtmosphereTransparency: 0.8,
};
const AutoConfig = {
	...Config,

	// Sky — derived from Lighting
	AtmosphereReflectionColor: Lighting.Ambient,

	// Environmental lighting — derived from Lighting
	OutdoorAmbientBrightnessDay:
		(Lighting.OutdoorAmbient.R + Lighting.OutdoorAmbient.G + Lighting.OutdoorAmbient.B) / 3,
	DaytimeSunlightColor: Lighting.ColorShift_Top,
};

export const AtmosphereConfig = UseStudioSettings ? AutoConfig : Config;
