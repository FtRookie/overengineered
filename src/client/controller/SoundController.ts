import { Debris, ReplicatedStorage, RunService, SoundService, TweenService, Workspace } from "@rbxts/services";
import { LocalPlayerController } from "client/controller/LocalPlayerController";
import { Signals } from "client/Signals";
import { Interface } from "engine/client/gui/Interface";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { HostedService } from "engine/shared/di/HostedService";
import { GameDefinitions } from "shared/data/GameDefinitions";
import { Sound } from "shared/Sound";
import { TerrainDataInfo } from "shared/TerrainDataInfo";
import { PartUtils } from "shared/utils/PartUtils";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { GameHostBuilder } from "engine/shared/GameHostBuilder";

type Sounds = {
	readonly Build: {
		readonly BlockPlace: Sound;
		readonly BlockPlaceError: Sound;
		readonly BlockRotate: Sound;
		readonly BlockDelete: Sound;
	};
	readonly Start: Sound;
	readonly Click: Sound;
	readonly Warning: Sound;
	readonly Wind: Sound;
};

@injectable
class UnderwaterSoundEffect extends HostedService {
	constructor(@inject playerDataStorage: PlayerDataStorage) {
		super();

		const underwaterEffectsCache: EqualizerSoundEffect[] = [];
		const applyUnderwaterEffect = (sound: Sound) => {
			const effect = ReplicatedStorage.Assets.Sounds.Effects.Underwater.Clone();
			effect.Parent = sound;
			underwaterEffectsCache.push(effect);
		};
		const cleanupUnderwaterEffect = () => {
			for (const instance of underwaterEffectsCache) {
				instance?.Destroy();
			}
			underwaterEffectsCache.clear();
		};

		let isUnderwater = false;
		const cameraMoved = () => {
			const terrainType = playerDataStorage.config.get().environment.terrain.kind;
			if (terrainType !== "Classic" && terrainType !== "Water") {
				return;
			}

			// Underwater effect
			const isUnderwaterCheck = Workspace.CurrentCamera!.CFrame.Y <= TerrainDataInfo.waterLevel + 5;
			if (isUnderwaterCheck !== isUnderwater) {
				isUnderwater = isUnderwaterCheck;

				if (isUnderwater) {
					PartUtils.applyToAllDescendantsOfType("Sound", Workspace, (sound) => {
						applyUnderwaterEffect(sound);
					});
					PartUtils.applyToAllDescendantsOfType("Sound", Interface.getPlayerGui(), (sound) => {
						applyUnderwaterEffect(sound);
					});
				} else {
					cleanupUnderwaterEffect();
				}

				return;
			}
		};

		this.event.subscribe(Signals.CAMERA.MOVED, cameraMoved);
		this.event.subscribeRegistration(() =>
			SoundController.subscribeSoundAdded((sound) => {
				if (!isUnderwater) return;
				applyUnderwaterEffect(sound);
			}),
		);
	}
}

// Longer wavelengths diffract past the geometric cone, so each band gets its own edge and the top end cuts
// first. Tuned by ear: atmospheric absorption depends on humidity and temperature (ISO 9613-1), not a formula
// these could be derived from. Stored as sin/cos so the per-sound test is arithmetic with no trig.
const bleed = (degrees: number) => $tuple(math.sin(math.rad(degrees)), math.cos(math.rad(degrees)));
const [MID_BLEED_SIN, MID_BLEED_COS] = bleed(3);
const [LOW_BLEED_SIN, LOW_BLEED_COS] = bleed(10);

// Below this the camera is effectively sitting on the source, and the direction between them comes out of a
// near-zero vector, so sub-stud jitter swings it across the whole sphere. You are at the source anyway, which
// is the cone's apex, so it counts as inside.
const MIN_SEPARATION = 1; // studs

/** Mirrors the Doppler dials onto SoundService, which is where Roblox reads them from. */
@injectable
class DopplerSoundEffect extends HostedService {
	constructor(@inject playerDataStorage: PlayerDataStorage) {
		super();

		this.event.subscribeObservable(
			playerDataStorage.config,
			(config) => {
				SoundService.DopplerScale = config.sound.dopplerScale;
				SoundService.DistanceFactor = config.sound.distanceFactor;
			},
			true,
		);
	}
}

// Effects holding a delay line keep replaying what they buffered before the mute, so the sound trails on
// after being cut — a 1s echo at 0.5 feedback rings for several seconds. Filters have no such memory and
// are already inaudible once every band is down, so only these are worth suppressing.
const TAILED_EFFECTS: ReadonlySet<string> = new Set(["EchoSoundEffect", "ReverbSoundEffect"]);

// The front is one pressure wave, not a repeating source, so a craft gets one crack — held long enough that
// chattering back and forth across the cone edge does not stutter into a machine gun.
const BOOM_COOLDOWN = 3; // seconds, per assembly
// Where each clip takes over. Past the last one the front has spread too thin to register in the mix.
const BOOM_NEAR = 600; // studs
const BOOM_FAR = 2000; // studs
const BOOM_RANGE = 6000; // studs
// TimeLength reads 0 until the asset has loaded, so the host is collected on a fixed timer instead. Long
// enough to outlast the ten-second reverb tail on VeryDistant, which destroying the sound would cut short.
const BOOM_LIFETIME = 16; // seconds

/**
 * Sound emitted above Mach 1 is confined to a cone trailing the source, of half-angle `asin(c/V)` — ahead of
 * it nothing has arrived yet. The camera is tested against that cone per sound, and the three equalizer bands
 * are cut at slightly different angles because bass bends past the boundary and treble does not.
 */
@injectable
class SupersonicSoundEffect extends HostedService {
	constructor(@inject playerDataStorage: PlayerDataStorage) {
		super();

		const template = ReplicatedStorage.Assets.Sounds.Effects.Supersonic;
		const effects = new Map<Sound, EqualizerSoundEffect>();
		const sounds = new Set<Sound>();
		/** Which bands were last written, so a steady state costs no property writes. */
		const applied = new Map<Sound, number>();
		const ALL_AUDIBLE = 0;

		this.event.subscribeRegistration(() =>
			SoundController.subscribeSoundAdded((sound) => {
				sounds.add(sound);
				sound.Destroying.Once(() => {
					sounds.delete(sound);
					effects.delete(sound);
					applied.delete(sound);
					suppressed.delete(sound);
				});
			}),
		);

		/** Which bands the listener has been outrun by. Subsonic or co-located means none. */
		const coneMask = (listener: Vector3, source: Vector3, velocity: Vector3) => {
			const speed = velocity.Magnitude;
			if (speed <= GameDefinitions.SPEED_OF_SOUND) return ALL_AUDIBLE;

			const offset = listener.sub(source);
			// A listener sitting on the source has no direction to test, and the cone apex counts as inside.
			// Distance is deliberately not a factor: RollOffMaxDistance is where Inverse rolloff stops
			// attenuating, not where a sound ends, so skipping past it left distant sources audible.
			if (offset.Magnitude < MIN_SEPARATION) return ALL_AUDIBLE;

			// How far behind the source the listener sits, against the Mach angle. cos(mach + bleed) is
			// expanded through the angle-addition identity so no trig runs per sound.
			// fixme: the assembly's velocity, so a part far from the rotation centre of a spinning craft has
			// tangential velocity of its own that this does not account for.
			const behind = offset.Unit.Dot(velocity.Unit.mul(-1));
			const machSin = GameDefinitions.SPEED_OF_SOUND / speed;
			const machCos = math.sqrt(1 - machSin * machSin);

			let muted = ALL_AUDIBLE;
			if (behind < machCos) muted += 1;
			if (behind < machCos * MID_BLEED_COS - machSin * MID_BLEED_SIN) muted += 2;
			if (behind < machCos * LOW_BLEED_COS - machSin * LOW_BLEED_SIN) muted += 4;

			return muted;
		};

		/** Effects suppressed while a sound is fully cut. Only ones this turned off are listed, so any that
		 * were already disabled stay that way when it is restored. */
		const suppressed = new Map<Sound, SoundEffect[]>();
		const ALL_MUTED = 7;

		const apply = (sound: Sound, muted: number) => {
			if (applied.get(sound) === muted) return;
			applied.set(sound, muted);

			// Only at a full cut: a partial mask still leaves the sound audible, and stripping its effects
			// would change how it sounds rather than silence it.
			const tails = suppressed.get(sound);
			if (muted === ALL_MUTED && !tails) {
				const disabled: SoundEffect[] = [];
				for (const child of sound.GetChildren()) {
					if (!child.IsA("SoundEffect") || !child.Enabled) continue;
					if (!TAILED_EFFECTS.has(child.ClassName)) continue;

					child.Enabled = false;
					disabled.push(child);
				}

				suppressed.set(sound, disabled);
			} else if (muted !== ALL_MUTED && tails) {
				for (const effect of tails) {
					effect.Enabled = true;
				}

				suppressed.delete(sound);
			}

			// Nothing muted and no effect yet: leave the sound untouched rather than allocating one.
			let effect = effects.get(sound);
			if (!effect) {
				if (muted === ALL_AUDIBLE) return;

				effect = template.Clone();
				effect.Parent = sound;
				effects.set(sound, effect);
			}

			effect.HighGain = (muted & 1) !== 0 ? template.HighGain : 0;
			effect.MidGain = (muted & 2) !== 0 ? template.MidGain : 0;
			effect.LowGain = (muted & 4) !== 0 ? template.LowGain : 0;
		};

		const boomTemplates = ReplicatedStorage.Assets.Sounds.Supersonic;
		/** When each assembly last cracked, so a craft covered in speakers booms once rather than per sound. */
		const lastBoom = new Map<BasePart, number>();

		const boom = (part: BasePart, position: Vector3, distance: number) => {
			const now = time();
			for (const [assembly, at] of lastBoom) {
				if (now - at > BOOM_COOLDOWN) lastBoom.delete(assembly);
			}

			const root = part.AssemblyRootPart ?? part;
			if (lastBoom.has(root)) return;
			lastBoom.set(root, now);

			// Its own host rather than the craft's part: the craft is still supersonic, so anything parented
			// to it would be cut by the cone above. A static host reads as subsonic and is left alone.
			const host = new Instance("Part");
			host.Anchored = true;
			host.CanCollide = false;
			host.CanQuery = false;
			host.CanTouch = false;
			host.Transparency = 1;
			host.Size = Vector3.one;
			host.Position = position;
			host.Parent = Workspace;

			// Distance picks the clip, not just the level — air absorption strips the crack off a boom long
			// before it strips the energy, so a far one is a different sound rather than a quieter one.
			const template =
				distance < BOOM_NEAR
					? boomTemplates.SonicBoom
					: distance < BOOM_FAR
						? boomTemplates.Distant
						: boomTemplates.VeryDistant;

			const sound = Sound.cloneRouted(template);
			sound.Volume = SoundController.getWorldVolume(template.Volume);
			sound.Parent = host;
			sound.Play();
			Debris.AddItem(host, BOOM_LIFETIME);
		};

		const wind = SoundController.getUISounds().Wind;

		// Turning it off has to put back what it changed, so everything is released once on the transition
		// rather than left muted; the change gate makes the pass free from then on.
		let enabled = true;

		this.event.subscribe(RunService.PreRender, () => {
			const config = playerDataStorage.config.get().sound;
			if (!config.supersonicScaling) {
				if (enabled) {
					enabled = false;
					for (const sound of sounds) {
						apply(sound, ALL_AUDIBLE);
					}

					apply(wind, ALL_AUDIBLE);
				}

				return;
			}
			enabled = true;

			const camera = Workspace.CurrentCamera;
			if (!camera) return;
			const listener = camera.CFrame.Position;

			const booms = config.supersonicBooms;

			for (const sound of sounds) {
				const part = sound.Parent;
				if (!part || !part.IsA("BasePart")) continue;

				const position = part.Position;
				const velocity = part.AssemblyLinearVelocity;
				const mask = coneMask(listener, position, velocity);

				// The high band is the one that does not bend past the boundary, so it clearing while the
				// source is still supersonic is the geometric cone edge crossing the camera — the boom.
				if (booms) {
					const prev = applied.get(sound);
					if (prev !== undefined && (prev & 1) !== 0 && (mask & 1) === 0) {
						const distance = listener.sub(position).Magnitude;
						if (distance < BOOM_RANGE && velocity.Magnitude > GameDefinitions.SPEED_OF_SOUND) {
							boom(part, position, distance);
						}
					}
				}

				apply(sound, mask);
			}

			// Wind is a 2D interface sound with no position of its own, so the head stands in as its source —
			// a cockpit camera sits on it and keeps the noise, while one parked ahead of the craft loses it
			// along with everything else.
			const head = LocalPlayer.head.get();
			if (head) {
				apply(wind, coneMask(listener, head.Position, head.AssemblyLinearVelocity));
			}
		});
	}
}

class WindSoundEffect extends HostedService {
	constructor() {
		super();

		const sound = SoundController.getUISounds().Wind;
		const maxVolume = 6;
		const maxSoundSpeed = 2;
		const maxSpeed = 900;

		this.event.subscribe(RunService.PostSimulation, () => {
			const speed = LocalPlayer.rootPart.get()?.Velocity.Magnitude ?? 0;

			let ratio = (speed / maxSpeed) * 100;
			if (ratio > 100) {
				ratio = 100;
			}

			const volume = (maxVolume / 100) * ratio;
			const soundSpeed = (maxSoundSpeed / 100) * ratio;

			TweenService.Create(sound, new TweenInfo(0.25), {
				Volume: SoundController.getWorldVolume(volume),
				PlaybackSpeed: soundSpeed,
			}).Play();

			// sound.Volume = SoundController.getWorldVolume(volume);
			// sound.PlaybackSpeed = soundSpeed;
		});
	}
}

/** A class for controlling sounds and their effects */
export namespace SoundController {
	export function initializeAll(host: GameHostBuilder) {
		initializeUnderwaterEffect(host);
	}
	export function initializeUnderwaterEffect(host: GameHostBuilder) {
		host.services.registerService(UnderwaterSoundEffect);
		host.services.registerService(WindSoundEffect);
		host.services.registerService(SupersonicSoundEffect);
		host.services.registerService(DopplerSoundEffect);
	}

	export function subscribeSoundAdded(func: (sound: Sound) => void): SignalConnection {
		const connection = Workspace.DescendantAdded.Connect((sound) => {
			if (!sound.IsA("Sound")) return;
			func(sound);
		});

		for (const instance of Workspace.GetDescendants()) {
			if (!instance.IsA("Sound")) continue;
			func(instance);
		}

		return connection;
	}

	export function getUISounds<T = {}>(): T & Sounds {
		return (Interface.getPlayerGui() as unknown as { Sounds: T & Sounds }).Sounds;
	}

	export function getWorldVolume(volume: number) {
		return Sound.getWorldVolume(LocalPlayerController.getPlayerRelativeHeight()) * volume;
	}

	export function randomSoundSpeed(): number {
		return math.random(8, 12) / 10;
	}
}
