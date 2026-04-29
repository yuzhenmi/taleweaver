# Plan 3.D — Multi-Pass Intrinsic Sizing + Architectural Cleanups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the architectural cleanups identified in the Plan 3 retrospective (D1–D8) AND ship CSS-faithful intrinsic sizing (`min-content`, `max-content`, `fit-content`) with a per-render-node cache. After Plan 3.D, the engine resolves shrink-to-fit (inline-block, float, auto table-cell) correctly per CSS Sizing 3.

**Architecture:** Tasks 0–5 are pre-existing-debt cleanup. Tasks 6–12 add a two-traversal layout discipline: a separate `computeIntrinsicSizes(box) → { minContent, maxContent }` pass that walks children once without positioning; results are cached per render node. The main layout pass consults this when resolving `auto` for shrink-to-fit cases. CSS spec: §10.3.5 (shrink-to-fit), §17.5.2 (table auto-layout).

**Tech Stack:** TypeScript, Vitest, npm workspaces.

**Spec reference:** `2026-04-29-plan-3-architectural-foundation-rewrite.md` §4 (multi-pass + intrinsic sizing). `2026-04-29-plan-3-retrospective-and-revisions.md` §2 (D1–D8 cleanups).

**Branch:** `feature/dom-architecture-redesign`.

---

## Worktree discipline

All work in `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign`. Pre-flight check on every task: `cd <worktree> && pwd && git -C <worktree> branch --show-current`. Expect `feature/dom-architecture-redesign`. STOP and report BLOCKED if mismatched. Use absolute paths and `git -C <worktree>` for all git commands.

---

## Task list overview

**Phase 1 — Architectural cleanups (per retrospective):**

| Task | Subject | Retro |
|---|---|---|
| **0** | Drop `containingInlineSize?:` factory default; require it everywhere | D1 |
| **1** | Refactor `UsedStyle` — drop sizing fields (`inlineSize`, `blockSize`, min/max); consumers read from LayoutBox | D2 |
| **2** | Add `containingBlockSize` parameter to `computeUsedStyle`; resolve block-axis percents correctly | D3 |
| **3** | Introduce `LayoutContext` value threading writing-mode + direction + containing-block sizes | D4 |
| **4** | Drop defensive `as unknown as Length` cast in `resolveFontSize` | D7 |
| **5** | Refactor LayoutBox factories with shared base helper; remove `withInlineOffset` factory bypass | D8, F3C.1 |

**Phase 2 — Intrinsic sizing:**

| Task | Subject |
|---|---|
| **6** | Define `IntrinsicSizes` type + per-render-node cache infrastructure |
| **7** | Implement `computeIntrinsicSizes` for block / inline / text / inline-block / table |
| **8** | BFC consults intrinsic sizing for inline-block + float shrink-to-fit |
| **9** | IFC produces paragraph intrinsic sizes from `ShapedRun.minClusterInlineSize` and `unbreakableRunInlineSize` |
| **10** | Table FC consumes per-cell intrinsic sizes for auto-layout column widths |
| **11** | Style schema: `inlineSize: "min-content" \| "max-content" \| "fit-content"` keywords accepted |
| **12** | Integration test: shrink-to-fit floats / inline-blocks / auto-table sized correctly; dev-server smoke |

---

## Task 0: Drop `containingInlineSize?` default; require explicit value

**Files:**
- Modify: `packages/core/src/layout/layout-box-v2.ts`
- Update every caller in `bfc.ts`, `ifc.ts`, `table-fc.ts` if any rely on the default.

**Why:** Retrospective D1. The `containingInlineSize?: number = ?? inlineSize` default is correct only for LTR. RTL with the default produces `x = -inlineOffset` (broken). Currently every caller passes explicit values; making it required prevents future drift.

**Steps:**

1. Pre-flight check.
2. In `layout-box-v2.ts`, change every factory's signature from `containingInlineSize?: number` to `containingInlineSize: number` (required). Drop the `?? inlineSize` fallback in the body — `containingInlineSize` is always defined now.
3. Build: `npm run build --workspace=packages/core`. Likely passes since callers already pass it. If any caller fails, fix.
4. Run all tests + builds.
5. Commit: `refactor(layout): require containingInlineSize on factories; close retrospective D1`.

---

## Task 1: Drop sizing fields from `UsedStyle`

**Files:**
- Modify: `packages/core/src/styles/used-style.ts` — remove `inlineSize`, `blockSize`, `minInlineSize`, `minBlockSize`, `maxInlineSize`, `maxBlockSize`.
- Modify: `packages/core/src/layout/used-style.ts` — `computeUsedStyle` no longer produces those fields.
- Update consumers (DOM painter, editor utilities) to read sizes from `LayoutBox.inlineSize/blockSize/x/y/width/height` (already present on `LayoutBoxBase`) instead of `box.usedStyle.X`.

**Why:** Retrospective D2. `usedStyle.blockSize === 0` for `auto`-sized boxes is misleading; consumers fall back to `box.height`. Cleanest fix: drop these fields from UsedStyle entirely. UsedStyle then only holds margin/padding/border/typography (values that resolve at cascade-or-layout-time without needing layout output).

**Steps:**

1. Pre-flight check.
2. Edit `used-style.ts` (`packages/core/src/styles/`): remove the 6 sizing fields from the `UsedStyle` interface.
3. Edit `used-style.ts` (`packages/core/src/layout/`): remove the 6 corresponding lines in `computeUsedStyle`'s return value.
4. Update `used-style.test.ts` (in styles/): remove the 6 fields from the literal test fixture.
5. Update `used-style.test.ts` (in layout/): the tests that asserted on `us.inlineSize` need to either assert on the LayoutBox's `inlineSize` (which is the post-layout numeric value) or be reworked.
6. Find consumers that read `box.usedStyle.{inlineSize,blockSize,min*,max*}`:
   ```bash
   grep -rnE "usedStyle\.(inlineSize|blockSize|minInlineSize|minBlockSize|maxInlineSize|maxBlockSize)" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/
   ```
   For each, switch to `box.inlineSize`/`box.blockSize` etc.
7. Build + tests.
8. Commit: `refactor(layout): drop sizing fields from UsedStyle; close retrospective D2`.

---

## Task 2: `containingBlockSize` parameter for block-axis percent resolution

**Files:**
- Modify: `packages/core/src/layout/used-style.ts` — `computeUsedStyle` accepts `containingBlockSize` parameter.
- Update FC callers to pass it.

**Why:** Retrospective D3. CSS spec: percent block-axis values resolve against the containing block's BLOCK-axis size. We currently resolve against inline-size (wrong). When the containing block has `auto` block-size (common), CSS treats percent block-sizes as `auto`.

**Steps:**

1. Pre-flight.
2. Add `containingBlockSize: number | "indefinite"` parameter to `computeUsedStyle`. New signature:
   ```ts
   export function computeUsedStyle(
     cs: ComputedStyle,
     containingInlineSize: number,
     containingBlockSize: number | "indefinite",
     ...other-fallbacks
   ): UsedStyle
   ```
3. For block-axis-percent properties (`marginBlockStart/End`, `paddingBlockStart/End` if applicable per CSS — actually CSS allows percent padding/margin to resolve against containing-block INLINE-size always; `block-size`/`min-block-size`/`max-block-size` are the ones that need block-axis resolution... but Task 1 dropped those from UsedStyle, so no-op for v3.D).
4. Document: padding and margin percents (per CSS) resolve against containing-block INLINE-size in horizontal-tb. The `containingBlockSize` parameter is a hook for future use (writing-mode `vertical-rl` swaps the axes); for v1 it's reserved.
5. Update callers (BFC/IFC/Table FC) to pass containing block's block-size where known, `"indefinite"` otherwise.
6. Build + tests.
7. Commit: `feat(layout): containingBlockSize param for percent block-axis resolution; close D3`.

(After Task 2, the parameter exists; v1 doesn't yet have block-axis-percent properties on the UsedStyle interface (since Task 1 dropped them), so the parameter is mostly reserved. When `block-size: 50%` becomes a thing in a future plan, `containingBlockSize` is already plumbed.)

---

## Task 3: `LayoutContext` value

**Files:**
- Create: `packages/core/src/layout/layout-context.ts` — `LayoutContext` value type + helpers.
- Refactor: `bfc.ts`, `ifc.ts`, `table-fc.ts` to thread `LayoutContext` instead of separate `writingMode`/`direction`/`containingInlineSize`/`containingBlockSize` parameters.

**Why:** Retrospective D4. Current FC signatures take `writingMode, direction` as separate parameters; Task 2 adds `containingInlineSize` and `containingBlockSize`. The combined parameter list is unwieldy and error-prone. Thread a `LayoutContext` object instead.

**LayoutContext shape:**

```ts
export interface LayoutContext {
  readonly writingMode: WritingMode;
  readonly direction:   Direction;
  readonly containingInlineSize: number;
  readonly containingBlockSize:  number | "indefinite";
}

export function makeChildContext(
  parent: LayoutContext,
  parentCs: ComputedStyle,
  parentContentInlineSize: number,
  parentContentBlockSize: number | "indefinite",
): LayoutContext {
  return {
    writingMode: parentCs.writingMode,
    direction:   parentCs.direction,
    containingInlineSize: parentContentInlineSize,
    containingBlockSize:  parentContentBlockSize,
  };
}
```

**Steps:**

1. Pre-flight.
2. Create `layout-context.ts` with the type and `makeChildContext` helper.
3. Update FC signatures: `layoutBlock(node: ElementBox, position: { inlineOffset: number; blockOffset: number }, ctx: LayoutContext, shaper: TextShaper): BlockBox`. Same for `layoutInlineContent`, `layoutTable`.
4. Update FC bodies: read from `ctx.writingMode`, `ctx.direction`, `ctx.containingInlineSize`. When recursing, build `childCtx = makeChildContext(ctx, cs, contentInlineSize, "indefinite")`.
5. Update `dispatch.ts` / `layout-engine.ts` (entry points) to construct an initial `LayoutContext` from the root's ComputedStyle.
6. Update factory `containingInlineSize` argument to come from `ctx.containingInlineSize` (single source of truth).
7. Update tests that invoke layout functions directly.
8. Build + tests.
9. Commit: `refactor(layout): thread LayoutContext; close D4`.

This is the biggest mechanical change in Plan 3.D. Estimate: ~30-50 lines per FC modified. The signatures collapse from 7-8 params to 4.

---

## Task 4: Drop defensive `as unknown as Length` cast

**Files:**
- Modify: `packages/core/src/cascade/cascade-pass.ts` (the `resolveFontSize` helper).

**Why:** Retrospective D7. The defensive branch in `resolveFontSize` handles a Length-shaped `fontSize` value, but `ComputedStyle.fontSize` is typed `number`. The branch is dead.

**Steps:**

1. Pre-flight.
2. Read `cascade-pass.ts:resolveFontSize`. Confirm the cast is on a branch that handles non-number `fontSize`.
3. Replace with a simple `return cs.fontSize` (since type guarantees it's a number).
4. If the cascade does have a path where `fontSize` could enter as Length (e.g., during the inheritance step before flattenLengths runs), keep an explicit Length-handling branch but use `Length` types directly without `as unknown as`.
5. Build + tests.
6. Commit: `refactor(cascade): drop defensive cast in resolveFontSize; close D7`.

---

## Task 5: Shared base helper for LayoutBox factories

**Files:**
- Modify: `packages/core/src/layout/layout-box-v2.ts` — extract shared base.
- Modify: `packages/core/src/layout/ifc.ts` — replace `withInlineOffset` factory bypass with proper helper (closes F3C.1).

**Why:** Retrospective D8 + F3C.1. 9 factories share ~10 lines of identical boilerplate; the bidi reorder pass uses an unsafe spread. Centralize the base construction in a helper; expose a `withInlineOffset` operation that properly dispatches by box type.

**Steps:**

1. Pre-flight.
2. Extract `createBoxBase`:
   ```ts
   function createBoxBase(args: {
     key: string;
     inlineOffset: number; blockOffset: number;
     inlineSize: number; blockSize: number;
     writingMode: WritingMode; direction: Direction;
     computedStyle: ComputedStyle;
     usedStyle: UsedStyle;
     containingInlineSize: number;
   }): BaseFields {
     const phys = logicalToPhysical(/* ... */);
     return {
       key: args.key,
       inlineOffset: args.inlineOffset, blockOffset: args.blockOffset,
       inlineSize: args.inlineSize,     blockSize: args.blockSize,
       ...phys,
       writingMode: args.writingMode, direction: args.direction,
       computedStyle: Object.freeze({ ...args.computedStyle }),
       usedStyle:     Object.freeze({ ...args.usedStyle }),
     };
   }
   ```
3. Each factory becomes ~5 lines: build base, add type-specific fields, freeze.
4. Add a `withInlineOffset(box, newInlineOffset, containingInlineSize): LayoutBox` that dispatches by `box.type` and rebuilds the box via the appropriate factory. Replace `ifc.ts`'s spread-based `withInlineOffset`.
5. Build + tests.
6. Commit: `refactor(layout): shared base helper for factories + typed withInlineOffset; close D8 + F3C.1`.

---

## Task 6: `IntrinsicSizes` type + per-render-node cache

**Files:**
- Create: `packages/core/src/layout/intrinsic-sizes.ts` — type + cache helper.
- Create: `packages/core/src/layout/intrinsic-sizes.test.ts`.

**Why:** Foundation for Tasks 7-10. The cache key is the render node + ComputedStyle (intrinsic to content + style; not to layout position).

**Steps:**

1. Define:
   ```ts
   export interface IntrinsicSizes {
     readonly minContent: number;
     readonly maxContent: number;
   }

   export interface IntrinsicSizesCache {
     get(renderNodeKey: string): IntrinsicSizes | undefined;
     set(renderNodeKey: string, value: IntrinsicSizes): void;
     invalidate(renderNodeKey: string): void;
     clear(): void;
   }

   export function createIntrinsicSizesCache(): IntrinsicSizesCache;
   ```
2. Implementation: a `Map<string, IntrinsicSizes>` with the four methods.
3. Tests: roundtrip, invalidation, clear.
4. Re-export from index.
5. Build + tests + commit: `feat(layout): IntrinsicSizes type + cache infrastructure`.

---

## Task 7: `computeIntrinsicSizes(box, ctx, shaper, cache)`

**Files:**
- Create: `packages/core/src/layout/intrinsic-sizes-pass.ts`.
- Create: `packages/core/src/layout/intrinsic-sizes-pass.test.ts`.

**Why:** Implements per-render-node intrinsic-sizing. Walks children once, returns `{ minContent, maxContent }` without positioning.

**Algorithm (per spec §4.3):**

```ts
function computeIntrinsicSizes(
  node: ElementBox | TextBox,
  shaper: TextShaper,
  cache: IntrinsicSizesCache,
): IntrinsicSizes {
  const cached = cache.get(node.key);
  if (cached) return cached;

  const cs = node.computedStyle;
  let result: IntrinsicSizes;

  if (node.type === "text") {
    const run = shaper.shape(node.text, cs, cs.direction);
    result = {
      minContent: run.minClusterInlineSize,
      maxContent: run.unbreakableRunInlineSize,
    };
  } else if (cs.display === "block" || cs.display === "list-item" || cs.display === "flow-root") {
    // Block: max-over-children of {min: child.min, max: child.max}
    let min = 0, max = 0;
    for (const child of node.children) {
      const child = computeIntrinsicSizes(child, shaper, cache);
      if (child.minContent > min) min = child.minContent;
      if (child.maxContent > max) max = child.maxContent;
    }
    result = { minContent: min, maxContent: max };
  } else if (cs.display === "inline" || cs.display === "inline-block") {
    // Inline: sum-without-wrap. Min = max child min; max = sum child max.
    let min = 0, sum = 0;
    for (const child of node.children) {
      const c = computeIntrinsicSizes(child, shaper, cache);
      if (c.minContent > min) min = c.minContent;
      sum += c.maxContent;
    }
    result = { minContent: min, maxContent: sum };
  } else if (cs.display === "table") {
    // Table: derive from per-column min/max with rowspan/colspan rules.
    // Defer to Task 10.
    result = computeTableIntrinsicSizes(node, shaper, cache);
  } else {
    result = { minContent: 0, maxContent: 0 };
  }

  cache.set(node.key, result);
  return result;
}
```

**Steps:**

1. Pre-flight.
2. Create `intrinsic-sizes-pass.ts` with the algorithm above (without the table case for now — Task 10 fills it in).
3. Tests: a paragraph with one word; a paragraph with multiple words; a block with mixed inline children; an empty block.
4. Build + tests.
5. Commit: `feat(layout): computeIntrinsicSizes for block / inline / text`.

---

## Task 8: BFC consults intrinsic sizing for shrink-to-fit

**Files:**
- Modify: `packages/core/src/layout/bfc.ts` — when laying out an inline-block or float, resolve `auto` inline-size via shrink-to-fit.

**Why:** CSS Sizing 3 §10.3.5: shrink-to-fit = `min(maxContent, available, max(minContent, available))`. For inline-blocks, floats, and table-cells with `auto` inline-size.

**Steps:**

1. Pre-flight.
2. In `bfc.ts`, when a child has `display: "inline-block"` or `cs.float !== "none"` AND `cs.inlineSize === "auto"`:
   ```ts
   const intrinsic = computeIntrinsicSizes(child, shaper, intrinsicCache);
   const available = contentInlineSize - childMargins;
   const shrinkToFit = Math.min(
     intrinsic.maxContent,
     available,
     Math.max(intrinsic.minContent, available),
   );
   const childInlineSize = shrinkToFit;
   ```
3. The existing `computeUsedStyle` for the child should receive this resolved inline-size as an override (since `auto` no longer maps to the default fallback).
4. Tests: an inline-block with auto inline-size in a 500px container, with 100px max-content, should be sized to 100px.
5. Build + tests + commit: `feat(layout): BFC shrink-to-fit for inline-block + float via intrinsic sizing`.

---

## Task 9: IFC produces paragraph intrinsic sizes

**Files:**
- Modify: `packages/core/src/layout/ifc.ts`.

**Why:** When the IFC's parent block is itself shrink-to-fit (e.g., an inline-block with auto inline-size containing inline content), the IFC needs to expose paragraph-level intrinsic sizes. Currently the IFC computes width by wrap; it doesn't expose intrinsic data.

**Steps:**

1. Pre-flight.
2. In `ifc.ts`, expose a function `computeInlineIntrinsicSizes(node: ElementBox, shaper, cache): IntrinsicSizes` that:
   - Walks the IFC's text children.
   - For each text child: shape it; min += `unbreakableRunInlineSize` (sum), max += `unbreakableRunInlineSize` (sum); `widestCluster = max(widestCluster, run.minClusterInlineSize)`.
   - Min-content = widestCluster (the narrowest paragraph that doesn't overflow).
   - Max-content = sum of unbreakableRunInlineSize values + sum of inline-block intrinsic max-contents.
3. Hook into Task 7's `computeIntrinsicSizes` switch: when the box is a block whose children are all inline (the IFC case), call `computeInlineIntrinsicSizes`.
4. Tests: a paragraph with text "hello world" — min-content = "world" width (assume 5*charWidth = 50); max-content = "hello world" width = 11*charWidth = 110.
5. Build + tests + commit: `feat(layout): IFC produces paragraph intrinsic sizes`.

---

## Task 10: Table FC auto-layout columns

**Files:**
- Modify: `packages/core/src/layout/table-fc.ts`.

**Why:** Tables with `auto` column widths (no `columnPxWidths` provided) should size each column from per-cell intrinsic sizes per CSS Tables 3.

**Steps:**

1. Pre-flight.
2. In `table-fc.ts`, when `columnPxWidths` is empty/auto, compute per-column min/max-content:
   - Walk all cells in the table.
   - For each cell, get its intrinsic sizes via `computeIntrinsicSizes`.
   - Per column, `colMin = max(cell.minContent for cells in this column)`; `colMax = max(cell.maxContent for cells in this column)`.
3. Resolve column widths via the CSS Tables 3 algorithm (simplified):
   - If `sum(colMax) <= availableInlineSize`: each column = colMax.
   - Else if `sum(colMin) >= availableInlineSize`: each column = colMin (overflow).
   - Else: distribute available proportionally between colMin and colMax.
4. Tests: a 2-column table with content "abc"|"defgh" in 200px container — column widths are derived from intrinsic sizes.
5. Build + tests + commit: `feat(layout): Table FC auto-layout columns from intrinsic sizes`.

---

## Task 11: Style schema accepts intrinsic-sizing keywords

**Files:**
- Modify: `packages/core/src/styles/style.ts` and `computed-style.ts`.

**Why:** CSS Sizing 3 — `inline-size: min-content | max-content | fit-content` are explicit keywords. Plan 3.A reserved them as TODO; Plan 3.D activates.

**Steps:**

1. In Style: extend `inlineSize?: LengthOrAuto` → `LengthOrAuto | "min-content" | "max-content" | "fit-content"`. Same for `blockSize`, `min*`, `max*`.
2. In ComputedStyle: same extension to the tightened types.
3. In `resolveUsedLength`: handle the keywords by computing via intrinsic sizes (caller passes them in).
4. Pass through: BFC's `auto` resolution becomes a unified path that handles all of `auto`, `min-content`, `max-content`, `fit-content`.
5. Build + tests + commit: `feat(styles): inline-size accepts min-content / max-content / fit-content keywords`.

---

## Task 12: Integration test + dev-server smoke

**Files:**
- Create: `packages/core/src/integration/intrinsic-sizing.test.ts`.
- Modify: `examples/react/src/...` — add a sample with auto-table or shrink-to-fit float.

**Steps:**

1. Tests:
   - inline-block with `inlineSize: "auto"` in a 500px container, content "hello" — sized to "hello"'s max-content.
   - float with `inlineSize: "max-content"` in a 200px container with 300px content — clamps to 200.
   - 2-column auto-table — column widths derived from cell intrinsics.
2. Smoke-test the dev server.
3. Commit + phase-exit verification.

---

## Phase exit criteria

- All 13 tasks committed.
- Build clean across all packages.
- Test suite green.
- Dev server boots; intrinsic-sizing examples render correctly.
- Closes retrospective D1, D2, D3, D4, D7, D8 + F3C.1.
- New `IntrinsicSizes` infrastructure ready for Plan 3.E (anonymous box generation can consume it for table-cell wrapping).

## Plan 3.A / 3.B / 3.C followups closed by 3.D

- F3A.9 / F3B.4 — `containingInlineSize` default footgun (Task 0).
- F3A.17 — Marker box writing-mode asymmetry (Task 3 via LayoutContext).
- F3B.1 — Defensive Length cast (Task 4).
- F3B.2 — Block-axis percent stub (Task 2).
- F3B.3 — `usedStyle.blockSize === 0` muddy contract (Task 1).
- F3C.1 — `withInlineOffset` factory bypass (Task 5).

## Plan 3.A / 3.B / 3.C followups remaining

- F3A.4 / F3B.5 — `parentCs` unused (still); Plan 3.G to address.
- F3C.2 — Token schema extensions (low priority); Plan 3.G.
- F3C.3 — `TextShaper | TextMeasurer` overload (sunset path); future plan.
- F3C.4 — Mixed-direction bidi (Plan 4).

## Followups likely to surface in Plan 3.D execution

Track here as discovered. Items most likely:
- The `ctx.containingBlockSize` parameter is a hook with no consumers in Plan 3.D — flag if unused after Task 2.
- The intrinsic-sizing cache key (`renderNodeKey`) doesn't account for cache invalidation when ComputedStyle changes — Plan 3.H (incremental layout) needs to handle.
