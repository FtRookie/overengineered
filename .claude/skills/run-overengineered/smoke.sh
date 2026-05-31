#!/usr/bin/env bash
# Smoke test for the overengineered build pipeline.
# Runs: TypeScript compile → place assembly → lint
# Exit 0 on success, non-zero on first failure.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "=== 1/3  TypeScript compile (rbxtsc) ==="
npm run build

echo "=== 2/3  Place assembly (lune run assemble) ==="
lune run assemble

echo "=== 3/3  Lint (eslint) ==="
npx eslint src --max-warnings 0

echo ""
echo "OK  out/ compiled, place.rbxl assembled ($(du -sh place.rbxl | cut -f1)), lint clean"
