# Plan 3.K.2 — Performance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four O(N) bottlenecks identified in Plan 3.K.1 baseline measurement so per-keystroke and per-cursor-move latency are O(1) at 10K-paragraph scale.

**Architecture:** Each task targets one bottleneck. Tasks 1 and 2 are independent. Task 3 likely depends on Task 2 (cascade output reference stability is a precondition for layout-tree subtree reuse). Task 4 is re-measurement — verify each fix lands the expected delta before declaring it complete.

**Spec reference:** `docs/superpowers/specs/2026-04-29-plan-3k-performance-design.md`. Baseline data: `docs/superpowers/perf/2026-04-29-baseline-raw.md`. Analysis: `docs/superpowers/plans/2026-04-29-plan-3k1-baseline-results.md`.

**Branch:** `feature/dom-architecture-redesign`.

---

## Worktree discipline

All work in `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign`. Pre-flight check on every task. Use absolute paths and `git -C <worktree>` for git.

---

## Task list overview

| Task | Subject | Expected impact (per 1000p) |
|---|---|---|
| **1** | Wire `PaintCache` through `editor-controller`; add root-reference short-circuit in `walkAndDetectChanges` | cursor move: 1756 paint.draw → ~1; eliminates cursor-slowness |
| **2** | Make `cascadePassIncremental` actually incremental — diagnose why subtree short-circuit doesn't fire and fix | insert: cascade 16.1ms → <1ms |
| **3** | Make `layoutTreeIncremental` actually incremental — diagnose why `isLayoutBoxReusable` rejects unchanged subtrees, fix | insert: layout 101.8ms → <2ms; bfc.layoutBlock count 1001 → ~1 |
| **4** | Re-measure on 1K / 5K / 10K fixtures; verify O(1); document delta; assess remaining gaps | confirms targets met or identifies next plan |

---

## Task 1: PaintCache wiring + root-reference short-circuit

**Why this task:** Plan 3.I shipped `PaintCache` infrastructure but the example app's `editor-controller` doesn't construct one. The renderer's optional `cache?: PaintCache | null` parameter is passed `undefined` in every call path, forcing the non-incremental "ctx.clearRect(0,0,w,h) + repaint everything" branch. Additionally, even when a cache IS supplied, `walkAndDetectChanges` recurses every box in the tree to hash and compare; for a 10K-paragraph doc with most subtrees reference-equal across paints, this is itself O(N).

**Files:**
- Modify: `packages/dom/src/canvas-renderer.ts` — add a previous-root reference check at the top of `walkAndDetectChanges`. If the root's `LayoutBox` reference equals the previously-walked root for this cache, skip the walk entirely (no dirty regions; cache is up-to-date).
- Modify: `packages/dom/src/paint-cache.ts` — extend `PaintCache` to remember the last walked root so the short-circuit has somewhere to compare against.
- Modify: `packages/dom/src/editor-controller.ts` — construct one `PaintCache` for `paintCanvas` (single-canvas mode) and one per page for `paintPages`. Thread them into the calls.
- Modify: `packages/dom/src/canvas-renderer.test.ts` (or wherever paint tests live) — add tests for the root short-circuit.

### Step 1: Read the current shape

- [ ] **Step 1.1: Confirm the existing PaintCache API**

```bash
sed -n '60,110p' /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/dom/src/paint-cache.ts
```

Expected: `interface PaintCache { get, set, clear }` with a WeakMap-keyed implementation.

- [ ] **Step 1.2: Confirm the current `walkAndDetectChanges` shape**

```bash
sed -n '263,295p' /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/dom/src/canvas-renderer.ts
```

Expected: function takes `(box, parentX, parentY, cache, dirty)`, hashes each box, compares to cached hash, recurses into children unconditionally.

- [ ] **Step 1.3: Confirm the editor-controller call sites**

```bash
grep -n "paintCanvas\|paintPage\|PaintCache\|createPaintCache" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/dom/src/editor-controller.ts
```

Expected: `paintCanvas` and `paintPage` are called with NO cache argument (relying on the optional `cache?: PaintCache | null` defaulting to undefined).

### Step 2: Extend `PaintCache` to remember the last walked root

- [ ] **Step 2.1: Write the failing test first (TDD)**

In `packages/dom/src/paint-cache.test.ts` (create if it doesn't exist):

```ts
import { describe, it, expect } from "vitest";
import { createPaintCache } from "./paint-cache";
import { createBlockBox } from "@taleweaver/core";

describe("PaintCache last-root tracking", () => {
  it("returns null for the last-walked root when never set", () => {
    const cache = createPaintCache();
    expect(cache.getLastRoot()).toBe(null);
  });

  it("remembers the last-walked root", () => {
    const cache = createPaintCache();
    // Use a minimal LayoutBox stub; the cache only stores the reference.
    const root = { type: "block" } as never;
    cache.setLastRoot(root);
    expect(cache.getLastRoot()).toBe(root);
  });

  it("setLastRoot(null) clears the reference", () => {
    const cache = createPaintCache();
    const root = { type: "block" } as never;
    cache.setLastRoot(root);
    cache.setLastRoot(null);
    expect(cache.getLastRoot()).toBe(null);
  });
});
```

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/dom -- src/paint-cache`

Expected: all tests fail (`getLastRoot is not a function`).

- [ ] **Step 2.2: Extend the `PaintCache` interface and `createPaintCache`**

In `packages/dom/src/paint-cache.ts`:

```ts
export interface PaintCache {
  get(box: LayoutBox): PaintInputHash | undefined;
  set(box: LayoutBox, hash: PaintInputHash): void;
  clear(): void;
  /** Get the root of the last walked tree, or null if no walk has happened. */
  getLastRoot(): LayoutBox | null;
  /** Record the root of the just-walked tree. Pass null to clear. */
  setLastRoot(root: LayoutBox | null): void;
}

export function createPaintCache(): PaintCache {
  const map = new WeakMap<LayoutBox, PaintInputHash>();
  let lastRoot: LayoutBox | null = null;
  return {
    get: (b) => map.get(b),
    set: (b, h) => { map.set(b, h); },
    clear: () => { lastRoot = null; /* WeakMap entries auto-clear */ },
    getLastRoot: () => lastRoot,
    setLastRoot: (r) => { lastRoot = r; },
  };
}
```

- [ ] **Step 2.3: Run the failing tests; expect green**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/dom -- src/paint-cache
```

Expected: 3 new tests pass; existing 128 dom tests still green.

### Step 3: Add root short-circuit + last-root tracking in `walkAndDetectChanges`

- [ ] **Step 3.1: Write the failing test (TDD)**

Locate the existing paint-cache integration test (likely `packages/dom/src/canvas-renderer.test.ts` or `packages/dom/src/integration-paint.test.ts`):

```bash
grep -rn "walkAndDetectChanges\|paintCanvas.*cache\|createPaintCache" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/dom/src/ | grep -i test
```

In the appropriate test file, add:

```ts
it("paintCanvas with cache: identical second paint produces zero dirty regions when root reference is unchanged", () => {
  // Build a small layout tree
  const tree = buildSimpleTree(); // helper that returns a LayoutBox with ≥10 boxes
  const ctx = makeMockCtx();
  const cache = createPaintCache();

  // First paint populates cache
  const dirty1 = paintCanvas(ctx, tree, /* selection */ [], /* cursor */ ZERO_CURSOR, "active", 800, 600, 0, 600, undefined, cache);
  expect(dirty1.length).toBeGreaterThan(0);

  // Second paint with SAME tree reference: should be zero dirty regions and zero box hashes computed
  const dirty2 = paintCanvas(ctx, tree, [], ZERO_CURSOR, "active", 800, 600, 0, 600, undefined, cache);
  expect(dirty2.length).toBe(0);
});
```

(If the existing test file already covers this scenario but expects nonzero hash work, update those expectations — the new behaviour is "zero work when the root is reference-equal".)

Run: expect FAIL (current behaviour walks every box even on identical-root paint).

- [ ] **Step 3.2: Implement the short-circuit in `walkAndDetectChanges`**

In `packages/dom/src/canvas-renderer.ts`, modify `walkAndDetectChanges`:

```ts
function walkAndDetectChanges(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  cache: PaintCache,
  dirty: Rect[],
  isRoot: boolean = false,
): void {
  const t = markStart("paint.walk");
  try {
    // Root short-circuit: if the entire layout tree is reference-equal to
    // the previously walked one, no boxes can have changed. Skip the walk.
    if (isRoot && cache.getLastRoot() === box) {
      return;
    }

    const absX = parentX + box.x;
    const absY = parentY + box.y;

    const currentHash = hashPaintInputs(box);
    const cachedHash = cache.get(box);

    if (cachedHash !== currentHash) {
      dirty.push({ x: absX, y: absY, w: box.width, h: box.height });
      cache.set(box, currentHash);
    }

    if ("children" in box) {
      for (const child of box.children) {
        walkAndDetectChanges(child, absX, absY, cache, dirty, false);
      }
    }
  } finally {
    markEnd("paint.walk", t);
  }
}
```

Then update the two callers in `paintCanvas` and `paintPage` to pass `isRoot: true` AND record the root after the walk:

```ts
// In paintCanvas, replace:
walkAndDetectChanges(layoutTree, 0, 0, cache, dirty);
// with:
walkAndDetectChanges(layoutTree, 0, 0, cache, dirty, true);
cache.setLastRoot(layoutTree);

// And likewise in paintPage:
walkAndDetectChanges(pageBox, 0, 0, cache, dirty, true);
cache.setLastRoot(pageBox);
```

- [ ] **Step 3.3: Run the test — should pass**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/dom
```

Expected: all 128+ tests green; new short-circuit test passes.

### Step 4: Wire `PaintCache` into `editor-controller`

- [ ] **Step 4.1: Read the current controller's paint flow**

```bash
sed -n '1,80p' /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/dom/src/editor-controller.ts
sed -n '170,240p' /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/dom/src/editor-controller.ts
```

Identify:
- Where `paintCanvas` is called in single-canvas mode.
- Where `paintPage` is called per-page in `paintPages`.
- The shape of `activeCanvases` (Map<idx, canvas>) so per-page caches can mirror it.

- [ ] **Step 4.2: Add cache state to the controller's closure**

In `editor-controller.ts`, near where other controller state lives (look for `controllerRef`, `pageGap`, etc.):

```ts
import { paintCanvas, paintPage, type CursorState } from "./canvas-renderer";
import { createPaintCache, type PaintCache } from "./paint-cache";

// Inside createEditorController, alongside other closure state:
const canvasCache: PaintCache = createPaintCache();
const pageCaches: Map<number, PaintCache> = new Map();

function getOrCreatePageCache(idx: number): PaintCache {
  let c = pageCaches.get(idx);
  if (!c) {
    c = createPaintCache();
    pageCaches.set(idx, c);
  }
  return c;
}
```

- [ ] **Step 4.3: Pass the caches to `paintCanvas` and `paintPage`**

In the `paintCanvas` call site (line ~177 in editor-controller.ts):

```ts
paintCanvas(
  ctx,
  tree,
  selectionRects,
  cursorPos,
  getCursorState(),
  logicalWidth,
  logicalHeight,
  visibleTop,
  visibleBottom,
  imageCache,
  canvasCache,  // <-- add this
);
```

In the `paintPage` call site inside `paintPages`:

```ts
paintPage(ctx, page, pageSelRects, pageCursor, cs, imageCache, getOrCreatePageCache(idx));
```

(Confirm the `paintPage` signature in `canvas-renderer.ts` — Plan 3.I added the optional cache parameter at the end.)

- [ ] **Step 4.4: When pages are removed (e.g., on relayout that has fewer pages), drop their caches**

If the controller maintains `activeCanvases` somewhere and there's a place where pages are pruned, mirror that pruning for `pageCaches`. If it's straightforward, do it; if it's not obvious from the code, leave it for a followup (TODO comment) — leaked caches per-removed-page are acceptable for v1.

- [ ] **Step 4.5: Build all packages**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && \
  npm run build --workspace=packages/core && \
  npm run build --workspace=packages/dom && \
  npm run build --workspace=packages/react && \
  npm run build --workspace=examples/react
```

Expected: clean.

- [ ] **Step 4.6: Run all tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && \
  npm test --workspace=packages/core && \
  npm test --workspace=packages/dom && \
  npm test --workspace=packages/react
```

Expected: 730+ core / 131+ dom / 10 react tests green.

### Step 5: Manual verification — measure cursor-move on 1000p

- [ ] **Step 5.1: Start dev server and capture before/after**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run dev --workspace=examples/react &
```

Open `http://localhost:5173/taleweaver/?perfFixture=1000` in browser. In dev console:
- Click into mid-doc.
- `__perfReset()`.
- Press ArrowRight 10×.
- `__perfReport()`.

**Expected before this task:** ~1756 paint.draw calls per move.
**Expected after this task:** ~1 paint.draw call per move (cursor-only — caret blink). The `paint.walk` label should also drop to near-zero ms because of the root short-circuit.

- [ ] **Step 5.2: Record delta in commit message**

### Step 6: Commit

- [ ] **Step 6.1: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/dom/src/paint-cache.ts packages/dom/src/canvas-renderer.ts packages/dom/src/editor-controller.ts packages/dom/src/paint-cache.test.ts packages/dom/src/canvas-renderer.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "perf(dom): wire PaintCache into editor-controller + root-reference short-circuit"
```

Commit message body should record the measured cursor-move delta from Step 5.

---

## Task 2: Diagnose and fix `cascadePassIncremental`

**Why this task:** `cascadePassIncremental` already has a subtree short-circuit (`newNode === oldNode && parentComputed === oldParentComputed`), but the baseline measurement shows it scales O(N) — meaning the short-circuit doesn't fire for most paragraphs during a real edit. Need to find out why.

**Hypotheses (in priority order):**

(a) **The render tree itself isn't preserving reference equality.** `renderTree(state, registry)` may produce fresh `ElementBox` objects on every call regardless of whether the underlying state node is unchanged. If so, every paragraph's `newNode === oldNode` check fails, and the cascade recomputes everything.

(b) **The cascade's call site doesn't pass `oldRoot`/`oldCascadedRoot`.** Look in `layout-incremental.ts` and `editor-state.ts` to see how `cascadePassIncremental` is invoked. If the previous-pass output isn't threaded in, the short-circuit can never fire.

(c) **The parent's `parentComputed` reference is rebuilt on every pass even when its style is unchanged.** The existing code has a "if structurally identical, reuse old reference" path at the recurse-level — but that runs AFTER recompute. The first call (root) has `parentComputed = null = oldParentComputed`, so root short-circuits if `newRoot === oldRoot`. Falls back to (a).

**Files to investigate:**
- `packages/core/src/render/render.ts` — does `renderTree` preserve reference equality on unchanged subtrees?
- `packages/core/src/cascade/cascade-pass.ts` — current `cascadePassIncremental` implementation (already read).
- `packages/core/src/layout/layout-incremental.ts` or wherever the pipeline is invoked — does it pass old roots through?
- The editor-state reducer or wherever the pipeline runs after dispatch.

### Step 1: Diagnostic — instrument the short-circuit

- [ ] **Step 1.1: Add temporary diagnostic counters**

In `packages/core/src/cascade/cascade-pass.ts`, in `cascadeNodeIncremental`, add temporary counters around the short-circuit:

```ts
// TEMPORARY DIAGNOSTIC — remove before commit
import { recordSample } from "../perf/perf-trace";

function cascadeNodeIncremental(/*...*/): RenderNode {
  // Short-circuit check
  const canShortCircuit = oldNode !== null && oldCascaded !== null && newNode === oldNode && parentComputed === oldParentComputed;
  recordSample(canShortCircuit ? "cascade.shortCircuit.hit" : "cascade.shortCircuit.miss", 0);
  if (canShortCircuit) return oldCascaded;

  // ALSO: log WHY the short-circuit missed (only first 5 misses to avoid log spam)
  if (oldNode === null) recordSample("cascade.miss.oldNodeNull", 0);
  else if (oldCascaded === null) recordSample("cascade.miss.oldCascadedNull", 0);
  else if (newNode !== oldNode) recordSample("cascade.miss.refDiff", 0);
  else if (parentComputed !== oldParentComputed) recordSample("cascade.miss.parentDiff", 0);

  // ... existing recompute path
}
```

Run a 500-paragraph fixture, type 5 chars, capture `__perfReport()`. The breakdown will reveal which condition fails.

- [ ] **Step 1.2: Capture diagnostic data**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run dev --workspace=examples/react &
```

In browser at `?perfFixture=500`:
1. Click mid-doc, `__perfReset()`, type "abcde", `__perfReport()`.
2. Record the counts of `cascade_short-circuit_hit`, `cascade_short-circuit_miss`, and the four `cascade_miss_*` reasons.

Most likely outcome: high `cascade.miss.refDiff` count → render tree isn't preserving reference equality.

### Step 2: Fix the identified offender

The fix depends on Step 1.2's data. Most likely cases:

#### Case A: render tree reference equality broken

If diagnostic shows `cascade.miss.refDiff` dominates, the fix is in `packages/core/src/render/render.ts`. Read the current implementation:

```bash
sed -n '1,80p' /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/render/render.ts
```

Likely the issue: `renderTree` rebuilds every node regardless of whether the underlying state is unchanged. The fix is the same shape as `cascadePassIncremental`: short-circuit when `newStateNode === oldStateNode` and properties haven't changed, returning the old render-tree node.

Implementation outline (TDD):

- [ ] **Step 2.A.1: Write failing test in `packages/core/src/render/render.test.ts` (or wherever the existing render tests live)**:

```ts
it("renderTree preserves reference equality for unchanged state subtrees", () => {
  const stateA = createSampleState({ nParagraphs: 3 });
  const renderA = renderTree(stateA, registry);

  // Mutate ONLY paragraph 0; paragraphs 1 and 2 are reference-equal
  const stateB = mutateOnlyFirstParagraph(stateA);
  const renderB = renderTreeIncremental(stateB, stateA, renderA, registry);

  expect(renderB.children[0]).not.toBe(renderA.children[0]); // touched
  expect(renderB.children[1]).toBe(renderA.children[1]);     // unchanged → same ref
  expect(renderB.children[2]).toBe(renderA.children[2]);     // unchanged → same ref
});
```

- [ ] **Step 2.A.2: Implement `renderTreeIncremental(newState, oldState, oldRender, registry)`** that walks the state tree, short-circuiting on reference equality, and reusing previous render-tree subtrees.

- [ ] **Step 2.A.3: Wire `renderTreeIncremental` through the pipeline** — find where the editor reducer (or whatever invokes `renderTree`) is called, and switch it to the incremental form when there's a previous render tree available.

#### Case B: pipeline doesn't pass `oldRoot` through

If diagnostic shows `cascade.miss.oldNodeNull` or `oldCascadedNull` dominates, the call site is the problem. Find where the pipeline is invoked (likely `editor-state.ts` reducer or `layout-incremental.ts`):

```bash
grep -rn "cascadePassIncremental\|cascadePass(" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/ | head
```

The fix is to thread the previous EditorState's renderTree + cascadedRenderTree into `cascadePassIncremental`.

#### Case C: structural-equality reuse not propagating

If diagnostic shows `cascade.miss.parentDiff` dominates, the existing "structural equality → reuse reference" path at the recurse level isn't working as intended. Likely a `composeComputed` or `flattenLengths` quirk that produces a value-equal but reference-different ComputedStyle. Find the offending field and either fix it at source or extend `computedStylesEqual` if a field needs deeper comparison.

### Step 3: Remove diagnostic counters

- [ ] **Step 3.1:** Once Step 2 lands, remove the diagnostic `recordSample` calls added in Step 1.1.

### Step 4: Re-measure cascade cost

- [ ] **Step 4.1:** With dev server running on 1000p fixture:
  1. `__perfReset()`, type 5 chars, `__perfReport()`.
  2. Record `cascadePassIncremental` totalMs.

**Expected before this task:** 16.1ms / keystroke.
**Expected after this task:** <1ms / keystroke (only the touched paragraph + its ancestors recompute).

### Step 5: Build, test, commit

- [ ] **Step 5.1:** `npm run build --workspace=packages/core && npm test --workspace=packages/core` → clean / green.
- [ ] **Step 5.2:** `git -C ... commit` with message: `perf(cascade): make cascadePassIncremental actually incremental — <Case A/B/C> fix`. Body records measured delta.

---

## Task 3: Diagnose and fix `layoutTreeIncremental`

**Why this task:** `bfc.layoutBlock` is called once per paragraph on every keystroke (1001 calls at 1000p). The Plan 3.H subtree-reuse predicate (`isLayoutBoxReusable`) is in place; it's just not detecting reusable subtrees in the example app's flow.

**Likely root cause:** This task probably becomes simpler after Task 2 lands. The reuse predicate checks `newRenderNode === oldRenderNode` plus a few invariants; if the render tree's reference equality is broken (Task 2 Case A), every layout-tree subtree-reuse check fails downstream too. Run Task 2 first, re-measure, then proceed with Task 3 if the layout cost remains high.

**Files:**
- `packages/core/src/layout/layout-incremental.ts` — the entry point.
- `packages/core/src/layout/layout-reuse.ts` — the `isLayoutBoxReusable` predicate.
- `packages/core/src/layout/bfc.ts` — where the predicate is consulted (look for `isLayoutBoxReusable` callers).

### Step 1: Re-measure after Task 2

- [ ] **Step 1.1: After Task 2 commit, capture insertion at 1000p**

If `bfc.layoutBlock` count dropped substantially (e.g., from 1001 to <100), Task 2 closed Task 3's underlying issue. Skip to Step 4 (verify, document, commit a doc-only "no work needed" finding). If `bfc.layoutBlock` count remained near 1001, proceed to Step 2.

### Step 2: Diagnostic — instrument the reuse predicate

- [ ] **Step 2.1: Add diagnostic counters at every reject site**

In `packages/core/src/layout/layout-reuse.ts:isLayoutBoxReusable`, add `recordSample` calls per rejection reason:

```ts
import { recordSample } from "../perf/perf-trace";

export function isLayoutBoxReusable(/*...*/): boolean {
  if (oldBox === undefined) { recordSample("reuse.miss.noOldBox", 0); return false; }
  if (oldBox.renderNode !== newRenderNode) { recordSample("reuse.miss.renderNodeRef", 0); return false; }
  if (!computedStylesEqual(...)) { recordSample("reuse.miss.computedStyle", 0); return false; }
  if (oldBox.availableInlineSize !== availableInlineSize) { recordSample("reuse.miss.inlineSize", 0); return false; }
  if (oldBox.writingMode !== writingMode || oldBox.direction !== direction) { recordSample("reuse.miss.writingMode", 0); return false; }
  if (oldBox.floatEnvDirtyOffset !== floatEnvDirtyOffset) { recordSample("reuse.miss.floatEnv", 0); return false; }
  recordSample("reuse.hit", 0);
  return true;
}
```

(Adjust to match the actual rejection conditions in the predicate; the structure is the goal.)

- [ ] **Step 2.2: Capture data**

Same protocol as Task 2 Step 1.2 — 1000p fixture, insert 5 chars, `__perfReport()`. Record per-reason counts.

### Step 3: Fix the dominant reject reason

Apply the analogous fix structure to Task 2:
- If `renderNodeRef` dominates → Task 2 didn't fully close render-tree reference equality; revisit.
- If `computedStyle` dominates → Task 2's structural-equality path produces value-equal but reference-different ComputedStyles for some boxes. Fix by extending `computedStylesEqual` or by ensuring cascade reuse extends to those boxes.
- If `floatEnv` dominates → the float-env dirty-offset isn't being threaded correctly. Look at how it's computed and propagated.
- If `noOldBox` dominates → the cache itself isn't being populated correctly. Look at the cache-build path in `layoutTreeIncremental` (F3H.2 territory).

### Step 4: Remove diagnostics, re-measure, commit

- [ ] **Step 4.1:** Remove temporary counters.
- [ ] **Step 4.2:** `__perfReport()` on 1000p insert. Expected: `bfc.layoutBlock` count drops to ~1; `layoutTreeIncremental` totalMs drops to <2ms.
- [ ] **Step 4.3:** Build, test, commit: `perf(layout): subtree-reuse short-circuit fires on unchanged paragraphs — <root cause> fix`.

---

## Task 4: Re-measure and assess

**Goal:** Verify each fix landed the expected delta, and that the combined effect meets the O(1) target at 10K-paragraph scale.

### Step 1: Capture full baseline at all fixture sizes

- [ ] **Step 1.1: Run 1K / 5K / 10K scenarios**

Same protocol as Plan 3.K.1 Task 5:
- Each fixture: cursor-10x scenario + insert-5 scenario.
- Capture `__perfReport()` after each scenario.
- Record into `docs/superpowers/perf/2026-04-29-after-3k2-raw.md`.

For 5K and 10K, paint will still be visually broken (canvas overflow F3K.A) — capture the engine-side numbers (cascade, layout, IFC). The paint.walk should be near-zero (root short-circuit firing).

### Step 2: Compute deltas

- [ ] **Step 2.1: Update analysis doc**

Create `docs/superpowers/plans/2026-04-29-plan-3k2-results.md` with:
- Before-after table per scenario per fixture size.
- Pass/fail vs O(1) target: per-keystroke < 16ms at 10K? per-cursor-move < 16ms at 10K?
- If targets met: declare 3.K complete, mark followups closed.
- If targets NOT met: identify the new top offender (e.g., F3K.A canvas overflow may now be the limiting factor for first paint, requiring paint virtualization in Plan 3.K.3 or pulling Plan 5 forward).

### Step 3: Update Plan 3 summary doc

- [ ] **Step 3.1:** Update `docs/superpowers/plans/2026-04-29-plan-3-summary.md`'s 3.K section with completion status. Mark closed followups (F3I.4, F4.1, F3H.1, F3H.2 if applicable).

### Step 4: Commit final results

- [ ] **Step 4.1: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add docs/superpowers/perf/ docs/superpowers/plans/2026-04-29-plan-3k2-results.md docs/superpowers/plans/2026-04-29-plan-3-summary.md
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "perf(plan-3k2): final measurement + assessment"
```

---

## Phase exit criteria

- All 4 tasks committed.
- Build clean across all packages.
- Existing test suite (730+ core / 131+ dom / 10 react) green.
- Per-keystroke insertion latency on 1000p fixture: < 16ms.
- Per-cursor-move latency on 1000p fixture: < 16ms.
- 10K-paragraph fixture targets either met OR the next limiting factor is documented and a follow-up plan is queued.
- Plan 3 summary doc updated.

## Out of scope

- True skip-painting (per-box composited layers, F3I.1) — needs a compositor architecture change; v1 ceiling is "clear-dirty + full-repaint" within one canvas. Picked up by Plan 5 / Plan 6 if needed.
- Canvas overflow at 10K paragraphs (F3K.A) — paint virtualization / pagination is a Plan 5 deliverable; this plan's target is engine-side O(1), achievable independently.
- IFC convergence detection wiring (F3G.3) — baseline shows IFC wrap is sub-1ms even at 1000p; not on the critical path until other offenders close.
- React render optimizations — baseline shows React render is ~0ms; not the bottleneck.

## Decision log

- **2026-04-29:** Plan 3.K.2 single-phase with 4 sequential tasks. Original "one sub-plan per offender" framing dropped — fixes are coupled (Task 2's render-tree reference stability is a precondition for Task 3's subtree reuse).
- **2026-04-29:** Diagnosis-first approach for Tasks 2 and 3 — temporary `recordSample` counters reveal which condition rejects each subtree, then fix the actual offender. Avoids speculation-driven fixes.
