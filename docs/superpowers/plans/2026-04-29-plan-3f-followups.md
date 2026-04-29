# Plan 3.F — Follow-ups, Hacks, and Deferred Cleanups

**Status as of Plan 3.F completion (2026-04-29):**
- 8 commits on `feature/dom-architecture-redesign` for Plan 3.F
- Build clean across all packages
- Test suite green: 661 core / 114 dom / 10 react

---

## Items closed by 3.F

- **F.2 / F.3** — IFC↔BFC float integration. Closed by 3.F Task 3 (FloatEnvironment threaded via LayoutContext, single env per BFC).

## New followups from 3.F

### F3F.1 — `LayoutContext.isBFCRoot` adds a second source of truth

**File:** `packages/core/src/layout/layout-context.ts`

**What:** Plan 3.F Task 3 added `isBFCRoot: boolean` to `LayoutContext` to handle the document-root case (root is a BFC even when `establishesNewBFC(rootCs)` returns `false` for `display: block`). The flag is set by `makeRootContext` to `true`; `makeChildContext` sets it from `establishesNewBFC(parentCs)`.

**Concern:** there are now two ways to ask "is this a BFC root?": the runtime flag `ctx.isBFCRoot` and the predicate `establishesNewBFC(cs)`. They can disagree (e.g., for the root: flag is true, predicate is false). Future code that uses `establishesNewBFC` directly may produce wrong results for the root.

**Fix:** consider unifying. Either:
- (a) Remove `isBFCRoot`; have `establishesNewBFC` accept an optional "isRoot" override or use a separate `isRootContext` predicate.
- (b) Document the dual concept clearly: `isBFCRoot` represents "is this layout context's box a BFC root", which can be true either because the box's style triggers BFC OR because it's the document root. Treat as canonical.

**Priority:** medium. Watch for misuse.

### F3F.2 — `nextFloatBottomBelow` exposed but only called from IFC

**File:** `packages/core/src/layout/float-context.ts`

**What:** Task 4 exposed `nextFloatBottomBelow` on `FloatEnvironment`. Currently only the IFC's below-min-content line push uses it. Document its purpose so future callers understand the contract (returns smallest float bottom > blockOffset, or blockOffset if none).

**Priority:** doc only.

### F3F.3 — `clearance` doesn't trigger the same loop semantics

**File:** `packages/core/src/layout/float-context.ts`

**What:** `clearance(side, blockOffset)` returns the largest block-bottom of floats matching `side` (and ≥ `blockOffset`). For documents with multiple floats on the same side at different block-offsets, this is correct (clears all of them). But the `clearance` function does NOT include the iteration logic that `placeFloat` and `nextFloatBottomBelow` have for finding the smallest jump. This is intentional (clear should clear ALL floats on the side), but worth documenting that it differs from "find next float bottom".

**Priority:** doc only.

### F3F.4 — Existing `lengthToPx`-style fallback dropped from float branch

**File:** `packages/core/src/layout/bfc.ts`

**What:** When Plan 3.F refactored the float branch to use `floatEnv.placeFloat(...)`, the old code that computed `placedInlineOffset = paddingInlineStart + active.inlineStartSize` was removed. The new code computes via `floatEnv.placeFloat(...)`, which returns the inline-offset relative to the BFC content area; the BFC then adds `paddingInlineStart` for the physical x. Verify that the relationship is consistent — the BFC's content inline-size starts at `paddingInlineStart`, and the float environment's inline-offsets are relative to that.

**Priority:** verify in tests; the existing tests didn't catch a regression so likely fine.

## Inherited still-unresolved

- F3A.4 / F3B.5 / F3C followups — `parentCs` unused param. Plan 3.G.
- F3C.2 — Token schema extensions. Plan 3.G.
- F3C.3 — `TextShaper | TextMeasurer` overload. Future plan.
- F3C.4 — Mixed-direction bidi. Plan 4.
- F3D.1/.6 — Rowspan/colspan auto-table. Plan 6.
- F3D.2 — `containingBlockSize` plumbing not yet consumed. Forward-compat.
- F3D.3 — `withInlineOffset` requires explicit `containingInlineSize`. Document.
- F3D.4 — IFC inline-block makes a fresh root context (cache isolation). Low priority.
- F3E.1 — Anonymous cell synthesizes synthetic ElementBox. Low priority.
- F3E.2 — Anonymous row stylesheet inheritance. Low priority.
- F3E.3 — Anonymous block run produces LineBoxes as siblings of BlockBoxes (mixed children). Low priority.
- bfc.ts unreachable code at ~line 357 (preexisting Plan 1 followup F7.x). Outstanding.

## Blockers / forward-looking concerns

- `overflow` Style property not yet in schema. `establishesNewBFC` only handles non-overflow triggers. Plan 6 (visual chrome) should add it.
- `position: absolute / fixed` triggers a new BFC per CSS but isn't in schema yet (Plan 7).
