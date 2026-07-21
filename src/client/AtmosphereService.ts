import { Lighting, Players, RunService, Workspace } from "@rbxts/services";
import { AtmosphereConfig as Config } from "client/3DAtmosphereConfig";
import { HostedService } from "engine/shared/di/HostedService";
import { Color3s } from "engine/shared/fixes/Color3.propmacro";
import { Colors } from "shared/Colors";
import type { PlayerDataStorage } from "client/PlayerDataStorage";

/*
You really do not want to edit this file, it's weird de-obfuscated code
full of a ton of constants and strange math... just edit 3DAtmosphereConfig.ts
*/

// ── Instance hierarchy types (dynamic model children not known to the type system) ──────────

type ExtPart1 = BasePart & {
	Attachment1a: Attachment;
	Attachment2b: Attachment;
	Attachment3a: Attachment;
	Attachment4b: Attachment;
	Attachment5a: Attachment;
	Attachment6b: Attachment;
	Attachment7a: Attachment;
	Attachment8b: Attachment;
};

type ExtPart2 = BasePart & {
	Beam1: Beam;
	Beam2: Beam;
	Beam3: Beam;
	Beam4: Beam;
	Beam5: Beam;
	Beam6: Beam;
	Beam7: Beam;
	Beam8: Beam;
	Attachment1b: Attachment;
	Attachment2a: Attachment;
	Attachment3b: Attachment;
	Attachment4a: Attachment;
	Attachment5b: Attachment;
	Attachment6a: Attachment;
	Attachment7b: Attachment;
	Attachment8a: Attachment;
};

type ExtSunsetPart2 = ExtPart2 & {
	Beam9: Beam;
	Beam10: Beam;
	Beam11: Beam;
	Beam12: Beam;
};

type ExtModel = Instance & {
	AtmosphericExtinction1: ExtPart1;
	AtmosphericExtinction2: ExtPart2;
};

type ExtSunsetModel = Instance & {
	AtmosphericExtinction1: ExtPart1;
	AtmosphericExtinction2: ExtSunsetPart2;
};

type Sun3DPart = Part & {
	Mesh: SpecialMesh;
	SunsetLight: SunsetLightGui;
};

type SunsetLightGui = Instance & {
	Light: ImageLabel;
	ExtentsOffsetWorldSpace: Vector3;
	StudsOffsetWorldSpace: Vector3;
	Brightness: number;
	Size: UDim2;
};

type AtmosphereModel = Folder & {
	AtmosphericExtinction: ExtModel;
	AtmosphericExtinctionSunset: ExtSunsetModel;
	Airglow: Part & {
		Mesh: SpecialMesh;
	};
	Atmosphere: Part & {
		Mesh: SpecialMesh;
	};
	BottomAtmosphere: Part & {
		Mesh: SpecialMesh;
		Decal: Decal;
	};
	DistantSurface: Part & {
		Mesh: SpecialMesh;
	};
	EarthSurface: Part & {
		Decal: Decal;
		Mesh: FileMesh;
	};
	EarthTerminator: Part & {
		Decal: Decal;
		Mesh: FileMesh;
	};
	EarthTerminator2: Part & {
		Decal: Decal;
		Mesh: FileMesh;
	};
	Sun3D: Sun3DPart;
};

// Module-level pre-allocated constants — avoids per-frame GC pressure
const NSEQ_HIDDEN = new NumberSequence(1);
const EXTENT_POS = new Vector3(5, 0, 0);
const EXTENT_NEG = new Vector3(-5, 0, 0);
const IS_DEFAULT_ATMO_COLOR = Config.AtmosphereColor === Color3.fromRGB(115, 180, 255);

/**
 * Translates the 3D Atmosphere LocalScript into a HostedService.
 *
 * AtmosphericExtinction and AtmosphericExtinctionSunset are pre-built Workspace instances
 * (serialized as rbxmx, assembled into the place via structure.json).
 * Sun3D is cloned from the 3D Atmosphere LocalScript in ReplicatedFirst — that script must
 * remain in the place for the constructor to succeed. Clear or disable its Source to prevent it
 * from running alongside this service.
 */
@injectable
export class AtmosphereService extends HostedService {
	private camera() {
		return Workspace.CurrentCamera!;
	}

	// Main scene instances
	private readonly atmosphere: Part;
	private readonly distantSurface: Part;
	private readonly surfaceMesh: SpecialMesh;
	private readonly mesh: SpecialMesh;
	private readonly skyGround: Sky;
	private readonly skySpace: Sky;
	private skyIsGround = true;
	private readonly clouds: Clouds;
	private readonly initialCloudDensity: number;

	// Earth
	private readonly earth: Part;
	private readonly earthMesh: FileMesh;
	private readonly earthTexture: Decal;
	private readonly earthTerminator: Part;
	private readonly earthTerminator2: Part;
	private readonly earthTerminatorMesh: FileMesh;
	private readonly earthTerminatorMesh2: FileMesh;
	private readonly earthTerminatorTexture: Decal;
	private readonly earthTerminatorTexture2: Decal;

	// Atmosphere layers
	private readonly airglowLayer: Part;
	private readonly airglowMesh: SpecialMesh;
	private readonly bottomAtmosphere: Part;
	private readonly bottomAtmosphereMesh: SpecialMesh;
	private readonly bottomAtmosphereDarkness: Decal;

	// Model children cloned from the Atmosphere LocalScript in ReplicatedFirst
	private readonly extinction: ExtModel;
	private readonly extinctionSunset: ExtSunsetModel;
	private readonly sun3D: Sun3DPart;

	// Beam containers (children of the cloned extinction models)
	private readonly extB1: ExtPart1;
	private readonly extB2: ExtPart2;
	private readonly extSB1: ExtPart1;
	private readonly extSB2: ExtSunsetPart2;

	// Pre-built beam arrays
	private readonly extBeams: Beam[];
	private readonly extBeams14: Beam[];
	private readonly extBeams58: Beam[];
	private readonly extSBeams: Beam[];
	private readonly beltBeams: Beam[];
	private readonly sunsetInnerBeams: Beam[];
	private readonly extraBeamSrc: Beam[];
	private readonly extraBeams: Beam[];
	private readonly extAtt: [Attachment, number][];
	private readonly extSAtt: [Attachment, number][];

	// Raycast params (pre-allocated, mutated per-frame)
	private readonly rayParams: RaycastParams;
	private readonly rayParamsOne: Instance[];
	private readonly rayParamsTwo: Instance[];

	// Character state
	private character!: Model;
	private humanoidRootPart!: BasePart;

	// Sun GUI (recreated per character)
	private sunTextureGui!: ScreenGui;
	private sunTexture!: ImageLabel;
	private sunTexture2!: ImageLabel;
	private sunTexture3!: ImageLabel;

	// Inter-frame carry state
	private fogEndRatio = 1;
	private airglowTransparency = 0;
	private extinctionWidthEquation = 40000;
	private extinctionOrientationEquation = 81;
	// persist so x <= 0 (below sea level) keeps the last finite Earth geometry instead of NaN
	private earthMeshEquation = 0;
	private earthPosVec: Vector3 = Vector3.zero;
	// Set by the Sunshine callback (runs at Last priority), read by the RenderStepped loop
	private horizElevSunsetDiff10 = 10;
	private sunOffsetX = 0;
	private sunOffsetZ = 0;
	private initialTime: number;
	private initialGL: number;
	private clockTimeExists: boolean;

	// Clouds
	private cloudDensity: number;
	private cloudCoverage: number;
	private cloudDensityTarget: number;
	private cloudCoverageTarget: number;
	private cloudConfig: TerrainConfiguration["cloud"];

	constructor(@inject playerData: PlayerDataStorage) {
		super();

		this.cloudConfig = playerData.config.get().environment.terrain.cloud;
		this.event
			.addObservable(playerData.config.fReadonlyCreateBased((c) => c.environment.terrain.cloud))
			.subscribe((c) => (this.cloudConfig = c));

		// Remove any engine Atmosphere instances (they break legacy fog)
		for (const v of Lighting.GetDescendants()) {
			if (v.IsA("Atmosphere")) v.Destroy();
		}

		const model = Workspace.WaitForChild("Atmosphere") as AtmosphereModel;
		this.atmosphere = model.Atmosphere;
		this.mesh = model.Atmosphere.Mesh;
		this.distantSurface = model.DistantSurface;
		this.surfaceMesh = model.DistantSurface.Mesh;
		this.distantSurface.Transparency = 0;

		// Sky (replaces Roblox default sun/moon)
		const skyGround = Lighting.FindFirstChildOfClass("Sky") ?? new Instance("Sky");
		skyGround.MoonAngularSize = 0.57;
		skyGround.SunAngularSize = 1.44;
		skyGround.Parent = Lighting;
		this.skyGround = skyGround;

		const skySpace = new Instance("Sky");
		skySpace.SkyboxBk = Config.SkyboxSpace;
		skySpace.SkyboxDn = Config.SkyboxSpace;
		skySpace.SkyboxFt = Config.SkyboxSpace;
		skySpace.SkyboxLf = Config.SkyboxSpace;
		skySpace.SkyboxRt = Config.SkyboxSpace;
		skySpace.SkyboxUp = Config.SkyboxSpace;
		skySpace.MoonAngularSize = 0.57;
		skySpace.SunAngularSize = 1.44;
		this.skySpace = skySpace;

		const clouds = Workspace.Terrain.FindFirstChildOfClass("Clouds") ?? new Instance("Clouds");
		clouds.Parent = Workspace.Terrain;
		this.clouds = clouds;
		this.initialCloudDensity = clouds.Density;
		this.cloudDensity = clouds.Density;
		this.cloudCoverage = clouds.Cover;
		this.cloudDensityTarget = clouds.Density;
		this.cloudCoverageTarget = clouds.Cover;

		Lighting.FogColor = Color3.fromRGB(115, 152, 255);
		Lighting.FogEnd = 100000;
		Lighting.FogStart = 0;

		// ── Earth ─────────────────────────────────────────────────────────
		this.earth = model.EarthSurface;
		this.earth.Orientation = Config.InitialPlanetOrientation;
		this.earthMesh = model.EarthSurface.Mesh;
		this.earthMesh.TextureId = "rbxassetid://2013298"; // base cloud layer, set once (lua never changes it in-loop)
		this.earthTexture = model.EarthSurface.Decal;
		this.earthTerminator = model.EarthTerminator;
		this.earthTerminatorMesh = model.EarthTerminator.Mesh;
		this.earthTerminatorTexture = model.EarthTerminator.Decal;
		this.earthTerminator2 = model.EarthTerminator2;
		this.earthTerminatorMesh2 = model.EarthTerminator2.Mesh;
		this.earthTerminatorTexture2 = model.EarthTerminator2.Decal;

		// ── Extinction models (pre-built Workspace instances from rbxmx) ──────────
		this.extinction = model.AtmosphericExtinction;
		this.extinctionSunset = model.AtmosphericExtinctionSunset;

		// ── Airglow ───────────────────────────────────────────────────────
		this.airglowLayer = model.Airglow;
		this.airglowMesh = model.Airglow.Mesh;

		// ── Bottom atmosphere ─────────────────────────────────────────────
		this.bottomAtmosphere = model.BottomAtmosphere;
		this.bottomAtmosphereMesh = model.BottomAtmosphere.Mesh;
		this.bottomAtmosphereDarkness = model.BottomAtmosphere.Decal;

		// ── Sun 3D model ──────────────────────────────────────────────────
		this.sun3D = model.Sun3D;
		this.sun3D.Transparency = 0.011;

		Lighting.EnvironmentDiffuseScale = 0;

		// ── Beam containers ───────────────────────────────────────────────
		const extB1 = this.extinction.AtmosphericExtinction1;
		const extB2 = this.extinction.AtmosphericExtinction2;
		const extSB1 = this.extinctionSunset.AtmosphericExtinction1;
		const extSB2 = this.extinctionSunset.AtmosphericExtinction2;
		this.extB1 = extB1;
		this.extB2 = extB2;
		this.extSB1 = extSB1;
		this.extSB2 = extSB2;

		this.extBeams = [
			extB2.Beam1,
			extB2.Beam2,
			extB2.Beam3,
			extB2.Beam4,
			extB2.Beam5,
			extB2.Beam6,
			extB2.Beam7,
			extB2.Beam8,
		];
		this.extBeams14 = [extB2.Beam1, extB2.Beam2, extB2.Beam3, extB2.Beam4];
		this.extBeams58 = [extB2.Beam5, extB2.Beam6, extB2.Beam7, extB2.Beam8];
		this.extSBeams = [
			extSB2.Beam1,
			extSB2.Beam2,
			extSB2.Beam3,
			extSB2.Beam4,
			extSB2.Beam5,
			extSB2.Beam6,
			extSB2.Beam7,
			extSB2.Beam8,
		];
		this.beltBeams = [extSB2.Beam3, extSB2.Beam4, extSB2.Beam7, extSB2.Beam8];
		this.sunsetInnerBeams = [extSB2.Beam1, extSB2.Beam2, extSB2.Beam5, extSB2.Beam6];
		this.extraBeamSrc = [extSB2.Beam1, extSB2.Beam2, extSB2.Beam1, extSB2.Beam2];
		this.extraBeams = [extSB2.Beam9, extSB2.Beam10, extSB2.Beam11, extSB2.Beam12];

		this.extAtt = [
			[extB2.Attachment2a, 90],
			[extB1.Attachment3a, 0],
			[extB2.Attachment4a, -90],
			[extB2.Attachment1b, 90],
			[extB1.Attachment2b, 0],
			[extB2.Attachment3b, -90],
			[extB1.Attachment1a, 180],
			[extB1.Attachment4b, 180],
			[extB2.Attachment6a, 90],
			[extB1.Attachment7a, 0],
			[extB2.Attachment8a, -90],
			[extB2.Attachment5b, 90],
			[extB1.Attachment6b, 0],
			[extB2.Attachment7b, -90],
			[extB1.Attachment5a, 180],
			[extB1.Attachment8b, 180],
		];
		this.extSAtt = [
			[extSB2.Attachment2a, 0],
			[extSB1.Attachment3a, -90],
			[extSB2.Attachment4a, -180],
			[extSB2.Attachment1b, 0],
			[extSB1.Attachment2b, -90],
			[extSB2.Attachment3b, 180],
			[extSB1.Attachment1a, 90],
			[extSB1.Attachment4b, 90],
			[extSB2.Attachment6a, 0],
			[extSB1.Attachment7a, -90],
			[extSB2.Attachment8a, -180],
			[extSB2.Attachment5b, 0],
			[extSB1.Attachment6b, -90],
			[extSB2.Attachment7b, 180],
			[extSB1.Attachment5a, 90],
			[extSB1.Attachment8b, 90],
		];

		// ── Raycast params ────────────────────────────────────────────────
		const rayParams = new RaycastParams();
		rayParams.FilterType = Enum.RaycastFilterType.Exclude;
		this.rayParams = rayParams;
		this.rayParamsOne = [this.atmosphere];
		this.rayParamsTwo = [this.atmosphere, this.atmosphere]; // second slot replaced per-frame

		// ── Server clock / initial time ───────────────────────────────────
		const findServerClock = Workspace.FindFirstChild("ServerClockTime") as NumberValue | undefined;
		this.clockTimeExists = findServerClock !== undefined;
		if (this.clockTimeExists && Config.EnableApparentSunMovement) {
			this.initialTime = (Workspace.FindFirstChild("ServerClockTime") as NumberValue).Value % 24;
		} else {
			this.initialTime = Lighting.ClockTime;
		}
		this.initialGL = Lighting.GeographicLatitude;

		// ── Character setup ───────────────────────────────────────────────
		const player = Players.LocalPlayer;
		const initialChar = (player.Character ?? player.CharacterAdded.Wait()[0]) as Model;
		this.setupCharacter(initialChar);
		this.event.subscribe(player.CharacterAdded, (char) => this.setupCharacter(char as Model));

		// ── Main render loop ──────────────────────────────────────────────
		this.event.subscribe(RunService.PreRender, (dt) => this.onRenderStep(dt));
	}

	private setupCharacter(character: Model) {
		this.character = character;
		this.humanoidRootPart = character.WaitForChild("HumanoidRootPart") as BasePart;
		this.sunOffsetX = 0;
		this.sunOffsetZ = 0;
		this.earth.Orientation = Config.InitialPlanetOrientation;

		const playerGui = Players.LocalPlayer.FindFirstChildOfClass("PlayerGui")!;
		let sunGui = playerGui.FindFirstChild("Sun") as ScreenGui | undefined;
		if (!sunGui) {
			sunGui = new Instance("ScreenGui");
			sunGui.DisplayOrder = -1;
			sunGui.Name = "Sun";
			sunGui.Parent = playerGui;
		}
		this.sunTextureGui = sunGui;

		const sunTexture = new Instance("ImageLabel");
		sunTexture.Image = Config.SunshineTexture;
		sunTexture.BackgroundTransparency = 1;
		sunTexture.Size = new UDim2(0, 1000, 0, 1000);
		sunTexture.AnchorPoint = new Vector2(0.5, 0.5);
		sunTexture.ZIndex = 1;
		sunTexture.Parent = sunGui;
		this.sunTexture = sunTexture;

		const sunTexture2 = new Instance("ImageLabel");
		sunTexture2.Image = "rbxassetid://5200654205";
		sunTexture2.BackgroundTransparency = 1;
		sunTexture2.Size = UDim2.fromOffset(2100 / this.camera().FieldOfView, 2100 / this.camera().FieldOfView);
		sunTexture2.AnchorPoint = new Vector2(0.5, 0.5);
		sunTexture2.ZIndex = 2;
		sunTexture2.Parent = sunGui;
		this.sunTexture2 = sunTexture2;

		const sunTexture3 = sunTexture.Clone();
		sunTexture3.Parent = sunGui;
		this.sunTexture3 = sunTexture3;

		RunService.UnbindFromRenderStep("Sunshine");
		RunService.BindToRenderStep("Sunshine", Enum.RenderPriority.Last.Value, () => this.onSunshineStep());
	}

	private onSunshineStep() {
		const sun3D = this.sun3D;

		if (Config.EnableSun) {
			this.sunTextureGui.Enabled = true;
			this.skyGround.SunTextureId = this.skySpace.SunTextureId = "rbxasset://sky/sun.jpg";
		} else {
			this.sunTextureGui.Enabled = false;
			this.skyGround.SunTextureId = this.skySpace.SunTextureId = "";
		}

		const scaleFactor = Config.Scale ** -1;
		const altOff = Config.AltitudeOffset;
		const camCF = this.camera().CFrame;
		const camPos = camCF.Position;
		const x = (camPos.Y + altOff) * scaleFactor;
		const altExp = 2 ** (-x / 500000);
		const sunBright = Config.SunBrightness;
		const sunDirV = Lighting.GetSunDirection();
		const sunPosition = camPos.add(sunDirV.mul(999));
		const [screenPosition, isVisible] = this.camera().WorldToScreenPoint(sunPosition);
		const camToSunDir = sunDirV.mul(999).sub(camCF.LookVector);
		const sunElevation = math.deg(math.atan(camToSunDir.Y / math.sqrt(camToSunDir.X ** 2 + camToSunDir.Z ** 2)));
		const horizElev = -math.deg(math.acos(20925656.2 / (20925656.2 + x)));
		const camZoomDist = this.camera().Focus.Position.sub(camPos).Magnitude;
		const horizElevSunsetDiff = sunElevation - horizElev;
		const apparentDiameter = Config.SunApparentDiameter;
		const [sunExtIR, sunExtIG, sunExtIB] = Color3s.toTuple(Config.SunExtinctionIntermediateColor.mul(255));

		const sunsetFOVTransScale =
			1 - math.clamp(((this.camera().FieldOfView - 5) / 5 + 1) * (horizElevSunsetDiff ** 3 / 10), 0, 1);
		const H1 = 6 * altExp;

		if (horizElevSunsetDiff <= 0) {
			this.horizElevSunsetDiff10 = 0;
		} else if (horizElevSunsetDiff <= H1) {
			this.horizElevSunsetDiff10 = horizElevSunsetDiff;
		} else {
			this.horizElevSunsetDiff10 = H1;
		}

		const hesd10 = this.horizElevSunsetDiff10;
		const hesd10Ratio = hesd10 / H1;
		const hesd10Ratio3 = (math.clamp(hesd10, 0, 2) * 3) / H1;
		const hesd10Ratio15 = (math.clamp(hesd10, 0, 1) * 6) / H1;

		if (camZoomDist <= 1.1) {
			this.rayParamsTwo[1] = this.character;
			this.rayParams.FilterDescendantsInstances = this.rayParamsTwo;
		} else {
			this.rayParams.FilterDescendantsInstances = this.rayParamsOne;
		}

		const obstructed = Workspace.Raycast(camPos, sunDirV.mul(999), this.rayParams);
		const isObstructed = obstructed !== undefined;

		const [sunTex, sunTex2, sunTex3] = [this.sunTexture, this.sunTexture2, this.sunTexture3];

		sunTex.Position = UDim2.fromOffset(screenPosition.X, screenPosition.Y);
		sunTex2.Position = UDim2.fromOffset(screenPosition.X, screenPosition.Y);
		sunTex3.Position = UDim2.fromOffset(screenPosition.X, screenPosition.Y);

		if (isVisible) {
			const altSunFadeRate = math.clamp(-0.00000133333333333 * x + 0.75666666666666, 0.55, 0.75);
			sunTex.ImageTransparency =
				1 -
				math.clamp(
					(2 - 2.6111111111111 * altSunFadeRate) *
						30 *
						(hesd10Ratio3 + 0.55 - altSunFadeRate - sunsetFOVTransScale),
					0,
					1,
				);
			sunTex.TweenSize(
				UDim2.fromOffset(
					100 + hesd10Ratio * 900 * sunBright * (-((this.camera().FieldOfView - 70) / 200) + 1),
					100 + hesd10Ratio * 900 * sunBright * (-((this.camera().FieldOfView - 70) / 200) + 1),
				),
				Enum.EasingDirection.Out,
				Enum.EasingStyle.Quad,
				0.1,
				true,
			);
			sunTex2.ImageTransparency =
				1 -
				math.clamp(
					(2 - 2.6111111111111 * altSunFadeRate) *
						30 *
						(hesd10Ratio15 + 0.55 - altSunFadeRate - sunsetFOVTransScale),
					0,
					1,
				);
			const _V1 = 2.5 * this.camera().ViewportSize.Y * apparentDiameter;
			sunTex2.TweenSize(
				UDim2.fromOffset(
					(_V1 / 31.983 / this.camera().FieldOfView) * sunBright,
					(_V1 / 31.9 / this.camera().FieldOfView) * sunBright,
				),
				Enum.EasingDirection.Out,
				Enum.EasingStyle.Quad,
				0.1,
				true,
			);

			const sunApparentDiamRatio = apparentDiameter / 31.983;
			sun3D.SunsetLight.Light.ImageTransparency = hesd10Ratio;
			sun3D.Mesh.Scale = new Vector3(12.25, 10.5 + 1.75 * hesd10Ratio, 12.25).mul(sunApparentDiamRatio);

			if (isObstructed || sunElevation <= horizElev || horizElev !== horizElev) {
				sunTex.TweenSize(UDim2.fromOffset(-5, -5), Enum.EasingDirection.Out, Enum.EasingStyle.Quad, 0.1, true);
				sunTex2.TweenSize(UDim2.fromOffset(-5, -5), Enum.EasingDirection.Out, Enum.EasingStyle.Quad, 0.1, true);
			}

			sunTex3.Size = UDim2.fromOffset(sunTex.Size.X.Offset / 2, sunTex.Size.Y.Offset / 2);
			sunTex3.ImageColor3 = sunTex.ImageColor3.mul(1.5);
			sunTex3.Position = sunTex.Position;
			sunTex3.Rotation = sunTex.Rotation;
			sunTex3.ImageTransparency = sunTex.ImageTransparency;
		} else {
			sunTex.TweenSize(UDim2.fromOffset(-5, -5), Enum.EasingDirection.Out, Enum.EasingStyle.Quad, 0.1, true);
			sunTex2.TweenSize(UDim2.fromOffset(-5, -5), Enum.EasingDirection.Out, Enum.EasingStyle.Quad, 0.1, true);
			sunTex3.Size = sunTex.Size;
		}

		if (sunTex.Size.X.Offset <= 0) {
			sunTex.Visible = false;
			sunTex2.Visible = false;
			sunTex3.Visible = false;
		} else {
			sunTex.Visible = true;
			sunTex2.Visible = true;
			sunTex3.Visible = true;
		}

		// Sun temperature → RGB
		let tempValue = math.clamp(Config.SunTemp, 2001, math.huge);
		if (!Config.EnableSunsetScattering) tempValue = Config.SunTemp;
		const temp = (tempValue + 1095) / 100;
		let [sunR, sunG, sunB]: number[] = [];
		if (tempValue <= 0) {
			sunR = 255;
			sunG = 76;
			sunB = 0;
		} else if (tempValue <= 1000) {
			sunR = 255;
			sunG = 99.4708025861 * math.log(temp) - 161.1195681661;
			sunB = 0;
		} else if (tempValue <= 2000) {
			sunR = 255;
			sunG = 104.492161993939 * math.log(temp - 2) - 0.445969504695791 * temp - 155.254855627092;
			sunB = 0;
		} else if (tempValue <= 6600) {
			sunR = 255;
			sunG = 104.492161993939 * math.log(temp - 2) - 0.445969504695791 * temp - 155.254855627092;
			sunB = 115.679944010661 * math.log(temp - 10) + 0.82740960640074 * temp - 254.769351841209;
		} else if (tempValue <= 40000) {
			sunR = -40.2536630933213 * math.log(temp - 55) + 0.114206453784165 * temp + 351.976905668057;
			sunG = -28.0852963507957 * math.log(temp - 50) + 0.0794345653666234 * temp + 325.449412571197;
			sunB = 255;
		} else {
			sunR = 162;
			sunG = 192;
			sunB = 255;
		}

		const H2 = 3 * altExp;
		if (Config.EnableSunsetScattering) {
			const intermediateColor = new Color3(
				math.clamp(
					(((sunR - math.clamp(sunExtIR, 0, sunR - 1)) / (H2 * altExp)) *
						(math.clamp(hesd10, H2, H2 * 2) - H2) +
						sunExtIR) /
						255,
					0,
					1,
				),
				math.clamp(
					(((sunG - math.clamp(sunExtIG, 0, sunG - 1)) / (H2 * altExp)) *
						(math.clamp(hesd10, H2, H2 * 2) - H2) +
						sunExtIG) /
						255,
					0,
					1,
				),
				math.clamp(
					(((sunB - math.clamp(sunExtIB, 0, sunB - 1)) / (H2 * altExp)) *
						(math.clamp(hesd10, H2, H2 * 2) - H2) +
						sunExtIB) /
						255,
					0,
					1,
				),
			);
			sunTex.ImageColor3 = Config.SunExtinctionColor.Lerp(intermediateColor, hesd10 / (6 * altExp));
		} else {
			sunTex.ImageColor3 = Config.SunExtinctionColor.Lerp(
				Color3.fromRGB(sunR, sunG, sunB),
				hesd10 / (6 * altExp),
			);
		}
		sunTex.Rotation = -((screenPosition.X - this.camera().ViewportSize.X / 2) / 100);

		// 3D sunset light direction
		if (Lighting.ClockTime < 12) {
			sun3D.SunsetLight.ExtentsOffsetWorldSpace = EXTENT_POS;
		} else {
			sun3D.SunsetLight.ExtentsOffsetWorldSpace = EXTENT_NEG;
		}

		let aboveHorizon = horizElevSunsetDiff > -2;
		if (x > 5000) {
			aboveHorizon = horizElevSunsetDiff > 0;
		} else if (x > 1000) {
			aboveHorizon = horizElevSunsetDiff > -0.5;
		}

		if (Config.EnableSun) {
			if (aboveHorizon && horizElevSunsetDiff < H1) {
				sun3D.Position = camPos;
				sun3D.Mesh.Offset = sunDirV.mul(70000);
			} else {
				sun3D.Position = new Vector3(0, -200000, 0);
				sun3D.Mesh.Offset = sun3D.Position;
			}
			sun3D.SunsetLight.StudsOffsetWorldSpace = sun3D.Mesh.Offset;
			sun3D.SunsetLight.Brightness = math.clamp(400 - x / 28, 40, 400);
			sun3D.SunsetLight.Size = UDim2.fromScale(
				10000 * sunBright,
				math.clamp(-x / 16 + 10000, 4000, 10000) * sunBright,
			);
			sun3D.SunsetLight.Light.ImageColor3 = Config.Sun3DExtinctionColor;
		} else {
			sun3D.Position = camPos.sub(new Vector3(0, 100000, 0));
		}
	}

	private onRenderStep(dt: number) {
		const scaleFactor = Config.Scale ** -1;
		const altOff = Config.AltitudeOffset;
		const atmoThinness = Config.AtmosphereTransparency;
		const atmoHeight = (Config.AtmosphereThickness ** -1) ** 0.0625;

		const camCF = this.camera().CFrame;
		const camPos = camCF.Position;
		const [camPosX, camPosY, camPosZ] = [camPos.X, camPos.Y, camPos.Z];

		const x = (camPosY + altOff) * scaleFactor;
		const altExp = 2 ** (-x / 500000);
		const xOverSF = camPosY + altOff;
		const altitudeFade =
			xOverSF <= 0
				? 0
				: xOverSF <= 2500
					? xOverSF / 2500
					: xOverSF <= 15000
						? 1
						: xOverSF <= 20000
							? 1 - (xOverSF - 15000) / 5000
							: 0;

		const H1 = 6 * altExp;
		const H3 = H1 * (5 / 3);
		const H15 = H1 * 2.5;

		const [colorR, colorG, colorB] = Color3s.toTuple(Config.AtmosphereColor.mul(255));
		const [colorRSunset, colorGSunset, colorBSunset] = Color3s.toTuple(Config.AtmosphereSunsetColor.mul(255));

		let sunBright: number = Config.SunBrightness;

		const sunDirV = Lighting.GetSunDirection();
		const camToSunDir = sunDirV.mul(999).sub(camCF.LookVector);
		const sunElevation = math.deg(math.atan(camToSunDir.Y / math.sqrt(camToSunDir.X ** 2 + camToSunDir.Z ** 2)));
		const horizElev = -math.deg(math.acos(20925656.2 / (20925656.2 + math.clamp(x, 0, math.huge))));
		const horizElevSunsetDiff = sunElevation - horizElev;
		const earthTransAltMult = 1 / (1 + 5 ** (horizElevSunsetDiff - 4));
		const lookAngle = math.deg(
			math.atan(camCF.LookVector.Y / math.sqrt(camCF.LookVector.X ** 2 + camCF.LookVector.Z ** 2)),
		);
		const lookAngleHorizDiff = lookAngle - horizElev;

		// ── Shared cross-section state ─────────────────────────────────────
		let outdoorAmbientBrightEq = 0;
		let earthTransparency = 0;
		let showTerminator = 0;
		const enableScatter = Config.EnableSunsetScattering;
		let lightEmissionEq = 0;
		let extTransEq = 0;
		let extColorEq: Color3 = Colors.white;
		let extSunsetTransEq = 0;

		const updateEarthAtmoColor = () => {
			if (IS_DEFAULT_ATMO_COLOR) {
				const groundAtmoFactor =
					math.clamp(1 - xOverSF / 32808, 0, 1) * (math.clamp(horizElevSunsetDiff, 0, 10) / 10);
				this.atmosphere.Color = new Color3(0, (95 / 255) * groundAtmoFactor, (148 / 255) * groundAtmoFactor);

				const sunsetFade15 = math.clamp(horizElevSunsetDiff / H15, 0, 1);
				const altitudeFade = 1 - math.clamp((xOverSF - 100000) / 20000, 0, 1);
				const fc = Lighting.FogColor;
				Lighting.FogColor = new Color3(
					fc.R * (1 + 0.0434782608695652 * sunsetFade15 * altitudeFade),
					fc.G * (1 + 0.2222222222222222 * sunsetFade15 * altitudeFade),
					fc.B * (1 + 0.4313725490196079 * sunsetFade15 * altitudeFade),
				);
			} else {
				this.atmosphere.Color = Colors.black;
			}
		};
		const updateEarthApparentMovement = () => {
			const earthPos = this.earth.CFrame.Position;
			const earthOrientation = this.earth.CFrame.sub(earthPos);
			const scaleVal = Config.Scale;
			const hrpVel = this.humanoidRootPart.Velocity;
			const hrpY = this.humanoidRootPart.Position.Y;
			const circumference = (2 * math.pi * (20925656.2 + hrpY * scaleVal)) / 360;
			const velocityX = ((hrpVel.X / scaleVal) * dt) / circumference;
			const velocityZ = ((hrpVel.Z / scaleVal) * dt) / circumference;
			const rotationSpeed = CFrame.Angles(math.rad(-velocityZ), 0, math.rad(velocityX));
			const newEarthRotation = rotationSpeed.mul(earthOrientation);
			const newEarthOrientation = newEarthRotation.add(earthPos);

			if (Config.EnableApparentPlanetRotation) {
				this.earth.CFrame = newEarthOrientation;
			} else {
				this.earth.CFrame = earthOrientation;
			}

			if (this.clockTimeExists && Config.EnableApparentSunMovement) {
				this.initialTime = (Workspace.FindFirstChild("ServerClockTime") as NumberValue).Value % 24;
			}

			if (Config.EnableApparentSunMovement) {
				this.sunOffsetX += velocityX * 4;
				this.sunOffsetZ += -velocityZ;
				if (Config.EquatorialMovementOnly) {
					Lighting.SetMinutesAfterMidnight(this.initialTime * 60 + this.sunOffsetX);
				} else {
					Lighting.SetMinutesAfterMidnight(this.initialTime * 60 + this.sunOffsetX);
					Lighting.GeographicLatitude = this.initialGL + this.sunOffsetZ;
				}
				const hrpPos = this.humanoidRootPart.Position;
				if (hrpPos.X >= -10000 && hrpPos.X < 10000 && hrpPos.Z >= -10000 && hrpPos.Y + altOff < 1000) {
					this.sunOffsetX = 0;
					this.sunOffsetZ = 0;
					this.earth.Orientation = Config.InitialPlanetOrientation;
				}
			}
		};
		const updateEarthPosition = () => {
			// lua has no branch for x <= 0; keep the last finite geometry instead of evaluating NaN powers
			if (x <= 0) return;
			let earthPositionEquation: number;

			if (x > 100000 && x <= 1000000) {
				earthPositionEquation =
					xOverSF -
					(x -
						(x -
							100000 +
							7306.78 * x ** 0.872004 +
							-266624 * x ** -0.0237557 +
							-7309.42 * x ** 0.87197956847));
				this.earthMeshEquation =
					(-25.3972387974 * x ** 1.05354335619 + 25.4369609378 * x ** 1.05342854607 + 101237.056899) /
					8.13653899048;
				this.earthTexture.Transparency =
					(1 - earthTransparency) / (1 + 1.0001 ** (x - 150000)) + earthTransparency;
				this.earthTerminatorTexture.Transparency = 1 / (1 + 1.00002 ** (x - 500000)) + showTerminator;
				this.earth.Transparency = 1 / (1 + 1.0001 ** (x - 150000)) + earthTransAltMult;
			} else if (x > 1000000 && x <= 3500000) {
				earthPositionEquation =
					xOverSF -
					(x -
						(2.0240445172e13 / (x ** -1.61220817515 - 0.410381984491) +
							-2.9626966906e11 / (x + 55704.2710045) +
							4.9320988669e13) -
						(x - 100000) +
						836.387);
				this.earthMeshEquation = 100000000000 / x / 8.13653899048;
				this.earthTexture.Transparency = earthTransparency;
				this.earthTerminatorTexture.Transparency = 0 + showTerminator;
				this.earth.Transparency = 0;
			} else if (x > 3500000 && x <= 5246873.871) {
				earthPositionEquation = xOverSF - (x - (1.00123264194 * x - 106467.5166));
				this.earthMeshEquation =
					(7.8380064061e17 * (x + 222825889.501) ** -1.50563875544 - 177960.408667) / 8.13653899048;
				this.earthTexture.Transparency = earthTransparency;
				this.earthTerminatorTexture.Transparency = 0 + showTerminator;
				this.earth.Transparency = 0;
			} else if (x > 5246873.871 && x <= 67263000) {
				const [a3, b3, c3, d3, f3, m3, n3, o3, p3, q3, r3, s3, t3b, u3, A3, B3, C3, D3, E3, F3, G3] = [
					4709.38474994, 1.01381720703491, -204535111.700394, 0.35687924465605, -218410.864076,
					1.03658947921442, 1002557179.90194, 0.30452396966735, -1283983614.10178, 0.25251698544549,
					214169.771949, 1.03688424616217, -5.0691452176e10, -0.36586684180984, -3431253.77136,
					0.999999652745506, 0.636617990425165, -4568303.25078, 0.999999267725124, -1.20549365154807,
					3229298347.72085,
				];
				earthPositionEquation = xOverSF - (x - (x - 100000));
				this.earthMeshEquation =
					(a3 * x ** b3 +
						c3 * x ** d3 +
						f3 * x ** m3 +
						n3 * x ** o3 +
						p3 * x ** q3 +
						r3 * x ** s3 +
						t3b * x ** u3 +
						A3 * B3 ** (x - C3) +
						D3 * E3 ** (x - F3) +
						G3) /
					8.13653899048;
				this.earthTexture.Transparency = earthTransparency;
				this.earthTerminatorTexture.Transparency = 0 + showTerminator;
				this.earth.Transparency = 0;
			} else if (x > 67263000) {
				const [g3, h3] = [8.5549040903e11, -0.487707702858];
				const [i3, j3, k3] = [-8.5504558849e11, -0.487681650235, 1321.30366835];
				earthPositionEquation = xOverSF - (x - (x - 100000));
				this.earthMeshEquation = (g3 * x ** h3 + i3 * x ** j3 + k3) / 8.13653899048;
				this.earthTexture.Transparency = earthTransparency;
				this.earthTerminatorTexture.Transparency = 0 + showTerminator;
				this.earth.Transparency = 0;
			} else {
				// x <= 100000 && x > 0
				earthPositionEquation =
					xOverSF -
					(x -
						(x -
							100000 +
							7306.78 * x ** 0.872004 +
							-266624 * x ** -0.0237557 +
							-7309.42 * x ** 0.87197956847)) /
						8.13653899048;
				this.earthMeshEquation =
					-25.3972387974 * x ** 1.05354335619 + 25.4369609378 * x ** 1.05342854607 + 101237.056899;
				this.earthTexture.Transparency = 1;
				this.earthTerminatorTexture.Transparency = 1 + showTerminator;
				this.earth.Transparency = 1;
			}

			let earthTerminatorX: number;
			let earthTerminatorY: number;
			if (horizElevSunsetDiff <= 0) {
				earthTerminatorX = 1.0001;
				earthTerminatorY = 1.0001;
			} else {
				earthTerminatorX = 1.01;
				earthTerminatorY = 1.2;
			}

			this.earthPosVec = new Vector3(camPosX, earthPositionEquation - altOff, camPosZ);
			this.earth.Position = this.earthPosVec;
			this.earthTerminator.Position = this.earthPosVec;
			this.earthTerminator2.Position = this.earthPosVec;

			const fogColorV = Lighting.FogColor;
			const fogVC2 = fogColorV.toVector3().mul(2);
			this.earthMesh.Scale = new Vector3(this.earthMeshEquation, this.earthMeshEquation, this.earthMeshEquation);
			this.earthMesh.VertexColor = fogVC2;
			this.earthTerminatorMesh.Scale = new Vector3(
				this.earthMeshEquation * earthTerminatorX,
				this.earthMeshEquation * earthTerminatorY,
				this.earthMeshEquation * earthTerminatorX,
			);
			this.earthTerminatorMesh2.Scale = this.earthTerminatorMesh.Scale;
			this.earthTerminatorTexture2.Transparency = this.earthTerminatorTexture.Transparency;
		};
		const updateEarthTerminatorCFrame = () => {
			const sunDir = Lighting.GetSunDirection();
			this.earthTerminator.CFrame = new CFrame(this.earthTerminator.Position)
				.mul(CFrame.fromMatrix(Vector3.zero, this.earthTerminator.CFrame.LookVector, sunDir))
				.mul(CFrame.Angles(0, 1.5 * math.pi, 0));
			this.earthTerminator2.CFrame = new CFrame(this.earthTerminator2.Position)
				.mul(CFrame.fromMatrix(Vector3.zero, this.earthTerminator2.CFrame.LookVector, sunDir.mul(-1)))
				.mul(CFrame.Angles(0, 1.5 * math.pi, 0));
		};

		const updateAtmosphereTransparency = () => {
			let starCount: number;
			if (horizElevSunsetDiff <= -18) {
				this.atmosphere.Transparency = 1;
				starCount = 3000;
			} else if (horizElevSunsetDiff <= -14) {
				this.atmosphere.Transparency = -(horizElevSunsetDiff + 14) / 4;
				starCount = 3000;
			} else if (horizElevSunsetDiff <= 0) {
				this.atmosphere.Transparency = 0;
				starCount = 3000;
			} else {
				this.atmosphere.Transparency = 0;
				starCount = 0;
			}
			this.skyGround.StarCount = this.skySpace.StarCount = starCount;
			this.atmosphere.Transparency = 1 - (1 - this.atmosphere.Transparency) * altitudeFade;

			const atmosphereApparentHeight = x <= 110000 ? 5.5 : 340334.643262 * x ** -0.948472308886;

			if (
				x > 110000 &&
				lookAngleHorizDiff - atmosphereApparentHeight >= this.camera().FieldOfView / 2 &&
				horizElevSunsetDiff >= 0
			) {
				this.mesh.MeshId = "";
				this.surfaceMesh.MeshId = "";
			} else {
				this.mesh.MeshId = "rbxassetid://5077225120";
				this.surfaceMesh.MeshId = "rbxassetid://452341386";
			}
		};

		const updateAtmosphericReflection = () => {
			const altitudeDensityScalar = math.clamp(1 - xOverSF / 5000, 0, 1);

			const cloud = this.cloudConfig;
			if (cloud.auto) {
				// fixme: to be replaced with a proper weather simulation instead of random-walk targets.
				// GetServerTimeNow is identical on every client, so the drift is the same for everyone
				const t = Workspace.GetServerTimeNow();
				this.cloudDensityTarget = math.clamp(math.noise(t / 300) + 0.5, 0, 1) * this.initialCloudDensity;
				this.cloudCoverageTarget = math.clamp(math.noise(t / 60, 100) + 0.5, 0, 1);
			} else {
				this.cloudDensityTarget = cloud.density;
				this.cloudCoverageTarget = cloud.cover;
			}

			// ~5.8 min half-life for density, ~23 s half-life for coverage
			this.cloudDensity += (this.cloudDensityTarget - this.cloudDensity) * math.clamp(dt * 0.002, 0, 1);
			this.cloudCoverage += (this.cloudCoverageTarget - this.cloudCoverage) * math.clamp(dt * 0.03, 0, 1);

			const atmosphericReflFactor = math.clamp(horizElevSunsetDiff / 10, 0, 1);
			const reflColor = Config.AtmosphereReflectionColor;
			Lighting.Ambient = reflColor.mul(atmosphericReflFactor);
			this.clouds.Color = Colors.white.mul(atmosphericReflFactor);
			this.clouds.Density = this.cloudDensity * altitudeDensityScalar;
			this.clouds.Cover = this.cloudCoverage;
		};

		const updateTwilightColors = () => {
			const div = H3 / 2.666666666666;

			if (horizElevSunsetDiff >= 0 && horizElevSunsetDiff < 3.75) {
				const abs = math.abs(horizElevSunsetDiff);
				const colorRRes = math.clamp(
					(-(colorRSunset - colorR) / div) * abs + colorRSunset,
					math.min(colorR, colorRSunset),
					math.max(colorR, colorRSunset),
				);
				const colorGRes = math.clamp(
					(-(colorGSunset - colorG) / div) * abs + colorGSunset,
					math.min(colorG, colorGSunset),
					math.max(colorG, colorGSunset),
				);
				const colorBRes = math.clamp(
					(-(colorBSunset - colorB) / div) * abs + colorBSunset,
					math.min(colorB, colorBSunset),
					math.min(colorB, colorBSunset),
				);
				outdoorAmbientBrightEq =
					(((Config.OutdoorAmbientBrightnessDay - Config.OutdoorAmbientBrightnessNight) / 17.75) *
						(horizElevSunsetDiff - 3.75) +
						Config.OutdoorAmbientBrightnessDay) /
					255;
				Lighting.FogColor = new Color3(
					((colorRRes / 17.75) * (horizElevSunsetDiff + 14)) / 255,
					((colorGRes / 17.75) * (horizElevSunsetDiff + 14)) / 255,
					((colorBRes / 17.75) * (horizElevSunsetDiff + 14)) / 255,
				);
				Lighting.FogEnd = (-100000 * (horizElevSunsetDiff - 3.75) + 100000) * this.fogEndRatio * atmoThinness;
				this.distantSurface.Color = Config.DistantSurfaceColor;
				sunBright = Config.SunlightBrightness;
				this.airglowLayer.Transparency = 1;
				earthTransparency = ((Config.PlanetTransparency - 0.011) / 3.75) * horizElevSunsetDiff + 0.011;
				this.earthTexture.Color3 = Config.EarthDayColor;
			} else if (horizElevSunsetDiff >= -7 && horizElevSunsetDiff < 0) {
				const abs = math.abs(horizElevSunsetDiff);
				const colorRRes = math.clamp(
					(-(colorRSunset - colorR) / div) * abs + colorRSunset,
					math.min(colorR, colorRSunset),
					math.max(colorR, colorRSunset),
				);
				const colorGRes = math.clamp(
					(-(colorGSunset - colorG) / div) * abs + colorGSunset,
					math.min(colorG, colorGSunset),
					math.max(colorG, colorGSunset),
				);
				const colorBRes = math.clamp(
					(-(colorBSunset - colorB) / div) * abs + colorBSunset,
					math.min(colorB, colorBSunset),
					math.min(colorB, colorBSunset),
				);
				outdoorAmbientBrightEq =
					(((Config.OutdoorAmbientBrightnessDay - Config.OutdoorAmbientBrightnessNight) / 17.75) *
						(horizElevSunsetDiff - 3.75) +
						Config.OutdoorAmbientBrightnessDay) /
					255;
				Lighting.FogColor = new Color3(
					((colorRRes / 17.75) * (horizElevSunsetDiff + 14)) / 255,
					((colorGRes / 17.75) * (horizElevSunsetDiff + 14)) / 255,
					((colorBRes / 17.75) * (horizElevSunsetDiff + 14)) / 255,
				);
				Lighting.FogEnd = (-25000 * horizElevSunsetDiff + 475000) * this.fogEndRatio * atmoThinness;
				this.distantSurface.Color = Colors.black;
				sunBright = Config.NightBrightness;
				this.airglowLayer.Transparency = Config.AirglowTransparency + this.airglowTransparency;
				earthTransparency = 0.011;
				this.earthTexture.Color3 = Config.EarthNightColor;
			} else if (horizElevSunsetDiff >= -14 && horizElevSunsetDiff < -7) {
				const abs = math.abs(horizElevSunsetDiff);
				const colorRRes = math.clamp(
					(-(colorRSunset - colorR) / div) * abs + colorRSunset,
					math.min(colorR, colorRSunset),
					math.max(colorR, colorRSunset),
				);
				const colorGRes = math.clamp(
					(-(colorGSunset - colorG) / div) * abs + colorGSunset,
					math.min(colorG, colorGSunset),
					math.max(colorG, colorGSunset),
				);
				const colorBRes = math.clamp(
					(-(colorBSunset - colorB) / div) * abs + colorBSunset,
					math.min(colorB, colorBSunset),
					math.min(colorB, colorBSunset),
				);
				outdoorAmbientBrightEq =
					(((Config.OutdoorAmbientBrightnessDay - Config.OutdoorAmbientBrightnessNight) / 17.75) *
						(horizElevSunsetDiff - 3.75) +
						Config.OutdoorAmbientBrightnessDay) /
					255;
				Lighting.FogColor = new Color3(
					((colorRRes / 17.75) * (horizElevSunsetDiff + 14)) / 255,
					((colorGRes / 17.75) * (horizElevSunsetDiff + 14)) / 255,
					((colorBRes / 17.75) * (horizElevSunsetDiff + 14)) / 255,
				);
				Lighting.FogEnd = ((550000 / 7) * (horizElevSunsetDiff + 7) + 650000) * this.fogEndRatio * atmoThinness;
				this.distantSurface.Color = Colors.black;
				sunBright = Config.NightBrightness;
				this.airglowLayer.Transparency = Config.AirglowTransparency + this.airglowTransparency;
				earthTransparency = 0.011;
				this.earthTexture.Color3 = Config.EarthNightColor;
			} else if (horizElevSunsetDiff < -14) {
				outdoorAmbientBrightEq = Config.OutdoorAmbientBrightnessNight / 255;
				Lighting.FogColor = Colors.black;
				Lighting.FogEnd = 100000 * this.fogEndRatio * atmoThinness;
				this.distantSurface.Color = Colors.black;
				sunBright = Config.NightBrightness;
				this.airglowLayer.Transparency = Config.AirglowTransparency + this.airglowTransparency;
				earthTransparency = 0.011;
				this.earthTexture.Color3 = Config.EarthNightColor;
			} else {
				// horizElevSunsetDiff >= 3.75 — broad daylight
				outdoorAmbientBrightEq = Config.OutdoorAmbientBrightnessDay / 255;
				Lighting.FogColor = Config.AtmosphereColor;
				Lighting.FogEnd = 100000 * this.fogEndRatio * atmoThinness;
				this.distantSurface.Color = Config.DistantSurfaceColor;
				sunBright = Config.SunlightBrightness;
				this.airglowLayer.Transparency = 1;
				earthTransparency = Config.PlanetTransparency;
				this.earthTexture.Color3 = Config.EarthDayColor;
			}
		};
		const updateTwilightDarkness = () => {
			const [ATDa, ATDb, ATDc, ATDd] = [1.42956638935407e-17, 3.11869410895, 5010.5925368, -0.998839715953];
			const CT = Lighting.ClockTime;
			let atdTimeComp: number;
			if (CT >= 5.9 && CT < 6.2) {
				atdTimeComp = (CT - 5.9) / 0.3;
			} else if (CT >= 4.8 && CT < 5.1) {
				atdTimeComp = -(CT - 5.1) / 0.3;
			} else if (CT >= 6.2 && CT < 17.8) {
				atdTimeComp = 1;
			} else if (CT >= 17.8 && CT < 18.1) {
				atdTimeComp = -(CT - 18.1) / 0.3;
			} else if (CT >= 18.9 && CT < 19.2) {
				atdTimeComp = (CT - 18.9) / 0.3;
			} else if (CT >= 19.2 || CT < 4.8) {
				atdTimeComp = 1;
			} else {
				atdTimeComp = 0;
			}

			if (x >= 5060 && x < 250251 && Config.EnableGroundAtmosphere) {
				const darknessTrans = math.clamp(ATDa * x ** ATDb + ATDc * x ** ATDd, 0, 1) + atdTimeComp;
				this.bottomAtmosphereDarkness.Transparency = 1 - (1 - darknessTrans) * altitudeFade;
			} else {
				this.bottomAtmosphereDarkness.Transparency = 1;
			}
		};

		const updateExtinction = () => {
			const hesdAdjEq = -((horizElevSunsetDiff - 10) ** 4) / 1000 + 10;

			if (horizElevSunsetDiff <= H3 && horizElevSunsetDiff > 0) {
				lightEmissionEq = (1 / H3) * horizElevSunsetDiff;
				extSunsetTransEq = (1 / H3) * horizElevSunsetDiff;
				if (enableScatter) {
					extTransEq = (0.8 / H3) * hesdAdjEq;
					// lua: ((255-c)/10 * altExp) * hesd + c  →  t = hesd*altExp/10 (altExp in the numerator)
					extColorEq = Config.AtmosphericExtinctionColor.Lerp(
						Colors.white,
						(horizElevSunsetDiff * altExp) / 10,
					);
				} else {
					extTransEq = 0.8;
					extColorEq = Colors.white;
				}
			} else if (horizElevSunsetDiff > H3) {
				lightEmissionEq = 1;
				extTransEq = 0.8;
				extSunsetTransEq = 1;
				extColorEq = Colors.white;
			} else if (horizElevSunsetDiff > -14 && horizElevSunsetDiff <= 0) {
				lightEmissionEq = 0;
				extSunsetTransEq = (1 / (1.2 * H3)) * math.abs(horizElevSunsetDiff);
				if (enableScatter) {
					extTransEq = -horizElevSunsetDiff / 14;
					extColorEq = Config.AtmosphericExtinctionColor.Lerp(
						Config.AstronomicalTwilightExtinctionColor,
						-horizElevSunsetDiff / 14,
					);
				} else {
					extTransEq = 0.8;
					extColorEq = Colors.white;
				}
			} else {
				// horizElevSunsetDiff <= -14
				lightEmissionEq = 0;
				extSunsetTransEq = 1;
				if (enableScatter) {
					extTransEq = 1;
					extColorEq = Config.AtmosphericExtinctionColor;
				} else {
					extTransEq = 0.8;
					extColorEq = Colors.white;
				}
			}
		};
		const updateExtinctionBeams = () => {
			const extWidth = this.extinctionWidthEquation;
			const extIntensity = ((1 - 5) / 20000) * math.clamp(x - 20000, 0, 20000) + 5;
			const altCl = math.clamp(x / 32808, 0, 1);
			const hesdClamp = math.clamp(horizElevSunsetDiff, -14, 0);
			const extTrans1 = new NumberSequence(
				(extTransEq / (1.5 - 0.5 * altCl)) * ((2 / 3) * (1 + (14 + hesdClamp) / 28)),
			);
			const extTrans2 = new NumberSequence(extTransEq / (2 * (1 + hesdClamp / 28)));
			// lua passes ColorSequence.new(color, number); Roblox ignores the extra numeric arg → uniform color
			const extColorSeq = new ColorSequence(extColorEq);

			for (const b of this.extBeams14) {
				b.Brightness = extIntensity;
				b.LightEmission = lightEmissionEq;
				b.Transparency = extTrans2;
				b.Color = extColorSeq;
				b.Width0 = extWidth;
				b.Width1 = extWidth;
			}
			for (const b of this.extBeams58) {
				b.Brightness = extIntensity;
				b.LightEmission = lightEmissionEq;
				b.Transparency = extTrans1;
				b.Color = extColorSeq;
				b.Width0 = extWidth;
				b.Width1 = extWidth;
			}
		};
		const updateSunsetScatteringBeams = () => {
			const sb2 = this.extSB2;
			if (extSunsetTransEq < 1 && enableScatter) {
				const extWidthS = this.extinctionWidthEquation / 4;
				const extSunsetBrightness = math.clamp(3 * horizElevSunsetDiff + 10, 10, 40);
				const beltOfVenusWidth = math.clamp(-0.4 * horizElevSunsetDiff + 1, 1, 10);
				const extSunsetBelt = extWidthS * beltOfVenusWidth;
				const esd10 = extSunsetTransEq;

				const extTransSS1 = new NumberSequence([
					new NumberSequenceKeypoint(0, 1),
					new NumberSequenceKeypoint(math.clamp((horizElevSunsetDiff - 10) / 30 + 1, 0.3, 1), esd10 + 0.1),
					new NumberSequenceKeypoint(1, esd10),
				]);
				const extTransSS2 = new NumberSequence([
					new NumberSequenceKeypoint(0, esd10),
					new NumberSequenceKeypoint(math.clamp(-(horizElevSunsetDiff - 10) / 30, 0.3, 1), esd10 + 0.1),
					new NumberSequenceKeypoint(1, 1),
				]);
				const bovExtra = math.clamp(-(horizElevSunsetDiff + 6.6) / 2.7, 0, 1);
				const extTransSS1BoV = new NumberSequence([
					new NumberSequenceKeypoint(0, 1),
					new NumberSequenceKeypoint(math.clamp((horizElevSunsetDiff - 10) / 30 + 1, 0.3, 1), esd10 + 0.1),
					new NumberSequenceKeypoint(1, esd10 + bovExtra),
				]);
				const extTransSS2BoV = new NumberSequence([
					new NumberSequenceKeypoint(0, esd10 + bovExtra),
					new NumberSequenceKeypoint(
						math.clamp(-(horizElevSunsetDiff - 10) / 30, 0.3, 1),
						esd10 + 0.1 + bovExtra,
					),
					new NumberSequenceKeypoint(1, 1),
				]);

				sb2.Beam1.Transparency = extTransSS1;
				sb2.Beam5.Transparency = extTransSS1;
				sb2.Beam2.Transparency = extTransSS2;
				sb2.Beam6.Transparency = extTransSS2;
				sb2.Beam3.Transparency = extTransSS1BoV;
				sb2.Beam7.Transparency = extTransSS1BoV;
				sb2.Beam4.Transparency = extTransSS2BoV;
				sb2.Beam8.Transparency = extTransSS2BoV;

				const beltEmission = math.clamp(0.4 * horizElevSunsetDiff + 1, 0, 1);
				const beltColor = new ColorSequence(Config.BeltOfVenusColor);
				for (const b of this.beltBeams) {
					b.Brightness = extSunsetBrightness;
					b.Color = beltColor;
					b.LightEmission = beltEmission;
					b.LightInfluence = beltEmission;
					b.Width0 = extSunsetBelt;
					b.Width1 = extSunsetBelt;
				}

				const innerColor = Config.InnerExtinctionColor;
				const sunsideColor = Config.SunsideExtinctionColor;
				const hesdAbs = math.abs(horizElevSunsetDiff);
				let innerExtSunsetColor = sunsideColor.Lerp(Config.AtmosphericExtinctionColor, hesdAbs / H3);
				let innerAtmExtColor: Color3 = innerColor;
				if (horizElevSunsetDiff < 0) {
					const nautColor = Config.NauticalTwilightExtinctionColor;
					const nautInner = Config.NauticalInnerExtinctionColor;
					innerExtSunsetColor = sunsideColor.Lerp(nautColor, hesdAbs / H3);
					innerAtmExtColor = innerColor.Lerp(nautInner, hesdAbs / H3);
				}

				const extSunsetColor1 = new ColorSequence(innerAtmExtColor, innerExtSunsetColor);
				const extSunsetColor2 = new ColorSequence(innerExtSunsetColor, innerAtmExtColor);
				for (const b of this.sunsetInnerBeams) {
					b.Brightness = extSunsetBrightness;
					b.Width0 = extWidthS;
					b.Width1 = extWidthS;
				}
				sb2.Beam1.Color = extSunsetColor1;
				sb2.Beam5.Color = extSunsetColor1;
				sb2.Beam2.Color = extSunsetColor2;
				sb2.Beam6.Color = extSunsetColor2;
			} else {
				for (const b of this.extSBeams) {
					b.Transparency = NSEQ_HIDDEN;
				}
			}
		};
		const updateTerminator = () => {
			if (horizElevSunsetDiff >= -14 && horizElevSunsetDiff < 0) {
				showTerminator = -horizElevSunsetDiff / 14;
				this.earthTexture.Texture = Config.PlanetTextureNight;
				this.mesh.TextureId = "rbxassetid://2013298";
			} else if (horizElevSunsetDiff < -14) {
				showTerminator = 1;
				this.earthTexture.Texture = Config.PlanetTextureNight;
			} else {
				showTerminator = 0;
				this.earthTexture.Texture = Config.PlanetTexture;
			}

			if (sunElevation < 0 && sunElevation >= -17.5) {
				this.mesh.TextureId = "rbxassetid://2013298";
			} else if (sunElevation < -17.5 || sunElevation >= 0) {
				this.mesh.TextureId = "";
			}
		};
		const updateAltitudeGeometry = () => {
			if (x > 100000 && x < 5246873.871) {
				this.fogEndRatio = 4377.1 / (x + 180020.1514) ** 0.810723 + 0.83211;
				const [r, u, l, o] = [208974, -62832.1, -1.3935e10, -109932];
				const [w, p, m, n] = [-167.036, -0.109192, -24.6005, 9554.31];
				const atmoY = xOverSF - (x - (x - 36799.1218621)) - altOff;
				const distY = xOverSF - (x - (x - 54996.930114)) - altOff;
				this.atmosphere.Position = new Vector3(camPosX, atmoY, camPosZ);
				this.distantSurface.Position = new Vector3(camPosX, distY, camPosZ);
				this.surfaceMesh.Scale = new Vector3(700, 1000, 700);
				Lighting.FogStart =
					(15 / (0.0000984275 + 0.38 ** (x ** 0.193962 + 0.00154112)) - 69535.15141) * atmoHeight;
				const meshW = r / (w * (x - u) ** p) + l / (m * (x - o)) + n;
				this.mesh.Scale = new Vector3(meshW, 3000, meshW);
			} else if (x <= 100000 && x > 10000) {
				this.fogEndRatio = 1;
				const [d, b, c, f] = [25400, -60715, 30500, -43630];
				const [a7, b7, c7] = [1.31047990554, 3.9710993937e-26, 5.85019468322];
				const [d7, f7, g7] = [0.701839373626, -2.9477486752e-11, 3.05504012873];
				const [h7, i7, j7] = [-2607.06952132, 0.168115525945, 43.9601841689];
				this.atmosphere.Position = new Vector3(
					camPosX,
					xOverSF - (x - (((x + d) * (x + b)) / (x + c) - f - 18178.846)) - altOff,
					camPosZ,
				);
				this.distantSurface.Position = new Vector3(
					camPosX,
					xOverSF -
						(x - (a7 * x + b7 * x ** c7 + j7 * x ** d7 + f7 * x ** g7 + h7 * x ** i7 - 161500)) -
						altOff,
					camPosZ,
				);
				this.surfaceMesh.Scale = new Vector3(700, 25 * (x / 10000 - 10) ** 2 + 1000, 700);
				Lighting.FogStart = 0;
				const [a6, b6, c6] = [2.7154155381e19, -5.1373398109e19, 9.1620578497e9];
				const [d6, f6, g6] = [9.1430590143e9, 2.421957201e19, 9.1219469736e9];
				const meshW =
					a6 / ((x - 50000) ** 2 + c6) + b6 / ((x - 50000) ** 2 + d6) + f6 / ((x - 50000) ** 2 + g6);
				this.mesh.Scale = new Vector3(meshW, 3000, meshW);
			} else if (x <= 10000 && x > 0) {
				this.fogEndRatio = 1;
				const [d, b, c, f] = [25400, -60715, 30500, -43630];
				this.atmosphere.Position = new Vector3(
					camPosX,
					xOverSF - (x - (((x + d) * (x + b)) / (x + c) - f - 18178.846)) - altOff,
					camPosZ,
				);
				this.distantSurface.Position = new Vector3(
					camPosX,
					xOverSF - (x - (2.95 * x - 162000)) - altOff,
					camPosZ,
				);
				this.surfaceMesh.Scale = new Vector3(700, 25 * (x / 10000 - 10) ** 2 + 1000, 700);
				Lighting.FogStart = 0;
				const [a6, b6, c6] = [2.7154155381e19, -5.1373398109e19, 9.1620578497e9];
				const [d6, f6, g6] = [9.1430590143e9, 2.421957201e19, 9.1219469736e9];
				const meshW =
					a6 / ((x - 50000) ** 2 + c6) + b6 / ((x - 50000) ** 2 + d6) + f6 / ((x - 50000) ** 2 + g6);
				this.mesh.Scale = new Vector3(meshW, 3000 + (60 / 10000) * (x - 10000), meshW);
			} else if (x <= 0) {
				this.fogEndRatio = 1;
				this.atmosphere.Position = new Vector3(camPosX, xOverSF - (x - (-25111.502 + x)) - altOff, camPosZ);
				this.distantSurface.Position = new Vector3(camPosX, xOverSF - (x - (-162000 + x)) - altOff, camPosZ);
				this.surfaceMesh.Scale = new Vector3(700, 3500, 700);
				Lighting.FogStart = 0;
				this.mesh.Scale = new Vector3(7600, 2940, 7600);
			} else if (x >= 5246873.871 && x < 21588000) {
				const a4 = -98579869.1664111,
					b4 = 0.999855267221903,
					c4 = 1.17384438375563;
				const d4 = -57563664.7876213,
					f4 = -0.196011457493863,
					g4 = 3642.75971943516;
				const h4 = -3.95985950072682,
					i4 = 145010709.567098,
					j4 = 0.99990166435694;
				const k4 = -46430900.3820651,
					l4 = 5197398.21595372;
				this.fogEndRatio =
					(a4 * x ** b4 + b4 * x ** c4 + d4 * x ** f4 + g4 * x ** h4 + i4 * x ** j4 + k4 * x + l4) / 100000;
				const a2 = -2.8575150114e13,
					b2 = -56.5968339427,
					c2 = -20830785.2368,
					d2 = 1.11194612973,
					f2 = 11.9620104512;
				this.atmosphere.Position = new Vector3(camPosX, xOverSF - (x - (x - 36799.1218621)) - altOff, camPosZ);
				this.distantSurface.Position = new Vector3(
					camPosX,
					xOverSF - (x - (x - 54996.930114)) - altOff,
					camPosZ,
				);
				this.surfaceMesh.Scale = new Vector3(700, 1000, 700);
				const a5 = -0.135104923621362,
					b5 = 1.19884862566049,
					c5 = 1196240.55139739;
				const d5 = -0.185581758943347,
					f5 = 0.136066310685175,
					g5 = 1.19845394730869;
				Lighting.FogStart = (a5 * x ** b5 + c5 * x ** d5 + f5 * x ** g5) * atmoHeight;
				const meshW = a2 / (b2 * (x - c2) ** d2) + f2;
				this.mesh.Scale = new Vector3(meshW, 3000, meshW);
			} else {
				// x >= 21588000
				const a4 = -98579869.1664111,
					b4 = 0.999855267221903,
					c4 = 1.17384438375563;
				const d4 = -57563664.7876213,
					f4 = -0.196011457493863,
					g4 = 3642.75971943516;
				const h4 = -3.95985950072681,
					i4 = 145010709.567098,
					j4 = 0.99990166435694;
				const k4 = -46430900.3820651,
					l4 = 5197398.21595372;
				this.fogEndRatio =
					(a4 * x ** b4 + b4 * x ** c4 + d4 * x ** f4 + g4 * x ** h4 + i4 * x ** j4 + k4 * x + l4) / 100000;
				const a2 = -2.8575150114e13,
					b2 = -56.5968339427,
					c2 = -20830785.2368,
					d2 = 1.11194612973,
					f2 = 11.9620104512;
				this.atmosphere.Position = new Vector3(camPosX, xOverSF - (x - (x - 36799.1218621)) - altOff, camPosZ);
				this.distantSurface.Position = new Vector3(
					camPosX,
					xOverSF - (x - (x - 54996.930114)) - altOff,
					camPosZ,
				);
				this.surfaceMesh.Scale = new Vector3(700, 1000, 700);
				Lighting.FogStart = 87751.051 * atmoHeight;
				const meshW = a2 / (b2 * (x - c2) ** d2) + f2;
				this.mesh.Scale = new Vector3(meshW, 3000, meshW);
			}
		};
		const updateAirglow = () => {
			const agColor = Config.AirglowColor;
			this.airglowMesh.VertexColor = agColor.toVector3();
			if (Config.EnableAirglow) {
				this.airglowLayer.Position = this.earthPosVec;
				const agScale = this.earthMeshEquation * 1.014 * 8.13653899048;
				this.airglowMesh.Scale = new Vector3(agScale, agScale, agScale);
				this.airglowTransparency = 0;
			} else {
				this.airglowLayer.Position = Vector3.zero;
				this.airglowMesh.Scale = Vector3.zero;
				this.airglowTransparency = 1;
			}
		};
		const updateExtinctionPositioning = () => {
			const extB1Any = this.extB1;
			const extB2Any = this.extB2;
			const extSB1Any = this.extSB1;
			const extSB2Any = this.extSB2;

			if (x > 0 && x < 21882.1504) {
				const a9 = 2006.90567819,
					b9 = 1.21405239737,
					c9 = -2007.17985974,
					d9 = 1.21403977579,
					f9 = 3500.97360274;
				const extPos = new Vector3(
					camPosX,
					xOverSF - (x - (a9 * x ** b9 + c9 * x ** d9 + f9 + x)) - altOff,
					camPosZ,
				);
				extB1Any.Position = extPos;
				extB2Any.Position = extPos;
				for (const b of this.extBeams) b.Enabled = true;

				const SSa = 8229.54488503584,
					SSb = 1.92564942378699,
					SSc = 4351.4730813359;
				const SSd = 1.91834873220339,
					SSe = -7493.59163984659,
					SSf = 1.92597315127642;
				const SSg = -5087.40263948938,
					SSh = 1.91892935993021,
					SSi = 1399.62366956292;
				const extSunsetEq = SSa * x ** SSb + SSc * x ** SSd + SSe * x ** SSf + SSg * x ** SSh + SSi;
				const extSPos = new Vector3(camPosX, xOverSF - (x - extSunsetEq) - altOff, camPosZ);
				extSB1Any.Position = extSPos;
				extSB2Any.Position = extSPos;
				for (const b of this.extSBeams) b.Enabled = extSunsetTransEq < 1 && enableScatter;

				this.extinctionWidthEquation = -((40000 * x) / 21882.1504) + 80000;
				this.extinctionOrientationEquation = (2 * x) / 21882.1504 + 79;
			} else if (x >= 21882.1504 && x < 100000) {
				const [a8, b8, c8, d8] = [6.2712061263e-21, 4.76359763589, 644.975565777, 0.322499727907];
				const [f8, g8, h8, i8] = [-87.7371373004, 0.56698113042, 0.00149802609093, 1.54285932958];
				const [j8, k8, l8] = [-0.00000452047107416, 2.0219644294, 4000.17081685];
				const extPos = new Vector3(
					camPosX,
					xOverSF -
						(x - (a8 * x ** b8 + c8 * x ** d8 + f8 * x ** g8 + h8 * x ** i8 + j8 * x ** k8 + l8 + x)) -
						altOff,
					camPosZ,
				);
				extB1Any.Position = extPos;
				extB2Any.Position = extPos;
				for (const b of this.extBeams) b.Enabled = true;

				const [SSa, SSb, SSc] = [15000, 1.00000103302, -14999.2215578];
				const extSPos = new Vector3(camPosX, xOverSF - (x - (SSa * x ** SSb + SSc * x)) - altOff, camPosZ);
				extSB1Any.Position = extSPos;
				extSB2Any.Position = extSPos;
				for (const b of this.extSBeams) b.Enabled = extSunsetTransEq < 1 && enableScatter;

				this.extinctionWidthEquation = 40000;
				this.extinctionOrientationEquation = 81;
			} else if (x >= 100000 && x < 200000) {
				const extPos = new Vector3(
					camPosX,
					xOverSF - (x - (-7.0577896884 * x ** 0.594641088876 + 620.275987688 + x)) - altOff,
					camPosZ,
				);
				extB1Any.Position = extPos;
				extB2Any.Position = extPos;
				for (const b of this.extBeams) b.Enabled = true;

				const [SSa, SSb, SSc] = [15000, 1.00000103302, -14999.2215578];
				const extSPos = new Vector3(camPosX, xOverSF - (x - (SSa * x ** SSb + SSc * x)) - altOff, camPosZ);
				extSB1Any.Position = extSPos;
				extSB2Any.Position = extSPos;
				for (const b of this.extSBeams) b.Enabled = extSunsetTransEq < 1 && enableScatter;

				this.extinctionWidthEquation = 40000;
				this.extinctionOrientationEquation = 81;
			} else if (x < 0) {
				const extPos = new Vector3(camPosX, xOverSF - (x - (3500 + x)) - altOff, camPosZ);
				extB1Any.Position = extPos;
				extB2Any.Position = extPos;
				for (const b of this.extBeams) b.Enabled = true;

				const extSPos = new Vector3(camPosX, xOverSF - (x - 1399.6236695629) - altOff, camPosZ);
				extSB1Any.Position = extSPos;
				extSB2Any.Position = extSPos;
				for (const b of this.extSBeams) b.Enabled = extSunsetTransEq < 1 && enableScatter;

				this.extinctionWidthEquation = 80000;
				this.extinctionOrientationEquation = 79;
			} else if (x >= 200000) {
				const extPos = new Vector3(
					camPosX,
					xOverSF - (x - (-7.0577896884 * x ** 0.594641088876 + 620.275987688 + x)) - altOff,
					camPosZ,
				);
				extB1Any.Position = extPos;
				extB2Any.Position = extPos;
				for (const b of this.extBeams) b.Enabled = false;

				const [SSa, SSb, SSc] = [15000, 1.00000103302, -14999.2215578];
				const extSPos = new Vector3(camPosX, xOverSF - (x - (SSa * x ** SSb + SSc * x)) - altOff, camPosZ);
				extSB1Any.Position = extSPos;
				extSB2Any.Position = extSPos;
				for (const b of this.extSBeams) b.Enabled = false;

				this.extinctionWidthEquation = 40000;
				this.extinctionOrientationEquation = 81;
			}
		};
		const updateAttachmentOrientations = () => {
			const sunHDG = -(math.deg(-math.atan2(sunDirV.X, sunDirV.Z)) - 180) % 360;
			const extOriEq = this.extinctionOrientationEquation;
			for (const [att, angle] of this.extAtt) {
				att.WorldOrientation = new Vector3(extOriEq, angle + sunHDG, 0);
			}
			for (const [att, angle] of this.extSAtt) {
				att.WorldOrientation = new Vector3(81, angle + sunHDG, 0);
			}

			this.extB1.Orientation = new Vector3(0, sunHDG - 90, 0);
			this.extB2.Orientation = new Vector3(0, sunHDG + 180, 0);
			this.extSB1.Orientation = new Vector3(0, sunHDG - 180, 0);
			this.extSB2.Orientation = new Vector3(0, sunHDG + 90, 0);
		};
		const updateMirrorBeams = () => {
			for (let i = 0; i < 4; i++) {
				const src = this.extraBeamSrc[i];
				const dst = this.extraBeams[i];
				dst.Width0 = src.Width0;
				dst.Width1 = src.Width1;
				dst.Brightness = src.Brightness;
				dst.Color = src.Color;
				dst.Transparency = src.Transparency;
				dst.LightEmission = src.LightEmission;
				dst.Enabled = src.Enabled;
			}
		};

		const updateGroundAtmosphere = () => {
			if (Config.EnableGroundAtmosphere) {
				this.bottomAtmosphere.Position = new Vector3(
					camPosX,
					xOverSF - (x - (0.975794628099 * x - 9972.10330579)) - altOff,
					camPosZ,
				);
				const gaTrans = Config.GroundAtmosphereTransparency;
				this.bottomAtmosphere.Transparency = 1 - (1 - gaTrans) * altitudeFade;
				this.bottomAtmosphereMesh.VertexColor = this.earthMesh.VertexColor;
			} else {
				this.bottomAtmosphere.Position = Vector3.zero;
				this.bottomAtmosphere.Transparency = 1;
				this.bottomAtmosphereMesh.VertexColor = this.earthMesh.VertexColor;
			}
		};
		const updateMoon = () => {
			const moonSize = 0.57 * (Config.MoonApparentDiameter / 31.6);
			const moonTexture = Config.EnableMoon ? Config.MoonTexture : "";
			this.skyGround.MoonAngularSize = this.skySpace.MoonAngularSize = moonSize;
			this.skyGround.MoonTextureId = this.skySpace.MoonTextureId = moonTexture;
		};

		const update = () => {
			updateAtmosphereTransparency();
			updateTwilightColors();
			// requires: Config.EnableEnvironmentalLighting
			if (Config.EnableEnvironmentalLighting) {
				const [dayR, dayG, dayB] = Color3s.toTuple(Config.DaytimeSunlightColor);
				const [sunR2, sunG2, sunB2] = Color3s.toTuple(Config.SunriseSunlightColor);
				const inv6altExp = 6 * altExp;
				const hesd10 = this.horizElevSunsetDiff10;
				Lighting.OutdoorAmbient = Color3s.fromValue(outdoorAmbientBrightEq);
				Lighting.Brightness = sunBright;
				Lighting.ColorShift_Top = new Color3(
					((dayR - sunR2) / inv6altExp) * hesd10 + sunR2,
					((dayG - sunG2) / inv6altExp) * hesd10 + sunG2,
					((dayB - sunB2) / inv6altExp) * hesd10 + sunB2,
				);
			}
			updateExtinction();
			// positioning sets extinctionWidthEquation/Orientation; must run before the beams read them (lua order)
			updateExtinctionPositioning();
			updateExtinctionBeams();
			updateSunsetScatteringBeams();
			updateTerminator();
			updateAltitudeGeometry();
			updateEarthPosition();
			updateEarthTerminatorCFrame();
			updateAirglow();
			updateMoon();
			updateAttachmentOrientations();
			updateMirrorBeams();
			// requires: !(extSunsetTransEq < 1 && enableScatter)
			if (!(extSunsetTransEq < 1 && enableScatter)) {
				const extWidthS = this.extinctionWidthEquation / 4;
				const extSunsetBelt = extWidthS * math.clamp(-0.4 * horizElevSunsetDiff + 1, 1, 10);
				for (const b of this.sunsetInnerBeams) {
					b.Width0 = extWidthS;
					b.Width1 = extWidthS;
				}
				for (const b of this.beltBeams) {
					b.Width0 = extSunsetBelt;
					b.Width1 = extSunsetBelt;
				}
			}
			updateGroundAtmosphere();
			updateEarthApparentMovement();
			updateTwilightDarkness();
			updateEarthAtmoColor();
			updateAtmosphericReflection();

			const wantGroundSky = xOverSF < 10000;
			if (wantGroundSky !== this.skyIsGround) {
				this.skyIsGround = wantGroundSky;
				this.skyGround.Parent = wantGroundSky ? Lighting : undefined;
				this.skySpace.Parent = wantGroundSky ? undefined : Lighting;
			}
		};
		update();
	}
}
