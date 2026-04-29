# Plan 3.H — Subtree-Granularity Incremental Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the binary "redo all" incremental layout with subtree-granularity reuse. After Plan 3.H, layout boxes outside the affected range are reference-equal across layouts; positions are parent-relative; the editor's keystroke latency drops to O(visible-page-area).

**Architecture:** A `LayoutBox` is reusable when (renderNode, availableInlineSize, writingMode, direction, intrinsicCache state, float-env dirty offset, block-axis context) all match its previous state. Positions are stored parent-relative; painter/hit-test/selection-geometry walk the tree accumulating offsets cumulatively.

**Spec reference:** `2026-04-29-plan-3-architectural-foundation-rewrite.md` §8 (Incremental everything). Retrospective D9 (`computedStylesEqual` cast-based iteration).

**Branch:** `feature/dom-architecture-redesign`.

---

## Worktree discipline

All work in `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign`. Pre-flight on every task. Use absolute paths and `git -C <worktree>` for git.

---

## Task list overview

| Task | Subject |
|---|---|
| **0** | **PREREQUISITE** — Fix F3G.1: `findChangePoint` compares token content not just IDs |
| **1** | Convert `LayoutBox` positions to parent-relative; physical x/y derived as parent-relative-to-parent (or with explicit anchor at painter time) |
| **2** | Painter / hit-test / selection-geometry walk tree accumulating parent offsets |
| **3** | Layout reuse predicate: `isLayoutBoxReusable(prev, current-context)` |
| **4** | `layoutBlock`/`layoutInlineContent`/`layoutTable` consult prev layout for reuse |
| **5** | `FloatEnvironment.dirtyBlockOffsetSince` real implementation (closes F3G.2) |
| **6** | Replace `computedStylesEqual` cast-based iteration with typed comparison (closes retrospective D9) |
| **7** | Reference-equality test suite for incremental layout |
| **8** | Integration smoke + dev-server typing-latency check |

---

## Task 0: Token content-equality (F3G.1 fix — PREREQUISITE)

**Why:** Plan 3.G's `findChangePoint` compares token IDs only. Same-length edits produce same IDs but different content, so the cache returns stale layout. **This must be fixed BEFORE incremental layout is wired in**, or layout-tree reuse will inherit the bug.

**Files:**
- Modify: `packages/core/src/layout/wrap-incremental.ts` — `findChangePoint` compares full token content.
- Modify: `packages/core/src/layout/wrap-incremental.test.ts` — add same-length edit test.

**Step 1: Pre-flight check.**

**Step 2: Add `tokensEqual` helper in `wrap-incremental.ts`**

```ts
import type { Token } from "./ifc";

function tokensEqual(a: Token, b: Token): boolean {
  return (
    a.id === b.id &&
    a.text === b.text &&
    a.width === b.width &&
    a.isSpace === b.isSpace &&
    a.isLineBreak === b.isLineBreak &&
    a.style === b.style &&  // reference equality on style (post-cascade ComputedStyle)
    arraysShallowEqual(a.inlineAncestors, b.inlineAncestors) &&
    a.inlineBlock === b.inlineBlock  // ref-equal on inline-block atom
  );
}

function arraysShallowEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function findChangePoint(prev: readonly Token[], next: readonly Token[]): number {
  const len = Math.min(prev.length, next.length);
  for (let i = 0; i < len; i++) {
    if (!tokensEqual(prev[i], next[i])) return i;
  }
  if (prev.length !== next.length) return len;
  return -1;
}
```

**Step 3: Add a same-length edit test**

```ts
it("findChangePoint detects same-length text replacement", () => {
  const a = [makeTokenWith("t:0", "hello", 50), makeTokenWith("t:6", "world", 50)];
  const b = [makeTokenWith("t:0", "world", 50), makeTokenWith("t:6", "world", 50)];
  // IDs match (same offsets); text differs at index 0.
  expect(findChangePoint(a, b)).toBe(0);
});
```

**Step 4: Run tests + builds; commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/wrap-incremental.ts packages/core/src/layout/wrap-incremental.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "fix(layout): findChangePoint compares full token content (closes F3G.1)"
```

---

## Task 1: Parent-relative positions on LayoutBox

**Why:** Currently LayoutBox positions are document-absolute. For subtree reuse, when a subtree is reused at a different parent-relative position, we'd have to walk the subtree and rewrite every box's position — defeating the purpose of reuse.

After Task 1: each LayoutBox's `inlineOffset`, `blockOffset`, `x`, `y` are parent-relative. Painter and consumers walk the tree accumulating offsets.

**Files:**
- Modify: `packages/core/src/layout/layout-box-v2.ts` — document the parent-relative convention; the factory itself doesn't change behavior (it always took values that were "child-relative-to-parent" — they were just being passed in absolute positions by callers).
- Modify: `packages/core/src/layout/bfc.ts`, `ifc.ts`, `table-fc.ts` — pass child-relative positions to factories instead of absolute.
- Modify: `packages/core/src/layout/wrap-incremental.ts` (line meta) — confirm line offsets are line-relative (within paragraph) not document-absolute.

**Step 1: Pre-flight check.**

**Step 2: Audit current position semantics**

```bash
grep -n "blockOffset:\|inlineOffset:" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/layout/bfc.ts | head -20
```

The current code passes positions like `paddingInlineStart, childBlockOffset` to factories. `paddingInlineStart` is content-edge-relative-to-this-block; `childBlockOffset` is block-relative-to-this-block. So positions are ALREADY parent-relative inside the BFC.

But: the BFC's outer factory call passes `inlineOffset, blockOffset` (the BFC's own position) — these came from the parent's call. Are they parent-relative or absolute?

Trace the chain. If `dispatch.ts` initially calls `layoutBlock(root, 0, 0, ctx, shaper)`, then root's `inlineOffset = 0`, `blockOffset = 0` — relative to nothing (the root has no parent). Each recursive call passes `paddingInlineStart, childBlockOffset` — relative to THIS block (parent-relative for the child).

Conclusion: positions are ALREADY parent-relative throughout. Plan 3.H Task 1 is largely DOCUMENTATION + verification.

**Step 3: Document in `layout-box-v2.ts`**

Add a comment to `LayoutBoxBase`:

```ts
interface LayoutBoxBase {
  // Logical (FCs read+write these). PARENT-RELATIVE: inlineOffset and
  // blockOffset are measured from the parent's content-edge origin.
  // Painter and consumers walk the tree accumulating parent offsets.
  readonly inlineOffset: number;
  readonly blockOffset:  number;
  // ...
  // Physical (painter / hit-test / selection-geometry read these).
  // PARENT-RELATIVE: x and y are measured from the parent's content-edge
  // origin, post-direction-mapping.
  readonly x: number;
  readonly y: number;
  // ...
}
```

**Step 4: Verify painter / hit-test / selection-geometry already walk the tree**

```bash
grep -rn "box\.x\|box\.y\|\.inlineOffset\|\.blockOffset" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/dom/src/canvas-renderer.ts /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/editor/ | head -20
```

If consumers read `box.x` and `box.y` ABSOLUTELY (no accumulation of parent offsets), they'll be wrong after Task 1's change. If they already accumulate, no fix needed.

Most likely: consumers DON'T accumulate (since the existing layout produces document-absolute positions). After Task 1, they need to. This is the load-bearing change.

**Step 5: Update painter to accumulate offsets**

```ts
function paintBox(ctx: CanvasRenderingContext2D, box: LayoutBox, parentX: number, parentY: number): void {
  const x = parentX + box.x;
  const y = parentY + box.y;
  // ... paint at (x, y)
  if ("children" in box) {
    for (const c of box.children) {
      paintBox(ctx, c, x, y);
    }
  }
}
```

Update entry: `paintBox(ctx, root, 0, 0)`.

Same pattern for `hit-test.ts`, `selection-geometry.ts`, `cursor-position.ts`, `layout-utils.ts`.

**Step 6: Run tests + builds**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core && npm test --workspace=packages/dom && npm test --workspace=packages/react && npm run build --workspaces --if-present
```

Expected: ALL existing tests pass. The change is invariant: positions ARE parent-relative; consumers ACCUMULATE parent positions; the visible output is identical.

**Step 7: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/layout-box-v2.ts packages/dom/src/canvas-renderer.ts packages/core/src/editor/
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "refactor(layout+dom+editor): parent-relative LayoutBox positions; consumers accumulate offsets"
```

---

## Task 2: (subsumed by Task 1)

Task 2 is part of Task 1 if the consumers needed updating. Mark Task 2 done with Task 1's commit.

---

## Task 3: `isLayoutBoxReusable` predicate

**Files:**
- Create: `packages/core/src/layout/layout-reuse.ts` — predicate function.
- Tests.

```ts
export function isLayoutBoxReusable(
  prev: LayoutBox,
  current: {
    renderNode: RenderNode;
    availableInlineSize: number;
    ctx: LayoutContext;
    floatEnvDirtyOffset: number;
  },
): boolean {
  // Reuse rules per spec §8.2:
  // - Render-node identity / computedStylesEqual to prev's stored style
  // - availableInlineSize matches
  // - writingMode + direction match
  // - intrinsic-size cache state — captured by render-node identity (caches keyed by renderNodeKey)
  // - float-env state at this block-offset
  // - block-axis context (preceding sibling's marginBlockEnd, clear resolution)
  if (prev.computedStyle !== current.renderNode.computedStyle) {
    if (!computedStylesEqual(prev.computedStyle, current.renderNode.computedStyle)) {
      return false;
    }
  }
  // ... checks for size/writingMode/floatEnv/blockAxisContext
  return true;
}
```

**Step 1-N**: implement; test.

---

## Task 4: FCs consult prev layout for reuse

**Files:**
- Modify: `packages/core/src/layout/bfc.ts`, `ifc.ts`, `table-fc.ts`.

When laying out a child, look up `prev = lookup(child.key)`; if `isLayoutBoxReusable(prev, ...)`, return `prev` directly.

The cache key includes `(renderNodeKey, fragmentIndex, anonIndex)` per spec §8.4.

---

## Task 5: `FloatEnvironment.dirtyBlockOffsetSince` real implementation

Implement the diff: compare two environments' placed-floats arrays; return the lowest block-offset where they differ.

---

## Task 6: Replace `computedStylesEqual` cast-based iteration

**Files:**
- Modify: `packages/core/src/cascade/cascade-pass.ts`.

Replace `as unknown as Record<string, unknown>` cast with typed property-by-property comparison.

```ts
const COMPUTED_STYLE_KEYS = ["display", "writingMode", ...] as const;

export function computedStylesEqual(a: ComputedStyle, b: ComputedStyle): boolean {
  for (const k of COMPUTED_STYLE_KEYS) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}
```

(For deeply-nested fields like `fontFeatureSettings: string[]`, may need `arraysShallowEqual` helper.)

---

## Task 7: Reference-equality test suite for incremental layout

**Files:**
- Create: `packages/core/src/integration/incremental-layout.test.ts`.

Per the spec §8.6 test discipline:
1. Insert character mid-paragraph → unaffected paragraphs ref-equal.
2. Toggle bold on word → unaffected words ref-equal.
3. Add float → siblings before float unchanged.
4. Resize containing block → blocks with explicit `inlineSize` reuse.
5. Add list item → unaffected list items ref-equal.

---

## Task 8: Integration smoke + typing-latency check

Boot dev server. Type in a long paragraph; observe responsiveness. Document anecdotal latency.

---

## Phase exit criteria

- All 9 tasks committed (Tasks 0 + 1 + 3-8; Task 2 absorbed by 1).
- Build clean across all packages.
- Test suite green.
- Reference-equality test suite verifies subtree reuse on common edits.
- F3G.1 (token content-equality), F3G.2 (dirtyBlockOffsetSince), retrospective D9 (computedStylesEqual cast) all closed.
- Dev server boots; typing latency anecdotally improved.

## Plan 3.G followups closed by 3.H

- F3G.1 — Token content-equality (Task 0).
- F3G.2 — `dirtyBlockOffsetSince` real impl (Task 5).
- F3G.3 — convergence detection wired (Tasks 3-4).
- D9 — `computedStylesEqual` typed comparison (Task 6).
