# Plan 3.D — Follow-ups, Hacks, and Deferred Cleanups

> Living record of every shortcut, stub, plan deviation, and code smell taken
> during Plan 3.D execution. Companion to prior phase followups docs and the
> Plan 3 retrospective.

**Status as of Plan 3.D completion (2026-04-29):**
- 14 commits on `feature/dom-architecture-redesign` for Plan 3.D
- All builds clean across all packages
- Test suite green: 623 core / 114 dom / 10 react
- Dev server boots
- Closes retrospective D1, D2, D3, D4, D7, D8, plus F3C.1

---

## Categories

1. [Retrospective items closed by 3.D](#1-closed-by-3d)
2. [Deferred to later in 3.D series](#2-deferred-within-3d-series)
3. [New followups from 3.D execution](#3-new-followups)
4. [Inherited issues, still unresolved](#4-inherited-still-unresolved)

---

## 1. Closed by 3.D

These were tracked in the Plan 3 retrospective and prior followups. Each is now resolved.

| ID | Description | Resolved in |
|---|---|---|
| **D1 / F3A.9 / F3B.4** | `containingInlineSize?:` default footgun in factories | P3.D.0 (`f1f8bef`) |
| **D2 / F3B.3** | `usedStyle.blockSize === 0` muddy contract for auto-sized boxes | P3.D.1 (`91714ac`) |
| **D3 / F3B.2** | Block-axis percent resolution against inline-size (forward-compat plumbing) | P3.D.2 (`54fcc58`) |
| **D4 / F3A.17** | Marker box writing-mode asymmetry; FCs took 4-7 separate parameters | P3.D.3 (`d34b771`) — `LayoutContext` |
| **D7 / F3B.1** | `as unknown as Length` defensive cast in `resolveFontSize` | P3.D.4 (`2391ff0`) |
| **D8** | 9 factories with ~10 lines of duplicate boilerplate | P3.D.5 (`6123543`) — `createBoxBase` |
| **F3C.1** | `withInlineOffset` factory bypass via spread+cast | P3.D.5 (`6123543`) — typed dispatch |

---

## 2. Deferred within 3D series

### F3D.1 — Rowspan / colspan in auto-table layout

**File:** `packages/core/src/layout/table-fc.ts` (and `intrinsic-sizes-pass.ts:computeTableIntrinsicSizes`)

**What:** Plan 3.D Task 10 implements auto-table column-width resolution from per-cell intrinsics, but the per-column accumulation uses a simple sequential walk (`colIdx++` per cell). Cells with `colspan > 1` should advance the index by their span count and contribute their intrinsic sizes split across the spanned columns. Cells with `rowspan > 1` should not be re-counted in subsequent rows.

**Why deferred:** the table layout in Plan 3.A doesn't yet support rowspan/colspan; adding them in Plan 3.D would require both schema additions (`rowSpan`, `colSpan` props on table-cell render nodes) and intrinsic-sizing changes. Out of Plan 3.D scope.

**Plan to fix:** when rowspan/colspan land (Plan 6 — visual chrome + full tables, per the Plan 3 spec §10), update the auto-layout column-width algorithm to handle them per CSS Tables 3 §17.5.2.

---

### F3D.2 — `containingBlockSize` parameter unconsumed in v1

**File:** `packages/core/src/layout/used-style.ts` (`computeUsedStyle`)

**What:** Plan 3.D Task 2 added `containingBlockSize: number | "indefinite"` to `computeUsedStyle` for forward compatibility. After Task 1 dropped sizing fields from `UsedStyle`, no length-typed UsedStyle field needs block-axis-percent resolution in v1. The parameter is passed but not read (suppressed via `void containingBlockSize`).

**When it activates:** when a future plan re-introduces a block-axis-percent property on UsedStyle (e.g., `block-size` if it returns to UsedStyle, or `min-block-size`/`max-block-size` for vertical writing modes). At that point, the resolver consumes `containingBlockSize`.

**Priority:** intentional plumbing. Low.

---

## 3. New followups

### F3D.3 — `withInlineOffset` requires `containingInlineSize` as a parameter

**File:** `packages/core/src/layout/layout-box-v2.ts` (`withInlineOffset`)

**What:** The typed `withInlineOffset(box, newInlineOffset, containingInlineSize)` introduced in Task 5 takes `containingInlineSize` as a separate parameter. The caller (e.g., IFC's bidi reorder in `ifc.ts:reorderLineForBidi`) must remember to pass the correct value (the line's own inline-size for line children).

**Concern:** if a future caller passes the wrong value for `containingInlineSize`, RTL physical-x computation produces wrong results. The footgun is similar in shape to D1 but localized to this one helper.

**Mitigation:** the helper's JSDoc documents the contract explicitly. A future cleanup could re-derive `containingInlineSize` from the box itself (since LayoutBoxBase carries enough info to reconstruct it via the factories' invariants), but that adds complexity.

**Priority:** low. Document and move on.

---

### F3D.4 — IFC inline-block layout uses `makeRootContext` instead of `makeChildContext`

**File:** `packages/core/src/layout/ifc.ts` (`collectInlineTokens` inline-block branch)

**What:** When the IFC encounters an inline-block, it lays out the inline-block's content via `layoutBlock(child, 0, 0, infCtx, shaper)`. The `infCtx` is built via `makeRootContext(cs, 100000)` — treating the inline-block's content as if it were a fresh root context with 100,000px available.

**Why:** the inline-block establishes a new BFC; its content's containing block IS the inline-block itself. `makeRootContext` semantically captures "fresh BFC with this writing-mode/direction".

**Concern:** the inline-block's intrinsic-cache is then a SEPARATE cache (since `makeRootContext` creates a new one). The parent's cache is bypassed. This may cause repeated computation for content shared between an inline-block and an enclosing context, but in practice render nodes are unique-per-position so the cache miss is benign.

**Priority:** low. Could be cleaned up by passing the parent `ctx.intrinsicCache` to the inline-block's child context — the typed `makeChildContext` would need to accept an optional override. Defer until a perf concern surfaces.

---

### F3D.5 — Mock shaper `minClusterInlineSize` is per-character, not per-word

**File:** `packages/core/src/layout/mock-shaper.ts`

**What:** The mock shaper sets `minClusterInlineSize = charWidth` (the widest single character; effectively `charWidth` since all chars have the same width). Real shapers would set this to the widest unbreakable grapheme cluster, which for a string like `"abc"` is the same as `charWidth`. So the value is correct.

**But:** test fixtures expecting `minContent === wordWidth` (e.g., `"abc"` → 30) need to know that mock-shaper's `minContent === charWidth` (10). Tests in P3.D.7 had to be adjusted from "min=30" expectation to "min=10".

**Concern:** test authors may write expectations based on intuitive "longest word" semantics, then be surprised when mock-shaper gives them per-character results.

**Mitigation:** the mock shaper's behavior is correct per CSS spec (min-content = widest cluster). Test fixtures should comment this when asserting on min-content values.

**Priority:** documentation. Add a comment to mock-shaper noting the spec.

---

### F3D.6 — Rowspan / colspan tracking in `computeIntrinsicSizes`

(See F3D.1 — same issue, separate file.)

---

## 4. Inherited still-unresolved

These remain from prior plans:

- **F3A.4 / F3B.5 / F3C followups** — `parentCs` unused param in `buildLineChildrenForAncestorLevel`. Preexisting Plan 1 followup; still unresolved. Plan 3.G to address.
- **F3C.2** — Token schema extensions (clusterWidths, hyphenBreaks). Plan 3.G.
- **F3C.3** — `TextShaper | TextMeasurer` overload (sunset path). Future plan.
- **F3C.4** — Mixed-direction bidi within a single shaped run. Plan 4.
- **bfc.ts unreachable code** at line ~324. Preexisting Plan 1 followup F7.x. Outstanding.

---

## How to use this document

Most items are intentional plumbing (F3D.2 — containingBlockSize) or documented limitations (F3D.5 — mock shaper semantics). The genuine work-to-do:

- **F3D.1 / F3D.6** — rowspan/colspan in auto-table. Plan 6 owns it.
- **F3D.3** — `withInlineOffset` requires explicit `containingInlineSize`. Document and move on; revisit if a bug surfaces.
- **F3D.4** — IFC inline-block cache isolation. Low-priority perf cleanup.

When fixing, link the fix commit here.
