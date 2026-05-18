# P9 — Cursor Types + Position Math Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `cursor/cursor-ops.ts` that consumes Y.Doc-backed `State` + new `Position` (`{ blockId, offset }`) per master spec lines 109-119. Grapheme-cluster + UAX #29 word-boundary aware navigation, with cross-block movement via the Layer-2 traversal utilities. Runs in parallel with `cursor-ops-legacy.ts` (Path B) until the editor migrates in P11.x.

**Architecture:**
- `cursor/grapheme-utils.ts` (new shared util) — exports `nextGraphemeBoundary`, `prevGraphemeBoundary`, `nextWordBoundary`, `prevWordBoundary`. Pure functions over `string` + `number`. Used by both legacy and new cursor-ops; survives P15 cutover.
- `cursor/cursor-ops-legacy.ts` (renamed from `cursor-ops.ts`) — current implementation, unchanged except imports flip to `./grapheme-utils` for the segmentation primitives. Legacy `Selection` type unchanged. Deleted at P15.
- `cursor/cursor-ops.ts` (new canonical) — `moveByCharacter`, `moveByWord` return new `Position`; `selectWord`, `expandSelection` return new `Span` (from `state/block-position.ts`). Reads `block.inlineContent.items` for within-block offset accounting; `findItemAtOffset` / `inlineContentLength` from `state/inline-content.ts` are the primitives. Cross-block movement uses `nextBlockInDocOrder` / `prevBlockInDocOrder` from `state/block-traversal.ts`.

**Tech Stack:** TypeScript, Vitest, `Intl.Segmenter` (UAX #29 grapheme + word boundaries), existing Layer-1/Layer-2 state utilities.

## Resolved spec questions

- **Open Q 1 (file boundary between P9 and P10):** P9 owns text/position math only — `cursor-ops.ts`. P10 owns the layout-coupled files (`editor/cursor-position.ts`, `editor/hit-test.ts`, `editor/line-navigation.ts`, `editor/selection-geometry.ts`). Reason: those four depend on a stable RenderNode/LayoutBox tree that P9 doesn't need to touch. They migrate when the editor itself does.
- **Open Q 2 (naming):** Decision E — `-legacy` suffix on the old file; new takes the canonical name. Single atomic commit for the rename.
- **Open Q 3 (shared grapheme utilities):** extract to `cursor/grapheme-utils.ts`. Both legacy and new import from it. Survives the parallel window; not suffixed. P15 leaves it in place.
- **Open Q (Selection type):** P9 does NOT migrate `cursor/selection.ts`. The new cursor ops return new `Span` (from `state/block-position.ts`) where they need to express a range, NOT legacy `Selection`. Legacy `Selection` keeps consuming legacy `Position` until P11.3. This means legacy editor actions (which build `Selection` values) keep working unchanged.

---

## File Structure

**Renamed in P9 (Decision E `-legacy` suffix), atomic commit:**
- `packages/core/src/cursor/cursor-ops.ts` → `cursor-ops-legacy.ts`
- `packages/core/src/cursor/cursor.test.ts` → `cursor-ops-legacy.test.ts` (preserves test history under the new filename)
- ~13 consumer-import updates in `packages/core/src/` (`index.ts`, 5 integration tests, 7 editor/actions files).

**Created (new canonical names):**
- `packages/core/src/cursor/grapheme-utils.ts` — shared segmentation helpers.
- `packages/core/src/cursor/grapheme-utils.test.ts` — tests for the shared helpers.
- `packages/core/src/cursor/cursor-ops.ts` — new entry points: `moveByCharacter`, `moveByWord`, `selectWord`, `expandSelection`.
- `packages/core/src/cursor/cursor-ops.test.ts` — tests for the new module.

**Modified in P9:**
- `packages/core/src/cursor/cursor-ops-legacy.ts` (post-rename) — replace inline segmenter definitions with imports from `./grapheme-utils`. Pure refactor; behavior unchanged.

**Untouched:**
- `packages/core/src/cursor/selection.ts` — stays on legacy `Position`-by-path until P11.3.
- `packages/core/src/editor/cursor-position.ts`, `hit-test.ts`, `line-navigation.ts`, `selection-geometry.ts` — layout-coupled, deferred to P10.

---

## Sub-phase ordering

Build-green-every-commit. Mechanical rename first, then shared utility, then new cursor ops one entry point per task.

1. **T1:** Rename `cursor-ops.ts` → `cursor-ops-legacy.ts`. Atomic commit; update all 13 consumers.
2. **T2:** Extract grapheme/word segmenter helpers to `cursor/grapheme-utils.ts`. Update `cursor-ops-legacy.ts` to import from it. Tests for the helpers.
3. **T3:** New `cursor-ops.ts` with `moveByCharacter` — within-block grapheme advance + cross-block transition + embed-as-1-stop.
4. **T4:** Add `moveByWord` — UAX #29 word boundaries + cross-block.
5. **T5:** Add `selectWord` — returns a `Span` containing the word at position.
6. **T6:** Add `expandSelection` — anchor-fixed focus movement.
7. **T7:** Final verification — test parity check, build green, full suite sweep.

Total commits: 7. Estimated new tests: ~35-40 (covering legacy parity + the new inline-items-aware path).

---

## T1: Rename `cursor-ops.ts` → `cursor-ops-legacy.ts`

**Files (atomic commit):**
- Rename: `packages/core/src/cursor/cursor-ops.ts` → `cursor-ops-legacy.ts` (via `git mv`).
- Rename: `packages/core/src/cursor/cursor.test.ts` → `cursor-ops-legacy.test.ts` (via `git mv`). Edit the test's self-import.
- Modify (13 consumers — flip imports to `cursor-ops-legacy`):
  - `packages/core/src/index.ts` (line ~135).
  - `packages/core/src/integration/word-wrap.test.ts`, `incremental-pipeline.test.ts`, `inline-formatting.test.ts`, `nested-formatting.test.ts`, `multi-paragraph-editing.test.ts`.
  - `packages/core/src/editor/actions/expand-word.ts`, `delete-forward.ts`, `move-cursor.ts`, `move-word.ts`, `expand-selection.ts`, `delete-backward.ts`, `delete-word.ts`.

### Steps

- [ ] **S1: Audit consumers**

```bash
grep -rln -E 'from "(\.{1,2}/)+cursor/cursor-ops"' /Users/hansyu/code/taleweaver/packages/core/src/ /Users/hansyu/code/taleweaver/packages/dom/src/ /Users/hansyu/code/taleweaver/packages/react/src/ 2>/dev/null | sort -u
```

Expected 14 hits in `packages/core/src/`: 13 consumers (`index.ts`, 5 integration tests, 7 editor/actions files) plus the legacy file's own test sibling (`cursor.test.ts`) whose self-import gets updated in S3. If fewer, refine the pattern.

- [ ] **S2: Rename via git mv**

```bash
git mv /Users/hansyu/code/taleweaver/packages/core/src/cursor/cursor-ops.ts /Users/hansyu/code/taleweaver/packages/core/src/cursor/cursor-ops-legacy.ts
git mv /Users/hansyu/code/taleweaver/packages/core/src/cursor/cursor.test.ts /Users/hansyu/code/taleweaver/packages/core/src/cursor/cursor-ops-legacy.test.ts
```

- [ ] **S3: Update consumer imports**

For each file in S1, replace:
- `from "./cursor-ops"` → `from "./cursor-ops-legacy"` (within `cursor/` dir)
- `from "../cursor/cursor-ops"` → `from "../cursor/cursor-ops-legacy"` (editor/actions/)
- `from "../../cursor/cursor-ops"` → `from "../../cursor/cursor-ops-legacy"` (integration/)

Also update the renamed test file's self-import: `from "./cursor-ops"` → `from "./cursor-ops-legacy"`.

Be careful: do NOT touch imports of `./selection` or other `cursor/` files. Only the cursor-ops path.

- [ ] **S4: Build + test**

```bash
npm run build --workspace=packages/core 2>&1 | tail -5
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: clean. 1330 tests still pass (no count change — pure rename).

- [ ] **S5: Commit**

```bash
git add -A packages/core/src/
git commit -m "refactor(p9): rename cursor-ops.ts → cursor-ops-legacy.ts (decision E)"
```

## Constraints

- File contents byte-equivalent. Pure rename.
- All 1330 tests still pass; no count change.
- Public API surface preserved (`moveByCharacter`, `moveByWord`, `selectWord`, `expandSelection`, etc. still exported from `cursor/index.ts` → `core/src/index.ts` under the same names; just internal path flips).
- No `as any`, no `!`, no `as unknown as`.

---

## T2: Extract `grapheme-utils.ts` shared helpers

**Files:**
- Create: `packages/core/src/cursor/grapheme-utils.ts`
- Create: `packages/core/src/cursor/grapheme-utils.test.ts`
- Modify: `packages/core/src/cursor/cursor-ops-legacy.ts` — delete inline segmenter helpers, import from `./grapheme-utils`.

### Steps

- [ ] **S1: Write the failing tests**

Create `packages/core/src/cursor/grapheme-utils.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  nextGraphemeBoundary,
  prevGraphemeBoundary,
  nextWordBoundary,
  prevWordBoundary,
} from "./grapheme-utils";

describe("nextGraphemeBoundary", () => {
  it("advances by one code unit in ASCII text", () => {
    expect(nextGraphemeBoundary("hello", 0)).toBe(1);
    expect(nextGraphemeBoundary("hello", 4)).toBe(5);
  });

  it("returns text.length at end", () => {
    expect(nextGraphemeBoundary("hello", 5)).toBe(5);
    expect(nextGraphemeBoundary("hello", 99)).toBe(5);
  });

  it("treats a flag emoji (2 code points = 1 grapheme) as one step", () => {
    // 🇺🇸 = U+1F1FA U+1F1F8, each surrogate-paired → 4 UTF-16 code units
    const flag = "🇺🇸";
    expect(flag.length).toBe(4);
    expect(nextGraphemeBoundary(flag, 0)).toBe(4);
  });

  it("returns text.length on empty string", () => {
    expect(nextGraphemeBoundary("", 0)).toBe(0);
  });
});

describe("prevGraphemeBoundary", () => {
  it("retreats by one code unit in ASCII text", () => {
    expect(prevGraphemeBoundary("hello", 5)).toBe(4);
    expect(prevGraphemeBoundary("hello", 1)).toBe(0);
  });

  it("returns 0 at start", () => {
    expect(prevGraphemeBoundary("hello", 0)).toBe(0);
  });

  it("retreats across a multi-code-unit grapheme as one step", () => {
    const flag = "🇺🇸"; // 4 UTF-16 code units
    expect(prevGraphemeBoundary(flag, 4)).toBe(0);
  });
});

describe("nextWordBoundary", () => {
  it("lands at the end of a word", () => {
    // "hello world" — from offset 0, next word ends at 5.
    expect(nextWordBoundary("hello world", 0)).toBe(5);
  });

  it("skips whitespace to the next word's end", () => {
    // From offset 5 (the space), next word "world" ends at 11.
    expect(nextWordBoundary("hello world", 5)).toBe(11);
  });

  it("returns text.length at end-of-text", () => {
    expect(nextWordBoundary("hello", 5)).toBe(5);
  });
});

describe("prevWordBoundary", () => {
  it("lands at the start of the current word when inside it", () => {
    // "hello world", from offset 8 (inside "world"), prev = 6 (word start).
    expect(prevWordBoundary("hello world", 8)).toBe(6);
  });

  it("retreats to the previous word's start when at a word boundary", () => {
    // From offset 11 (end of "world"), prev = 6.
    expect(prevWordBoundary("hello world", 11)).toBe(6);
  });

  it("returns 0 when inside a word starting at index 0", () => {
    // "hello", from offset 3 (inside "hello"), prev = 0 (word start).
    // Exercises the path where the word starts at index 0 — the
    // `seg.index > 0` guard inside prevWordBoundary skips the "inside this word"
    // return, and the function falls through to return lastWordStart = 0.
    expect(prevWordBoundary("hello", 3)).toBe(0);
  });

  it("returns 0 at start", () => {
    expect(prevWordBoundary("hello", 0)).toBe(0);
  });
});
```

- [ ] **S2: Run tests (expected failure)**

```bash
npm test --workspace=packages/core -- "src/cursor/grapheme-utils.test" 2>&1 | tail -10
```

- [ ] **S3: Implement `packages/core/src/cursor/grapheme-utils.ts`**

Copy the four helper functions (`nextGraphemeBoundary`, `prevGraphemeBoundary`, `nextWordBoundary`, `prevWordBoundary`) plus the two segmenter constants from `cursor-ops-legacy.ts` (lines 8-76). The implementation is verbatim — no behavior change.

```typescript
/**
 * Grapheme cluster + UAX #29 word-boundary helpers, shared between the
 * legacy and new cursor-ops modules during the P9–P15 parallel window.
 * Survives the cutover.
 *
 * All functions are pure: input is a string + offset, output is a
 * boundary offset. Offsets count UTF-16 code units (matching String.length
 * / String.charAt indexing).
 */

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});
const wordSegmenter = new Intl.Segmenter(undefined, {
  granularity: "word",
});

/** Find the next grapheme cluster boundary after `offset` in `text`. */
export function nextGraphemeBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  for (const seg of graphemeSegmenter.segment(text)) {
    const end = seg.index + seg.segment.length;
    if (end > offset) return end;
  }
  return text.length;
}

/** Find the previous grapheme cluster boundary before `offset` in `text`. */
export function prevGraphemeBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;
  let lastStart = 0;
  for (const seg of graphemeSegmenter.segment(text)) {
    if (seg.index >= offset) return lastStart;
    lastStart = seg.index;
  }
  return lastStart;
}

/**
 * Find the next word boundary after `offset` in `text`. Always lands at
 * the END of a word, skipping any whitespace/punctuation between.
 */
export function nextWordBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  for (const seg of wordSegmenter.segment(text)) {
    const end = seg.index + seg.segment.length;
    if (seg.isWordLike && end > offset) {
      return end;
    }
  }
  return text.length;
}

/** Find the previous word boundary before `offset` in `text`. */
export function prevWordBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;
  let lastWordStart = 0;
  let foundWord = false;
  for (const seg of wordSegmenter.segment(text)) {
    const end = seg.index + seg.segment.length;
    if (seg.isWordLike) {
      if (end >= offset) {
        if (seg.index < offset && seg.index > 0) {
          return seg.index;
        }
        if (seg.index >= offset) {
          return foundWord ? lastWordStart : 0;
        }
      }
      lastWordStart = seg.index;
      foundWord = true;
    }
  }
  return foundWord ? lastWordStart : 0;
}
```

- [ ] **S4: Update `cursor-ops-legacy.ts`**

Delete lines 8-76 of `cursor-ops-legacy.ts` (the inline segmenter helpers). Add at the top:

```typescript
import {
  nextGraphemeBoundary,
  prevGraphemeBoundary,
  nextWordBoundary,
  prevWordBoundary,
} from "./grapheme-utils";
```

The function bodies that call these helpers (e.g., `moveByCharacter` line 95) now resolve through the import. No other changes.

- [ ] **S5: Run tests**

```bash
npm test --workspace=packages/core -- "src/cursor/" 2>&1 | tail -10
```

Expected: the new 14 grapheme-utils tests pass; all existing `cursor-ops-legacy.test.ts` tests still pass.

- [ ] **S6: Full build + test**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: 1330 + 14 = 1344 passing, 4 skipped.

- [ ] **S7: Commit**

```bash
git add packages/core/src/cursor/grapheme-utils.ts packages/core/src/cursor/grapheme-utils.test.ts packages/core/src/cursor/cursor-ops-legacy.ts
git commit -m "refactor(p9): extract grapheme/word segmenter helpers to grapheme-utils"
```

## Constraints

- `cursor-ops-legacy.ts` behavior unchanged (pure refactor).
- `grapheme-utils.ts` is NOT suffixed; it's a permanent shared utility.
- No `as any`, no `!`, no `as unknown as`.
- All existing tests still pass.

---

## T3: New `cursor-ops.ts` — `moveByCharacter`

**Files:**
- Create: `packages/core/src/cursor/cursor-ops.ts` (canonical; legacy is at `cursor-ops-legacy.ts`).
- Create: `packages/core/src/cursor/cursor-ops.test.ts`.

The new `moveByCharacter(state, position, direction): Position`:
- Reads `block.inlineContent` from `getBlock(state, position.blockId)`.
- Uses `findItemAtOffset` (from `state/inline-content.ts`) to locate the current item.
- Within a text item, advances by `nextGraphemeBoundary` / `prevGraphemeBoundary` against the item's text.
- Across an embed item, advances by 1 offset unit (embeds are single cursor positions).
- At the end of the block's inline content, advances to offset 0 of `nextBlockInDocOrder(state, blockId)`. Symmetric for backward (lands at `inlineContentLength` of the previous block).
- At document start/end, returns the input position unchanged.
- For unknown block ids, returns the input position unchanged (defensive — caller already errors elsewhere).

### Steps

- [ ] **S1: Write the failing tests**

Create `packages/core/src/cursor/cursor-ops.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { moveByCharacter } from "./cursor-ops";
import { buildState, buildBlock, inlineContent, text, embed } from "../test-utils/state-builders";
import { createPosition } from "../state/block-position";
import type { BlockId } from "../state/block-id";

describe("moveByCharacter (new) — within text", () => {
  it("advances forward by one ASCII grapheme", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const out = moveByCharacter(state, createPosition("p" as BlockId, 0), "forward");
    expect(out).toEqual({ blockId: "p", offset: 1 });
  });

  it("retreats backward by one ASCII grapheme", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const out = moveByCharacter(state, createPosition("p" as BlockId, 3), "backward");
    expect(out).toEqual({ blockId: "p", offset: 2 });
  });

  it("treats a flag emoji (4 UTF-16 code units) as one step", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("🇺🇸hi")]) }),
      ],
    });
    const out = moveByCharacter(state, createPosition("p" as BlockId, 0), "forward");
    expect(out).toEqual({ blockId: "p", offset: 4 });
  });

  it("retreats across an emoji as one step", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("🇺🇸hi")]) }),
      ],
    });
    const out = moveByCharacter(state, createPosition("p" as BlockId, 4), "backward");
    expect(out).toEqual({ blockId: "p", offset: 0 });
  });
});

describe("moveByCharacter (new) — embed handling", () => {
  it("advances past an embed by 1 offset unit", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("ab"), embed("fn-anchor", { contentBlockId: "fn1" }), text("cd")]),
        }),
      ],
    });
    // 'a''b'<embed>'c''d' → offsets 0..5 (text "ab"=2, embed=1, text "cd"=2; total 5).
    // From offset 2 (just past "ab", start of embed), forward should land at 3 (past the embed).
    const out = moveByCharacter(state, createPosition("p" as BlockId, 2), "forward");
    expect(out).toEqual({ blockId: "p", offset: 3 });
  });

  it("retreats past an embed by 1 offset unit", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("ab"), embed("fn-anchor", { contentBlockId: "fn1" }), text("cd")]),
        }),
      ],
    });
    const out = moveByCharacter(state, createPosition("p" as BlockId, 3), "backward");
    expect(out).toEqual({ blockId: "p", offset: 2 });
  });
});

describe("moveByCharacter (new) — cross-block", () => {
  it("advances from end-of-block to offset 0 of next block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("yo")]) }),
      ],
    });
    const out = moveByCharacter(state, createPosition("p1" as BlockId, 2), "forward");
    expect(out).toEqual({ blockId: "p2", offset: 0 });
  });

  it("retreats from offset 0 to end-of-content of previous block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("yo")]) }),
      ],
    });
    const out = moveByCharacter(state, createPosition("p2" as BlockId, 0), "backward");
    expect(out).toEqual({ blockId: "p1", offset: 2 });
  });

  it("returns input unchanged at start-of-document (backward)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 0);
    const out = moveByCharacter(state, pos, "backward");
    expect(out).toEqual(pos);
  });

  it("returns input unchanged at end-of-document (forward)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 2);
    const out = moveByCharacter(state, pos, "forward");
    expect(out).toEqual(pos);
  });

  it("returns input unchanged for unknown blockId", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
    });
    const pos = createPosition("missing" as BlockId, 0);
    const out = moveByCharacter(state, pos, "forward");
    expect(out).toEqual(pos);
  });
});
```

(11 tests covering: within-text forward/backward, multi-byte grapheme forward/backward, embed forward/backward, cross-block forward/backward, start/end of doc, unknown blockId.)

- [ ] **S2: Failing run**

```bash
npm test --workspace=packages/core -- "src/cursor/cursor-ops.test" 2>&1 | tail -15
```

- [ ] **S3: Implement `packages/core/src/cursor/cursor-ops.ts`**

```typescript
import type { State } from "../state/state";
import { getBlock } from "../state/state";
import type { Position } from "../state/block-position";
import { createPosition } from "../state/block-position";
import type { InlineContent } from "../state/inline-content";
import { inlineContentLength, findItemAtOffset } from "../state/inline-content";
import { nextBlockInDocOrder, prevBlockInDocOrder } from "../state/block-traversal";
import { nextGraphemeBoundary, prevGraphemeBoundary } from "./grapheme-utils";

/**
 * Move the cursor by one grapheme cluster in the given direction.
 *
 * Within a text item: advances by `nextGraphemeBoundary` /
 * `prevGraphemeBoundary` against the item's text. Embed items count as
 * exactly 1 cursor position (per master spec line 124) — moving across
 * an embed advances `offset` by 1. At the boundary of a block's inline
 * content, transitions to the next/prev block via
 * `nextBlockInDocOrder` / `prevBlockInDocOrder`.
 *
 * Returns the input position unchanged at document boundaries (no prev
 * before the first block; no next after the last) and for unknown
 * blockIds (defensive — caller is expected to validate, but we degrade
 * gracefully).
 */
export function moveByCharacter(
  state: State,
  position: Position,
  direction: "forward" | "backward",
): Position {
  const block = getBlock(state, position.blockId);
  if (block === null) return position;
  const content: InlineContent = block.inlineContent ?? { items: [] };
  const total = inlineContentLength(content);

  if (direction === "forward") {
    if (position.offset >= total) {
      const next = nextBlockInDocOrder(state, position.blockId);
      return next === null ? position : createPosition(next, 0);
    }
    const advanced = advanceForward(content, position.offset);
    return createPosition(position.blockId, advanced);
  }

  if (position.offset <= 0) {
    const prev = prevBlockInDocOrder(state, position.blockId);
    if (prev === null) return position;
    const prevBlock = getBlock(state, prev);
    if (prevBlock === null) return position;
    const prevTotal = inlineContentLength(prevBlock.inlineContent ?? { items: [] });
    return createPosition(prev, prevTotal);
  }
  const retreated = advanceBackward(content, position.offset);
  return createPosition(position.blockId, retreated);
}

function advanceForward(content: InlineContent, offset: number): number {
  const { itemIndex, withinItem } = findItemAtOffset(content, offset);
  const item = content.items[itemIndex];
  if (item === undefined) return offset; // defensive; total-check above should prevent this
  if (item.kind === "text") {
    const nextBoundary = nextGraphemeBoundary(item.text, withinItem);
    if (nextBoundary > withinItem) {
      return offset + (nextBoundary - withinItem);
    }
    // Already at item end — step to next item start (1 unit).
    return offset + 1;
  }
  // Embed item — single-unit step.
  return offset + 1;
}

function advanceBackward(content: InlineContent, offset: number): number {
  const { itemIndex, withinItem } = findItemAtOffset(content, offset);
  if (withinItem > 0) {
    const item = content.items[itemIndex];
    if (item !== undefined && item.kind === "text") {
      const prevBoundary = prevGraphemeBoundary(item.text, withinItem);
      return offset - (withinItem - prevBoundary);
    }
    // Inside an embed (shouldn't happen — embeds have withinItem === 0)
    // or item undefined — step 1 unit defensively.
    return offset - 1;
  }
  // At an item boundary (start of items[itemIndex]). Step into the previous item.
  const prev = content.items[itemIndex - 1];
  if (prev === undefined) return offset; // defensive; offset === 0 case handled above
  if (prev.kind === "text") {
    const prevBoundary = prevGraphemeBoundary(prev.text, prev.text.length);
    return offset - (prev.text.length - prevBoundary);
  }
  // Previous item is an embed — single-unit step.
  return offset - 1;
}
```

- [ ] **S4: Tests pass**

```bash
npm test --workspace=packages/core -- "src/cursor/cursor-ops.test" 2>&1 | tail -10
```

Expected: 11/11 pass.

- [ ] **S5: Build + full sweep**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: 1344 + 11 = 1355 passing, 4 skipped.

- [ ] **S6: Commit**

```bash
git add packages/core/src/cursor/cursor-ops.ts packages/core/src/cursor/cursor-ops.test.ts
git commit -m "feat(p9): new moveByCharacter (grapheme + embed + cross-block)"
```

## Constraints

- Returns new `Position` (`{ blockId, offset }`), NOT legacy `Selection` / `Span`.
- Cross-block via `nextBlockInDocOrder` / `prevBlockInDocOrder`, **filtered to content-bearing blocks**: the bare traversal helpers return ANY block in document order, including containers (`document`, `section`, `list`, `list-item`, `table`, `table-row`, `table-cell`) whose `inlineContent === null`. Cursors are not valid in containers — wrap the bare traversal in `findNextContentBlock(state, blockId)` / `findPrevContentBlock(state, blockId)` helpers (private to `cursor-ops.ts`) that skip past blocks where `inlineContent === null` until a leaf or null is reached. T4 reuses these same helpers.
- Embed = 1 offset unit per master spec.
- Defensive on unknown blockIds: returns input unchanged (caller is expected to validate).
- **Public API surface is unchanged.** The new `moveByCharacter` / `moveByWord` / `selectWord` / `expandSelection` are NOT re-exported from `cursor/index.ts` or `packages/core/src/index.ts` during P9. The legacy names there continue to point at `cursor-ops-legacy.ts`. P11.4 cutover swaps the barrel; P15 deletes the legacy entries. Adding the new exports to the barrel in P9 would shadow the legacy ones under the same names and break the editor.
- No `as any`, no `!`, no `as unknown as`.

---

## T4: Add `moveByWord`

**Files:**
- Modify: `packages/core/src/cursor/cursor-ops.ts` — add `moveByWord`.
- Modify: `packages/core/src/cursor/cursor-ops.test.ts` — add tests.

`moveByWord(state, position, direction): Position` mirrors `moveByCharacter` but uses `nextWordBoundary` / `prevWordBoundary`. UAX #29 word boundaries. Embeds act as word boundaries (the legacy `Intl.Segmenter` already handles this for the text item's content; for cross-item movement, embeds are barriers — step one item).

### Steps

- [ ] **S1: Failing tests**

Append to `cursor-ops.test.ts`:

```typescript
import { moveByWord } from "./cursor-ops";

describe("moveByWord (new)", () => {
  it("advances forward to end of next word within a text item", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world")]) }),
      ],
    });
    const out = moveByWord(state, createPosition("p" as BlockId, 0), "forward");
    expect(out).toEqual({ blockId: "p", offset: 5 });
  });

  it("retreats backward to start of current/previous word within a text item", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world")]) }),
      ],
    });
    const out = moveByWord(state, createPosition("p" as BlockId, 8), "backward");
    expect(out).toEqual({ blockId: "p", offset: 6 });
  });

  it("crosses block boundary to offset 0 when at end of last word in block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("world")]) }),
      ],
    });
    const out = moveByWord(state, createPosition("p1" as BlockId, 5), "forward");
    expect(out).toEqual({ blockId: "p2", offset: 0 });
  });

  it("crosses block boundary backward from offset 0 to last word start of previous block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello there")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("world")]) }),
      ],
    });
    const out = moveByWord(state, createPosition("p2" as BlockId, 0), "backward");
    expect(out).toEqual({ blockId: "p1", offset: 6 });
  });

  it("treats an embed as a word boundary (forward stops just before embed)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello"), embed("fn-anchor", { contentBlockId: "x" }), text("world")]),
        }),
      ],
    });
    // From offset 0, forward word lands at end of "hello" (5).
    const out = moveByWord(state, createPosition("p" as BlockId, 0), "forward");
    expect(out).toEqual({ blockId: "p", offset: 5 });
  });

  it("returns input unchanged at document boundaries", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    expect(moveByWord(state, createPosition("p" as BlockId, 0), "backward")).toEqual(createPosition("p" as BlockId, 0));
    expect(moveByWord(state, createPosition("p" as BlockId, 2), "forward")).toEqual(createPosition("p" as BlockId, 2));
  });
});
```

(6 tests.)

- [ ] **S2: Failing run, S3: Implement**

Add to `cursor-ops.ts`:

```typescript
import { nextWordBoundary, prevWordBoundary } from "./grapheme-utils";

/**
 * Move the cursor by one word (UAX #29 word boundary) in the given direction.
 *
 * Word boundaries are detected within each text item's text via
 * `Intl.Segmenter`. Embeds act as word barriers — `moveByWord` does NOT
 * traverse through an embed; instead, when it would cross one, the
 * position lands at the offset immediately before (forward) or after
 * (backward) the embed. Cross-block transitions: forward advances to
 * offset 0 of the next block; backward retreats to the start of the
 * last word of the previous block.
 */
export function moveByWord(
  state: State,
  position: Position,
  direction: "forward" | "backward",
): Position {
  const block = getBlock(state, position.blockId);
  if (block === null) return position;
  const content: InlineContent = block.inlineContent ?? { items: [] };
  const total = inlineContentLength(content);

  if (direction === "forward") {
    if (position.offset >= total) {
      const next = nextBlockInDocOrder(state, position.blockId);
      return next === null ? position : createPosition(next, 0);
    }
    const advanced = advanceWordForward(content, position.offset);
    return createPosition(position.blockId, advanced);
  }

  if (position.offset <= 0) {
    const prev = prevBlockInDocOrder(state, position.blockId);
    if (prev === null) return position;
    const prevBlock = getBlock(state, prev);
    if (prevBlock === null) return position;
    const prevContent = prevBlock.inlineContent ?? { items: [] };
    const prevTotal = inlineContentLength(prevContent);
    // Find last word start in prev block. Iterate items in reverse, pick
    // first text item's prevWordBoundary from its end.
    for (let i = prevContent.items.length - 1; i >= 0; i--) {
      const item = prevContent.items[i];
      if (item.kind !== "text") continue;
      const boundary = prevWordBoundary(item.text, item.text.length);
      // Compute the cumulative offset of this item's start in the block.
      let cum = 0;
      for (let j = 0; j < i; j++) {
        const it = prevContent.items[j];
        cum += it.kind === "text" ? it.text.length : 1;
      }
      return createPosition(prev, cum + boundary);
    }
    // No text items in prev block — land at its end (block boundary).
    return createPosition(prev, prevTotal);
  }
  const retreated = advanceWordBackward(content, position.offset);
  return createPosition(position.blockId, retreated);
}

function advanceWordForward(content: InlineContent, offset: number): number {
  const { itemIndex, withinItem } = findItemAtOffset(content, offset);
  const item = content.items[itemIndex];
  if (item === undefined) return offset;
  if (item.kind !== "text") {
    // Inside an embed — word movement steps past it (treat as a 1-unit step).
    return offset + 1;
  }
  const nextBoundary = nextWordBoundary(item.text, withinItem);
  if (nextBoundary > withinItem) {
    return offset + (nextBoundary - withinItem);
  }
  // At end of text item — step 1 unit (embed barrier or next item start).
  return offset + 1;
}

function advanceWordBackward(content: InlineContent, offset: number): number {
  const { itemIndex, withinItem } = findItemAtOffset(content, offset);
  if (withinItem > 0) {
    const item = content.items[itemIndex];
    if (item !== undefined && item.kind === "text") {
      const prevBoundary = prevWordBoundary(item.text, withinItem);
      return offset - (withinItem - prevBoundary);
    }
    return offset - 1;
  }
  // At item boundary — step into previous item.
  const prev = content.items[itemIndex - 1];
  if (prev === undefined) return offset;
  if (prev.kind !== "text") return offset - 1;
  const prevBoundary = prevWordBoundary(prev.text, prev.text.length);
  return offset - (prev.text.length - prevBoundary);
}
```

- [ ] **S4-S6:** tests pass, build, commit `feat(p9): new moveByWord (UAX #29 word boundary)`.

## Constraints

- Reads embed items as word barriers — does NOT walk through an embed in word movement.
- Cross-block: forward to offset 0 of next; backward to start of last word in prev.
- No `as any`, no `!`, no `as unknown as`.

---

## T5: Add `selectWord`

**Files:**
- Modify: `packages/core/src/cursor/cursor-ops.ts` — add `selectWord`.
- Modify: `packages/core/src/cursor/cursor-ops.test.ts` — add tests.

`selectWord(state, position): Span` returns a `Span` (from `state/block-position.ts`, NOT legacy `Selection`). Selects the word at the given position. Falls back to the preceding word if position is on whitespace. Empty block → collapsed span at position. Embed → collapsed span at position.

### Steps

- [ ] **S1: Failing tests**

```typescript
import { selectWord } from "./cursor-ops";

describe("selectWord (new)", () => {
  it("returns the span of the word at the position", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world")]) }),
      ],
    });
    const span = selectWord(state, createPosition("p" as BlockId, 3));
    expect(span.anchor).toEqual({ blockId: "p", offset: 0 });
    expect(span.focus).toEqual({ blockId: "p", offset: 5 });
  });

  it("falls back to preceding word when position is on whitespace", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world")]) }),
      ],
    });
    const span = selectWord(state, createPosition("p" as BlockId, 5)); // on the space
    expect(span.anchor).toEqual({ blockId: "p", offset: 0 });
    expect(span.focus).toEqual({ blockId: "p", offset: 5 });
  });

  it("returns a collapsed span on an empty block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 0);
    const span = selectWord(state, pos);
    expect(span.anchor).toEqual(pos);
    expect(span.focus).toEqual(pos);
  });

  it("returns a collapsed span when position falls on an embed", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([embed("fn-anchor", { contentBlockId: "x" })]),
        }),
      ],
    });
    const pos = createPosition("p" as BlockId, 0);
    const span = selectWord(state, pos);
    expect(span.anchor).toEqual(pos);
    expect(span.focus).toEqual(pos);
  });
});
```

- [ ] **S2: Failing run, S3: Implement**

Add to `cursor-ops.ts`:

```typescript
import type { Span } from "../state/block-position";
import { createSpan } from "../state/block-position";

// reuse existing wordSegmenter constant? No — it's in grapheme-utils. Re-import or
// add a helper to grapheme-utils. For selectWord we need segment iteration, not
// just a boundary lookup. Add an iterator helper to grapheme-utils:
import { iterateWordSegments } from "./grapheme-utils";

/**
 * Return a Span covering the word that contains `position`. If `position`
 * lies on whitespace/punctuation, returns the preceding word's span. On
 * an empty block or with no preceding word in the block, returns a
 * collapsed span at `position`.
 *
 * Operates within a single block — does not cross block boundaries. (A
 * P11.x action that wants triple-click or similar may compose this with
 * cross-block logic.)
 */
export function selectWord(state: State, position: Position): Span {
  const block = getBlock(state, position.blockId);
  if (block === null) return createSpan(position, position);
  const content = block.inlineContent ?? { items: [] };
  const { itemIndex, withinItem } = findItemAtOffset(content, position.offset);
  const item = content.items[itemIndex];
  if (item === undefined || item.kind !== "text") {
    return createSpan(position, position);
  }
  // Compute item's start offset in the block.
  let itemStart = 0;
  for (let i = 0; i < itemIndex; i++) {
    const it = content.items[i];
    itemStart += it.kind === "text" ? it.text.length : 1;
  }

  // Find a word segment containing `withinItem`.
  let containing: { start: number; end: number } | null = null;
  let lastWord: { start: number; end: number } | null = null;
  let nextWord: { start: number; end: number } | null = null;
  for (const seg of iterateWordSegments(item.text)) {
    if (!seg.isWordLike) continue;
    if (seg.start <= withinItem && seg.end >= withinItem) {
      containing = seg;
      break;
    }
    if (seg.end <= withinItem) {
      lastWord = seg;
    } else if (nextWord === null) {
      nextWord = seg;
    }
  }
  const word = containing ?? lastWord ?? nextWord;
  if (word === null) return createSpan(position, position);
  const anchor = createPosition(position.blockId, itemStart + word.start);
  const focus = createPosition(position.blockId, itemStart + word.end);
  return createSpan(anchor, focus);
}
```

Also add to `grapheme-utils.ts`:

```typescript
/**
 * Iterate UAX #29 word segments of `text`, exposing each segment's
 * boundaries and whether it's a word-like token (vs whitespace/punct).
 * Wraps `Intl.Segmenter` so cursor-ops doesn't reach for the segmenter
 * directly. Used by `selectWord`.
 */
export function* iterateWordSegments(
  text: string,
): Iterable<{ start: number; end: number; isWordLike: boolean }> {
  for (const seg of wordSegmenter.segment(text)) {
    yield {
      start: seg.index,
      end: seg.index + seg.segment.length,
      isWordLike: seg.isWordLike ?? false,
    };
  }
}
```

Add tests for `iterateWordSegments` to `grapheme-utils.test.ts` (append to the existing T2 file). These exercise the boundary accounting (`end = start + length`) and the `isWordLike` flag plumbing that `selectWord` depends on:

```typescript
import { iterateWordSegments } from "./grapheme-utils";

describe("iterateWordSegments", () => {
  it("yields contiguous { start, end, isWordLike } triples covering the input", () => {
    const segs = [...iterateWordSegments("hello world")];
    // Reconstruct the text from the segments to confirm boundary accounting.
    const reconstructed = segs.map((s) => "hello world".slice(s.start, s.end)).join("");
    expect(reconstructed).toBe("hello world");
    // At least one segment is wordLike, at least one is not (the space).
    expect(segs.some((s) => s.isWordLike)).toBe(true);
    expect(segs.some((s) => !s.isWordLike)).toBe(true);
  });

  it("flags both word and non-word segments correctly", () => {
    const segs = [...iterateWordSegments("a b")];
    // "a" wordLike, " " not, "b" wordLike — order checked.
    expect(segs.filter((s) => s.isWordLike).map((s) => s.start)).toEqual([0, 2]);
  });

  it("returns an empty iterator on empty input", () => {
    expect([...iterateWordSegments("")]).toEqual([]);
  });
});
```

- [ ] **S4-S6:** tests pass, build, commit `feat(p9): new selectWord (returns Span)`.

Add an additional selectWord test that exercises the `lastWord` whitespace-fallback branch directly. The plan's existing "falls back to preceding word when position is on whitespace" test at offset 5 of "hello world" lands at the END of "hello" (so `containing` fires for "hello"); to actually exercise the `lastWord` fallback, the cursor must be inside whitespace (not at a word's edge). Append to the selectWord describe block:

```typescript
it("uses the lastWord fallback when position is squarely inside whitespace", () => {
  // Double-space between words: "hello  world" (offset 6 is interior of
  // whitespace, not at the edge of either word).
  const state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello  world")]) }),
    ],
  });
  const span = selectWord(state, createPosition("p" as BlockId, 6));
  expect(span.anchor).toEqual({ blockId: "p", offset: 0 });
  expect(span.focus).toEqual({ blockId: "p", offset: 5 });
});
```

## Constraints

- Returns `Span` from `state/block-position.ts` — NOT legacy `Selection`.
- Operates within a single block.
- Embeds, empty blocks, no-word-found cases → collapsed span at position.
- No `as any`, no `!`, no `as unknown as`. The `seg.isWordLike ?? false` default handles the rare segmenter-doesn't-set-the-flag case (Intl.Segmenter returns `isWordLike?: boolean`).

---

## T6: Add `expandSelection`

**Files:**
- Modify: `packages/core/src/cursor/cursor-ops.ts` — add `expandSelection`.
- Modify: `packages/core/src/cursor/cursor-ops.test.ts` — add tests.

`expandSelection(state, span, direction): Span` keeps anchor fixed, moves focus by one grapheme cluster (composes `moveByCharacter` on the focus). Cross-block movement applies.

### Steps

- [ ] **S1: Failing tests**

```typescript
import { expandSelection } from "./cursor-ops";

describe("expandSelection (new)", () => {
  it("moves focus forward by one grapheme, anchor unchanged", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const anchor = createPosition("p" as BlockId, 2);
    const focus = createPosition("p" as BlockId, 2);
    const out = expandSelection(state, { anchor, focus }, "forward");
    expect(out.anchor).toEqual(anchor);
    expect(out.focus).toEqual({ blockId: "p", offset: 3 });
  });

  it("moves focus backward by one grapheme, anchor unchanged", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const anchor = createPosition("p" as BlockId, 0);
    const focus = createPosition("p" as BlockId, 3);
    const out = expandSelection(state, { anchor, focus }, "backward");
    expect(out.anchor).toEqual(anchor);
    expect(out.focus).toEqual({ blockId: "p", offset: 2 });
  });

  it("crosses block boundary when focus is at block end", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("yo")]) }),
      ],
    });
    const anchor = createPosition("p1" as BlockId, 0);
    const focus = createPosition("p1" as BlockId, 2);
    const out = expandSelection(state, { anchor, focus }, "forward");
    expect(out.anchor).toEqual(anchor);
    expect(out.focus).toEqual({ blockId: "p2", offset: 0 });
  });
});
```

- [ ] **S2: Failing run, S3: Implement**

Add to `cursor-ops.ts`:

```typescript
/**
 * Move the selection's focus by one grapheme cluster in the given
 * direction; anchor unchanged. Cross-block movement follows the same
 * rules as `moveByCharacter`.
 */
export function expandSelection(
  state: State,
  span: Span,
  direction: "forward" | "backward",
): Span {
  const newFocus = moveByCharacter(state, span.focus, direction);
  return createSpan(span.anchor, newFocus);
}
```

- [ ] **S4-S6:** tests pass, build, commit `feat(p9): new expandSelection (focus moves; anchor pinned)`.

## Constraints

- Anchor is preserved by reference. Focus moves via `moveByCharacter` (so cross-block + grapheme-aware come for free).
- No `as any`, no `!`, no `as unknown as`.

---

## T7: Final verification

- [ ] **S1: Test count audit**

```bash
npm test --workspace=packages/core -- "src/cursor/cursor-ops.test" "src/cursor/grapheme-utils.test" 2>&1 | tail -5
```

Expected: ≥ 35 tests across the new module. Actual counts:
- `grapheme-utils.test.ts`: 14 from T2 (4 nextGrapheme + 3 prevGrapheme + 3 nextWord + 4 prevWord) + 3 from T5 (iterateWordSegments) = **17 grapheme-utils tests**.
- `cursor-ops.test.ts`: 11 from T3 (moveByCharacter) + 6 from T4 (moveByWord) + 5 from T5 (selectWord, includes lastWord fallback) + 3 from T6 (expandSelection) = **25 cursor-ops tests**.
- **Grand total: 42 tests** across the new module.

- [ ] **S2: Confirm spec success criteria**

- ✅ New cursor entry points: `moveByCharacter`, `moveByWord` return new `Position`; `selectWord`, `expandSelection` return new `Span`.
- ✅ Grapheme cluster boundaries (UAX #29) preserved (shared `grapheme-utils.ts`).
- ✅ Word boundaries (UAX #29) preserved (shared `grapheme-utils.ts`).
- ✅ Cross-block movement via `nextBlockInDocOrder` / `prevBlockInDocOrder`.
- ✅ Embed handling per master spec (1 cursor position per embed; word-barrier behavior for `moveByWord`).
- ✅ Test parity with legacy: legacy `cursor.test.ts` has 44 tests; the new module has 42 (close — covers all the new code paths). Legacy's tests include `expandSelectionByCharacter` (8 tests) which is layout-coupled and deferred to P10; subtracting those, in-scope legacy coverage is ~36 tests, and the new module's 42 exceeds it.
- ✅ Legacy `cursor-ops-legacy.ts` still compiles and works (1330 baseline tests pass).
- ✅ Build green; no other module breaks.

- [ ] **S3: Full build + test**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: ~1330 + 42 = ~1372 passing, 4 skipped.

## End of P9

After T7 the new cursor-ops module ships alongside the legacy. P10 will build the layout-coupled cursor pieces (`cursor-position.ts`, `hit-test.ts`, `line-navigation.ts`, `selection-geometry.ts`) on top of the new renderer and the new cursor-ops. P11.x cuts the editor over; P15 deletes `cursor-ops-legacy.ts` and the legacy `Selection` consumers.

**Browser smoke deferral:** the new cursor module has no UI pipeline yet — exercised only by unit tests. Browser smoke at P11.4 cutover.
