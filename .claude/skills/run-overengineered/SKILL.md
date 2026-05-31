---
name: run-overengineered
description: Build, run, verify, or smoke-test the overengineered Roblox game. Use when asked to build, compile, assemble, lint, check, run, or verify the project.
---

This is a Roblox game written in roblox-ts (TypeScript → Lua). The compiled
output is synced into Roblox Studio via Rojo. There is no headless runtime —
the game engine is Roblox Studio (Windows/macOS). In a Linux container the
pipeline stops at compilation and place assembly, which covers everything PRs
actually touch.

## Prerequisites

Node, npm, lune, and rojo must be available. They were already present in this
environment — no extra `apt-get` was required.

```bash
node --version   # v26.2.0
lune --version   # 0.10.4
```

## Build (agent path)

Run the smoke script — it does the full build-and-verify cycle and exits
non-zero on failure:

```bash
bash .claude/skills/run-overengineered/smoke.sh
```

What it does:
1. `npm run build` — rbxtsc compiles `src/` TypeScript to Lua in `out/`
2. `lune run assemble` — assembles `out/` + game assets into `place.rbxl`
3. `npx eslint src --max-warnings 0` — lint check

Success output ends with:
```
OK  out/ compiled, place.rbxl assembled (3.9M), lint clean
```

Type errors from rbxtsc appear inline in step 1 and fail with exit code 1.

## Gotchas

- `rbxtsc` is not on PATH — it's at `node_modules/.bin/rbxtsc`. `npm run build`
  resolves it correctly; calling `rbxtsc` directly fails.
- `lune run assemble` reads from `out/`, not `src/`. Running it on a stale
  `out/` silently bakes old code — always build first.
