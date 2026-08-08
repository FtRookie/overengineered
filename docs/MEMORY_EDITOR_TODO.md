# Memory editor / ROM — remaining work after PR 26

PR 26 merged as `7028c92f`. Everything the review raised has now been either fixed by the author in the PR,
fixed on `main` before the merge, or applied post-merge — except the structural work and the hazards below,
which are deliberate deferrals rather than oversights.

**Fixed by the PR author** (verified in the merged tree): bounded/clamped recolor in `MemoryEditor16Popup`,
anchored `^%x+$` validation in both the import and address parsers, `ReadonlyMemoryBlockLogic` export-name
collision (now `ReadonlyMemoryBlock16Logic`), the `wordAddr` identity alias, `WordTextBoxControl`'s
truncate-instead-of-clamp, and the dead `readonlymemory16` entry in `BlockConfigRegistrySave`.

**Fixed on `main` before the merge** (`MemoryEditorPopup.ts` / `ReadonlyMemoryBlock.ts` were outside the PR
diff): bounded/clamped recolor, `loadBelow` paging bound, address-jump cursor clamp, scroll-label gate,
`math.floor` on the ROM read address.

**Fixed post-merge**: `limitFamily: "rom"` and `search.partialAliases` on ROM 16, `math.floor` on its read
address, the can't-store-`0` bug in both text controls, `ByteTextBoxControl`'s over-long input zeroing
instead of clamping, and the per-repaint gray `Color3` allocation.

## Structural work (worth doing, none of it urgent)

- **De-fork the four twins.** `MemoryEditor16Popup` (397 lines vs 337, same Studio template),
  `WordTextBoxControl` (3 literals), `ConfigControlWordArray` (1 format string), `ReadonlyMemoryBlock16`
  (4 literals). Shape: `HexTextBoxControl(gui, digits)` following `NumberTextBoxControl`'s parameterization,
  one popup parameterized by digit width (restore `numberToHex`, dropped in the 16-bit copy in favour of a
  hardcoded `%04X`), one ROM definition factory à la `RandomAccessMemoryBlocks`. The post-merge fixes above
  had to be written twice for exactly this reason.

- **Fold `wordarray` back into a parameterized array primitive** (`valueLimit`/`bits` next to `lengthLimit`).
  Of its registration points only two are live (UI dispatch, `LogicValueStorages`); the `T.primitives`
  checker is consulted by nothing, and the wire colour is unreachable because the only `wordarray` input is
  `connectorHidden`. `T.fromBlockConfigDefinition` already receives the per-definition object and discards
  it, so a definition-derived checker is a small change.

- **Dirty-range tracking for the editors.** A `filledUntil` watermark on the popup replaces both the
  O(cellIndex) `data[j] ??= 0` backfill per commit and gives the recolor its exact dirty range.

- **Both `wordarray`/`bytearray` checkers omit `step`**, so a hand-edited save can carry non-integer
  elements. The UI paths all floor, so this is only reachable off-UI.

## Known copied hazards, deliberately left (low priority)

- `GenericControls.wordarray` is a bare-string `throw` where the file's convention is `undefined` + skip.
  Unreachable today: the live dispatcher is the local map that has a real `wordarray` entry.
- Popups are retained by `PopupController` forever (close only hides; ~2300 instances per open of either
  memory editor, plus two raw `CanvasPosition` connections that outlive the disable).
- `MemoryEditorRow`/`WordMemoryEditorRow` wire all 16 cells inside `onEnable` with a non-`clearOnDisable`
  `ComponentChildren` — a re-enable would double-wire every cell.
- `destroy()`-time `commit(true)` can fire `submitted` into a row whose Frame is already destroyed
  (`AsciiLabel` indexing throws) and can resurrect cleared data during `spawnRows()`; no repro found on
  desktop (focus is released before Clear/Import run), touch/gamepad unconfirmed. The post-merge `fromUser`
  flag deliberately leaves this path on the old equality check so teardown cannot mass-fill the array.
- 16-bit paging is inert (`contentSize` 128 == `maxRows` 128), so all 128 rows spawn at once. Harmless at
  the shipped `lengthLimit`, but raising it would strand rows past 127 as uneditable.
- `tb.MaxVisibleGraphemes = 5` is written per cell on every spawn. It cannot move to the template because
  the 8-bit editor clones the same `Popups.MemoryEditor` instance.

## Needs a Studio look

- Whether 4-digit words render on one line in the shared `Popups.MemoryEditor` cell template, or wrap into
  stacked 2×2 digit blocks (`TextScaled` + `TextWrapped`, cells authored for 2 digits;
  `MaxVisibleGraphemes = 5` caps rendering but does not size). Also: both editors show identical headings —
  `TitleLabel` is never set by either popup.
