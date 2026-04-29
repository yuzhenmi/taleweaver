# Plan 3.H — Follow-ups, Hacks, and Deferred Cleanups

**Status as of Plan 3.H completion (2026-04-29):**
- 11 commits on `feature/dom-architecture-redesign` for Plan 3.H
- Build clean across all packages
- Test suite green: 724 core / 114 dom / 10 react

---

## Items closed by 3.H

- **F3G.1** — Token content-equality bug. Fixed in P3.H.0 (`2e195e1`): `findChangePoint` compares full token content (id, text, width, style, isSpace, isLineBreak, ancestors).
- **F3G.2** — `dirtyBlockOffsetSince` real impl. Done in P3.H.5 (`ee7ab06`): array-diff over placed-floats; returns lowest differing block-offset.
- **D9** — `computedStylesEqual` typed comparison. Done in P3.H.6 (`ee7ab06`): typed `COMPUTED_STYLE_KEYS` list with structural comparison for Length objects and arrays.

## New followups from 3.H

### F3H.1 — IFC subtree reuse not yet implemented

**File:** `packages/core/src/layout/ifc.ts`

**What:** Plan 3.H Task 4 added subtree reuse for the BFC's `layoutBlock`. The IFC has its own simple-cache-only path (Plan 3.G Task 4) for paragraph-level reuse but doesn't yet use the new `LayoutBoxCache` for individual line/text-run reuse. So lines within a paragraph still get fully re-laid-out on any paragraph change.

**Concern:** combined with the cache:
- BFC level: subtree reuse for blocks works.
- IFC level: paragraph identity-cache (full reuse OR full re-wrap).
- Within-paragraph: no reuse.

**Fix:** Plan 3.G Task 3's convergence-detection algorithm IS in place (`wrap-incremental.ts`); it just isn't WIRED into the IFC's wrap loop because hyphen-handling complicates extracting `wrapOneLine`. A future plan should wire convergence detection in.

**Priority:** medium. The simple-cache provides 90%+ of the benefit; convergence saves the remainder for long-paragraph edits.

### F3H.2 — Incremental cache not used by `layoutTreeIncremental` for sequential edits

**File:** `packages/core/src/layout/layout-incremental.ts`

**What:** `layoutTreeIncremental(newRoot, oldRoot, oldLayout, ...)` builds a fresh `LayoutBoxCache` from `oldLayout` on each call. For continuous editing (e.g., typing), this means cache is rebuilt every keystroke. Could be optimized: keep the cache around between calls (keyed by something stable like the EditorState identity) and incrementally update it.

**Concern:** rebuild cost is O(layout-tree-size) per keystroke. For 100-page docs this could be noticeable — though likely still fast since it's a flat Map population.

**Priority:** low. Profile before optimizing. Plan 3.I (paint incremental) may surface this if paint becomes the bottleneck.

### F3H.3 — `isLayoutBoxReusable` only checks block boxes; LineBox/InlineBox reuse is implicit via paragraph cache

**File:** `packages/core/src/layout/layout-reuse.ts`

**What:** The predicate's reuse rules are framed for blocks (computedStyle, availableInlineSize, writingMode, direction, floatEnvDirtyOffset). LineBox / InlineBox / TextRunBox don't go through this predicate; they're reused via the IFCStateCache's identity-cache OR by virtue of being children of a reused BlockBox.

**Concern:** if a future plan adds LineBox-level reuse rules (e.g., "reuse a LineBox if its tokens are unchanged"), the predicate would need extending. Currently fine because line reuse goes through the IFC path.

**Priority:** doc. Note in `layout-reuse.ts` that the predicate is for block-level boxes; line/inline reuse goes through the IFC.

### F3H.4 — `prevLayoutCache` and `prevFloatEnv` are nullable in `LayoutContext` — easy to forget

**File:** `packages/core/src/layout/layout-context.ts`

**What:** `LayoutContext` has `prevLayoutCache: LayoutBoxCache | null` and `prevFloatEnv: FloatEnvironment | null`. When a fresh layout is started (no previous), both are `null`. Code that checks `ctx.prevLayoutCache` for reuse must null-check.

**Concern:** future code paths that don't explicitly null-check could fall into bugs. The pattern is: `if (ctx.prevLayoutCache) { ... }` everywhere.

**Priority:** doc. The current BFC integration handles it correctly. Future expanders should be careful.

### F3H.5 — `BoxBaseFields` interface added in P3.D.5 is now public-ish via `withInlineOffset`

**File:** `packages/core/src/layout/layout-box-v2.ts`

**What:** Plan 3.D Task 5 introduced `createBoxBase` + `BoxBaseFields` for factory deduplication. They're internal but the `withInlineOffset` function exported in the same file dispatches by box type and reconstructs via factories. If a future task adds a new LayoutBox type, both `createBoxBase` and `withInlineOffset` need updating.

**Priority:** doc only.

## Inherited still-unresolved

- **F3C.3** — `TextShaper | TextMeasurer` overload (sunset path). Future plan.
- **F3C.4** — Mixed-direction bidi within shaped run. Plan 4.
- **F3D.1/.6** — Rowspan/colspan auto-table. Plan 6.
- **F3D.2** — `containingBlockSize` plumbing not yet consumed. Forward-compat.
- **F3D.3** — `withInlineOffset` requires explicit `containingInlineSize`. Document.
- **F3D.4** — IFC inline-block makes a fresh root context. Low priority.
- **F3E.1** — Anonymous cell synthesizes synthetic ElementBox. Low priority.
- **F3E.2** — Anonymous row stylesheet inheritance. Low priority.
- **F3E.3** — Anonymous block run produces LineBoxes as siblings of BlockBoxes. Low priority.
- **F3F.1** — `LayoutContext.isBFCRoot` dual-source-of-truth. Watch.
- **F3F.2 / F3F.3** — Doc-only.
- **F3G.3** — Convergence detection not yet wired. Optimization.
- **F3G.4** — `IFCStateCache` invalidation on render-node-key reuse with changed children. Edge case.
- **bfc.ts unreachable code** at ~line 383. Preexisting Plan 1 followup F7.x.

## Going into Plan 3.I (paint incremental)

Plan 3.I builds on Plan 3.H's reuse machinery. Each LayoutBox now has a stable identity across re-layouts when content is unchanged; paint can hash paint-inputs per box and skip repainting unchanged regions.

Most relevant for 3.I:
- LayoutBox reference equality detected via the cache from Plan 3.H.
- `prevFloatEnv` informs which areas need repainting due to float changes.
- Per-box paint-input hashing decides "is this box's paint output the same?"
