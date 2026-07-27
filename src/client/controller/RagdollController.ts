import { ContextActionService } from "@rbxts/services";
import { FlyController } from "client/controller/FlyController";
import { InputController } from "engine/client/InputController";
import { LocalPlayer } from "engine/client/LocalPlayer";
import { BlockDamageController } from "engine/shared/BlockDamageController";
import { Component } from "engine/shared/component/Component";
import { ComponentEvents } from "engine/shared/component/ComponentEvents";
import { HostedService } from "engine/shared/di/HostedService";
import { Keys } from "engine/shared/fixes/Keys";
import { SharedRagdoll } from "shared/SharedRagdoll";
import type { PlayerDataStorage } from "client/PlayerDataStorage";
import type { ReadonlyObservableValue } from "engine/shared/event/ObservableValue";

const { isPlayerRagdolling } = SharedRagdoll;

const IMPACT_DAMAGE_MIN_DIFF = 100;
const FALL_DAMAGE_MULTIPLIER = 2;
// The solver spreads a collision's velocity change over several frames, so one frame's delta under-reports it;
// compare against where we were this long ago instead.
const IMPACT_WINDOW = 0.1;
// Ring capacity for that window — covers well past 300 FPS, and overflowing only shortens the window.
const IMPACT_SAMPLES = 32;

function initAutoRagdoll(event: ComponentEvents, humanoid: Humanoid, enabled: ReadonlyObservableValue<boolean>) {
	let prevVelocity: Vector3 | undefined;
	// Velocity history, reused in place; `written` counts pushes, so the newest sits at (written - 1) % capacity.
	const sampleTimes: number[] = [];
	const sampleVelocities: Vector3[] = [];
	let written = 0;

	event.loop(0, () => {
		if (FlyController.active) return; // the admin fly tool moves fast; don't auto-ragdoll while noclipping
		if (!humanoid.RootPart) return;
		if (humanoid.Sit) return;
		if (isPlayerRagdolling(humanoid)) return;

		const state = humanoid.GetState();
		if (
			state === Enum.HumanoidStateType.Physics ||
			state === Enum.HumanoidStateType.GettingUp ||
			state === Enum.HumanoidStateType.Jumping
		) {
			prevVelocity = undefined;
			written = 0;
			return;
		}

		const velocity = humanoid.RootPart.AssemblyLinearVelocity;
		const now = time();

		// Oldest sample still inside the window, walking back from the newest.
		let reference: Vector3 | undefined;
		const available = math.min(written, IMPACT_SAMPLES);
		for (let back = 1; back <= available; back++) {
			const index = (written - back) % IMPACT_SAMPLES;
			reference = sampleVelocities[index];
			if (now - sampleTimes[index] >= IMPACT_WINDOW) break;
		}

		const slot = written % IMPACT_SAMPLES;
		sampleTimes[slot] = now;
		sampleVelocities[slot] = velocity;
		written++;

		// Whatever stopped us — terrain, our own machine, someone else's — the impact is how much velocity changed,
		// not how much speed was shed: a redirection (bounced off a wall, clipped by a passing hull) barely dents the
		// speed but is a violent change. The server ignores this unless the limb is registered, so mortality || pvp
		// gates it there.
		if (reference) {
			const delta = velocity.sub(reference);
			const impact = delta.Magnitude;
			if (impact >= IMPACT_DAMAGE_MIN_DIFF) {
				const verticality = math.abs(delta.Y) / math.max(impact, 0.001);
				BlockDamageController.instance?.applyDamage(humanoid.RootPart, {
					impactDamage: (impact - IMPACT_DAMAGE_MIN_DIFF) * (1 + (FALL_DAMAGE_MULTIPLIER - 1) * verticality),
				});
				// One collision stays inside the window for its whole length; drop the history so it bills once.
				written = 0;
			}
		}

		if (prevVelocity === undefined) {
			prevVelocity = velocity;
			return;
		}

		const diff = math.abs(velocity.Magnitude - prevVelocity.Magnitude);
		prevVelocity = velocity;

		const difference = state === Enum.HumanoidStateType.Landed ? 100 : 50;
		if (!enabled.get() || diff < difference) return;

		$trace("Ragdolled with a diff of", diff);
		SharedRagdoll.event.send(true);
	});
}
function initRagdollUp(
	event: ComponentEvents,
	humanoid: Humanoid,
	autoRecoveryByTimer: ReadonlyObservableValue<boolean>,
	autoRecoveryByMoving: ReadonlyObservableValue<boolean>,
) {
	const player = LocalPlayer.player;

	while (!player.Character?.FindFirstChild("ConstraintsFolder")) {
		task.wait();
	}

	const getUpTime = 4;
	const actionName = "ragdoll_autoRecovery";
	event.subscribeRegistration(() =>
		SharedRagdoll.subscribeToPlayerRagdollChange(humanoid, () => {
			if (isPlayerRagdolling(humanoid)) {
				humanoid.SetStateEnabled("GettingUp", false);
				humanoid.SetStateEnabled("Swimming", false);
				humanoid.SetStateEnabled("Seated", false);
				humanoid.ChangeState("Physics");

				if (humanoid.GetState() !== Enum.HumanoidStateType.Dead && humanoid.Health > 0) {
					task.spawn(() => {
						const unragdollIfSlow = () => {
							if (humanoid.Health <= 0) return;
							if (!humanoid.RootPart) return;
							if (!isPlayerRagdolling(humanoid)) return;

							if (humanoid.RootPart.AssemblyLinearVelocity.Magnitude < 10) {
								SharedRagdoll.event.send(false);
								ContextActionService.UnbindAction(actionName);

								return true;
							}
						};

						task.wait(getUpTime);

						if (autoRecoveryByTimer.get() && unragdollIfSlow()) return;

						if (autoRecoveryByMoving.get()) {
							ContextActionService.UnbindAction(actionName);
							ContextActionService.BindActionAtPriority(
								actionName,
								() => {
									task.spawn(() => SharedRagdoll.event.send(false));

									ContextActionService.UnbindAction(actionName);
									return Enum.ContextActionResult.Pass;
								},
								false,
								2000 + 1,
								...Enum.PlayerActions.GetEnumItems(),
							);
						}

						if (autoRecoveryByTimer.get()) {
							while (task.wait()) {
								if (unragdollIfSlow()) {
									break;
								}
							}
						}
					});
				}
			} else {
				humanoid.ChangeState("GettingUp");
				humanoid.SetStateEnabled("GettingUp", true);
				humanoid.SetStateEnabled("Swimming", true);
				humanoid.SetStateEnabled("Seated", true);

				const character = player.Character;
				if (character && !(character.WaitForChild("Humanoid") as Humanoid).Sit) {
					character.PivotTo(character.GetPivot().add(new Vector3(0, 2, 0)));
				}
			}

			humanoid.AutoRotate = !isPlayerRagdolling(humanoid);
		}),
	);
}
function initRagdollKey(event: ComponentEvents, key: ReadonlyObservableValue<{ triggerKey: KeyCode | undefined }>) {
	const actionName = "ragdoll";

	function bind(key: KeyCode, func: () => void) {
		ContextActionService.BindAction(
			actionName,
			(name, state, input) => {
				if (state === Enum.UserInputState.Begin) {
					func();
				}

				return Enum.ContextActionResult.Pass;
			},
			InputController.inputType.get() === "Touch",
			Keys.Keys[key],
		);

		ContextActionService.SetDescription(actionName, "funny falling");
		ContextActionService.SetImage(actionName, "rbxassetid://110824406341723");
		ContextActionService.SetPosition(actionName, new UDim2(0, 150, 0, 50));
	}
	function unbind() {
		ContextActionService.UnbindAction(actionName);
	}

	let can = true;
	const rebind = () => {
		const { triggerKey } = key.get();
		can = true;

		unbind();
		// "Unknown" is the unbound sentinel (KeyChooserControl); binding it hands BindAction Enum.KeyCode.Unknown, which it rejects
		if (!triggerKey || triggerKey === "Unknown") return;

		bind(triggerKey, () => {
			if (!can) return;

			const humanoid = LocalPlayer.humanoid.get();
			if (!humanoid || humanoid.Sit) return;

			const ragdolling = isPlayerRagdolling(humanoid);
			can = false;
			task.delay(1, () => (can = true));
			task.spawn(() => SharedRagdoll.event.send(!ragdolling));
		});
	};

	event.subscribeObservable(key, rebind);
	event.subscribeObservable(InputController.inputType, rebind);
	event.onEnable(rebind);
}

@injectable
export class RagdollController extends HostedService {
	constructor(@inject playerDataStorage: PlayerDataStorage) {
		super();

		initRagdollKey(
			this.event,
			playerDataStorage.config.createBased((c) => c.character.ragdoll),
		);
		this.event.subscribeObservable(
			LocalPlayer.humanoid,
			(humanoid) => {
				if (!humanoid) return;

				task.delay(1, () => {
					const character = LocalPlayer.character.get();
					if (!character) return;

					const component = new Component();
					const event = new ComponentEvents(component);

					initRagdollUp(
						event,
						humanoid,
						playerDataStorage.config.createBased((c) => c.character.ragdoll.autoRecovery),
						playerDataStorage.config.createBased((c) => c.character.ragdoll.autoRecoveryByMoving),
					);
					initAutoRagdoll(
						event,
						humanoid,
						playerDataStorage.config.createBased((c) => c.character.ragdoll.autoFall),
					);

					// A limb hitting 0 HP is dismembered server-side (its joint's "Dismembered" flag replicates).
					// Watch for that here on the character's owner and, once both legs are gone, ragdoll ourselves —
					// triggering it client-side rather than server-forcing keeps the client-owned physics in sync.
					const checkLegless = () => {
						if (SharedRagdoll.isLegless(character)) SharedRagdoll.event.send(true);
					};
					for (const joint of character.GetDescendants()) {
						if (!joint.IsA("Motor6D")) continue;
						event.subscribe(joint.GetAttributeChangedSignal("Dismembered"), checkLegless);
					}

					humanoid.Died.Once(() => component.disable());
					event.subscribe(character.GetPropertyChangedSignal("Parent"), () => {
						if (character.Parent) return;
						component.destroy();
					});

					component.enable();
				});
			},
			true,
		);
	}
}
