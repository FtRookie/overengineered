#!/usr/bin/env bash
# Driver for the overengineered Roblox game.
#
# There is no way to launch this app headlessly — it is a Roblox game and the runtime is Studio.
# What IS available from the console is everything short of that: typecheck, lint, place assembly,
# and — via lunit's Lune shim — loading and calling the *actual compiled game modules* out of out/.
#
#   ./driver.sh verify     typecheck + lint + asset integrity   (fast; uses existing out/)
#   ./driver.sh build      full pipeline: compile + assemble + lint
#   ./driver.sh check      asset integrity only, full warning list
#   ./driver.sh modules    list compiled modules that are loadable outside Roblox
#   ./driver.sh eval '<luau>'    run Luau with rbx() to require compiled modules
#   ./driver.sh eval -f <file>   same, from a file
#   ./driver.sh assets <id|path> [--assert]   dump a block model tree, optionally assert it
#   ./driver.sh assets --find <substr>        find block ids and their model files
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

INVOKE=.claude/skills/run-overengineered/invoke

step() { printf '\n=== %s ===\n' "$1"; }
die()  { printf '\nFAIL  %s\n' "$1" >&2; exit 1; }

case "${1:-verify}" in

verify)
	# Deliberately does NOT compile: `npm run dev` may own out/, and rbxtsc -w keeps it current.
	step "1/3  Typecheck (tsc --noEmit)"
	if npx tsc --noEmit -p tsconfig.json 2>&1 | grep '^src/'; then
		die "type errors in src/"
	fi
	echo "no src/ type errors"

	step "2/3  Lint (eslint)"
	npx eslint src --max-warnings 0 || die "lint"
	echo "lint clean"

	step "3/3  Asset integrity (real BlockAssertions, headless)"
	lune run tests/assetcheck || die "assetcheck"
	;;

build)
	# `npm run dev` already runs rbxtsc -w over out/ and lunewatch over place.rbxl. A second compiler
	# writing the same trees mid-session corrupts what Studio is syncing, so refuse instead.
	if pgrep -f 'rbxtsc -w' >/dev/null 2>&1; then
		die "npm run dev is running (rbxtsc -w owns out/). Use 'verify' instead, or stop the watcher first."
	fi

	step "1/3  Compile (rbxtsc)"
	npm run build || die "compile"

	step "2/3  Assemble place.rbxl"
	lune run assemble || die "assemble"

	step "3/3  Lint (eslint)"
	npx eslint src --max-warnings 0 || die "lint"

	printf '\nOK  out/ compiled, place.rbxl assembled (%s), lint clean\n' "$(du -sh place.rbxl | cut -f1)"
	;;

check)
	lune run tests/assetcheck --full || die "assetcheck"
	;;

modules)
	shift
	# Loads each module for real rather than guessing from its imports. Timeout because module-scope code that
	# spin-waits would otherwise hang the listing.
	# A module can spawn a task at module scope that errors after the load returned; Lune reports that and exits
	# non-zero. The listing itself is still valid, so only a real timeout is a failure here.
	timeout 120 lune run .claude/skills/run-overengineered/modules "$@"
	[ $? -eq 124 ] && die "module listing timed out (a module may spin-wait at module scope)"
	;;

assets)
	shift
	# Reads game/Assets directly, so it needs no out/ unless --assert is passed.
	lune run .claude/skills/run-overengineered/assets "$@"
	;;

eval)
	shift
	[ $# -eq 0 ] && die "eval needs a snippet or -f <file>"
	if [ "$1" = "-f" ]; then
		lune run "$INVOKE" "$2"
	else
		lune run "$INVOKE" -e "$1"
	fi
	;;

*)
	sed -n '3,13p' "$0" | sed 's/^# \?//'
	exit 2
	;;
esac
