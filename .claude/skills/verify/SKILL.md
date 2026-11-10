---
name: verify
description: How to confirm a change compiles and behaves in this repo while the dev watcher may be running — reading what the watcher refused (.dev.log, wait-for-out.js, dev-errors.js), a real rbxtsc compile that never touches out/ (compile-check.js), and throwaway Lune probes against the compiled modules (probe.js). Use whenever you have changed anything under src/, are about to claim something compiles or works, out/ looks stale, or want to compute a value instead of reasoning about it.
---

# Verifying code here

`out/` is the compiled Luau; every headless check reads it. Who writes `out/` decides what you may run:

- **`npm run dev` is up** (the usual case): `rbxtsc -w` owns `out/`. Never run `npm run build`. After an edit, wait
  for the watcher: `node .claude/skills/verify/scripts/wait-for-out.js`.
- **No watcher**: `npm run build` first, or `npm test`, which builds when no watcher is running.

The chain, in order:

| Command | Proves | Touches `out/`? |
|---|---|---|
| `node .claude/skills/verify/scripts/wait-for-out.js` | the watcher compiled your edit (a file left stale is a file it refused) | reads |
| `node .claude/skills/verify/scripts/compile-check.js` | `rbxtsc` accepts the whole tree, including what `tsc` never checks | no (scratch dir) |
| `npx eslint --cache <files you edited>` | style and import order | no |
| `npm run check` (or `npm test`) | the headless checks pass against the real compiled modules | reads |

A compile error is reported only in the dev terminal. `scripts/watch-all.js` copies that terminal into `.dev.log`;
`node .claude/skills/verify/scripts/dev-errors.js` prints the last compile cycle (`--all` for rojo and assets). With no
`.dev.log`, the watcher predates the copy or is not running, and `compile-check.js` is the way to see the message.

**Never run `rbxtsc` yourself** — not `npx rbxtsc`, not the CLI by path. `rbxtsc` deletes every file in its `outDir`
that has no source, and a hand-written config with an empty `outDir` deleted the repository root (2026-11-09).
`compile-check.js` is the only sanctioned way: it checks every path before it writes or removes anything.

The causes the watcher refuses that `tsc` and lint never see, and the ways it goes quiet, are listed in
`docs/claude/BUILD_AND_TOOLING.md` ("Seeing what the watcher refused").

## Probes

A probe runs a throwaway Luau snippet against `out/` — use one whenever the answer is a value you could compute.

```
node .claude/skills/verify/scripts/probe.js path/to/snippet.luau
node .claude/skills/verify/scripts/probe.js -e 'print(load("shared/SlotsMeta").SlotsMeta.isReadonly(-1))'
```

It writes `tests/_probe.luau` with a preamble, runs it under Lune and deletes it. Keep the snippet in your scratchpad.
The preamble gives `roblox`, `Vector3`, `Vector2`, `CFrame`, `Color3`, `Enum` (none are globals under Lune),
`rbxRequire("out/…")` and `load("…")` with `out/` implied. `driver.sh eval` in the `run-overengineered` skill is the
same idea with a different preamble.

How compiled code looks from Luau, from `LUAU_GOTCHAS.md`: a namespace function is called with `.`, a class method
with `:`; `Map`/`Set` are plain tables; classes are built with `.new`; a module importing `@rbxts/services` does not
load headlessly. `pcall(load, …)` before assuming either way.

## Reporting

Say what ran and what it proved, with numbers: "compile-check passes, lint clean, 31 tests pass; the Studio side is
unverified" is the shape. Code that needs a real render, player or physics step compiles and lints, and that is all
you can say about it headlessly.
