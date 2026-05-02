# P1.B Pagination Within-Block Fragmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend P1.A's pagination foundation with within-block fragmentation: paragraphs, block containers, and tables can split across page boundaries with widows/orphans, `break-*` properties, and CSS Fragmentation Module Level 4 fidelity.

**Architecture:** Interleaved-with-BFC fragmentation. The layout entry points (`layoutBlock`, `layoutInlineContent`, `layoutTable`) gain an optional `FragmentationContext` parameter and return `LayoutResult { box: LayoutBox | null, breakToken: BreakToken | null }`. When the fragmentation context is present, layout may stop early and return a `breakToken` describing where to resume. `paginate.ts` becomes a thin page-by-page coordinator that drives `layoutBlock` per page with the `breakToken` from the previous iteration as the next iteration's `resumeFrom`.

**Tech stack:** TypeScript (npm workspaces, `packages/core`); vitest + jsdom + canvas-mock for tests; Node v24.14.0 via nvm; kebab-case file naming throughout.

**Reference:** `docs/superpowers/specs/2026-05-01-p1b-pagination-within-block-fragmentation-design.md` (this plan implements that spec).

**Worktree guard:** All work happens in `.worktrees/dom-redesign/` on branch `feature/dom-architecture-redesign`. Every shell command in this plan uses `git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign` for git, and absolute paths for file edits. Subagent dispatches must include this `cwd` guard explicitly.

---

## File structure

**New files:**
- `packages/core/src/layout/fragmentation.ts` — break-token types, `FragmentationContext`, `LayoutResult`, `normalizeBreakValue` helper.
- `packages/core/src/layout/fragmentation.test.ts` — unit tests for the helper.
- `packages/core/src/layout/__tests__/bfc-fragmentation.test.ts` — BFC fragmentation cases.
- `packages/core/src/layout/__tests__/ifc-fragmentation.test.ts` — IFC line-level fragmentation cases.
- `packages/core/src/layout/__tests__/table-fc-fragmentation.test.ts` — Table FC row-level fragmentation cases.
- `packages/core/src/test-utils/paginated-harness.ts` — fixture helper that runs cascade + layout + paginate and returns the page list for assertion.
- `packages/core/src/integration/pagination-fragmentation.test.ts` — end-to-end fragmentation cases via the editor reducer.

**Modified files:**
- `packages/core/src/layout/bfc.ts` — `layoutBlock` signature change; child-placement loop becomes break-aware; margin truncation across breaks; overflow rule; resume from `BlockBreakToken`.
- `packages/core/src/layout/ifc.ts` — `layoutInlineContent` signature change; line-level split-point search with widows/orphans + hyphen-pair constraint; resume from `IFCBreakToken`.
- `packages/core/src/layout/table-fc.ts` — `layoutTable` signature change; row-level fragmentation; `<thead>` repetition; resume from `TableBreakToken`.
- `packages/core/src/layout/paginate.ts` — `paginateRoot` rewritten as a page-by-page coordinator loop; `withBlockOffset` removed.
- `packages/core/src/layout/dispatch.ts` — routes through new paginate when `pageConfig` is set; ignores `breakToken` in unpaginated path.
- `packages/core/src/layout/layout-box-v2.ts` — `withBlockOffset` export removed (unused after F.2).
- `packages/core/src/integration/pagination-cursor.test.ts` — extended with fragmentation cases.
- `docs/architecture/1-core/1.5-pagination.md` — pseudocode aligned with `LayoutResult { box | null, breakToken | null }` model.
- `docs/architecture/1-core/1.4-layout/1.4.1-bfc.md` — Fragmentation subsection.
- `docs/architecture/1-core/1.4-layout/1.4.2-ifc.md` — Fragmentation subsection.
- `docs/architecture/1-core/1.4-layout/1.4.3-table-fc.md` — Fragmentation subsection.
- `docs/architecture/state-of-branch.md` — pagination "still missing" list updated.
- `docs/superpowers/plans/2026-04-30-decomposition.md` — P1.B status annotation.

---

## Pre-flight

- [ ] **Verify worktree.** `git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign rev-parse --abbrev-ref HEAD` should print `feature/dom-architecture-redesign`.
- [ ] **Verify clean baseline.** `npm test --workspace=packages/core` should pass all 773 existing tests.
- [ ] **Verify build clean.** `npm run build --workspace=packages/core` should succeed.

---

## Phase A — Fragmentation type infrastructure

### Task A.1: Create `fragmentation.ts` with break-token types

**Files:**
- Create: `packages/core/src/layout/fragmentation.ts`

- [ ] **Step 1: Write the file.**

```ts
// packages/core/src/layout/fragmentation.ts

/**
 * Break-token continuation model. When a fragmentation-aware layout call
 * stops early because content didn't fit on the current fragment, it
 * returns a BreakToken describing where to resume. The next call (typically
 * for the next page) passes the token in via FragmentationContext.resumeFrom.
 *
 * BreakTokens are recursive: a BlockBreakToken's resumeChildToken carries
 * the inner FC's break state when a child was itself mid-fragment.
 */
export type BreakToken = BlockBreakToken | IFCBreakToken | TableBreakToken;

export interface BlockBreakToken {
  readonly type: "block";
  /** Index of the next child to lay out in the parent's children array. */
  readonly resumeChildIndex: number;
  /** If the child at resumeChildIndex was itself mid-fragmenting on the
   * previous fragment, this carries that child's break token. Null when
   * the child should be laid out fresh. */
  readonly resumeChildToken: BreakToken | null;
}

export interface IFCBreakToken {
  readonly type: "ifc";
  /** 0-based line index in the paragraph at which to resume emitting lines. */
  readonly resumeAtLine: number;
}

export interface TableBreakToken {
  readonly type: "table";
  /** 0-based row index in the table body at which to resume. */
  readonly resumeAtRow: number;
}

/**
 * Carried down the layout walk when pagination is active. When undefined,
 * layout runs in unpaginated mode and never returns a breakToken.
 */
export interface FragmentationContext {
  /** Block-axis space remaining on the current fragment (page). */
  readonly availableBlockSize: number;
  /** 0-based page index for diagnostics and the PageBox.pageIndex field. */
  readonly pageIndex: number;
  /** Resume state from the previous fragment, if any. Null on first attempt
   * for a fresh fragment. */
  readonly resumeFrom: BreakToken | null;
}

/**
 * The unified return shape for fragmentation-aware layout calls.
 *
 * - `{ box, breakToken: null }` — content fitted entirely.
 * - `{ box, breakToken }` — content fitted partially; remainder needs another fragment.
 * - `{ box: null, breakToken }` — couldn't fit anything on this fragment; parent
 *   should push the whole node to the next fragment.
 *
 * In the unpaginated path (no FragmentationContext passed), `box` is always
 * non-null and `breakToken` is always null.
 */
export interface LayoutResult {
  readonly box: import("./layout-box-v2").LayoutBox | null;
  readonly breakToken: BreakToken | null;
}
```

- [ ] **Step 2: Verify it compiles.**

Run: `npm run build --workspace=packages/core`
Expected: builds cleanly (no new tests yet, no behavior change).

- [ ] **Step 3: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/fragmentation.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(layout): fragmentation types — BreakToken, FragmentationContext, LayoutResult

P1.B foundation. No behavior change; consumers in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A.2: Add `normalizeBreakValue` helper

**Files:**
- Modify: `packages/core/src/layout/fragmentation.ts`
- Create: `packages/core/src/layout/fragmentation.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// packages/core/src/layout/fragmentation.test.ts
import { describe, it, expect } from "vitest";
import { normalizeBreakValue } from "./fragmentation";

describe("normalizeBreakValue", () => {
  it.each([
    ["auto", "auto"],
    ["page", "page"],
    ["always", "page"],
    ["avoid", "avoid"],
    ["avoid-page", "avoid"],
    // Unsupported values for P1.B → auto.
    ["recto", "auto"],
    ["verso", "auto"],
    ["left", "auto"],
    ["right", "auto"],
    ["column", "auto"],
    ["region", "auto"],
    ["avoid-column", "auto"],
    ["avoid-region", "auto"],
  ])("normalizes %s → %s", (raw, expected) => {
    expect(normalizeBreakValue(raw)).toBe(expected);
  });

  it("treats unknown strings as auto", () => {
    expect(normalizeBreakValue("garbage")).toBe("auto");
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npm test --workspace=packages/core -- fragmentation`
Expected: FAIL with "normalizeBreakValue is not a function" or similar import error.

- [ ] **Step 3: Implement.**

Add to `packages/core/src/layout/fragmentation.ts` (append):

```ts
/**
 * Normalize a CSS break-* property value to the three values BFC actually
 * consumes: "auto", "page", or "avoid".
 *
 * Mapping rules:
 *   "always" → "page" (synonym in pagination context)
 *   "avoid-page" → "avoid"
 *   "page", "auto", "avoid" → unchanged
 *   anything else (recto/verso/left/right/column/region/avoid-column/avoid-region/garbage) → "auto"
 *
 * P1.B doesn't honor recto/verso/left/right (need P1.C templates) or
 * column/region (no multi-column or named regions).
 */
export function normalizeBreakValue(raw: string): "auto" | "page" | "avoid" {
  if (raw === "page" || raw === "always") return "page";
  if (raw === "avoid" || raw === "avoid-page") return "avoid";
  return "auto";
}
```

- [ ] **Step 4: Run tests to verify they pass.**

Run: `npm test --workspace=packages/core -- fragmentation`
Expected: 14 tests pass.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/fragmentation.ts packages/core/src/layout/fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(layout): normalizeBreakValue — map CSS break-* values to {auto, page, avoid}

Maps always→page, avoid-page→avoid, and unsupported values (recto/verso/
left/right/column/region/avoid-column/avoid-region) → auto. The unsupported
set covers values that need P1.C page templates or formatting contexts P1.B
doesn't support.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Layout entry-point signature changes

These tasks change `layoutBlock` / `layoutInlineContent` / `layoutTable` to return `LayoutResult` and accept an optional `fragmentation?: FragmentationContext` parameter. No fragmentation *logic* yet — the new parameter is threaded but ignored. The new return is always `{ box: <result>, breakToken: null }` so the existing test suite keeps passing.

### Task B.1: Change `layoutBlock` signature

**Files:**
- Modify: `packages/core/src/layout/bfc.ts` — change `layoutBlock` signature and return type. Wrap all `return <BlockBox>` statements as `return { box: <BlockBox>, breakToken: null }`.
- Modify: `packages/core/src/layout/dispatch.ts:50` — call site `layoutBlock(layoutRoot, 0, 0, ctx, shaper)` becomes `const r = layoutBlock(layoutRoot, 0, 0, ctx, shaper); result = r.box!;` (non-null assertion is safe in unpaginated path; we'll replace it with proper narrowing in B.4).

- [ ] **Step 1: Read current `layoutBlock` to identify all return sites.**

Run: `grep -n "return " /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/layout/bfc.ts | head -20`

Identify every site that returns a `BlockBox`. Each one wraps as `return { box: <expr>, breakToken: null }`.

- [ ] **Step 2: Update the signature.**

In `packages/core/src/layout/bfc.ts`, change:

```ts
export function layoutBlock(
  node: ElementBox,
  inlineOffset: number,
  blockOffset: number,
  ctx: LayoutContext,
  shaper: TextShaper,
): BlockBox {
```

to:

```ts
import type { FragmentationContext, LayoutResult } from "./fragmentation";

export function layoutBlock(
  node: ElementBox,
  inlineOffset: number,
  blockOffset: number,
  ctx: LayoutContext,
  shaper: TextShaper,
  fragmentation?: FragmentationContext,
): LayoutResult {
```

- [ ] **Step 3: Wrap every internal `return <BlockBox>` site.**

Each `return blockBox;` (or equivalent expression) becomes `return { box: blockBox, breakToken: null };`.
The reuse-cache fast-path at `bfc.ts:66` returns `entry.box` — also wrap: `return { box: entry.box, breakToken: null };`.

- [ ] **Step 4: Update internal recursive callers within `bfc.ts`.**

If `layoutBlock` calls itself recursively (for nested block containers), each call site now needs to access `.box`. Find recursive sites:
Run: `grep -n "layoutBlock(" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/layout/bfc.ts`

For each recursive call, change `const child = layoutBlock(...)` to `const childResult = layoutBlock(...); const child = childResult.box;` — at this stage `childResult.box` is always non-null (no fragmentation logic yet); use `if (childResult.box === null) throw new Error("unreachable in B.1: fragmentation not yet wired")` as a stopgap that we'll replace in Phase C.

- [ ] **Step 5: Update `dispatch.ts` call site.**

In `packages/core/src/layout/dispatch.ts`, around line 50:

```ts
case "block":
  result = layoutBlock(layoutRoot, 0, 0, ctx, shaper);
  break;
```

becomes:

```ts
case "block": {
  const blockResult = layoutBlock(layoutRoot, 0, 0, ctx, shaper);
  if (blockResult.box === null) {
    throw new Error("layoutBlock at dispatch returned null box; should be unreachable in unpaginated path");
  }
  result = blockResult.box;
  break;
}
```

- [ ] **Step 6: Run the build.**

Run: `npm run build --workspace=packages/core`
Expected: builds cleanly. Any consumer of `layoutBlock`'s old return type surfaces as a TypeScript error here — fix each one to access `.box`.

- [ ] **Step 7: Run all existing tests.**

Run: `npm test --workspace=packages/core`
Expected: all 773 + 14 new tests pass. No behavior change; only signature shape changed.

- [ ] **Step 8: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/bfc.ts packages/core/src/layout/dispatch.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
refactor(bfc): layoutBlock returns LayoutResult; threads optional FragmentationContext

Mechanical signature change. layoutBlock now accepts fragmentation?:
FragmentationContext and returns LayoutResult { box: LayoutBox | null,
breakToken: BreakToken | null }. All internal returns wrap as { box, breakToken: null }
since no fragmentation logic is wired yet. dispatch.ts callers narrow box
back out, with a defensive throw on null (unreachable while fragmentation is
absent; replaced with proper handling in Phase C).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B.2: Change `layoutInlineContent` signature

**Files:**
- Modify: `packages/core/src/layout/ifc.ts:274` — `layoutInlineContent` signature.
- Modify: `packages/core/src/layout/bfc.ts` — call sites of `layoutInlineContent`.

- [ ] **Step 1: Identify all sites that call `layoutInlineContent`.**

Run: `grep -n "layoutInlineContent" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/layout/`

Expected: declaration in `ifc.ts:274`; one or more callers in `bfc.ts`.

- [ ] **Step 2: Update the signature in `ifc.ts`.**

Change `layoutInlineContent`'s signature to add `fragmentation?: FragmentationContext` as the last parameter and to return `LayoutResult` instead of its current return type (which is a `BlockBox` of lines).

Rule: every `return <BlockBox>` becomes `return { box: <BlockBox>, breakToken: null }`.

- [ ] **Step 3: Update bfc.ts call sites.**

Each call to `layoutInlineContent` returns `LayoutResult` now. Access `.box` for the existing behavior. Same defensive throw on `null` as in B.1.

- [ ] **Step 4: Build + test.**

Run: `npm run build --workspace=packages/core`
Run: `npm test --workspace=packages/core`
Expected: all tests pass.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/ifc.ts packages/core/src/layout/bfc.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
refactor(ifc): layoutInlineContent returns LayoutResult; threads FragmentationContext

Mechanical signature change. layoutInlineContent now accepts fragmentation?:
FragmentationContext and returns LayoutResult { box, breakToken }. All
internal returns wrap as { box, breakToken: null } since no fragmentation
logic is wired yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B.3: Change `layoutTable` signature

**Files:**
- Modify: `packages/core/src/layout/table-fc.ts:198` — `layoutTable` signature.
- Modify: `packages/core/src/layout/dispatch.ts:53` — `layoutTable(layoutRoot, 0, 0, ctx, shaper)` call site.
- Modify: any `bfc.ts` call sites of `layoutTable`.

- [ ] **Step 1: Identify all sites that call `layoutTable`.**

Run: `grep -n "layoutTable" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/layout/`

- [ ] **Step 2: Update the signature in `table-fc.ts`.**

Change `layoutTable` to add `fragmentation?: FragmentationContext` as the last parameter and return `LayoutResult`. Wrap all returns.

- [ ] **Step 3: Update call sites.**

`dispatch.ts:53`:

```ts
case "table": {
  const tableResult = layoutTable(layoutRoot, 0, 0, ctx, shaper);
  if (tableResult.box === null) {
    throw new Error("layoutTable at dispatch returned null box; should be unreachable in unpaginated path");
  }
  result = tableResult.box;
  break;
}
```

`bfc.ts` call sites: same access-`.box` pattern.

- [ ] **Step 4: Build + test.**

Run: `npm run build --workspace=packages/core`
Run: `npm test --workspace=packages/core`
Expected: all tests pass.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/table-fc.ts packages/core/src/layout/dispatch.ts packages/core/src/layout/bfc.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
refactor(table-fc): layoutTable returns LayoutResult; threads FragmentationContext

Mechanical signature change. Symmetric with B.1 (BFC) and B.2 (IFC).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — BFC fragmentation logic

The BFC's child-placement loop becomes break-aware. From this phase forward, the unit-test files are organized under `packages/core/src/layout/__tests__/` (a new subdirectory; existing tests stay alongside their sources).

### Task C.1: BFC respects `availableBlockSize` for whole-block placement

**Files:**
- Create: `packages/core/src/layout/__tests__/bfc-fragmentation.test.ts`
- Modify: `packages/core/src/layout/bfc.ts` — child-placement loop: when `fragmentation` is set, check whether each placed child fits and stop early.

- [ ] **Step 1: Write the failing test.**

```ts
// packages/core/src/layout/__tests__/bfc-fragmentation.test.ts
import { describe, it, expect } from "vitest";
import type { FragmentationContext } from "../fragmentation";
import { layoutBlock } from "../bfc";
import { makeRootContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "../../styles";
import { createMockShaper } from "../mock-shaper";
import { cascadePass } from "../../cascade";
import type { ElementBox } from "../../render/render-node-v2";

/** Build a root ElementBox with N block children, each of fixed block-size. */
function buildBlockChildren(count: number, childBlockSize: number): ElementBox {
  const children = Array.from({ length: count }, (_, i) => ({
    type: "element" as const,
    key: `child-${i}`,
    properties: {},
    style: { display: "block", blockSize: childBlockSize },
    children: [],
  }));
  const root = {
    type: "element" as const,
    key: "root",
    properties: {},
    style: { display: "block" },
    children,
  };
  return cascadePass(root) as ElementBox;
}

describe("BFC fragmentation — whole-block placement", () => {
  it("places all children when they fit", () => {
    const root = buildBlockChildren(3, 100); // 3 children × 100 = 300 total
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper();
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000,
      pageIndex: 0,
      resumeFrom: null,
    };

    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);

    expect(box).not.toBeNull();
    expect(breakToken).toBeNull();
    expect(box!.children).toHaveLength(3);
  });

  it("stops at the first child that doesn't fit; returns BlockBreakToken", () => {
    const root = buildBlockChildren(5, 100); // 5 × 100 = 500 total
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper();
    const fragmentation: FragmentationContext = {
      availableBlockSize: 250, // fits 2 children (200), 3rd doesn't fit
      pageIndex: 0,
      resumeFrom: null,
    };

    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);

    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(2);
    expect(breakToken).toEqual({
      type: "block",
      resumeChildIndex: 2,
      resumeChildToken: null,
    });
  });

  it("returns box: null when even the first child doesn't fit", () => {
    const root = buildBlockChildren(3, 1000); // child too tall
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper();
    const fragmentation: FragmentationContext = {
      availableBlockSize: 500,
      pageIndex: 0,
      resumeFrom: null,
    };

    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);

    // Note: this test exercises the simple case before C.6 overflow rule lands.
    // For now, we expect the BFC to refuse to place the oversize child and
    // return null + a breakToken that resumes from child 0. C.6 changes the
    // behavior when accumulatedOffset === 0 to place anyway.
    expect(box).toBeNull();
    expect(breakToken).toEqual({
      type: "block",
      resumeChildIndex: 0,
      resumeChildToken: null,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `npm test --workspace=packages/core -- bfc-fragmentation`
Expected: FAIL — fragmentation parameter is currently ignored, so `box` always contains all children and `breakToken` is always null.

- [ ] **Step 3: Implement.**

In `packages/core/src/layout/bfc.ts`'s child-placement loop (look for the section that iterates over the node's children and places them at `blockOffset += child.blockSize`), add fragmentation-aware logic:

```ts
// New: when fragmentation is active, track remaining space and break early.
const isPaginated = fragmentation !== undefined;
const availableBlockSize = isPaginated ? fragmentation.availableBlockSize : Number.POSITIVE_INFINITY;
let accumulatedOffset = 0;          // running block-offset within content area
let placedCount = 0;                // number of children actually placed
const placedChildren: LayoutBox[] = [];

for (let i = 0; i < children.length; i++) {
  const child = children[i];

  // Lay out the child; the recursive call may itself fragment.
  const childResult = layoutBlock(child as ElementBox, /* inlineOffset */ ?, accumulatedOffset, /* childCtx */, shaper, /* nested fragmentation */);

  // Whole-block placement check: does the laid-out child fit?
  const childBlockSize = childResult.box?.blockSize ?? 0;
  if (isPaginated && childResult.box !== null && childBlockSize > availableBlockSize - accumulatedOffset) {
    // Doesn't fit. Return a BlockBreakToken pointing at this child.
    return {
      box: createBlockBox(/* with placedChildren so far */),
      breakToken: { type: "block", resumeChildIndex: i, resumeChildToken: null },
    };
  }

  if (isPaginated && childResult.box === null) {
    // Child couldn't fit on this fragment. Accumulator is 0 → return null
    // box; otherwise return what we've placed with a token pointing here.
    if (placedCount === 0) {
      return { box: null, breakToken: { type: "block", resumeChildIndex: i, resumeChildToken: null } };
    }
    return {
      box: createBlockBox(/* with placedChildren */),
      breakToken: { type: "block", resumeChildIndex: i, resumeChildToken: null },
    };
  }

  placedChildren.push(childResult.box!);
  accumulatedOffset += childBlockSize;
  placedCount++;

  // If childResult had a breakToken (child was mid-fragment), stop here.
  if (childResult.breakToken !== null) {
    return {
      box: createBlockBox(/* with placedChildren */),
      breakToken: { type: "block", resumeChildIndex: i, resumeChildToken: childResult.breakToken },
    };
  }
}
return { box: createBlockBox(/* all placedChildren */), breakToken: null };
```

The exact integration with the existing BFC code (margin collapsing, anonymous block runs, marker boxes, list counters, etc.) requires careful weaving. Read `bfc.ts` lines 22-300 to understand the current child-placement loop structure and weave the fragmentation logic into it without disrupting the existing concerns. The recursive `layoutBlock` call for nested children must pass a derived `fragmentation` with `availableBlockSize: availableBlockSize - accumulatedOffset` so nested BFCs see the right remaining space.

- [ ] **Step 4: Run tests to verify they pass.**

Run: `npm test --workspace=packages/core -- bfc-fragmentation`
Expected: 3 tests pass.

- [ ] **Step 5: Run the full suite to verify no regressions.**

Run: `npm test --workspace=packages/core`
Expected: all existing tests still pass.

- [ ] **Step 6: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/bfc.ts packages/core/src/layout/__tests__/bfc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(bfc): whole-block placement respects FragmentationContext.availableBlockSize

When fragmentation is active, BFC stops at the first child that doesn't fit
and returns a BlockBreakToken pointing at that child. If even the first
child doesn't fit, returns box: null. Recursive calls thread reduced
availableBlockSize into nested BFCs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C.2: BFC handles `break-before: page` / `always`

**Files:**
- Modify: `packages/core/src/layout/__tests__/bfc-fragmentation.test.ts` — add cases.
- Modify: `packages/core/src/layout/bfc.ts` — read `cs.breakBefore` per child.

- [ ] **Step 1: Write failing tests.**

Append to `bfc-fragmentation.test.ts`:

```ts
describe("BFC fragmentation — break-before", () => {
  it("forces a page break before child K when cs.breakBefore = 'page'", () => {
    const root = buildBlockChildrenWithBreakBefore(/* ... */);
    // Child 2 has breakBefore: page. Children 0..1 placed; break returned at 2.
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper();
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
    expect(box!.children).toHaveLength(2);
    expect(breakToken).toEqual({ type: "block", resumeChildIndex: 2, resumeChildToken: null });
  });

  it("treats break-before: page on the first child of the fragment as no-op (CSS L4 §3.4)", () => {
    const root = buildBlockChildrenWithBreakBeforeOnFirst();
    // Child 0 has breakBefore: page.
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper();
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
    expect(box!.children).toHaveLength(/* all of them, since break before first is suppressed */ 3);
    expect(breakToken).toBeNull();
  });

  it("treats 'always' as a synonym for 'page'", () => {
    // Same as the first test but with breakBefore: 'always' on child 2.
    // Same expectation: page break before child 2.
  });
});
```

(Helper functions `buildBlockChildrenWithBreakBefore` etc. — extend the existing `buildBlockChildren` helper to accept per-child style overrides.)

- [ ] **Step 2: Verify the tests fail.**

Run: `npm test --workspace=packages/core -- bfc-fragmentation`
Expected: 3 new test failures (existing 3 still pass).

- [ ] **Step 3: Implement.**

In `bfc.ts`'s child-placement loop, before laying out child `i`, when `i > 0 || accumulatedOffset > 0` (i.e., the fragment already has placed content), check the child's `cs.breakBefore`:

```ts
import { normalizeBreakValue } from "./fragmentation";
// ...
const childCs = (children[i] as ElementBox).computedStyle;
if (childCs && isPaginated) {
  const breakBefore = normalizeBreakValue(childCs.breakBefore ?? "auto");
  if (breakBefore === "page" && (i > 0 || /* any prior content placed via earlier siblings */ false)) {
    // Forced break — finish this fragment now, push child K to next page.
    return {
      box: createBlockBox(/* with placedChildren so far */),
      breakToken: { type: "block", resumeChildIndex: i, resumeChildToken: null },
    };
  }
}
```

Note: "first child of the current fragment" can mean either the first child overall (`i === 0` and not resuming) OR the first child after a resume (handled when `resumeFrom !== null` and the first iteration of the loop is at `resumeChildIndex`). The check is: did this fragment already place any content? If yes, the break-before fires; if no, suppress.

- [ ] **Step 4: Verify tests pass.**

Run: `npm test --workspace=packages/core -- bfc-fragmentation`
Expected: 6 tests pass (3 original + 3 new).

- [ ] **Step 5: Run full suite.**

Run: `npm test --workspace=packages/core`
Expected: no regressions.

- [ ] **Step 6: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/bfc.ts packages/core/src/layout/__tests__/bfc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(bfc): break-before: page / always forces page break

CSS Fragmentation L4 §3.4: forced break before a child when cs.breakBefore
normalizes to 'page'. Suppressed when the fragment hasn't placed any content
yet (no preceding break point exists).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C.3: BFC handles `break-after: page` / `always`

**Files:**
- Modify: `packages/core/src/layout/__tests__/bfc-fragmentation.test.ts` — add cases.
- Modify: `packages/core/src/layout/bfc.ts` — read `cs.breakAfter` per placed child.

- [ ] **Step 1: Write failing tests.**

Append to `bfc-fragmentation.test.ts`:

```ts
describe("BFC fragmentation — break-after", () => {
  it("forces a page break after child K when cs.breakAfter = 'page'", () => {
    const root = buildBlockChildrenWithBreakAfter(/* child 1 has breakAfter: page */);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper();
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
    expect(box!.children).toHaveLength(2);
    expect(breakToken).toEqual({ type: "block", resumeChildIndex: 2, resumeChildToken: null });
  });

  it("is a no-op when break-after fires on the last child", () => {
    // Children 0..2; child 2 has breakAfter: page. No K+1 → no-op.
    const root = buildBlockChildrenWithBreakAfter(/* child 2 has breakAfter: page */);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper();
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
    expect(box!.children).toHaveLength(3);
    expect(breakToken).toBeNull();
  });
});
```

- [ ] **Step 2: Verify the tests fail.**

Run: `npm test --workspace=packages/core -- bfc-fragmentation`
Expected: 2 new failures.

- [ ] **Step 3: Implement.**

In `bfc.ts`'s child-placement loop, *after* placing child K successfully, check `cs.breakAfter`:

```ts
const breakAfter = normalizeBreakValue(childCs?.breakAfter ?? "auto");
if (isPaginated && breakAfter === "page" && i + 1 < children.length) {
  return {
    box: createBlockBox(/* with placedChildren */),
    breakToken: { type: "block", resumeChildIndex: i + 1, resumeChildToken: null },
  };
}
```

- [ ] **Step 4: Verify tests pass.**

Run: `npm test --workspace=packages/core -- bfc-fragmentation`
Expected: 8 tests pass.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/bfc.ts packages/core/src/layout/__tests__/bfc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(bfc): break-after: page / always forces page break

Symmetric with break-before. No-op when fired on the last child.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C.4: BFC handles `break-inside: avoid`

**Files:**
- Modify: `packages/core/src/layout/__tests__/bfc-fragmentation.test.ts` — add cases.
- Modify: `packages/core/src/layout/bfc.ts` — when child returns partial result and `cs.breakInside === "avoid"`, push whole.

- [ ] **Step 1: Write failing tests.**

Append:

```ts
describe("BFC fragmentation — break-inside: avoid", () => {
  it("pushes whole child to next page when partial fragment would result", () => {
    // Children 0..2: child 0 size 100, child 1 size 200 with breakInside: avoid,
    // available 250. Child 0 fits; child 1 doesn't fit whole; with breakInside:
    // avoid, BFC pushes child 1 to next page even though some of it could fit.
    const root = buildWithBreakInsideAvoid(/* child 1 */);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper();
    const fragmentation: FragmentationContext = {
      availableBlockSize: 250, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
    expect(box!.children).toHaveLength(1);
    expect(breakToken).toEqual({ type: "block", resumeChildIndex: 1, resumeChildToken: null });
  });

  it("treats 'avoid-page' the same as 'avoid'", () => {
    // Same as above, but child 1 has breakInside: 'avoid-page'.
  });
});
```

- [ ] **Step 2: Verify failures.**

Run: `npm test --workspace=packages/core -- bfc-fragmentation`
Expected: 2 new failures.

- [ ] **Step 3: Implement.**

In `bfc.ts`'s child-placement loop, when a child's layout returns either `(box != null, breakToken != null)` (partial) or `(box: null, breakToken)` (couldn't fit), inspect `cs.breakInside`:

```ts
const breakInside = normalizeBreakValue(childCs?.breakInside ?? "auto");
if (isPaginated && childResult.breakToken !== null && breakInside === "avoid" && accumulatedOffset > 0) {
  // Discard the partial result; push whole child to next page.
  return {
    box: createBlockBox(/* with placedChildren so far */),
    breakToken: { type: "block", resumeChildIndex: i, resumeChildToken: null },
  };
}
```

- [ ] **Step 4: Verify tests pass.**

Run: `npm test --workspace=packages/core -- bfc-fragmentation`
Expected: 10 tests pass.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/bfc.ts packages/core/src/layout/__tests__/bfc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(bfc): break-inside: avoid pushes whole child to next page

Discards partial fragmentation results and emits BlockBreakToken pointing
back at the child. C.6 will add the alone-on-empty-page exception (place
anyway, overflowing).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C.5: BFC handles margin truncation across breaks

**Files:**
- Modify: `packages/core/src/layout/__tests__/bfc-fragmentation.test.ts` — add cases.
- Modify: `packages/core/src/layout/bfc.ts` — at fragment-boundary, suppress first-child top-margin and last-child bottom-margin.

- [ ] **Step 1: Write failing tests.**

```ts
describe("BFC fragmentation — margin truncation across breaks", () => {
  it("suppresses top-margin of the first child on a fresh fragment (CSS L4 §5.4)", () => {
    // Child 0 has marginBlockStart: 50. Available 100, child block-size 80.
    // Without suppression: 50 (top-margin) + 80 = 130 > 100 → would push.
    // With suppression: top-margin = 0; 80 ≤ 100 → fits.
    const root = buildWithFirstChildTopMargin(50, 80);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper();
    const fragmentation: FragmentationContext = {
      availableBlockSize: 100, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
    expect(box!.children).toHaveLength(1);
    expect(breakToken).toBeNull();
  });

  it("drops bottom-margin of the last child when a fragment finishes via break", () => {
    // Children 0..2 each block-size 50, marginBlockEnd: 30, available 200.
    // Without suppression: child 0 + margin 30 = 80, child 1 + 30 = 160, child 2 + 30 = 240 > 200.
    // With last-margin truncated when fragment closes: only the *internal*
    // margins between siblings count; the last child's trailing margin doesn't
    // contribute to the page's used height for the purpose of the break decision.
    // (The page coordinator still records the child's blockSize for layout; the
    // truncation only affects the "did the next child fit?" decision.)
    // For a simpler test: place all 3 children, expect breakToken: null.
    const root = buildWithChildrenAllHavingBottomMargin(3, 50, 30);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper();
    const fragmentation: FragmentationContext = {
      availableBlockSize: 200, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
    expect(box!.children).toHaveLength(3);
    expect(breakToken).toBeNull();
  });
});
```

- [ ] **Step 2: Verify failures.**

Run: `npm test --workspace=packages/core -- bfc-fragmentation`
Expected: 2 new failures.

- [ ] **Step 3: Implement.**

In `bfc.ts`'s child-placement loop, when paginated:
- Track `isFirstChildOnFragment = true` initially. When the first child is placed (`accumulatedOffset === 0` before placement), suppress the top-margin contribution from `accumulatedOffset` for that child. Then set `isFirstChildOnFragment = false` for subsequent children.
- The "drop last child's bottom-margin at break" rule means: when computing the "did this child fit?" decision, the next child's bottom-margin contribution to total used height should be excluded. Concretely, the comparison `usedAfterThisChild > availableBlockSize` should compare only `usedAfterThisChild - thisChild.bottomMargin > availableBlockSize`. Equivalently, BFC tracks two values: `accumulatedOffset` (where the next child will start) and `accumulatedHeight` (used for the fit check, which excludes the trailing margin).

Read `bfc.ts` lines 78-160 carefully — the existing margin-collapsing logic for "first child collapses with parent" needs to coexist with this fragmentation truncation. The `isFirstChildOnFragment` flag is *additional* to the existing first-child margin collapse; both apply at fragment top.

- [ ] **Step 4: Verify tests pass.**

Run: `npm test --workspace=packages/core -- bfc-fragmentation`
Expected: 12 tests pass.

- [ ] **Step 5: Run full suite.**

Run: `npm test --workspace=packages/core`
Expected: no regressions in existing margin-collapsing tests (they exercise the unpaginated path, where this logic is inactive).

- [ ] **Step 6: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/bfc.ts packages/core/src/layout/__tests__/bfc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(bfc): margin truncation across fragmentation breaks (CSS L4 §5.4)

First child of a fresh fragment has its top-margin suppressed; trailing
bottom-margin of the last child is excluded from the fit-check so a
content-size-tight page doesn't overflow due to a margin that wouldn't
visually appear past the page boundary anyway.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C.6: BFC handles overflow rule (alone-on-empty-page)

**Files:**
- Modify: `packages/core/src/layout/__tests__/bfc-fragmentation.test.ts` — add cases.
- Modify: `packages/core/src/layout/bfc.ts` — when child too large + page empty, re-invoke without fragmentation and accept the overflowing box.

- [ ] **Step 1: Write failing tests.**

```ts
describe("BFC fragmentation — overflow rule", () => {
  it("places oversize child anyway when alone on empty fragment (overflows)", () => {
    const root = buildBlockChildren(1, 1500); // single child, block-size 1500
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper();
    const fragmentation: FragmentationContext = {
      availableBlockSize: 500,    // child too tall
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(1);
    expect(box!.children[0].blockSize).toBe(1500); // placed at full height
    expect(breakToken).toBeNull();
  });

  it("places oversize break-inside:avoid child anyway when alone on empty fragment", () => {
    const root = buildWithBreakInsideAvoid(/* child 0, size 1500 */);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper();
    const fragmentation: FragmentationContext = {
      availableBlockSize: 500, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(1);
    expect(breakToken).toBeNull();
  });

  it("revises C.1 expectation: oversize first child on empty fragment → place anyway", () => {
    // This is the same scenario as C.1's "returns box: null when even the first
    // child doesn't fit" test, but now C.6 changes the behavior. Update or
    // remove that earlier test as part of this task.
    // (The earlier test said box: null. With overflow rule, box is NOT null.)
  });
});
```

- [ ] **Step 2: Verify failures, and update the C.1 test that's now contradicted.**

The third test case above flags that one of C.1's tests must be updated/removed because C.6 supersedes its behavior. Edit the C.1 test "returns box: null when even the first child doesn't fit" to assert the new behavior (place anyway, overflowing).

Run: `npm test --workspace=packages/core -- bfc-fragmentation`
Expected: 2 failures (and the one C.1 test you updated above passes again).

- [ ] **Step 3: Implement.**

In `bfc.ts`'s child-placement loop, when child K won't fit AND `accumulatedOffset === 0` AND nothing has been placed yet (`placedCount === 0`):

```ts
if (isPaginated && childWontFit && placedCount === 0) {
  // Overflow rule: place the whole child anyway. Re-invoke layoutBlock
  // without fragmentation to get the unfragmented full box.
  const fullResult = layoutBlock(child as ElementBox, /* offsets */, /* childCtx */, shaper, /* fragmentation */ undefined);
  // fullResult.box is guaranteed non-null in unpaginated path.
  placedChildren.push(fullResult.box!);
  accumulatedOffset += fullResult.box!.blockSize;
  placedCount++;
  // Continue with next child (it will surely not fit; will be pushed to next page).
  continue;
}
```

- [ ] **Step 4: Verify tests pass.**

Run: `npm test --workspace=packages/core -- bfc-fragmentation`
Expected: ~14 tests pass (12 from prior + 2 new + 1 updated = 15, modulo any test renaming).

- [ ] **Step 5: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/bfc.ts packages/core/src/layout/__tests__/bfc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(bfc): overflow rule — place oversize child anyway when alone on empty fragment

CSS L4 §3.5: avoid is preferred but not mandatory. When no valid break point
exists (the child won't fit any fragment) and the current fragment is empty,
place the child anyway and let it overflow past the fragment bottom. Prevents
infinite paginate-empty-page loops on truly oversize content.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C.7: BFC handles resume from `BlockBreakToken`

**Files:**
- Modify: `packages/core/src/layout/__tests__/bfc-fragmentation.test.ts` — add cases.
- Modify: `packages/core/src/layout/bfc.ts` — when `fragmentation.resumeFrom` is a `BlockBreakToken`, start the loop at `resumeChildIndex` and pass `resumeChildToken` into the first child's recursive call.

- [ ] **Step 1: Write failing tests.**

```ts
describe("BFC fragmentation — resume from BlockBreakToken", () => {
  it("resumes at resumeChildIndex on the next fragment", () => {
    const root = buildBlockChildren(5, 100); // 5 × 100 = 500
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper();
    // First call fills page 1 with children 0..1 (200 used), break at 2.
    const r1 = layoutBlock(root, 0, 0, ctx, shaper, {
      availableBlockSize: 250, pageIndex: 0, resumeFrom: null,
    });
    expect(r1.box!.children).toHaveLength(2);
    expect(r1.breakToken).toEqual({ type: "block", resumeChildIndex: 2, resumeChildToken: null });

    // Second call resumes at child 2.
    const r2 = layoutBlock(root, 0, 0, ctx, shaper, {
      availableBlockSize: 250, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box!.children).toHaveLength(2); // children 2..3
    expect(r2.breakToken).toEqual({ type: "block", resumeChildIndex: 4, resumeChildToken: null });

    // Third call resumes at child 4 (last).
    const r3 = layoutBlock(root, 0, 0, ctx, shaper, {
      availableBlockSize: 250, pageIndex: 2, resumeFrom: r2.breakToken,
    });
    expect(r3.box!.children).toHaveLength(1); // child 4
    expect(r3.breakToken).toBeNull();
  });

  it("threads resumeChildToken into the first child's recursive call", () => {
    // Set up: a paragraph mid-fragment. First call returns BlockBreakToken with
    // resumeChildToken: { type: "ifc", resumeAtLine: 5 }. Second call resumes
    // the paragraph from line 5.
    // (This test integrates IFC fragmentation, which lands in Phase D. Mark
    // it as `it.skip` if running C.7 before D.5; un-skip when D.5 lands.)
    it.skip("threads resumeChildToken (requires IFC resume from D.5)", () => {
      // ...
    });
  });
});
```

- [ ] **Step 2: Verify failure.**

Run: `npm test --workspace=packages/core -- bfc-fragmentation`
Expected: 1 failure (the resume test; the second test is skipped).

- [ ] **Step 3: Implement.**

In `bfc.ts`'s child-placement loop:

```ts
const resumeFrom = fragmentation?.resumeFrom;
const resumeBlockToken = resumeFrom?.type === "block" ? resumeFrom : null;
const startIndex = resumeBlockToken?.resumeChildIndex ?? 0;
const firstChildResume = resumeBlockToken?.resumeChildToken ?? null;

for (let i = startIndex; i < children.length; i++) {
  // First iteration: pass firstChildResume as the recursive call's resumeFrom.
  // Subsequent iterations: pass null.
  const childFragmentation: FragmentationContext | undefined = isPaginated ? {
    availableBlockSize: availableBlockSize - accumulatedOffset,
    pageIndex: fragmentation.pageIndex,
    resumeFrom: i === startIndex ? firstChildResume : null,
  } : undefined;
  const childResult = layoutBlock(children[i] as ElementBox, /* offsets */, /* childCtx */, shaper, childFragmentation);
  // ... rest of loop unchanged
}
```

- [ ] **Step 4: Verify the resume test passes.**

Run: `npm test --workspace=packages/core -- bfc-fragmentation`
Expected: resume test passes; integration test stays skipped.

- [ ] **Step 5: Run full suite.**

Run: `npm test --workspace=packages/core`
Expected: no regressions.

- [ ] **Step 6: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/bfc.ts packages/core/src/layout/__tests__/bfc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(bfc): resume from BlockBreakToken

Threads resumeFrom into the child-placement loop: starts at resumeChildIndex
and passes resumeChildToken into the first child's recursive call so a
mid-fragment IFC/Table/nested-BFC continues from where it left off.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — IFC fragmentation logic

### Task D.1: IFC stops at `availableBlockSize`, returns `IFCBreakToken`

**Files:**
- Create: `packages/core/src/layout/__tests__/ifc-fragmentation.test.ts`
- Modify: `packages/core/src/layout/ifc.ts` — `layoutInlineContent` checks `fragmentation.availableBlockSize` and stops at the line that would overflow.

- [ ] **Step 1: Write failing tests.**

```ts
// packages/core/src/layout/__tests__/ifc-fragmentation.test.ts
import { describe, it, expect } from "vitest";
import type { FragmentationContext } from "../fragmentation";
import { layoutInlineContent } from "../ifc";
// ... harness imports similar to bfc-fragmentation.test.ts

describe("IFC fragmentation — line-level split", () => {
  it("places all lines when paragraph fits", () => {
    // 5 lines × line-height 20 = 100; available 200.
    const para = buildParagraphWithFixedLines(5, 20);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 200, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(/* args */, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(5); // 5 LineBoxes
    expect(breakToken).toBeNull();
  });

  it("stops at the line that overflows; returns IFCBreakToken", () => {
    const para = buildParagraphWithFixedLines(10, 20); // 10 × 20 = 200
    const fragmentation: FragmentationContext = {
      availableBlockSize: 100, // fits 5 lines
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(/* args */, fragmentation);
    expect(box!.children).toHaveLength(5);
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 5 });
  });

  it("returns box: null + IFCBreakToken at line 0 when even the first line doesn't fit", () => {
    const para = buildParagraphWithFixedLines(5, 100); // line height 100
    const fragmentation: FragmentationContext = {
      availableBlockSize: 50, // line too tall
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(/* args */, fragmentation);
    expect(box).toBeNull();
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 0 });
  });
});
```

- [ ] **Step 2: Verify failures.**

Run: `npm test --workspace=packages/core -- ifc-fragmentation`
Expected: 3 failures.

- [ ] **Step 3: Implement.**

In `ifc.ts`'s `layoutInlineContent` function (line ~274), after the wrap pass produces all lines, walk the lines accumulating block-axis used size:

```ts
if (fragmentation !== undefined) {
  let used = 0;
  let placedLineCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineHeight = lines[i].blockSize;
    if (used + lineHeight > fragmentation.availableBlockSize) {
      break;
    }
    used += lineHeight;
    placedLineCount++;
  }
  if (placedLineCount === 0) {
    return { box: null, breakToken: { type: "ifc", resumeAtLine: 0 } };
  }
  if (placedLineCount < lines.length) {
    const placedLines = lines.slice(0, placedLineCount);
    return {
      box: createBlockBox(/* with placedLines, blockSize=used */),
      breakToken: { type: "ifc", resumeAtLine: placedLineCount },
    };
  }
  // All lines placed — fall through to return { box, breakToken: null }.
}
```

This is post-wrap fragmentation: IFC still produces the full set of lines from the wrap pass, then truncates. Per the spec's "IFC re-runs line layout from line 0" note, this is acceptable because line layout is deterministic given content + width. Caching is P18.

- [ ] **Step 4: Verify tests pass.**

Run: `npm test --workspace=packages/core -- ifc-fragmentation`
Expected: 3 tests pass.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/ifc.ts packages/core/src/layout/__tests__/ifc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(ifc): line-level fragmentation respects FragmentationContext.availableBlockSize

Post-wrap fragmentation: produces the full line set, then truncates to those
that fit. Returns IFCBreakToken with resumeAtLine for the next fragment.
Returns box: null when even the first line doesn't fit (parent BFC handles
the push-or-overflow decision).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task D.2: IFC respects `orphans`

**Files:**
- Modify: `packages/core/src/layout/__tests__/ifc-fragmentation.test.ts` — add cases.
- Modify: `packages/core/src/layout/ifc.ts` — orphans constraint applied to split-point search.

- [ ] **Step 1: Write failing tests.**

```ts
describe("IFC fragmentation — orphans", () => {
  it("pushes whole paragraph when fewer than `orphans` lines fit on current page", () => {
    // Paragraph with orphans: 3. Available fits only 2 lines.
    const para = buildParagraphWithOrphans(10, 20, /* orphans */ 3);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 50, // fits only 2 lines
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(/* args */, fragmentation);
    expect(box).toBeNull();
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 0 });
  });

  it("places K lines when K >= orphans", () => {
    const para = buildParagraphWithOrphans(10, 20, /* orphans */ 2);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 100, // fits 5 lines, orphans constraint satisfied
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(/* args */, fragmentation);
    expect(box!.children).toHaveLength(5);
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 5 });
  });
});
```

- [ ] **Step 2: Verify failures.**

Run: `npm test --workspace=packages/core -- ifc-fragmentation`
Expected: 2 new failures.

- [ ] **Step 3: Implement.**

Read the orphans value from the paragraph's computed style; default to `2` per CSS spec. Modify the split-point search:

```ts
const orphans = paragraphCs?.orphans ?? 2;
// ... in the line-fit loop ...
if (placedLineCount < orphans) {
  // Constraint violated; push whole paragraph.
  return { box: null, breakToken: { type: "ifc", resumeAtLine: 0 } };
}
```

- [ ] **Step 4: Verify tests pass.**

Run: `npm test --workspace=packages/core -- ifc-fragmentation`
Expected: 5 tests pass.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/ifc.ts packages/core/src/layout/__tests__/ifc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(ifc): orphans constraint pushes whole paragraph when fewer than orphans lines fit

CSS Fragmentation L4 §5.4. Default orphans value is 2 per CSS spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task D.3: IFC respects `widows`

**Files:**
- Modify: `packages/core/src/layout/__tests__/ifc-fragmentation.test.ts` — add cases.
- Modify: `packages/core/src/layout/ifc.ts` — widows constraint applied to split-point search.

- [ ] **Step 1: Write failing tests.**

```ts
describe("IFC fragmentation — widows", () => {
  it("backs off split point when fewer than `widows` lines would land on next page", () => {
    // 7 lines, widows: 3. Available fits 6 lines (line K=5). But that leaves
    // only 2 lines for the next page, violating widows. Back off K to 4.
    const para = buildParagraphWithWidows(7, 20, /* widows */ 3);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 120, // fits 6 lines (120/20)
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(/* args */, fragmentation);
    expect(box!.children).toHaveLength(4); // backed off from 6 to 4
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 4 });
  });

  it("pushes whole paragraph when no valid split exists due to widows + orphans", () => {
    // 5 lines, orphans: 3, widows: 3. No valid k satisfies both 3 ≤ k ≤ 2.
    const para = buildParagraphWithWidowsAndOrphans(5, 20, 3, 3);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 80, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(/* args */, fragmentation);
    expect(box).toBeNull();
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 0 });
  });
});
```

- [ ] **Step 2: Verify failures.**

Run: `npm test --workspace=packages/core -- ifc-fragmentation`
Expected: 2 new failures.

- [ ] **Step 3: Implement.**

After computing initial `placedLineCount` from the fit-loop, apply widows: while `placedLineCount > 0 && lines.length - placedLineCount < widows`, decrement `placedLineCount`. If after this `placedLineCount < orphans`, push whole.

```ts
const widows = paragraphCs?.widows ?? 2;
// Already applied orphans (D.2). Now apply widows.
while (placedLineCount > 0 && lines.length - placedLineCount < widows) {
  placedLineCount--;
}
if (placedLineCount < orphans) {
  return { box: null, breakToken: { type: "ifc", resumeAtLine: 0 } };
}
// Now compute used = sum(lineHeights[0..placedLineCount-1]) and emit.
```

- [ ] **Step 4: Verify tests pass.**

Run: `npm test --workspace=packages/core -- ifc-fragmentation`
Expected: 7 tests pass.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/ifc.ts packages/core/src/layout/__tests__/ifc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(ifc): widows constraint backs off split point or pushes whole

CSS Fragmentation L4 §5.4. Default widows value is 2 per CSS spec. When no
valid split exists (widows + orphans both unsatisfiable), pushes whole
paragraph.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task D.4: IFC respects hyphen-pair constraint

**Files:**
- Modify: `packages/core/src/layout/__tests__/ifc-fragmentation.test.ts` — add cases.
- Modify: `packages/core/src/layout/ifc.ts` — split-point search avoids cuts where lines[k] ends with hyphen continuation onto lines[k+1].

- [ ] **Step 1: Write a failing test.**

```ts
describe("IFC fragmentation — hyphen-pair constraint", () => {
  it("avoids splitting between two hyphenated lines (CSS L4 §5)", () => {
    // 6 lines; line 3 ends with a hyphenated continuation onto line 4.
    // Available fits 4 lines. Without constraint: split at k=4. With constraint:
    // back off to k=3.
    const para = buildParagraphWithHyphenAt(6, 20, /* hyphenLine */ 3);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 80, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(/* args */, fragmentation);
    expect(box!.children).toHaveLength(3); // backed off from 4 to 3
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 3 });
  });
});
```

The test fixture `buildParagraphWithHyphenAt` constructs a paragraph where the IFC's wrap output puts a hyphen continuation between the specified line and the next. The IFC marks lines that end in hyphen continuations via `LineBox.endsWithHyphenContinuation: boolean` (or similar) — read `ifc.ts` to confirm the existing flag name and adjust the test accordingly.

- [ ] **Step 2: Verify failure.**

Run: `npm test --workspace=packages/core -- ifc-fragmentation`
Expected: 1 failure.

- [ ] **Step 3: Implement.**

In the IFC's split-point search, after the widows back-off, check the hyphen continuation:

```ts
// Hyphen-pair constraint: the line at the break point can't end with a
// hyphenation continuation onto the next line.
while (placedLineCount > 0 && lines[placedLineCount - 1].endsWithHyphenContinuation) {
  placedLineCount--;
}
if (placedLineCount < orphans) {
  return { box: null, breakToken: { type: "ifc", resumeAtLine: 0 } };
}
```

If the existing IFC doesn't surface `endsWithHyphenContinuation` on `LineBox`, add the flag at line-construction time (the IFC wrap loop knows when it inserted a hyphen). The flag is a single boolean on `LineBox` produced by the wrap pass.

- [ ] **Step 4: Verify tests pass.**

Run: `npm test --workspace=packages/core -- ifc-fragmentation`
Expected: 8 tests pass.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/ifc.ts packages/core/src/layout/__tests__/ifc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(ifc): hyphen-pair constraint — break can't fall mid hyphenated word

CSS L4 §5: hyphenated suffix stays whole on one fragment. Adds (or surfaces)
a LineBox.endsWithHyphenContinuation flag set by the wrap pass; fragmentation
backs off the split point past such lines.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task D.5: IFC handles resume from `IFCBreakToken`

**Files:**
- Modify: `packages/core/src/layout/__tests__/ifc-fragmentation.test.ts` — add cases.
- Modify: `packages/core/src/layout/ifc.ts` — when `fragmentation.resumeFrom` is an `IFCBreakToken`, skip lines `0..resumeAtLine-1`.

- [ ] **Step 1: Write failing tests.**

```ts
describe("IFC fragmentation — resume from IFCBreakToken", () => {
  it("emits lines starting at resumeAtLine on the next fragment", () => {
    const para = buildParagraphWithFixedLines(10, 20); // 10 × 20 = 200
    // First fragment: fits 4 lines (k=4 satisfies orphans=2, widows=2: 4 ≥ 2 and 6 ≥ 2).
    const r1 = layoutInlineContent(/* args */, {
      availableBlockSize: 80, pageIndex: 0, resumeFrom: null,
    });
    expect(r1.breakToken).toEqual({ type: "ifc", resumeAtLine: 4 });

    // Second fragment: resume at line 4. Fit lines 4..9 (6 lines, 120 used).
    const r2 = layoutInlineContent(/* args */, {
      availableBlockSize: 200, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box!.children).toHaveLength(6);
    expect(r2.breakToken).toBeNull();
  });

  it("applies widows/orphans relative to the resumed line range", () => {
    const para = buildParagraphWithFixedLines(10, 20);
    // First fragment: 4 lines.
    const r1 = layoutInlineContent(/* args */, {
      availableBlockSize: 80, pageIndex: 0, resumeFrom: null,
    });
    // Second fragment: only 100 available. 5 lines fit, leaves 1 line for next.
    // Widows constraint (default 2): backs off to 4.
    const r2 = layoutInlineContent(/* args */, {
      availableBlockSize: 100, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box!.children).toHaveLength(4); // lines 4..7
    expect(r2.breakToken).toEqual({ type: "ifc", resumeAtLine: 8 });
  });
});
```

- [ ] **Step 2: Verify failures.**

Run: `npm test --workspace=packages/core -- ifc-fragmentation`
Expected: 2 new failures.

- [ ] **Step 3: Implement.**

In `layoutInlineContent`, after the wrap pass produces all lines:

```ts
const resumeFrom = fragmentation?.resumeFrom;
const startLine = resumeFrom?.type === "ifc" ? resumeFrom.resumeAtLine : 0;

// Slice lines starting at startLine.
const linesToConsider = lines.slice(startLine);

// Apply availableBlockSize fit-check, orphans, widows, hyphen-pair to linesToConsider.
// (Everything in D.1-D.4 now applies to the suffix.)
// ...
// Final placedLineCount is relative to linesToConsider; convert back:
const absolutePlacedEnd = startLine + placedLineCount;
return {
  box: createBlockBox(/* with linesToConsider.slice(0, placedLineCount), blockSize=used */),
  breakToken: absolutePlacedEnd < lines.length
    ? { type: "ifc", resumeAtLine: absolutePlacedEnd }
    : null,
};
```

Verify that for the case where `placedLineCount === 0` (couldn't fit anything from the suffix), the return is `{ box: null, breakToken: { type: "ifc", resumeAtLine: startLine } }` — i.e., resume from the same line on the next fragment.

- [ ] **Step 4: Verify tests pass.**

Run: `npm test --workspace=packages/core -- ifc-fragmentation`
Expected: 10 tests pass.

- [ ] **Step 5: Un-skip the C.7 integration test (BlockBreakToken with resumeChildToken IFCBreakToken).**

Edit `bfc-fragmentation.test.ts` to un-skip and write the integration test now that IFC resume works.

```ts
it("threads resumeChildToken (IFCBreakToken) into the first child's recursive call", () => {
  // Set up: a single paragraph child that fragments at line 5.
  const root = buildSingleParagraphChild(/* 10 lines × 20 */);
  // First call: paragraph fragments at line 5.
  const r1 = layoutBlock(root, 0, 0, ctx, shaper, {
    availableBlockSize: 100, pageIndex: 0, resumeFrom: null,
  });
  expect(r1.breakToken).toEqual({
    type: "block",
    resumeChildIndex: 0,
    resumeChildToken: { type: "ifc", resumeAtLine: 5 },
  });
  // Second call: resume from the BlockBreakToken with IFC child token.
  const r2 = layoutBlock(root, 0, 0, ctx, shaper, {
    availableBlockSize: 200, pageIndex: 1, resumeFrom: r1.breakToken,
  });
  // The paragraph's continuation should have lines 5..9 (5 lines).
  expect(r2.box!.children[0].children).toHaveLength(5);
  expect(r2.breakToken).toBeNull();
});
```

- [ ] **Step 6: Run full suite.**

Run: `npm test --workspace=packages/core`
Expected: no regressions.

- [ ] **Step 7: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/ifc.ts packages/core/src/layout/__tests__/ifc-fragmentation.test.ts packages/core/src/layout/__tests__/bfc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(ifc): resume from IFCBreakToken; integration with BFC

IFC consumes resumeFrom: IFCBreakToken and emits lines starting at
resumeAtLine. Widows/orphans/hyphen-pair apply to the resumed suffix.
Un-skips the BFC↔IFC integration test from C.7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — Table FC fragmentation logic

### Task E.1: Table FC stops at `availableBlockSize`, returns `TableBreakToken`

**Files:**
- Create: `packages/core/src/layout/__tests__/table-fc-fragmentation.test.ts`
- Modify: `packages/core/src/layout/table-fc.ts` — `layoutTable` truncates rows that don't fit.

- [ ] **Step 1: Write failing tests.**

```ts
// packages/core/src/layout/__tests__/table-fc-fragmentation.test.ts
import { describe, it, expect } from "vitest";
import type { FragmentationContext } from "../fragmentation";
import { layoutTable } from "../table-fc";
// ... harness imports

describe("Table FC fragmentation — row-level split", () => {
  it("places all rows when table fits", () => {
    const table = buildSimpleTable(/* rows */ 3, /* rowHeight */ 30);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 200, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutTable(/* args */, fragmentation);
    expect(box).not.toBeNull();
    expect(/* row count from box */).toBe(3);
    expect(breakToken).toBeNull();
  });

  it("stops at the row that overflows; returns TableBreakToken", () => {
    const table = buildSimpleTable(5, 30); // total 150
    const fragmentation: FragmentationContext = {
      availableBlockSize: 90, // fits 3 rows
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutTable(/* args */, fragmentation);
    expect(/* row count from box */).toBe(3);
    expect(breakToken).toEqual({ type: "table", resumeAtRow: 3 });
  });

  it("returns box: null + TableBreakToken at row 0 when even the first row doesn't fit", () => {
    const table = buildSimpleTable(5, 100);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 50, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutTable(/* args */, fragmentation);
    expect(box).toBeNull();
    expect(breakToken).toEqual({ type: "table", resumeAtRow: 0 });
  });
});
```

- [ ] **Step 2: Verify failures.**

Run: `npm test --workspace=packages/core -- table-fc-fragmentation`
Expected: 3 failures.

- [ ] **Step 3: Implement.**

In `table-fc.ts`'s `layoutTable`, after rows are laid out, apply the same fit-and-truncate pattern as IFC but at row granularity. Read `table-fc.ts` lines 1-360 to understand the row-grouping (`groupTableRows`) and layout flow first; hook fragmentation in after rows are sized but before the final TableBox is constructed.

```ts
if (fragmentation !== undefined) {
  let used = 0;
  let placedRowCount = 0;
  for (let i = 0; i < rows.length; i++) {
    if (used + rows[i].blockSize > fragmentation.availableBlockSize) {
      break;
    }
    used += rows[i].blockSize;
    placedRowCount++;
  }
  if (placedRowCount === 0) {
    return { box: null, breakToken: { type: "table", resumeAtRow: 0 } };
  }
  if (placedRowCount < rows.length) {
    return {
      box: createTableBox(/* with rows[0..placedRowCount-1] */),
      breakToken: { type: "table", resumeAtRow: placedRowCount },
    };
  }
}
```

- [ ] **Step 4: Verify tests pass.**

Run: `npm test --workspace=packages/core -- table-fc-fragmentation`
Expected: 3 tests pass.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/table-fc.ts packages/core/src/layout/__tests__/table-fc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(table-fc): row-level fragmentation; returns TableBreakToken

Truncates rows that don't fit on the current fragment. Returns box: null
when even the first row overflows (parent BFC handles push-or-overflow).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task E.2: Table FC repeats `<thead>` at top of remainder

**Files:**
- Modify: `packages/core/src/layout/__tests__/table-fc-fragmentation.test.ts` — add cases.
- Modify: `packages/core/src/layout/table-fc.ts` — when fragmenting, prepend `<thead>` rows to remainder.

- [ ] **Step 1: Write failing tests.**

```ts
describe("Table FC fragmentation — thead repetition", () => {
  it("repeats thead rows at the top of each remainder fragment", () => {
    const table = buildTableWithTheadAndBody(
      /* thead rows */ 2, /* tbody rows */ 5, /* rowHeight */ 30,
    );
    // Total visible rows = 2 + 5 = 7, total height = 210.
    // Available 120: fits 4 rows (thead 2 + body 2).
    const fragmentation: FragmentationContext = {
      availableBlockSize: 120, pageIndex: 0, resumeFrom: null,
    };
    const r1 = layoutTable(/* args */, fragmentation);
    // First fragment has thead (rows 0..1) + body rows 0..1 = 4 rows.
    expect(/* count of rows from r1.box */).toBe(4);
    expect(r1.breakToken).toEqual({ type: "table", resumeAtRow: 2 }); // resume at 3rd body row (0-indexed in tbody)

    // Second fragment with resume.
    const r2 = layoutTable(/* args */, {
      availableBlockSize: 120, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    // Should contain thead (repeated) + body rows 2..4 = 5 rows total.
    expect(/* count */).toBe(5);
    expect(r2.breakToken).toBeNull();
  });

  it("doesn't repeat anything for a table with no thead", () => {
    const table = buildSimpleTable(5, 30); // no thead
    const r1 = layoutTable(/* args */, {
      availableBlockSize: 90, pageIndex: 0, resumeFrom: null,
    });
    expect(/* count */).toBe(3);
    expect(r1.breakToken).toEqual({ type: "table", resumeAtRow: 3 });

    const r2 = layoutTable(/* args */, {
      availableBlockSize: 90, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(/* count */).toBe(2); // remaining body rows, no thead repeat
  });
});
```

The `resumeAtRow` index convention: it indexes into the TBODY rows, not the merged thead+body sequence. Document this in the type comment in `fragmentation.ts`.

- [ ] **Step 2: Update the comment in `fragmentation.ts`.**

```ts
export interface TableBreakToken {
  readonly type: "table";
  /** 0-based row index in the table BODY (excluding thead) at which to resume.
   * thead rows always repeat at the top of each fragment. */
  readonly resumeAtRow: number;
}
```

- [ ] **Step 3: Verify failures.**

Run: `npm test --workspace=packages/core -- table-fc-fragmentation`
Expected: 2 new failures (one new test, one updated test that's now contradicted by the resumeAtRow indexing change).

- [ ] **Step 4: Implement.**

In `table-fc.ts`, separate thead from body in the row-grouping. When fragmenting body, the placed-rows for the current fragment are `thead.rows + body.rows.slice(startBody, startBody + placed)`. The remainder fragment, when re-entered, also prepends thead rows — so `layoutTable` always emits thead rows regardless of `resumeAtRow`.

- [ ] **Step 5: Verify tests pass.**

Run: `npm test --workspace=packages/core -- table-fc-fragmentation`
Expected: 5 tests pass.

- [ ] **Step 6: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/table-fc.ts packages/core/src/layout/fragmentation.ts packages/core/src/layout/__tests__/table-fc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(table-fc): thead rows repeat at top of each table-fragment

CSS Tables 3 §17.5.4. resumeAtRow indexes the table BODY only; thead is
always emitted at the top of each fragment.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task E.3: Table FC handles resume from `TableBreakToken`

**Files:**
- Modify: `packages/core/src/layout/__tests__/table-fc-fragmentation.test.ts` — add cases.
- Modify: `packages/core/src/layout/table-fc.ts` — apply `resumeFrom` to skip body rows.

- [ ] **Step 1: Write failing test.**

```ts
describe("Table FC fragmentation — resume from TableBreakToken", () => {
  it("skips body rows 0..resumeAtRow-1 when resuming", () => {
    const table = buildSimpleTable(8, 30);
    const r1 = layoutTable(/* args */, {
      availableBlockSize: 120, pageIndex: 0, resumeFrom: null,
    });
    expect(r1.breakToken).toEqual({ type: "table", resumeAtRow: 4 });
    const r2 = layoutTable(/* args */, {
      availableBlockSize: 200, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(/* row count */).toBe(4); // body rows 4..7
    expect(r2.breakToken).toBeNull();
  });
});
```

- [ ] **Step 2: Verify failure.**

Run: `npm test --workspace=packages/core -- table-fc-fragmentation`
Expected: 1 failure.

- [ ] **Step 3: Implement.**

```ts
const resumeFrom = fragmentation?.resumeFrom;
const startBodyRow = resumeFrom?.type === "table" ? resumeFrom.resumeAtRow : 0;
const bodyRowsToConsider = bodyRows.slice(startBodyRow);
// Apply E.1's fit-truncate to bodyRowsToConsider; emit thead always.
```

- [ ] **Step 4: Verify tests pass.**

Run: `npm test --workspace=packages/core -- table-fc-fragmentation`
Expected: 6 tests pass.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/table-fc.ts packages/core/src/layout/__tests__/table-fc-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(table-fc): resume from TableBreakToken

Skips body rows 0..resumeAtRow-1; thead always emits at top of fragment.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase F — paginate.ts coordinator

### Task F.1: Rewrite `paginateRoot` as a coordinator loop

**Files:**
- Modify: `packages/core/src/layout/paginate.ts` — full rewrite.
- Modify: `packages/core/src/layout/paginate.test.ts` — extend tests.

- [ ] **Step 1: Write a new test for the coordinator's multi-page behavior.**

```ts
// Append to packages/core/src/layout/paginate.test.ts
describe("paginateRoot — coordinator loop", () => {
  it("invokes layoutBlock per page with carry-over breakToken", () => {
    const root = buildBlockChildrenWithBreakBefore(/* child 2 has breakBefore: page */);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper();
    const pageConfig = {
      pageInlineSize: 600, pageBlockSize: 1000,
      pageMargins: { blockStart: 50, blockEnd: 50, inlineStart: 0, inlineEnd: 0 },
      pageGap: 24,
    };
    const result = paginateRoot(root, ctx, shaper, pageConfig);
    expect(result.children).toHaveLength(2); // 2 PageBoxes
    expect(result.children[0].children).toHaveLength(2); // children 0..1 on page 0
    expect(result.children[1].children).toHaveLength(/* remaining */);
  });
});
```

- [ ] **Step 2: Verify failure.**

Run: `npm test --workspace=packages/core -- paginate`
Expected: failure (current `paginateRoot` consumes a `BlockBox`, not a `RenderNode`; signature mismatch).

- [ ] **Step 3: Rewrite `paginate.ts`.**

```ts
// packages/core/src/layout/paginate.ts
import type { ElementBox } from "../render/render-node-v2";
import type { LayoutContext } from "./layout-context";
import type { TextShaper } from "./text-shaper";
import type { PageConfig } from "./page-config";
import type { BlockBox, LayoutBox } from "./layout-box-v2";
import { createBlockBox } from "./layout-box-v2";
import type { PageBox } from "./page-box";
import { createPageBox } from "./page-box";
import { layoutBlock } from "./bfc";
import { computeUsedStyle } from "./used-style";
import type { BreakToken, FragmentationContext } from "./fragmentation";

/**
 * Paginate a block-flow document by driving `layoutBlock` per page with
 * the previous page's breakToken as the next page's resumeFrom.
 *
 * P1.B: interleaved-with-BFC fragmentation. The fragmenter is no longer a
 * post-hoc pass over a fully-laid-out tree; it's a per-page coordinator
 * that asks the BFC to produce one page's worth of content at a time.
 */
export function paginateRoot(
  root: ElementBox,
  ctx: LayoutContext,
  shaper: TextShaper,
  pageConfig: PageConfig,
): BlockBox {
  const pageContentBlockSize =
    pageConfig.pageBlockSize -
    pageConfig.pageMargins.blockStart -
    pageConfig.pageMargins.blockEnd;
  if (pageContentBlockSize <= 0) {
    throw new Error(
      `Invalid PageConfig: pageMargins.blockStart (${pageConfig.pageMargins.blockStart}) + pageMargins.blockEnd (${pageConfig.pageMargins.blockEnd}) must be less than pageBlockSize (${pageConfig.pageBlockSize}).`,
    );
  }

  if (!root.computedStyle) {
    throw new Error("paginateRoot: root must be cascaded (computedStyle missing)");
  }

  // Compute the root's UsedStyle once; reuse for every PageBox + the wrapping
  // root BlockBox. The root's containing-inline-size is the page's inline size.
  const rootComputed = root.computedStyle;
  const rootUsedStyle = computeUsedStyle(rootComputed, pageConfig.pageInlineSize, "indefinite");

  const pages: PageBox[] = [];
  let resumeFrom: BreakToken | null = null;
  let pageIndex = 0;

  do {
    const fragmentation: FragmentationContext = {
      availableBlockSize: pageContentBlockSize,
      pageIndex,
      resumeFrom,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
    // box is a BlockBox whose children are this page's flow content. Extract
    // them so the PageBox children are paragraphs/tables directly (not a
    // wrapping BlockBox), matching P1.A's PageBox.children shape.
    const placedChildren: readonly LayoutBox[] = box ? box.children : [];
    const pageBlockOffset = pageIndex * (pageConfig.pageBlockSize + pageConfig.pageGap);
    const page = createPageBox(
      `page-${pageIndex}`,
      0, pageBlockOffset,
      pageConfig.pageInlineSize, pageConfig.pageBlockSize,
      ctx.writingMode, ctx.direction,
      rootComputed, rootUsedStyle,
      placedChildren,
      pageIndex,
      pageConfig.pageInlineSize,
    );
    pages.push(page);
    resumeFrom = breakToken;
    pageIndex++;
  } while (resumeFrom !== null);

  // Defensive: the do-while above always pushes ≥1 page, so this fallback is
  // unreachable in normal flow. Kept as a guard against future edits that
  // might short-circuit the loop (e.g., layoutBlock throwing before push).
  if (pages.length === 0) {
    pages.push(createPageBox(
      `page-0`, 0, 0,
      pageConfig.pageInlineSize, pageConfig.pageBlockSize,
      ctx.writingMode, ctx.direction,
      rootComputed, rootUsedStyle,
      [], 0, pageConfig.pageInlineSize,
    ));
    pageIndex = 1;
  }

  const totalBlockSize = pageIndex * pageConfig.pageBlockSize + (pageIndex - 1) * pageConfig.pageGap;
  return createBlockBox(
    root.key, 0, 0,
    pageConfig.pageInlineSize, totalBlockSize,
    ctx.writingMode, ctx.direction,
    rootComputed, rootUsedStyle,
    pages,
    pageConfig.pageInlineSize,
  );
}
```

**Implementer note:** The `createPageBox` and `createBlockBox` signatures have many positional parameters; double-check the call-site argument order against `packages/core/src/layout/page-box.ts:50` and `packages/core/src/layout/layout-box-v2.ts` (search for `^export function createBlockBox`) before considering this task done.

- [ ] **Step 4: Update `dispatch.ts` to call the new `paginateRoot`.**

In `dispatch.ts`, replace lines 47-62 with:

```ts
const cs = layoutRoot.computedStyle ?? INITIAL_COMPUTED_STYLE;
const ctx = makeRootContext(cs, containerInlineSize);

let result: LayoutBox;
if (pageConfig !== undefined) {
  // Paginated mode: paginate.ts orchestrates layoutBlock per page.
  result = paginateRoot(layoutRoot, ctx, shaper, pageConfig);
} else {
  switch (cs.display) {
    case "block": {
      const r = layoutBlock(layoutRoot, 0, 0, ctx, shaper);
      if (r.box === null) throw new Error("unpaginated layoutBlock returned null box (unreachable)");
      result = r.box;
      break;
    }
    case "table": {
      const r = layoutTable(layoutRoot, 0, 0, ctx, shaper);
      if (r.box === null) throw new Error("unpaginated layoutTable returned null box (unreachable)");
      result = r.box;
      break;
    }
    default:
      throw new Error(`display "${cs.display}" not yet implemented in Plan 1`);
  }
}

return result;
```

- [ ] **Step 5: Run tests.**

Run: `npm test --workspace=packages/core -- paginate`
Expected: existing P1.A pagination tests still pass; new coordinator test passes.

Run: `npm test --workspace=packages/core`
Expected: full suite passes.

- [ ] **Step 6: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/paginate.ts packages/core/src/layout/paginate.test.ts packages/core/src/layout/dispatch.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
feat(paginate): rewrite paginateRoot as page-by-page coordinator

P1.B model. paginateRoot now drives layoutBlock per page with the prior
page's breakToken as the next page's resumeFrom. Replaces the post-hoc
fragmentation pass (P1.A). dispatch.ts routes through paginateRoot when
pageConfig is set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task F.2: Remove `withBlockOffset` (no longer needed)

**Files:**
- Modify: `packages/core/src/layout/layout-box-v2.ts` — delete `withBlockOffset` export.
- Verify: no consumers remain.

- [ ] **Step 1: Verify no consumers.**

Run: `grep -rn "withBlockOffset" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/`

Expected: only the declaration in `layout-box-v2.ts` (and its tests). The new `paginateRoot` uses BFC's natural offset computation.

- [ ] **Step 2: Delete `withBlockOffset`.**

In `packages/core/src/layout/layout-box-v2.ts`, remove the `withBlockOffset` function and its export.

If `layout-box-v2.test.ts` has tests for `withBlockOffset`, delete them.

- [ ] **Step 3: Build and test.**

Run: `npm run build --workspace=packages/core`
Run: `npm test --workspace=packages/core`
Expected: all green.

- [ ] **Step 4: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/layout-box-v2.ts packages/core/src/layout/layout-box-v2.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
refactor(layout-box-v2): remove withBlockOffset (unused after F.1)

P1.A's post-hoc fragmenter needed to relocate already-laid-out children
into per-page coordinates. P1.B's interleaved fragmenter computes offsets
naturally during BFC layout in each page's fragmentation context, so the
helper is dead code.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase G — Editor diligence

### Task G.1: Add `paginated-harness.ts` test fixture

**Files:**
- Create: `packages/core/src/test-utils/paginated-harness.ts`

- [ ] **Step 1: Write the harness file.**

```ts
// packages/core/src/test-utils/paginated-harness.ts
import { cascadePass } from "../cascade";
import { layoutTree } from "../layout/dispatch";
import { createMockShaper } from "../layout/mock-shaper";
import type { ElementBox } from "../render/render-node-v2";
import type { PageConfig } from "../layout/page-config";
import type { BlockBox, LayoutBox, PageBox } from "../layout/layout-box-v2";

export interface PaginatedHarnessResult {
  readonly root: BlockBox;          // BlockBox whose children are PageBoxes
  readonly pages: readonly PageBox[];
}

/** Run cascade + layout + paginate; return the page list for assertion. */
export function paginatedHarness(
  rootSpec: ElementBox,
  pageConfig: PageConfig,
  containerInlineSize: number = pageConfig.pageInlineSize,
): PaginatedHarnessResult {
  const shaper = createMockShaper();
  const cascaded = cascadePass(rootSpec) as ElementBox;
  const root = layoutTree(cascaded, containerInlineSize, shaper, pageConfig) as BlockBox;
  const pages = root.children.filter((c): c is PageBox => c.type === "page");
  return { root, pages };
}

/** Assert that page `pageIndex` of `result` has exactly `expected` line boxes. */
export function assertPageHasLines(result: PaginatedHarnessResult, pageIndex: number, expected: number): void {
  const lineCount = countLines(result.pages[pageIndex]);
  if (lineCount !== expected) {
    throw new Error(`Page ${pageIndex} expected ${expected} lines, found ${lineCount}`);
  }
}

/** Recursive line count under a layout box. */
function countLines(box: LayoutBox): number {
  if (box.type === "line") return 1;
  if ("children" in box) {
    return box.children.reduce((sum: number, c: LayoutBox) => sum + countLines(c), 0);
  }
  return 0;
}

/** Assert that the LineBox at `lineIndex` (global, depth-first across pages) lives on `expectedPageIndex`. */
export function assertLineOnPage(result: PaginatedHarnessResult, lineIndex: number, expectedPageIndex: number): void {
  let cumulative = 0;
  for (let p = 0; p < result.pages.length; p++) {
    const lc = countLines(result.pages[p]);
    if (lineIndex < cumulative + lc) {
      if (p !== expectedPageIndex) {
        throw new Error(`Line ${lineIndex} found on page ${p}, expected page ${expectedPageIndex}`);
      }
      return;
    }
    cumulative += lc;
  }
  throw new Error(`Line ${lineIndex} not found in any page (only ${cumulative} lines total)`);
}
```

- [ ] **Step 2: Build to verify imports resolve.**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/test-utils/paginated-harness.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
test: paginated-harness — fixture for cascade+layout+paginate end-to-end testing

Helper for integration tests in subsequent tasks. Wraps the layoutTree call
with mock shaper + cascade and exposes the page list plus assertion
utilities (assertPageHasLines, assertLineOnPage).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task G.2: Verify line-navigation orders globally across pages

**Files:**
- Read: `packages/core/src/editor/line-navigation.ts`
- Read: `packages/core/src/editor/__tests__/` (if exists) or `packages/core/src/editor/line-navigation.test.ts`
- Modify: editor tests for fragmented-content arrow-up/down crossings.
- Modify (if needed): `packages/core/src/editor/line-navigation.ts` — fix global ordering if it isn't already correct.

- [ ] **Step 1: Read `line-navigation.ts` to confirm whether it orders globally or within-page.**

Run: `cat packages/core/src/editor/line-navigation.ts | head -100`

If the existing logic uses `(pageIndex, y)` ordering (page-major, then within-page y), no fix is needed — just add the test. If it uses `y` alone, fix it.

- [ ] **Step 2: Write a test for arrow-down crossing a page boundary.**

In `packages/core/src/integration/pagination-cursor.test.ts` (extend; the file exists from P1.A.14):

```ts
describe("pagination — arrow-down across page boundary", () => {
  it("moves cursor from end of last line on page 1 to start of first line on page 2", () => {
    // Set up a paginated document with a paragraph that fragments at line 5.
    const { editor, dispatch } = setupPaginatedEditor(/* fragmenting paragraph */);
    // Place cursor at end of line 4 (last on page 1).
    dispatch({ type: "MOVE_TO_END_OF_LINE", lineIndex: 4 });
    // Arrow down.
    dispatch({ type: "MOVE_LINE_DOWN" });
    // Cursor should now be on line 5, which is on page 2 (pageIndex = 1).
    const pos = resolvePixelPosition(editor.cursor, editor.layout);
    expect(pos.pageIndex).toBe(1);
  });
});
```

- [ ] **Step 3: Run the test.**

Run: `npm test --workspace=packages/core -- pagination-cursor`
Expected: test passes if line-navigation already orders globally; fails otherwise.

- [ ] **Step 4: If failing, fix line-navigation to order globally.**

The fix: when finding the "next line below," compare lines as `(pageIndex, y)` pairs lexicographically rather than by `y` alone.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/editor/line-navigation.ts packages/core/src/integration/pagination-cursor.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
test/fix(editor): line-navigation orders lines globally across pages

Arrow-up/down across page boundaries must compare lines lexicographically
by (pageIndex, y), not by y alone. Adds integration test; fixes the
ordering if needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task G.3: Verify cursor resolution + selection across fragmented content

**Files:**
- Modify: `packages/core/src/integration/pagination-cursor.test.ts` — add cases.
- Modify (if needed): `packages/core/src/editor/cursor-position.ts`, `packages/core/src/editor/selection-geometry.ts`.

- [ ] **Step 1: Write tests for fragmented-paragraph cursor resolution.**

```ts
describe("pagination — cursor resolution across fragmented paragraph", () => {
  it("returns pageIndex=0 for cursor at end of last line on page 1", () => {
    const { editor } = setupPaginatedEditor(/* fragmenting paragraph */);
    const pos = resolvePixelPosition({ paragraphId, offset: endOfLine4 }, editor.layout);
    expect(pos.pageIndex).toBe(0);
  });
  it("returns pageIndex=1 for cursor at start of first line on page 2", () => {
    const { editor } = setupPaginatedEditor(/* fragmenting paragraph */);
    const pos = resolvePixelPosition({ paragraphId, offset: startOfLine5 }, editor.layout);
    expect(pos.pageIndex).toBe(1);
  });
});

describe("pagination — selection across page boundary", () => {
  it("emits per-line rects on both pages for a selection spanning the boundary", () => {
    const { editor } = setupPaginatedEditor(/* fragmenting paragraph */);
    const rects = computeSelectionRects(/* line 3 to line 6 */, editor.layout);
    expect(rects.some(r => r.pageIndex === 0)).toBe(true);
    expect(rects.some(r => r.pageIndex === 1)).toBe(true);
  });
});

describe("pagination — hit-test on fragmented paragraph", () => {
  it("returns the correct state-tree position when clicking on a line that lives on page 2", () => {
    const { editor } = setupPaginatedEditor(/* fragmenting paragraph at line 5 */);
    // Click coordinates for a line on page 2 (page-relative coords + pageIndex).
    const pos = hitTest({ x: 100, y: 30, pageIndex: 1 }, editor.layout);
    // The line at this y on page 2 is line 5 (the first line on the second fragment).
    expect(pos.paragraphId).toBe(/* expected paragraph id */);
    expect(pos.lineIndex).toBe(5);
  });
});
```

- [ ] **Step 2: Run the tests.**

Run: `npm test --workspace=packages/core -- pagination-cursor`
Expected: tests pass if `cursor-position.ts` and `selection-geometry.ts` already work correctly with two partial BlockBoxes; fail otherwise.

- [ ] **Step 3: If failing, investigate.**

Read `cursor-position.ts:123` (the `collectTextBoxes` recursion). Verify it walks both partial BlockBoxes for the same source RenderNode and that the picker correctly identifies the right partial by line-offset. If it doesn't, add a "match by line index" disambiguation.

- [ ] **Step 4: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/editor/cursor-position.ts packages/core/src/editor/selection-geometry.ts packages/core/src/integration/pagination-cursor.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
test(editor): cursor resolution and selection geometry across fragmented paragraphs

Verifies that resolvePixelPosition and computeSelectionRects correctly
attribute positions to the right page when a paragraph spans a page
boundary. Fixes any internal lookups that don't disambiguate between two
partial BlockBoxes for the same source RenderNode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase H — Integration tests

### Task H.1: `pagination-fragmentation.test.ts`

**Files:**
- Create: `packages/core/src/integration/pagination-fragmentation.test.ts`

- [ ] **Step 1: Write the integration test file.**

Cover end-to-end via the editor reducer:
- Multi-page document where a body paragraph fragments
- `break-before: page` on a body paragraph forces a new page
- Widows/orphans honored when paragraph fragments
- Edits to fragmented content trigger correct re-pagination
- Empty input still produces one blank page

```ts
// packages/core/src/integration/pagination-fragmentation.test.ts
import { describe, it, expect } from "vitest";
import { paginatedHarness, assertPageHasLines } from "../test-utils/paginated-harness";
// ... fixture builders

describe("pagination integration — within-block fragmentation", () => {
  it("fragments a tall paragraph across two pages", () => {
    const root = buildDocumentWithTallParagraph(/* 20 lines */);
    const result = paginatedHarness(root, /* pageConfig with content area = 200 */);
    expect(result.pages).toHaveLength(2);
    // First page: 10 lines (200/20). Second: 10 lines.
    assertPageHasLines(result, 0, 10);
    assertPageHasLines(result, 1, 10);
  });

  it("respects break-before: page on a body paragraph", () => {
    const root = buildDocumentWith(/* paragraphs A (small), B with breakBefore: page (small) */);
    const result = paginatedHarness(root, /* pageConfig */);
    expect(result.pages).toHaveLength(2);
    // Page 0: A only. Page 1: B only.
  });

  it("honors widows and orphans", () => {
    const root = buildDocumentWith(/* tall paragraph with widows: 3, orphans: 3 */);
    const result = paginatedHarness(root, /* pageConfig */);
    // Verify the split point.
  });

  it("empty input produces one blank page", () => {
    const root = buildEmptyDocument();
    const result = paginatedHarness(root, /* pageConfig */);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].children).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests.**

Run: `npm test --workspace=packages/core -- pagination-fragmentation`
Expected: all pass (the underlying logic is in place from Phases A-F).

- [ ] **Step 3: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/integration/pagination-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
test(integration): pagination-fragmentation — end-to-end fragmentation cases

Tall paragraph fragmenting across pages; break-before: page on body
paragraph; widows/orphans honored end-to-end; empty input falls back to
one blank page (P1.A behavior preserved).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task H.2: Verify edits to fragmented content trigger correct re-pagination

**Files:**
- Modify: `packages/core/src/integration/pagination-fragmentation.test.ts` — add edit-driven cases.

- [ ] **Step 1: Write the test.**

```ts
describe("pagination integration — edits to fragmented content", () => {
  it("re-paginates after inserting text into a fragmented paragraph", () => {
    const root = buildDocumentWithTallParagraph(/* 10 lines, fragments at line 5 */);
    const before = paginatedHarness(root, /* pageConfig */);
    expect(before.pages).toHaveLength(2);

    // Insert text that adds 5 more lines.
    const editedRoot = insertText(root, /* lots of text */);
    const after = paginatedHarness(editedRoot, /* pageConfig */);
    expect(after.pages).toHaveLength(/* updated count */);
  });

  it("re-paginates after deleting content that previously fragmented", () => {
    const root = buildDocumentWithTallParagraph(/* 10 lines */);
    const before = paginatedHarness(root, /* pageConfig */);
    expect(before.pages).toHaveLength(2);

    const editedRoot = deleteLines(root, 8); // now 2 lines, fits on one page
    const after = paginatedHarness(editedRoot, /* pageConfig */);
    expect(after.pages).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests.**

Run: `npm test --workspace=packages/core -- pagination-fragmentation`
Expected: pass.

- [ ] **Step 3: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/integration/pagination-fragmentation.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
test(integration): edits to fragmented content trigger correct re-pagination

Inserts and deletions that change line counts repaginate the document
correctly. P1.B always full-repaginates; P18 will add incremental.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase I — Documentation updates

### Task I.1: Update architecture pagination doc

**Files:**
- Modify: `docs/architecture/1-core/1.5-pagination.md` — align pseudocode with `LayoutResult { box | null, breakToken | null }` model.

- [ ] **Step 1: Edit the file.**

Replace the existing `paginateRoot` pseudocode (lines 162-196 in the current version) with one that reflects the implemented model:

```
function paginateRoot(root, ctx, shaper, pageConfig):
  pages = []
  resumeFrom = null
  pageIndex = 0
  contentBlockSize = pageConfig.pageBlockSize - pageMargins.blockStart - pageMargins.blockEnd

  do:
    fragmentation = { availableBlockSize: contentBlockSize, pageIndex, resumeFrom }
    { box, breakToken } = layoutBlock(root, ctx, shaper, fragmentation)
    pages.push(makePageBox(pageIndex, box, geometry))
    resumeFrom = breakToken
    pageIndex += 1
  while resumeFrom is not null

  if pages.length == 0:
    pages.push(makeEmptyPageBox(0))

  return wrapPagesAsRoot(pages)
```

Also update the `packPage` and `fragmentBlock` pseudocode to the LayoutResult-returning shape, since we now do this within `layoutBlock` rather than as separate functions.

- [ ] **Step 2: Build and verify the doc renders.**

(No runtime check; visual review on GitHub or a markdown previewer.)

- [ ] **Step 3: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add docs/architecture/1-core/1.5-pagination.md
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
docs(architecture): pagination doc aligned with LayoutResult model

paginateRoot pseudocode now shows the page-by-page coordinator that drives
layoutBlock with a FragmentationContext per page; packPage and
fragmentBlock are subsumed into layoutBlock's break-aware behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task I.2: Update BFC, IFC, Table FC architecture docs

**Files:**
- Modify: `docs/architecture/1-core/1.4-layout/1.4.1-bfc.md` — add Fragmentation subsection.
- Modify: `docs/architecture/1-core/1.4-layout/1.4.2-ifc.md` — add Fragmentation subsection.
- Modify: `docs/architecture/1-core/1.4-layout/1.4.3-table-fc.md` — add Fragmentation subsection.

- [ ] **Step 1: For each file, append a `## Fragmentation` section.**

For BFC's section, document:
- `FragmentationContext` parameter on `layoutBlock`
- `LayoutResult { box: LayoutBox | null, breakToken: BreakToken | null }`
- The break-aware child-placement loop algorithm (the same prose as Section 1 of the design spec)
- Margin truncation at fragmentation boundaries (CSS L4 §5.4)
- The overflow rule

For IFC's section:
- The split-point search (orphans / widows / hyphen-pair)
- `IFCBreakToken { resumeAtLine }` and the resume behavior

For Table FC's section:
- Row-level fragmentation; `<thead>` repetition
- `TableBreakToken { resumeAtRow }` and the resume behavior; `resumeAtRow` indexes the body, not the merged thead+body

- [ ] **Step 2: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add docs/architecture/1-core/1.4-layout/1.4.1-bfc.md docs/architecture/1-core/1.4-layout/1.4.2-ifc.md docs/architecture/1-core/1.4-layout/1.4.3-table-fc.md
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
docs(architecture): per-FC Fragmentation subsections (BFC, IFC, Table FC)

Documents the break-aware behavior of each formatting context after P1.B.
References CSS Fragmentation Module Level 4 sections by number.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task I.3: Update state-of-branch and decomposition

**Files:**
- Modify: `docs/architecture/state-of-branch.md` — update Pagination "Still missing" list.
- Modify: `docs/superpowers/plans/2026-04-30-decomposition.md` — annotate P1.B as shipped.

- [ ] **Step 1: Edit `state-of-branch.md`.**

In the "Pagination" section, the "Still missing (deferred to P1.B / P1.C)" bullet list has these P1.B items:
- Within-block fragmentation
- `widows` / `orphans` constraints
- `break-before` / `break-after` / `break-inside` properties

Move these from "Still missing" to "Shipped." Status remains `[partial]` overall because P1.C's items (page templates, headers, footers, footnotes) and P1.D-or-P12's items (cross-page floats) still remain.

- [ ] **Step 2: Edit `decomposition.md`.**

In the P1 status block (currently shows P1.A shipped, P1.B/P1.C deferred), update to:

```
**Status:** P1.A (foundation — whole-block placement) shipped. P1.B (within-block
fragmentation, widows/orphans, break-* properties) shipped.
Follow-ups deferred:
- P1.C — page templates with headers, footers, footnotes.
```

- [ ] **Step 3: Commit.**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add docs/architecture/state-of-branch.md docs/superpowers/plans/2026-04-30-decomposition.md
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "$(cat <<'EOF'
docs: state-of-branch and decomposition reflect P1.B completion

P1.B closes within-block fragmentation, widows/orphans, and break-*
properties; P1.C (templates) and P1.D-or-P12 (cross-page floats) remain.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] **Run the full test suite.**

Run: `npm test --workspace=packages/core`
Expected: all tests pass; new tests added in this plan are part of the count.

- [ ] **Build the workspace.**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Browser smoke test (manual; optional pre-handoff).**

Run: `npm run dev --workspace=examples/react`
Open the app in a browser. Verify:
- Multi-page document with a tall paragraph fragments at line boundaries
- Cursor moves correctly across page boundaries with arrow keys
- Selection across pages renders correctly
- Edits to a fragmented paragraph repaginate cleanly

If issues surface here, file them as P1.B followups in `docs/superpowers/plans/2026-05-01-p1b-followups.md`.
