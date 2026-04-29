# Plan 3.F — Real CSS 9.5 Floats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simplistic `FloatContext` with a CSS 9.5–faithful `FloatEnvironment`. After Plan 3.F, floats obey CSS 9.5.1 placement rules (no overlap, push below if needed); they rise to the nearest BFC root rather than being scoped to every block; lines push below floats when they have less than min-content available; `clear` produces clearance that interacts with margin collapse correctly; new BFCs are established by `overflow ∈ {hidden, auto, scroll, clip}`, `display: flow-root`, etc.

**Architecture:** The current `FloatContext` is created fresh per `layoutBlock` call (every block scopes its own floats). Plan 3.F threads ONE `FloatEnvironment` per BFC root through layout context; non-BFC-establishing blocks use the parent's environment. The new `FloatEnvironment` honors the placement rules: when a float can't fit at the requested block-offset due to earlier floats on the same side, it gets pushed below.

**Spec reference:** `2026-04-29-plan-3-architectural-foundation-rewrite.md` §6 (Real floats).

**Branch:** `feature/dom-architecture-redesign`.

---

## Worktree discipline

All work in `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign`. Pre-flight check on every task: `cd <worktree> && pwd && git -C <worktree> branch --show-current`. Expect `feature/dom-architecture-redesign`. STOP if mismatched. Use absolute paths and `git -C <worktree>` for all git commands.

---

## Task list overview

| Task | Subject |
|---|---|
| **1** | Define `FloatEnvironment` with CSS 9.5.1 placement rules (push below if doesn't fit); replace `FloatContext` |
| **2** | Add `display: "flow-root"` to schema; BFC establishment helper `establishesNewBFC(cs)` |
| **3** | Thread `FloatEnvironment` through `LayoutContext`; floats rise to nearest BFC root |
| **4** | Below-min-content line push in IFC (CSS 9.5: line pushed below float when content can't fit) |
| **5** | Clearance + margin-collapse interaction (CSS 8.3.1): non-zero clearance suppresses marginBlockStart collapse |
| **6** | Self-collapsing-block-with-floats already works via BFC enclosure max(); verify with test |
| **7** | Integration tests + dev-server smoke |

---

## Task 1: `FloatEnvironment` with CSS 9.5.1 placement

**Files:**
- Modify: `packages/core/src/layout/float-context.ts` — rename interface to `FloatEnvironment`; rewrite `placeFloat` to accept a REQUESTED block-offset and return the FINAL position (per CSS 9.5.1 push-below-if-needed).
- Update callers in `bfc.ts`, `ifc.ts` to use the new shape.
- Update `float-context.test.ts` for new placement semantics.

**Behavior change:**

Old: caller computed `placedInlineOffset` via `paddingInlineStart + active.inlineStartSize` and called `placeFloat({...})` to record. Push-below-if-needed wasn't enforced.

New: caller computes a REQUESTED block-offset (the line/sibling's natural position) and asks `placeFloat(box, side, requestedBlockOffset, containingInlineSize)` to compute the FINAL block-offset and inline-offset. The environment pushes the float below earlier floats if its inline-size doesn't fit at the requested offset.

**New interface:**

```ts
export interface PlacedFloat {
  readonly side: "inline-start" | "inline-end";
  readonly inlineOffset: number;
  readonly blockOffset: number;
  readonly inlineSize: number;
  readonly blockSize: number;
}

export interface FloatEnvironment {
  /**
   * Place a new float according to CSS 9.5.1 rules. May push below the
   * requested block-offset if the float's inline-size doesn't fit.
   *
   * @param side the float's logical side
   * @param requestedBlockOffset the natural block-offset (line block-offset
   *   in IFC, or sibling block-offset in BFC) where the caller wants the
   *   float placed
   * @param inlineSize the float's resolved inline-size
   * @param blockSize the float's resolved block-size
   * @param containingInlineSize the BFC's content inline-size
   * @returns the final placement
   */
  placeFloat(
    side: "inline-start" | "inline-end",
    requestedBlockOffset: number,
    inlineSize: number,
    blockSize: number,
    containingInlineSize: number,
  ): { blockOffset: number; inlineOffset: number };

  /** Inline-size occupied at `blockOffset` per side. */
  availableInlineSizeAt(
    blockOffset: number,
    containingInlineSize: number,
  ): { inlineStartSize: number; inlineEndSize: number };

  /** For `clear`: block-offset where the cleared side(s) have no active float. */
  clearance(
    side: "inline-start" | "inline-end" | "both",
    currentBlockOffset: number,
  ): number;

  /** Lowest float block-edge across all floats. */
  lowestFloatBlockEdge(): number;
}

export function createFloatEnvironment(): FloatEnvironment;
```

(Keep `createFloatContext` as a deprecated alias for backwards compat during the migration; remove later.)

**Placement algorithm:**

```ts
function placeFloat(side, requestedBlockOffset, inlineSize, blockSize, containingInlineSize) {
  let candidateBlockOffset = requestedBlockOffset;
  while (true) {
    const active = availableInlineSizeAt(candidateBlockOffset, containingInlineSize);
    const free = containingInlineSize - active.inlineStartSize - active.inlineEndSize;
    if (free >= inlineSize) {
      // Fits at this block-offset.
      const inlineOffset = side === "inline-start"
        ? active.inlineStartSize
        : containingInlineSize - active.inlineEndSize - inlineSize;
      placed.push({ side, inlineOffset, blockOffset: candidateBlockOffset, inlineSize, blockSize });
      return { blockOffset: candidateBlockOffset, inlineOffset };
    }
    // Doesn't fit — push below the lowest float at-or-above the requested offset.
    const nextBlockOffset = nextFloatBottomBelow(candidateBlockOffset);
    if (nextBlockOffset <= candidateBlockOffset) {
      // No float below; place at containingBlock's edge with overflow.
      const inlineOffset = side === "inline-start" ? 0 : 0;
      placed.push({ side, inlineOffset, blockOffset: candidateBlockOffset, inlineSize, blockSize });
      return { blockOffset: candidateBlockOffset, inlineOffset };
    }
    candidateBlockOffset = nextBlockOffset;
  }
}

function nextFloatBottomBelow(blockOffset: number): number {
  let candidate = Infinity;
  for (const f of placed) {
    const bottom = f.blockOffset + f.blockSize;
    if (bottom > blockOffset && bottom < candidate) candidate = bottom;
  }
  return candidate === Infinity ? blockOffset : candidate;
}
```

**Step 4: Update callers**

In bfc.ts's float branch:
```ts
const { blockOffset: placedBlockOffset, inlineOffset: placedInlineOffset } =
  floatEnv.placeFloat(
    childCs.float === "inline-start" ? "inline-start" : "inline-end",
    childBlockOffset,
    floatInlineSize,
    floatBlockSize,
    contentInlineSize,
  );
const positioned: LayoutBox = Object.freeze({
  ...floatLayout,
  x: paddingInlineStart + placedInlineOffset,
  y: placedBlockOffset,
} as LayoutBox);
```

(Remove the manual `paddingInlineStart + active.inlineStartSize` calculation; the environment computes it now relative to the BFC content.)

**Step 5: Tests**

```ts
it("two same-side floats stack: second pushes below first if first's inline-size fills available", () => {
  const env = createFloatEnvironment();
  const p1 = env.placeFloat("inline-start", 0, 200, 100, 200);
  expect(p1).toEqual({ blockOffset: 0, inlineOffset: 0 });
  const p2 = env.placeFloat("inline-start", 0, 200, 100, 200);
  // First float occupies all of 200px at block 0..100. Second wants block 0
  // but doesn't fit; pushed to block 100.
  expect(p2.blockOffset).toBe(100);
  expect(p2.inlineOffset).toBe(0);
});

it("inline-start and inline-end floats can coexist if widths sum less than container", () => {
  const env = createFloatEnvironment();
  const p1 = env.placeFloat("inline-start", 0, 80, 50, 200);
  expect(p1.inlineOffset).toBe(0);
  const p2 = env.placeFloat("inline-end", 0, 80, 50, 200);
  expect(p2.inlineOffset).toBe(120); // 200 - 80
  expect(p2.blockOffset).toBe(0);
});
```

**Commit:** `feat(layout): FloatEnvironment with CSS 9.5.1 placement rules`.

---

## Task 2: `display: "flow-root"` schema + BFC establishment helper

**Files:**
- Modify: `packages/core/src/styles/style.ts` — add `"flow-root"` to `Display` value union.
- Modify: `packages/core/src/styles/computed-style.ts` — same.
- Create: `packages/core/src/layout/bfc-establishment.ts` — helper `establishesNewBFC(cs)`.
- Create: `packages/core/src/layout/bfc-establishment.test.ts`.

**`establishesNewBFC` returns true when:**
- `cs.float !== "none"`
- `cs.display === "inline-block"`
- `cs.display === "table-cell"`
- `cs.display === "flow-root"`
- `cs.overflow !== "visible"` (when overflow is added to schema; for now this branch is dormant — overflow isn't yet a Style property; flag for future)
- (Future) `cs.position === "absolute"` / `"fixed"` (Plan 7)

**Implementation:**

```ts
export function establishesNewBFC(cs: ComputedStyle): boolean {
  if (cs.float !== "none") return true;
  if (cs.display === "inline-block") return true;
  if (cs.display === "table-cell") return true;
  if (cs.display === "flow-root") return true;
  // Future: cs.overflow !== "visible"; cs.position ∈ {absolute, fixed}
  return false;
}
```

**Tests** for each case.

**Commit:** `feat(layout): display: flow-root + establishesNewBFC helper`.

---

## Task 3: Thread `FloatEnvironment` through `LayoutContext`

**Files:**
- Modify: `packages/core/src/layout/layout-context.ts` — add `floatEnv: FloatEnvironment` to context.
- Modify: `packages/core/src/layout/bfc.ts` — only create a fresh env if `establishesNewBFC(cs)`; otherwise inherit parent's.
- Modify: `packages/core/src/layout/ifc.ts` — accept env from ctx (already passed via `floatCtx` parameter; this task makes it consistent with other ctx threading).

**Implementation:**

```ts
// In layout-context.ts:
export interface LayoutContext {
  // ...existing
  readonly floatEnv: FloatEnvironment;
}

export function makeRootContext(rootCs, containerInlineSize): LayoutContext {
  return {
    // ...existing
    floatEnv: createFloatEnvironment(),
  };
}

export function makeChildContext(parent, childCs, contentInlineSize, contentBlockSize): LayoutContext {
  const newFloatEnv = establishesNewBFC(childCs)
    ? createFloatEnvironment()
    : parent.floatEnv;
  return {
    // ...existing
    floatEnv: newFloatEnv,
  };
}
```

(`establishesNewBFC` here takes the child's CS; the child establishes a new BFC if its own display/float/etc. trigger it.)

In `bfc.ts`, replace the existing `const floatCtx = createFloatContext()` line with `const floatEnv = ctx.floatEnv` (use parent's). The IFC similarly accepts via ctx.

For floats placed via `floatEnv.placeFloat`, the float's block-offset is now relative to the BFC root. When the float is in inline content, the IFC translates the line's block-offset accordingly.

**Tests:**
1. Float in a `display: flow-root` block: float scoped to that block.
2. Float in a regular block: float visible to siblings (rises to parent BFC).
3. Float in inline content: rises to the parent BFC.

**Commit:** `feat(layout): floats rise to nearest BFC; FloatEnvironment threaded via LayoutContext`.

---

## Task 4: Below-min-content line push in IFC

**Files:**
- Modify: `packages/core/src/layout/ifc.ts`.

**Behavior:** When the IFC is about to lay out a line at block-offset Y, it queries `floatEnv.availableInlineSizeAt(Y, ...)`. If the available inline-size is less than the line's min-content (computed via the IFC's intrinsic-sizing path), advance Y to the next float bottom and retry.

**Implementation sketch:**

```ts
let currentBlockOffset = startBlockOffset;
while (true) {
  const active = floatEnv.availableInlineSizeAt(currentBlockOffset, containingInlineSize);
  const freeInline = containingInlineSize - active.inlineStartSize - active.inlineEndSize;
  // Compute min-content for the next-to-place token (or use a paragraph-level minContent).
  if (freeInline >= nextTokenMinSize) break;
  // Doesn't fit even the smallest token; push line below the next float bottom.
  const next = nextFloatBottomBelow(floatEnv, currentBlockOffset);
  if (next <= currentBlockOffset) break;  // no float below; stuck
  currentBlockOffset = next;
}
// Lay out the line at currentBlockOffset.
```

**Test:**
```ts
it("line pushes below float when below-min-content available", () => {
  // Construct: a paragraph with a wide inline-block (un-breakable), narrow container,
  // float above that fills container's inline-axis at block 0..50.
  // Expect the inline-block's line to start at block 50, not 0.
  // ...
});
```

**Commit:** `feat(layout): IFC pushes line below floats when below min-content`.

---

## Task 5: Clearance + margin-collapse interaction

**Files:**
- Modify: `packages/core/src/layout/bfc.ts`.

**Behavior:** Per CSS 8.3.1: when a block has `clear` set and there are floats to clear, the clearance is computed as `clearedBlockOffset - naturalBlockOffset`. If clearance is non-zero, the box's `marginBlockStart` does NOT collapse with the parent's marginBlockStart.

**Current code:**
```ts
if (childCs.clear !== "none") {
  const clearedY = floatEnv.clearance(childCs.clear, childBlockOffset);
  if (clearedY > childBlockOffset) {
    childBlockOffset = clearedY;
  }
}
```

After Task 5, this becomes:
```ts
let clearanceApplied = 0;
if (childCs.clear !== "none") {
  const clearedY = floatEnv.clearance(childCs.clear, childBlockOffset);
  if (clearedY > childBlockOffset) {
    clearanceApplied = clearedY - childBlockOffset;
    childBlockOffset = clearedY;
  }
}

// Margin collapse:
const childMarginBlockStart = childUsedStyle.marginBlockStart;
if (clearanceApplied > 0) {
  // Cleared box: marginBlockStart doesn't collapse with parent's.
  childBlockOffset += childMarginBlockStart;
} else if (layoutChildren.length > 0) {
  childBlockOffset += Math.max(prevMarginBlockEnd, childMarginBlockStart);
} else {
  childBlockOffset += noTopBoundary ? 0 : childMarginBlockStart;
}
```

**Test:**
```ts
it("clearance prevents marginBlockStart collapse with parent", () => {
  // ... a parent block with no top padding, first child has clear: inline-start
  // and a float exists above. The child's marginBlockStart should NOT collapse
  // out (as it would for a non-cleared first child).
});
```

**Commit:** `feat(layout): clearance interacts with margin-collapse per CSS 8.3.1`.

---

## Task 6: Self-collapsing block with floats — verification

**Files:**
- Modify: `packages/core/src/layout/bfc.test.ts` — add a test verifying the existing BFC enclosure max() rule works correctly.

**Behavior:** A block with no in-flow content and `overflow: hidden` (or `display: flow-root`, etc.) containing only floats should have block-size = `lowestFloatBlockEdge()`. The current BFC code does `max(inFlowBlockSize, lowestFloatEdge)` — verify in a test.

```ts
it("flow-root block containing only floats encloses them (clearfix)", () => {
  const float1 = createElementBox(
    "f1",
    { display: "block", float: "inline-start", inlineSize: 100, blockSize: 50 },
    [],
  );
  const container = createElementBox(
    "c", { display: "flow-root" },
    [float1],
  );
  // The container should have blockSize = 50 (the float's blockSize), even
  // though the container has no in-flow content.
  // ... layout, assert container.blockSize === 50
});
```

**Commit:** `test(layout): self-collapsing block with floats (clearfix pattern)`.

---

## Task 7: Integration tests + dev-server smoke

**Files:**
- Create: `packages/core/src/integration/floats-real.test.ts`.

Cover:
1. Two same-side floats stack vertically.
2. Float rises to nearest BFC (parent block has flow-root, grandparent doesn't — float visible to grandparent's siblings? No, float scoped to the flow-root parent).
3. Below-min-content line push.
4. Clearance + margin-collapse.
5. Self-collapsing block with floats (clearfix).

Smoke-test the dev server.

**Commit:** `test(integration): real floats — placement, BFC scope, line-push, clearance, clearfix`.

---

## Phase exit criteria

- All 7 tasks committed.
- Build clean across all packages.
- Test suite green.
- CSS 9.5 placement rules respected (overlap detection + push below).
- Floats rise to nearest BFC.
- `display: flow-root` works.
- Clearance interacts with margin-collapse per CSS 8.3.1.
- Self-collapsing block with floats encloses (clearfix).
- Dev server boots.

## Plan 3.A / 3.B / 3.C / 3.D / 3.E followups closed by 3.F

- **F.2 / F.3** — IFC↔BFC float integration. Plan 3.E Task 2's BFC anonymous-block-runs work already implicitly closed this (single floatCtx shared across groups). Plan 3.F's Task 3 (FloatEnvironment in LayoutContext) makes it explicit and CSS-correct.

## New followups likely from 3.F

Track here as discovered:
- `overflow` Style property not yet in schema; Task 2's `establishesNewBFC` only handles non-overflow triggers. Add `overflow` in Plan 6 (visual chrome) or a dedicated cleanup.
- The `containingInlineSize` parameter on `placeFloat` is computed by BFC as `contentInlineSize`. For nested BFCs (e.g., inline-block establishing its own BFC inside a parent BFC), verify the right value flows. Inline-block's float environment is fresh per Task 3 → its containingInlineSize is the inline-block's own content inline-size.
- Float clearing across BFCs: `clear` only clears floats in the SAME BFC. Verify that `floatEnv.clearance(side, ...)` only consults floats in this environment (which is correct since each environment is per-BFC).
