# Known bugs

Bugs found while consolidating helpers, left unfixed because fixing them changes behaviour. Each entry names
where the bug is, what goes wrong, and what the entry rests on — a reading of the code, or a run. None has been
reproduced in Studio.

## Speedometer angular acceleration is wrong in degree and rpm units

`src/shared/blocks/blocks/SpeedometerBlock.ts:74-77`. `localVelocity.angular` stores the angular velocity already
converted to the chosen unit (`l2.apply(applyUnit)`), and the next tick subtracts that from the raw radian value
before converting again: `l2.sub(localVelocity.angular).apply(applyUnit)`. At a steady 1 rad/s in degrees that
reads (1 − 57.2958) × 57.2958 ≈ −3225.5 every tick instead of 0. Radian mode is unaffected, since its multiplier
is 1.

Rests on: the code, and the arithmetic. Fix: store the raw `l2` and convert only on output.

## Replication gates treat a missing setting as off

`src/server/blocks/logic/{Laser,Tracer,Particle,Speaker}BlockServerLogic.ts`, `TextToSpeechServerLogic.ts`
(e.g. `LaserBlockServerLogic.ts:20,25`) gate on `!database.get(id)?.settings?.replication?.publicLasers`, so an
absent key counts as off, while the definition default is `true` (`PlayerConfig.ts:292`). A new server row is
`{}` (`PlayerDatabase.ts:59`) and holds only what the client has sent (`PlayerDataController.ts:26`). So a player
whose client never sent the replication keys neither sends nor receives lasers, tracers, particles, speakers or
text-to-speech, although their own settings UI shows these as on.

The copies also disagree with each other: `ServerEffectCreator.filterPlayer` (`:41-55`) checks only whether the
recipient blacklisted the owner, where the block gates check both directions, and it uses
`getPlotComponentByOwnerID`, which throws when there is no plot, where the others use `tryGet`.

Rests on: the code. Whether real clients ever leave the keys unsent was not checked.

## Laser beams are absorbed by accessories added after firing starts

`src/shared/weaponProjectiles/LaserProjectileLogic.ts:62-68` snapshots `ProjectileHitboxes.all()` into its own
`RaycastParams` once, in the constructor. `BaseProjectileLogic.ts:64` rebuilds the shared params on
`ProjectileHitboxes.changed`; the laser never subscribes. A continuous beam therefore stops at the hat of a
character that spawned or equipped an accessory after firing began, and the body behind it takes no damage.

Rests on: the code.

## Helium lift ignores custom gravity

`src/shared/blocks/blocks/HeliumBlock.ts:63` computes its counterforce with `Physics.GetGravityOnHeight(height)`,
which defaults to Earth gravity. The engine's gravity follows the player's `customGravity`
(`src/client/controller/GameEnvironmentController.ts:19`), so on the moon preset the counterforce is about 6× the
part's real weight. `GravitySensorBlock.ts:30` does pass `customGravity`.

Related, latent: `Physics.GetGravityModifierOnHeight(value, base)` (`src/shared/Physics.ts:20-22`) applies `base`
to the divisor but not to `GetGravityOnHeight`, so a caller passing `base` gets the wrong ratio. No caller passes
it today.

Rests on: the code.

## Client-detonated TNT skips blocks welded to an anchor block

`src/shared/BlastImpulse.ts:90` builds the damage list only from parts passing `BlockManager.isActiveBlockPart`,
which rejects any part whose assembly root is anchored (`BlockManager.ts:37-43`). TNT sends that list to the
server as the claimed set of hit blocks, and the server then skips its own query, so anything welded to an
anchored block takes no TNT damage, while a shell (no claim) damages it through the server's query in
`ServerBlockDamageController`. Client and server also measure distance differently (first part returned vs primary
part) and differ at the edge (`>= radius` vs `> radius`).

Rests on: the code at `BlastImpulse.ts` and `BlockManager.ts`; the server-side claim path is from the audit report
and was not re-read.

## Propmacro calls on maps keyed by client-supplied strings

A propmacro call compiles to `if type(x) == "table" and x.<name> ~= nil then x.<name>(x, ...) else Macros.<name>(x, ...)`
(e.g. `out/engine/client/event/InputHandler.luau:140`). On a `Map` whose string keys come from outside, a key equal
to the macro's name is called instead of the macro. Block uuids are such keys: `placeBlocks` has no payload
validator and the server rejects only a duplicate uuid (`BuildingPlot.ts:112-114`), so a crafted request can place
a block with uuid `"getOrSet"` or `"clone"`. The consolidation left the three sites where this would have applied
on their original code; existing code written this way before was not searched for.

Rests on: the compiled output and a headless run of the compiled module. Fix options: validate uuid format on
`placeBlocks`, or add a tripwire rule for propmacro calls on string-keyed maps.
