// Roblox's domain-scoped user ID rollout retyped the userId parameter of several APIs from number to User.
// Staff guidance is that the transition is handled engine-side and existing number calls keep working, and
// developers on the rollout thread hit live-session failures when passing the new User objects while Studio
// was fine, so these calls still send a plain number and only the type is bridged.
// fixme: use User.fromId once the rollout has settled on every client build
export namespace DomainUser {
	export function fromId(userId: number): User {
		return userId as unknown as User;
	}
}
