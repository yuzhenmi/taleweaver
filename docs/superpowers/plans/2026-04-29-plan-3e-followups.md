# Plan 3.E — Follow-ups, Hacks, and Deferred Cleanups

**Status as of Plan 3.E completion (2026-04-29):**
- 5 commits on `feature/dom-architecture-redesign` for Plan 3.E (8f3eca0, f5aace9, 30d7e2c, a63c4c4, plus the doc commits)
- Build clean across all packages
- Test suite green: 639 core / 114 dom / 10 react

---

## Items closed

None directly — Plan 3.E added new infrastructure rather than fixing prior items. The anonymous-box generation enables future correctness, doesn't fix existing bugs.

## New followups from 3.E

### F3E.1 — Anonymous cell synthesizes a synthetic ElementBox for `layoutBlock` recursion

**File:** `packages/core/src/layout/table-fc.ts` (anonymous cell handling)

**What:** When wrapping non-cell content in an anonymous table-cell, the implementation creates a synthetic `ElementBox` literal with `computedStyle.display = "table-cell"` so `layoutBlock` can recurse into it. This works but introduces a new pattern: layout-time synthesis of render nodes whose computedStyle differs from the original parent's.

**Concern:** The synthetic ElementBox uses the parent row's computedStyle as a base + `display: "table-cell"`. This may cause inheritance edge cases (e.g., text-decoration that should propagate from row to cell to inline content). Cascade has already run before layout; the synthetic cell's children carry their cascaded styles. The anonymous box itself has `display: table-cell` style for layout dispatch purposes, but consumers reading the synthesized ElementBox's computedStyle for non-display purposes get the parent's cascaded values.

**Priority:** low. The existing tests pass. If a future test uncovers an inheritance edge case (e.g., `text-decoration` not appearing through anonymous cells), revisit.

### F3E.2 — Anonymous row stylesheet inheritance

**File:** `packages/core/src/layout/table-fc.ts`

**What:** Anonymous rows use the table's computedStyle. Per CSS, an anonymous table-row's effective computed values are derived from its parent (the table). Inheritance behaves as if the anonymous row sits between the table and the cells, but its layout-relevant properties (margins, padding, borders) are zero. Plan 3.E's implementation passes the table's full computedStyle to the synthesized row, which is "correct enough" for v1. 

**Priority:** low. The CSS spec is nuanced here ("anonymous boxes inherit from parent but have transparent layout properties"). Verify in tests if a real document exposes a discrepancy.

### F3E.3 — Anonymous block run does NOT produce a BlockBox in the LayoutBox tree

**File:** `packages/core/src/layout/bfc.ts` (in `layoutBlock`'s inline-run branch)

**What:** When the BFC encounters an inline-run group, it produces LineBoxes directly as children of the parent block (no anonymous BlockBox wrapper). This matches the spec ("anonymous boxes are layout-time-only") and keeps the LayoutBox tree closer to the document tree. But it means the parent BlockBox's children are a mix of `LineBox` (from anonymous runs) and `BlockBox` (from real block children).

**Concern:** consumers (painter, hit-test, selection-geometry) may assume that a BlockBox's children are either all LineBoxes (a paragraph) or all BlockBoxes (a container). The mixed case is new.

**Mitigation:** existing painter and editor utilities walk children by `box.type` discriminated union; they should handle the mixed case naturally. If a bug surfaces, it'll be in a consumer that branches on parent type assuming homogeneous children.

**Priority:** low. Watch for it.

## Inherited still-unresolved

(Same as Plan 3.D followups; nothing new resolved or added.)

- F3A.4 / F3B.5 — `parentCs` unused param. Plan 3.G.
- F3C.2 — Token schema extensions (clusterWidths, hyphenBreaks). Plan 3.G.
- F3C.3 — `TextShaper | TextMeasurer` overload. Future plan.
- F3C.4 — Mixed-direction bidi. Plan 4.
- F3D.1/.6 — Rowspan/colspan auto-table. Plan 6.
- F3D.2 — `containingBlockSize` plumbing not yet consumed. Forward-compat.
- F3D.3 — `withInlineOffset` requires explicit `containingInlineSize`. Document.
- F3D.4 — IFC inline-block makes a fresh root context (cache isolation). Low priority.
- bfc.ts unreachable code at ~line 330 (preexisting).
