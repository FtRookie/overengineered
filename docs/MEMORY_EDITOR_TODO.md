# Memory editor / ROM — remaining work after the PR 26 review

Follow-ups from the PR 26 (ROM 16) review that were **not** fixed on `main`, because their fixes land in
files the PR modifies (merge conflict) or belong to the post-merge unification. 8-bit line numbers refer to
current `main`; 16-bit ones to the PR branch.

**Every item below was observed at PR head `127ec69c` and its current state is unknown** — the PR author may
fix any of them before merge, and line numbers will drift. Verify an item still exists in the merged code
before working on it, and delete it from this file if the merge already resolved it.

Already fixed on `main` (no PR conflict — `MemoryEditorPopup.ts` and `ReadonlyMemoryBlock.ts` are outside the
PR diff): bounded/clamped recolor, `loadBelow` paging bound, address-jump cursor clamp, scroll-label gate,
`math.floor` on the ROM read address.

## Deferred: fix lands in a PR-touched file — do after the merge

- **An explicit `0` typed into a never-written cell is silently dropped** (both editors).
  `ByteTextBoxControl.commit` / `WordTextBoxControl.commit` early-return when `num === value.get()`, and an
  unwritten cell's observable already defaults to `0`, so `submitted` never fires and `data[cell]` stays nil —
  the cell stays gray and the block's `size` output undercounts. Storing `[5, 0]` via the UI is impossible.
  Fix in the (ideally unified) control: fire `submitted` when the *cell* was never written, not only when the
  parsed number differs from the observable.

- **Over-long hex input truncates instead of clamping** (PR-introduced, both controls).
  `text.sub(-2)` / `sub(-4)` runs before `tonumber`, so `100` in a byte cell commits `0x00` where the old code
  clamped to `0xFF`. The clamp already exists in `NumberObservableValue` — set into the observable, then fire
  and display the clamped read-back so the bound has a single owner.

- **16-bit import/address parsers strip invalid characters before validating** (`MemoryEditor16Popup.ts`).
  `12G4` imports as `0x0124` with "Import successful!"; `hello` in the address box navigates to row 14.
  Keep the `%S+` tokenizer and the `0x`-prefix `gsub`, replace the sanitizing `gsub` with an anchored
  `^%x+$` match (destructure the LuaTuple). Makes the error branches reachable and kills the dead
  `parsed < 0` check.

- **16-bit full-grid recolor** (`MemoryEditor16Popup.ts` row callback): repaints 128×16 cells per commit.
  Port the bounded version now on `main`'s `MemoryEditorPopup.spawnRows` (fresh `getAll()`, floor bound,
  cursor-relative, clamped), and hoist the gray `Color3.fromRGB(180, 180, 180)` to a module constant.

- **`bytearray`/`wordarray` checkers have no `step`** (`BlockLogicTypes.ts:210-211`), so non-integer elements
  validate. Add the step argument — but note `T.primitives` is only consumed via `fromBlockConfigDefinition`,
  whose sole caller is `ScreenBlock`; the `wordarray` entry is currently consulted by nothing at all.

- **ROM 16 block regressions** (`ReadonlyMemoryBlock16.ts`): missing `limitFamily: "rom"` (a plot can hold
  1 ROM + 1 ROM 16, and `"rom"` limit grants don't apply), missing `search.partialAliases`, the
  `ReadonlyMemoryBlockLogic` export-name collision (rename `ReadonlyMemoryBlock16Logic`), the `wordAddr`
  identity alias where `math.floor` belongs (mirror the fix now on the 8-bit block).

## Post-merge structural work (supersedes several items above)

- **De-fork the four twins.** `MemoryEditor16Popup` (394 lines vs 337, same Studio template),
  `WordTextBoxControl` (3 literals), `ConfigControlWordArray` (1 format string), `ReadonlyMemoryBlock16`
  (4 literals). Shape: `HexTextBoxControl(gui, digits)` following `NumberTextBoxControl`'s parameterization,
  one popup parameterized by digit width (restore `numberToHex`, deleted in the 16-bit copy in favour of
  hardcoded `%04X`), one ROM definition factory à la `RandomAccessMemoryBlocks`. Fixes then land once for
  both bit widths — the fork had already diverged in both directions before merging.

- **Fold `wordarray` back into a parameterized array primitive** (`valueLimit`/`bits` field next to
  `lengthLimit`). Of its eight registration points only two are live (UI dispatch, `LogicValueStorages`);
  the checker is dead code, the wire colour is unreachable (`connectorHidden`), and the serializer's
  shape-based type reconstruction can never distinguish the two array types anyway. Removable immediately
  even without the fold: the whole `BlockConfigRegistrySave` addition (entry `:1295-1341`, registration
  `:1883`, types `:25`/`:152`) — a new block id cannot exist in a pre-v25 save.

- **Dirty-range tracking for the editors.** A `filledUntil` watermark on the popup replaces both the
  O(cellIndex) `data[j] ??= 0` backfill loop per commit and gives the recolor its exact dirty range.

## Known copied hazards, deliberately left (low priority)

- Popups are retained by `PopupController` forever (close only hides; ~2300 instances per open of either
  memory editor, plus two raw `CanvasPosition` connections that outlive the disable).
- `MemoryEditorRow`/`WordMemoryEditorRow` wire all 16 cells inside `onEnable` with a non-`clearOnDisable`
  `ComponentChildren` — a re-enable would double-wire every cell.
- `destroy()`-time `commit(true)` can fire `submitted` into a row whose Frame is already destroyed
  (`AsciiLabel` indexing throws) and can resurrect cleared data during `spawnRows()`; no repro found on
  desktop (focus is released before Clear/Import run), touch/gamepad unconfirmed.

## Needs a Studio look

- Whether 4-digit words render on one line in the shared `Popups.MemoryEditor` cell template, or wrap into
  stacked 2×2 digit blocks (`TextScaled` + `TextWrapped`, cells authored for 2 digits;
  `MaxVisibleGraphemes = 5` caps rendering but does not size). Also: both editors show identical headings —
  `TitleLabel` is never set by either popup.
