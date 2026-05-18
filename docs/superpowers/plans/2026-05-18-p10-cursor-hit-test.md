# P10 — Cursor Hit-Test + Selection Geometry on New Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build new versions of the four layout-coupled cursor files (`hit-test`, `selection-geometry`, `cursor-position`, `line-navigation`) that consume new `Position` / `State` (Y.Doc-backed) and the new renderer's RenderNode tree shape. Path B parallel: legacy `*-legacy.ts` versions stay callable through P11.3 cutover.

**Architecture:**
- Spatial walks continue to operate on `LayoutBox` trees produced by the existing `layoutTree` function — `LayoutBox` shape is unchanged. The differences from legacy are:
  - Input types are new `Position` (`{ blockId, offset }`) and new `State`.
  - Box-key parsing flips from the legacy `${nodeId}:${runIndex}` format to the new renderer's `${blockId}/inline/${itemIndex}` format (see P7's `expandInlineItems` and the block-level `view.id` keys).
  - State accessors flip from `getNodeByPath` / `getTextContentLength` (legacy) to `getBlock` / `inlineContentLength` (Y.Doc-backed).
- Shared `editor/layout-utils.ts` (`collectAllTextBoxes`, `collectBlockBoundaryLines`) has no legacy state dependencies; it stays in place, gets imported by both legacy and new files. Survives P15 cutover.
- New files live in `cursor/` (logical-cursor-module placement, resolving the spec's Open Q on file boundary); legacy files renamed in place at `editor/*-legacy.ts`.

**Tech Stack:** TypeScript, Vitest. Uses the layout pipeline (`layoutTree`), the new renderer (`render`, from P7), the new component registry (`createDefaultComponentRegistry`, from P8), and the new attr registry (`createDefaultAttrRegistry`, from P7).

## Resolved spec questions

- **Open Q 1 (file boundary P9 vs P10):** P9 already shipped grapheme/word/select/expand. P10 owns the four layout-coupled files. No overlap.
- **Open Q 2 (layout tree access):** P10 walks the LayoutBox tree itself via the existing `collectAllTextBoxes` (no new layout-module API). The block-id mapping comes from parsing box keys (`${blockId}/...` for new-renderer output).
- **Open Q 3 (selection bridges):** lives inside `selection-geometry.ts` as it does in legacy. Inter-block "selection extends to page edge" computed via `collectBlockBoundaryLines`. No new module split.
- **Open Q (file placement: cross-directory vs in-place rename):** new canonical files in `cursor/`; legacy renamed in place at `editor/*-legacy.ts`. Cross-directory pattern is cleaner architecturally — `cursor/` becomes the logical home for all cursor work.

---

## File Structure

**Renamed in P10 (Decision E `-legacy` suffix, in place at `editor/`):**
- `packages/core/src/editor/hit-test.ts` → `editor/hit-test-legacy.ts`
- `packages/core/src/editor/hit-test.test.ts` → `editor/hit-test-legacy.test.ts`
- `packages/core/src/editor/selection-geometry.ts` → `editor/selection-geometry-legacy.ts`
- `packages/core/src/editor/selection-geometry.test.ts` → `editor/selection-geometry-legacy.test.ts`
- `packages/core/src/editor/cursor-position.ts` → `editor/cursor-position-legacy.ts`
- `packages/core/src/editor/cursor-position.test.ts` → `editor/cursor-position-legacy.test.ts`
- `packages/core/src/editor/line-navigation.ts` → `editor/line-navigation-legacy.ts`
- `packages/core/src/editor/line-navigation.test.ts` → `editor/line-navigation-legacy.test.ts`

**Created (new canonical names in `cursor/`):**
- `packages/core/src/cursor/cursor-position.ts` — new `Position` → caret screen coords.
- `packages/core/src/cursor/hit-test.ts` — `(x, y)` → new `Position`.
- `packages/core/src/cursor/selection-geometry.ts` — rects for a `Span<NewPosition>`.
- `packages/core/src/cursor/line-navigation.ts` — `moveByLine`, `moveByLineBoundary` on new `Position`.
- Test files alongside each.

**Modified (legacy consumer import path updates):**
- `packages/core/src/index.ts` — barrel re-exports of `resolvePixelPosition`, `resolvePositionFromPixel`, `computeSelectionRects`, `moveToLine`, `moveToLineBoundary` flip to `-legacy` paths. EXPORT NAMES stay unchanged (public API surface preserved for `packages/dom/`).
- `packages/core/src/integration/pagination-cursor.test.ts` — flips its deep imports.

**Untouched:**
- `packages/core/src/editor/layout-utils.ts` — shared, no legacy state deps. Both old and new files import from it. P15 leaves it in place.

---

## Sub-phase ordering

Build-green-every-commit. Rename first; then implement the four new files in dependency order (cursor-position is foundational; hit-test, selection-geometry, line-navigation build on it).

1. **T1:** Atomic rename of all 8 legacy files (4 source + 4 tests) to `-legacy.ts`. Update 2 consumer files. Single atomic commit.
2. **T2:** New `cursor/cursor-position.ts` — `resolvePixelPosition(state, position, layoutTree, measurer): PixelPosition`. Foundational; T3-T5 depend on it.
3. **T3:** New `cursor/hit-test.ts` — `resolvePositionFromPixel(state, layoutTree, measurer, x, y, pageIndex?): Position | null`.
4. **T4:** New `cursor/selection-geometry.ts` — `computeSelectionRects(state, span, layoutTree, measurer, containerWidth): SelectionRect[]`.
5. **T5:** New `cursor/line-navigation.ts` — `moveToLine` + `moveToLineBoundary` on new `Position`.
6. **T6:** Final verification — full test sweep, parity check, build green.

Total commits: 6. Test count: ~30 across T2-T5 (T2: 8, T3: 8, T4: 8, T5: 6).

---

## T1: Rename 4 legacy files (8 files including tests) to `-legacy` suffix

**Files (atomic commit):**
- 8 renames via `git mv` (4 source + 4 test files, `editor/{hit-test, selection-geometry, cursor-position, line-navigation}.{ts, test.ts}` → `-legacy.{ts, test.ts}`).
- Update `packages/core/src/index.ts` — lines ~141-146 currently export `resolvePixelPosition`, `resolvePositionFromPixel`, `computeSelectionRects`, `moveToLine`, `moveToLineBoundary` from their unprefixed paths. Flip to `-legacy.ts` paths. EXPORT NAMES stay unchanged.
- Update `packages/core/src/integration/pagination-cursor.test.ts` — flip its deep-import paths.
- Update internal cross-file references between the renamed files: e.g., `line-navigation.ts` imports from `./cursor-position` and `./hit-test`, which after T1 become `./cursor-position-legacy` and `./hit-test-legacy`. Same for `selection-geometry.ts`'s import of `./cursor-position`.

### Steps

- [ ] **S1: Audit consumers**

```bash
grep -rln -E 'from "(\.{1,2}/)+editor/(hit-test|selection-geometry|cursor-position|line-navigation)"' /Users/hansyu/code/taleweaver/packages/core/src/ /Users/hansyu/code/taleweaver/packages/dom/src/ /Users/hansyu/code/taleweaver/packages/react/src/ 2>/dev/null | sort -u
```

Expected hits:
- `packages/core/src/index.ts` (barrel re-exports).
- `packages/core/src/integration/pagination-cursor.test.ts`.
- Internal cross-imports within the four files themselves (e.g., `line-navigation.ts` → `./cursor-position`, `./hit-test`; `selection-geometry.ts` → `./cursor-position`).

`packages/dom/src/` and `packages/react/src/` consume only the public API names from `@taleweaver/core`; the index barrel keeps those names stable, so no dom/react edits.

- [ ] **S2: Rename via git mv (8 files)**

```bash
cd /Users/hansyu/code/taleweaver/packages/core/src/editor
git mv hit-test.ts hit-test-legacy.ts
git mv hit-test.test.ts hit-test-legacy.test.ts
git mv selection-geometry.ts selection-geometry-legacy.ts
git mv selection-geometry.test.ts selection-geometry-legacy.test.ts
git mv cursor-position.ts cursor-position-legacy.ts
git mv cursor-position.test.ts cursor-position-legacy.test.ts
git mv line-navigation.ts line-navigation-legacy.ts
git mv line-navigation.test.ts line-navigation-legacy.test.ts
```

- [ ] **S3: Update consumer imports**

For each file in S1, mechanically replace:
- `from "./hit-test"` → `from "./hit-test-legacy"` (within `editor/` dir)
- `from "./selection-geometry"` → `from "./selection-geometry-legacy"`
- `from "./cursor-position"` → `from "./cursor-position-legacy"`
- `from "./line-navigation"` → `from "./line-navigation-legacy"`
- `from "../editor/hit-test"` → `from "../editor/hit-test-legacy"` (integration tests)
- `from "./editor/hit-test"` → `from "./editor/hit-test-legacy"` (`core/src/index.ts`)
- Same for the other three names.

ALSO update each renamed test file's self-import: `from "./hit-test"` → `from "./hit-test-legacy"`, etc.

CRITICAL: do NOT touch `editor/layout-utils.ts`, `editor/editor-state.ts`, `editor/editor-action.ts`, or anything else in `editor/`. Only the four renamed files and their direct cross-imports.

- [ ] **S4: Update `core/src/index.ts` barrel**

Look at lines ~141-146 (current state from earlier audit). They look like:

```typescript
export type { PixelPosition } from "./editor/cursor-position";
export { resolvePixelPosition } from "./editor/cursor-position";
export { resolvePositionFromPixel } from "./editor/hit-test";
export type { SelectionRect } from "./editor/selection-geometry";
export { computeSelectionRects } from "./editor/selection-geometry";
export { moveToLine, moveToLineBoundary } from "./editor/line-navigation";
```

Flip every `./editor/{name}` to `./editor/{name}-legacy`. Export names unchanged.

- [ ] **S5: Build + test**

```bash
npm run build --workspace=packages/core 2>&1 | tail -5
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: clean. 1372 tests still pass.

- [ ] **S6: Commit**

```bash
git add -A packages/core/src/
git commit -m "refactor(p10): rename 4 layout-coupled cursor files → -legacy (decision E)"
```

## Constraints

- File contents byte-equivalent except for cross-import updates within the four renamed files.
- All 1372 tests still pass.
- Public API surface preserved.
- Build green at this commit.
- No `as any`, no `!`, no `as unknown as`.

---

## T2: New `cursor/cursor-position.ts` — `resolvePixelPosition`

**Files:**
- Create: `packages/core/src/cursor/cursor-position.ts`
- Create: `packages/core/src/cursor/cursor-position.test.ts`

The new `resolvePixelPosition(state, position, layoutTree, shaperOrMeasurer): PixelPosition`:
- Reads `block = getBlock(state, position.blockId)` to verify the block exists.
- Walks the LayoutBox tree via `collectAllTextBoxes` from `editor/layout-utils.ts`.
- Filters text boxes whose key starts with `${position.blockId}/inline/` (the new renderer's inline-item key format).
- Within the matching boxes, finds the one containing the offset by accumulating offset counts per box (each box's text length contributes to the running offset).
- Computes prefix width using the measurer.
- Returns `PixelPosition { x, y, lineHeight, pageIndex, margins }`.

### Reference

Read `packages/core/src/editor/cursor-position-legacy.ts` for the algorithm. The new file mirrors the same spatial-search logic but:
- Replaces `getNodeByPath(state, position.path)` with `getBlock(state, position.blockId)`.
- Replaces the legacy box-key matching (parseBoxKey returning `nodeId`) with new-format parsing: split on `/inline/`, take the first half as `blockId`, the second half as `itemIndex` (or just match the prefix `${blockId}/inline/`).
- Returns `null` (or throws) for unknown blockIds — legacy returned a sentinel; match legacy's choice.

### Steps

- [ ] **S1: Write the failing tests**

Create `packages/core/src/cursor/cursor-position.test.ts`. Tests run the FULL pipeline: build state → `render(state, componentRegistry, attrRegistry).root` → `layoutTree(root, ...)` → `resolvePixelPosition(...)`.

8 tests:
1. Position at offset 0 of a single paragraph → returns `{ x: ~leftMargin, y: ~topMargin, ... }`.
2. Position at mid-text of a single paragraph → x advances by measured prefix width (with 8px-per-char mock shaper, offset 3 → x is 3 chars wider than offset 0).
3. Position at end-of-line wraps correctly: build a paragraph with 200 chars at containerInlineSize 800 → with 8px chars and ~100 chars/line, position at offset 100 lands at start of line 2 (x near leftMargin, y advanced by lineHeight).
4. Position in a second paragraph → y advances past paragraph 1 (single page).
5. Position lands on page 2 when paginated: build 5 paragraphs of 1 line each (each block ~16px tall + margins), set `pageConfig = { pageBlockSize: 60, pageInlineSize: 800, marginBlockStart: 10, marginBlockEnd: 10, marginInlineStart: 0, marginInlineEnd: 0, headerHeight: 0, footerHeight: 0 }`, then resolve a position in the 4th paragraph and assert `pageIndex === 1`. (Confirm the `PageConfig` field names against `packages/core/src/layout/page-config.ts` — the implementer should grep the actual fields and adjust if the names differ.)
6. Unknown blockId returns null OR throws (match legacy behavior — read legacy and match).
7. Position at offset 0 of an empty block → returns the block's baseline coords (no text to measure).
8. Position on an embed item: returns coords of the embed's ElementBox.

Use the canonical test setup pattern:

```typescript
import { describe, it, expect } from "vitest";
import { resolvePixelPosition } from "./cursor-position";
import { render } from "../render/render";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { layoutTree } from "../layout/dispatch";
import { createMockShaper } from "../layout/mock-shaper";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";
import { createPosition } from "../state/block-position";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";

function pipeline(state: State) {
  const root = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry()).root;
  const shaper = createMockShaper(8, 16); // 8px char width, 16px line height — codebase convention
  // layoutTree signature: (root, containerInlineSize, shaperOrMeasurer, pageConfig?)
  const layout = layoutTree(root, /* containerInlineSize */ 800, shaper, /* pageConfig */ undefined);
  return { layout, shaper };
}
```

Note on test infrastructure (verified pre-flight against actual exports):
- `layoutTree` lives in `../layout/dispatch` (not `../layout/layout-engine`). Signature: `(root, containerInlineSize, shaperOrMeasurer, pageConfig?)`.
- `createMockShaper(charWidth, lineHeight)` from `../layout/mock-shaper` is the codebase-standard mock. `createMockMeasurer` exists in `../layout/text-measurer` but is a 2-arg constructor (`(charWidth, lineHeight)`), not the no-arg call the earlier plan draft used. Prefer `createMockShaper` for uniformity with existing tests.
- T3/T4/T5 inherit this corrected pattern.

- [ ] **S2: Run tests (expected failure: module not found)**

```bash
npm test --workspace=packages/core -- "src/cursor/cursor-position.test" 2>&1 | tail -10
```

- [ ] **S3: Implement `packages/core/src/cursor/cursor-position.ts`**

Read `editor/cursor-position-legacy.ts` carefully (182 lines). Mirror its structure:
- Define `PixelPosition` interface (re-export from `-legacy.ts` if appropriate, OR redefine — match the legacy shape).
- Define internal helpers: parse the new-renderer box-key format `${blockId}/inline/${itemIndex}`; collect text boxes matching a blockId; sort spatially.
- Main function: `resolvePixelPosition(state, position, layoutTree, shaperOrMeasurer): PixelPosition | null`.

Imports:
- `State`, `getBlock` from `../state/state`.
- `Position` from `../state/block-position`.
- `BlockId` from `../state/block-id`.
- `LayoutBox`, `TextRunBox` from `../layout/layout-node`.
- `TextShaper`, `TextMeasurer` from `../layout/text-measurer` / `../layout/text-shaper`.
- `collectAllTextBoxes`, `AbsoluteTextBox` from `../editor/layout-utils` (cross-directory import; allowed).
- `inlineContentLength` from `../state/inline-content` (for end-of-block edge case).

JSDoc on `resolvePixelPosition`: explain the input contract (state has a block at `position.blockId`; layoutTree was produced by laying out the result of `render(state, ..., ...)`), the output shape, and the unknown-blockId behavior.

CRITICAL implementation details (read legacy carefully):
- Box-key format: legacy used `${nodeId}:${runIndex}`. New format: `${blockId}/inline/${itemIndex}`. Block-level ElementBox key === `view.id` === `block.id`. So new files filter text boxes by checking if `box.key.startsWith(blockId + "/inline/")`.
- Offset accumulation: legacy summed character counts across boxes belonging to the same node. New: same idea, but offset is into the BLOCK's inlineContent (not into a single text node). Each TextRunBox carries a slice of one inline-item's text; accumulating their `text.length` across spatially-sorted boxes reconstructs the block-level offset.

### Type safety constraints

- NO `as unknown as`, `as any`, `!` (non-null assertions). Use proper narrowing with `if (x === null) return ...` patterns.
- Box-key parsing: write a typed helper `parseInlineBoxKey(key: string): { blockId: BlockId; itemIndex: number } | null` that returns null for non-matching keys. No regex-cast tricks.

- [ ] **S4: Tests pass**

```bash
npm test --workspace=packages/core -- "src/cursor/cursor-position.test" 2>&1 | tail -10
```

Expected: 8/8 pass.

- [ ] **S5: Build green**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
```

- [ ] **S6: Commit**

```bash
git add packages/core/src/cursor/cursor-position.ts packages/core/src/cursor/cursor-position.test.ts
git commit -m "feat(p10): new cursor/cursor-position (new Position → pixel coords)"
```

## Constraints

- Consumes new `State` and new `Position` (`{ blockId, offset }`).
- Walks LayoutBox tree via `collectAllTextBoxes` from `editor/layout-utils`.
- Box-key parsing uses the new-renderer format (`${blockId}/inline/${itemIndex}`).
- **Public API barrel UNCHANGED.** Do NOT add `resolvePixelPosition` to `cursor/index.ts` (which doesn't exist) or `packages/core/src/index.ts`. The legacy name still exports from `-legacy.ts`. P11.4 swaps the barrel.
- No `as any`, no `!`, no `as unknown as`.

---

## T3: New `cursor/hit-test.ts` — `resolvePositionFromPixel`

**Files:**
- Create: `packages/core/src/cursor/hit-test.ts`
- Create: `packages/core/src/cursor/hit-test.test.ts`

New `resolvePositionFromPixel(state, layoutTree, shaperOrMeasurer, x, y, pageIndex?): Position | null`:
- Walks LayoutBox via `collectAllTextBoxes`.
- Filters to the target page (if pageIndex given).
- Groups boxes by line Y, binary-searches by y → target line.
- Within the line, finds the box containing x.
- Binary-searches character offset within the target box using measurer.
- Maps box key (`${blockId}/inline/${itemIndex}`) → `Position { blockId, offset }` by parsing the key and accumulating block-level offset across preceding boxes with the same blockId.

### Reference

Read `editor/hit-test-legacy.ts` (160 lines). Mirror structure but:
- Replace legacy box-key parsing (`nodeId` from `:N` suffix) with new format parsing.
- Replace `findPathById` with a typed accumulator that walks all boxes for the target blockId and sums their text lengths up to the target box.
- Return new `Position` (not legacy `Selection`).

### Steps

- [ ] **S1: Write the failing tests**

8 tests:
1. Click at top-left of a single paragraph → offset 0.
2. Click mid-text → correct offset via measurer binary search.
3. Click past end of a line → offset at line end (or wraps to next line, match legacy).
4. Click below all text → returns null (or last position; match legacy).
5. Click in second paragraph of multi-block doc → returns position in second block.
6. Click on an embed → returns position at the embed (offset 0 of the embed's "slot" in inlineContent).
7. Page-specific click (with `pageIndex` arg) returns the right page.
8. Click outside any box returns null.

Use the same pipeline-construction pattern from T2's tests.

- [ ] **S2: Implement**

Same structure as T2. Implementer reads `hit-test-legacy.ts` for the algorithm and adapts:
- `parseInlineBoxKey` from T2 may be DRY-able (extract to a shared helper file, e.g., `cursor/box-key-utils.ts`); if so, do it now while only T2 and T3 need it.
- Return null cases match legacy.

- [ ] **S3-S6:** tests pass, build, commit `feat(p10): new cursor/hit-test ((x,y) → new Position)`.

## Constraints

- Consumes new `State`, returns new `Position`.
- Box-key parsing shared with T2 (extract to `cursor/box-key-utils.ts` if pattern recurs).
- Public API barrel UNCHANGED.
- No `as any`, no `!`, no `as unknown as`.

---

## T4: New `cursor/selection-geometry.ts` — `computeSelectionRects`

**Files:**
- Create: `packages/core/src/cursor/selection-geometry.ts`
- Create: `packages/core/src/cursor/selection-geometry.test.ts`

New `computeSelectionRects(state, span, layoutTree, shaperOrMeasurer, containerWidth): SelectionRect[]`:
- Resolves `span.anchor` and `span.focus` to pixel positions via the new `resolvePixelPosition` from T2.
- Builds per-page line-edge maps via `collectBlockBoundaryLines` from `editor/layout-utils`.
- Iterates lines between start and end, emitting rects for first-line, middle-lines, last-line, with selection-bridge handling at block boundaries.

### Reference

Read `editor/selection-geometry-legacy.ts` (248 lines — the largest of the four). Mirror its structure, but consume new `Span` (from `state/block-position.ts`) and new `State`.

Span-related helpers: `selectionStart(span)` and `selectionEnd(span)` exist in `cursor/selection.ts` for legacy Selection, but they're typed to legacy Position. The new Span doesn't have established normalization helpers yet.

**Resolution (layering-aware):** add `spanStart(state, span): Position` and `spanEnd(state, span): Position` to `packages/core/src/state/block-compare.ts`. They use the existing cross-block compare there (which already takes `State` to walk the block tree). This is the correct architectural layer:
- `block-position.ts` is a leaf type module that imports only `BlockId` — adding `State`-dependent helpers there would invert the dependency hierarchy.
- `block-compare.ts` already imports `State` and is the documented home for cross-block compare (see `block-position.ts:47` comment pointing at `block-compare.ts`).

Add 2 tests for `spanStart` / `spanEnd` to `packages/core/src/state/block-compare.test.ts`:
1. Span where anchor precedes focus in doc order → `spanStart === anchor`, `spanEnd === focus`.
2. Span where focus precedes anchor in doc order → `spanStart === focus`, `spanEnd === anchor`.

T4 imports `spanStart`, `spanEnd` from `../state/block-compare`. Bump T4's test count accordingly.

### Steps

- [ ] **S1: Add `spanStart` / `spanEnd` to `state/block-compare.ts`** (uses the existing cross-block compare; takes `State`). Add 2 tests to `state/block-compare.test.ts`. Verify build.

- [ ] **S2: Failing test in `cursor/selection-geometry.test.ts`** — 8 tests:
  1. Single-block single-line selection → one rect.
  2. Single-block multi-line selection → multiple rects (one per line).
  3. Multi-block selection → rects per block, with selection bridges at block boundaries.
  4. Selection across page break → rects split per page.
  5. Empty (collapsed) selection → empty array.
  6. Selection across a paragraph break (selection bridge from one paragraph's last line to next paragraph's first line) → bridge rect present.
  7. Selection ending at start of a block → no rect for that block (or zero-width rect; match legacy).
  8. Selection in document with embed items → embed positions covered correctly.

- [ ] **S3: Implement `cursor/selection-geometry.ts`** mirroring `selection-geometry-legacy.ts`'s algorithm but:
  - Input is new `Span` (not legacy `Selection`).
  - Uses new `resolvePixelPosition` (T2) and `spanStart`/`spanEnd` from `state/block-compare`.
  - Replaces `getNodeByPath` / `getTextContentLength` with `getBlock` / `inlineContentLength`.
  - Box-key parsing per the new format (T2's shared helper).

- [ ] **S4-S6:** tests pass (8 new + 2 from S1 = 10), build, commit `feat(p10): new cursor/selection-geometry (rects for new Span)`.

## Constraints

- Consumes new `State` and new `Span`.
- Depends on T2's `resolvePixelPosition`.
- Adds `spanStart` / `spanEnd` to `state/block-compare.ts` (small but real API addition; cross-block-aware compare lives there per layering).
- Public API barrel UNCHANGED.
- No `as any`, no `!`, no `as unknown as`.

---

## T5: New `cursor/line-navigation.ts` — `moveToLine` + `moveToLineBoundary`

**Files:**
- Create: `packages/core/src/cursor/line-navigation.ts`
- Create: `packages/core/src/cursor/line-navigation.test.ts`

New entry points:
- `moveToLine(state, position, layoutTree, shaperOrMeasurer, direction, targetX): { position: Position; targetX: number } | null`.
- `moveToLineBoundary(state, position, layoutTree, shaperOrMeasurer, boundary): Position | null`.

Composes T2's `resolvePixelPosition` and T3's `resolvePositionFromPixel`. Maintains a `targetX` between successive moveToLine calls (so vertical navigation keeps the column).

### Reference

Read `editor/line-navigation-legacy.ts` (149 lines). Mirror its structure; swap legacy types for new.

### Steps

- [ ] **S1: Failing tests** — 6 tests:
  1. moveToLine "down" from line 0 → line 1, x preserved.
  2. moveToLine "up" from line 1 → line 0.
  3. moveToLine across paragraph break.
  4. moveToLine at last line "down" → null (or unchanged; match legacy).
  5. moveToLineBoundary "start" → offset at line start.
  6. moveToLineBoundary "end" → offset at line end (handle the wrap-to-next-line edge case).

- [ ] **S2-S3: Failing run, implement.** Implementer uses the legacy algorithm + T2's `resolvePixelPosition` + T3's `resolvePositionFromPixel`. Imports new `Position` types.

- [ ] **S4-S6:** tests pass, build, commit `feat(p10): new cursor/line-navigation (moveToLine + moveToLineBoundary)`.

## Constraints

- Composes T2 + T3 — no new spatial walks introduced.
- Public API barrel UNCHANGED.
- No `as any`, no `!`, no `as unknown as`.

---

## T6: Final verification

- [ ] **S1: Test count audit**

```bash
npm test --workspace=packages/core -- "src/cursor/cursor-position.test" "src/cursor/hit-test.test" "src/cursor/selection-geometry.test" "src/cursor/line-navigation.test" 2>&1 | tail -5
```

Expected: ≥ 30 tests across the new files. Actual: T2: 8, T3: 8, T4: 8 cursor/selection-geometry tests + 2 in `state/block-compare.test.ts` (spanStart/spanEnd helpers added in T4 S1), T5: 6 = **32 new tests** total (10 in T4 across two files).

- [ ] **S2: Confirm spec success criteria**

- ✅ New `hit-test`, `selection-geometry`, `cursor-position`, `line-navigation` files exist in `cursor/`.
- ✅ All consume new `Position` / `State` / new RenderNode-tree-via-layout.
- ✅ Test parity with legacy versions (legacy 40 tests across the four; new 32 — close, covers all the in-scope behaviors).
- ⚠️ Browser smoke: deferred to P11.4 cutover. The new files have no UI consumer yet; legacy continues to drive the editor.
- ✅ Old versions still callable (legacy renderer + legacy cursor still wired in editor; 1372 baseline preserved).

- [ ] **S3: Full build + test**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: ~1372 + 32 = ~1404 passing, 4 skipped. Build exit 0.

## End of P10

After T6 the new cursor module is fully shipped (text/position math from P9 + layout-coupled hit-test/geometry/cursor-position/line-navigation from P10). The new pipeline is ready to be wired into the editor.

**P11.0–P11.4 (next):** the editor itself migrates from legacy to new. P11.0 introduces the type-flip + dual-rep bridge; P11.1-P11.3 migrate each action family; P11.4 finally swaps the renderer + cursor barrel and deletes the legacy editor action layer.

**Browser smoke deferral:** preserved. The new cursor files have no UI consumer yet. Smoke testing lands at P11.4 (or earlier P11.x phases that wire the new pipeline behind a feature flag for testing).

**P15:** delete all `*-legacy.ts` files (the four hit-test/geometry/position/navigation legacy files, plus the cursor-ops-legacy, the component-*-legacy files, the state-*-legacy files, etc.). Single sweep across the entire legacy seam.
