# P9 — Cursor types + position math

**Subject:** Adopt the new `Position` type (`{ blockId, offset }`) in cursor module. Port grapheme-cluster-aware position math from existing `cursor-ops.ts`. Build a parallel implementation; old cursor stays callable until editor cuts over.

**Reference:** Master spec migration step 10a; spec lines 109-119 (Position/Span types) and lines 122-139 (offset semantics).

## Goal

Cursor module today consumes legacy `Position` (path-based — uses `state-node.ts`). Phase 5+ requires a cursor module that consumes the new `Position` (`{ blockId: BlockId, offset: number }`). Per Path B, build a parallel new cursor module. Old cursor stays callable until P11.x editor migration consumes the new one.

This is a TYPES + POSITION MATH phase. Hit-testing and selection geometry (which depend on a stable editor) defer to P10.

## Dependencies

P1 (Layer 1 types — `Position`, `Span`, `BlockId`). Strictly that's it.

NOTE per round-4 strategy review: P9 does NOT depend on the editor work. It's a precondition for P11.1 (first action family that calls cursor ops).

## Current state

- `/Users/hansyu/code/taleweaver/packages/core/src/cursor/` directory:
  - `cursor-ops.ts` — the main cursor-navigation file. Consumes legacy types (imports `getNodeByPath` from `state/operations`, legacy `Position` from `state/position`, etc.).
  - `selection.ts` — the `Selection` type (= `Span`, in legacy `Position`-by-path).
  - `cursor.test.ts` — tests for cursor ops.
- Legacy `Position` lives in `/Users/hansyu/code/taleweaver/packages/core/src/state/position.ts` (path-based). New `Position` lives in `/Users/hansyu/code/taleweaver/packages/core/src/state/block-position.ts`.
- The cursor module also has files that are technically in `editor/` per directory survey:
  - `editor/cursor-position.ts`, `editor/cursor-position.test.ts`
  - `editor/hit-test.ts`, `editor/hit-test.test.ts`
  - `editor/line-navigation.ts`, `editor/line-navigation.test.ts`
  - `editor/selection-geometry.ts`, `editor/selection-geometry.test.ts`
  These are layout-coupled (depend on RenderNode tree from layout pass) — they belong to the cursor module logically, despite the directory placement. P9 may or may not touch these depending on the file boundary decision (Open Question 6 of strategy doc).

## Files involved

**Naming per `decisions.md` decision E (`-legacy` suffix on old):**

In the same commit that introduces the new parallel cursor implementation, rename `cursor/cursor-ops.ts` → `cursor/cursor-ops-legacy.ts` and update all imports. The new canonical `cursor/cursor-ops.ts` adopts new `Position`. After cutover, `cursor-ops-legacy.ts` is deleted in P15.

**Created (parallel new cursor — canonical name per decision E):**
- `cursor/cursor-ops.ts` (canonical) — adopts new `Position`. Contains:
  - `moveByCharacter(state, position, direction): Position` — grapheme-cluster aware.
  - `moveByWord(state, position, direction): Position` — UAX #29 word boundaries.
  - Maybe `moveByLine`, `moveByDocumentBoundary` — but these are layout-coupled (need RenderNode); could defer to P10.
- Test file alongside.

**Renamed in this phase (per decision E):**
- `cursor/cursor-ops.ts` → `cursor/cursor-ops-legacy.ts` (the old version). Imports throughout the codebase update to `cursor-ops-legacy`. P15 deletes.

**Untouched (in this phase):**
- `cursor/selection.ts` — stays on legacy `Position`-by-path until P11.3 selection migration.

**Open question on P9 scope (Open Question 6 in strategy):**
Do we also build new versions of the layout-coupled files (`editor/cursor-position.ts`, `editor/hit-test.ts`, etc.) in P9? Or do they belong entirely to P10? P9 plan must enumerate exactly which files it creates/touches.

## Key technical considerations

1. **Grapheme cluster boundaries.** The legacy `cursor-ops.ts` already implements UAX #29 grapheme-cluster boundaries (extended grapheme clusters via `Intl.Segmenter`). Port this logic — don't re-derive. The existing implementation has been validated against test fixtures.

2. **UTF-16 code-unit offsets.** Per spec, `Position.offset` counts UTF-16 code units (NOT grapheme clusters, NOT characters). So `moveByCharacter` advances by the next-grapheme-cluster's UTF-16 length, not by 1.

3. **Embed handling.** Per spec line 124, an embed item counts as 1 cursor position. `moveByCharacter` across an embed advances offset by 1.

4. **Cross-block movement.** When the cursor reaches the end of a block's inline content, `moveByCharacter` forward should advance to offset 0 of the next block (per `nextBlockInDocOrder` in Layer 2 utilities). Likewise reverse.

5. **`selection.ts` stays put.** P9 does NOT migrate the `Selection` type. That happens in P11.3 when action handlers cut over. Keeping selection on legacy types during P9 / P10 / P11.0-P11.2 means action handlers in those phases still look at legacy selection. This is acceptable under Path B.

## Risks and patterns to apply

- **DRY for grapheme-cluster code.** Don't re-implement UAX #29 logic; port it from legacy. Extract to a shared util if both old and new cursor need it during the parallel window (Path B), then dedupe in P15.
- **Cycle defense:** cursor walks across blocks via `nextBlockInDocOrder` / `prevBlockInDocOrder`, both of which are O(1)-per-step Layer 2 utilities — no cycles possible.
- **Test parity.** New cursor-ops tests should at least match the coverage of the legacy `cursor-ops.test.ts` (tests for grapheme boundaries, word boundaries, cross-block movement, embed handling).

## Test strategy

Per Phase 4 pattern. ~5-7 tasks:
- Implementation + sanity test.
- Grapheme-cluster movement tests (forward, backward).
- UAX #29 word movement tests.
- Cross-block movement tests.
- Embed-handling tests.
- Edge cases (start of document, end of document, empty block).
- Error cases (invalid position, missing block).

Estimated test count: 25-35.

## Open questions

1. **File boundary between P9 and P10** (Open Question 6 of strategy doc): which files are P9 vs P10? P9 plan must enumerate. Recommendation: P9 owns `cursor-ops.ts` (text-only navigation). P10 owns hit-test, selection-geometry, line-navigation (layout-coupled).

2. ✅ **Naming convention — resolved in `decisions.md` decision E (2026-05-16).** `-legacy` suffix on old; new code takes the canonical name. P9 renames `cursor/cursor-ops.ts` → `cursor/cursor-ops-legacy.ts` and introduces new canonical `cursor/cursor-ops.ts` in the same commit.

3. **Where do shared grapheme-cluster utilities live?** Decision E addresses file naming but not shared internals between `*-legacy.ts` and canonical. P9 plan picks: extract to a non-suffixed shared util (e.g., `cursor/grapheme-utils.ts`) that both `cursor-ops.ts` and `cursor-ops-legacy.ts` import. The shared util survives cutover.

## Success criteria

- New cursor entry point exists; takes `State` + new `Position`; returns new `Position` for forward/backward movement.
- All existing cursor ops behaviors preserved (grapheme clusters, words, cross-block, embed).
- Test parity with legacy `cursor-ops.test.ts`.
- Old cursor still compiles and works.
- Build green; no other module breaks.

## Review cycle expectations

Pre-execution: yes. Post-execution: yes.

## Estimated commits

~7-10.
