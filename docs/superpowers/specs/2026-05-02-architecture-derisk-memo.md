# Architecture-readiness derisking memo

**Date:** 2026-05-02
**Purpose:** Confirm the current architecture can support three known-unknown features (accessibility, IME, multi-column) without restructuring. Each is sized as "where would this live, what slots does it use, what (if anything) needs to change."

This is a confidence pass, not a design pass. Each section is intentionally short — enough to answer "is the architecture ready" with high confidence, not enough to start implementation.

---

## 1. Accessibility tree / hidden DOM mirror

**The problem.** Canvas is opaque to screen readers. Standard solution (used by Google Docs): maintain a hidden HTML DOM tree that mirrors document content + geometry; screen readers traverse the DOM, sighted users see the canvas.

**Where it lives.** A new module in `packages/dom/`, e.g. `dom-mirror.ts`, sibling to `canvas-renderer.ts`. Both consume the layout tree; canvas paints pixels; dom-mirror emits absolutely-positioned HTML elements at the same coordinates, transparent text colors, hidden from sighted users via opacity. Both attach to the same editor-controller-managed container.

**What the engine needs to provide.** Already provides:
- A layout tree with text content, semantic structure (via the originating render nodes), and per-box geometry.
- Reference-equality discipline so a "DOM mirror cache" (analogous to `PaintCache`) can short-circuit unchanged subtrees.
- Editor controller events that fire after every layout change.

**What needs to change.** Nothing in core. In the dom package: a new `DomMirrorCache` (similar to `PaintCache`), a `walkAndSyncDom` function (similar to `walkAndDetectChanges`), and editor-controller wiring to call it alongside `paint()`.

**Architectural verdict.** Fully supported. New consumer of layout output; no engine change.

**Estimated scope.** ~1 piece, similar size to canvas-renderer (~500-800 lines initially), plus integration tests.

---

## 2. IME composition

**The problem.** CJK / accented-input typing produces multi-step composition events: `compositionstart` → `compositionupdate` × N → `compositionend`. During composition, pending text must be visible (typically with underlined / highlighted styling) but not yet committed to document state. Arrow keys and other navigation should be intercepted by the IME during composition, not reach the editor as normal actions.

**Where it lives.** Editor controller (`packages/dom/src/editor-controller.ts`) — a UI-level concern, not a state-level one. The reducer never sees composition events; it only sees the final `INSERT_TEXT` on commit.

**Composition is UI state, not document state.** The editor controller keeps a `composition: { pending: string; cursorAt: Cursor } | null` field. On `compositionupdate`, update `pending` and trigger a re-paint that draws the pending text at the cursor position (with composition styling) on top of the canvas. On `compositionend`, dispatch `INSERT_TEXT(pending)` to the reducer and clear the composition field.

**Pending text rendering.** Drawn directly by the editor controller's paint code, not via the layout tree. The pending text is short (a few characters) and inserted at the cursor's pixel position; visually it looks like it's part of the text but the layout isn't recomputed for it. This is what every word processor does for basic IME.

**What the engine needs to provide.** Already provides:
- Cursor position resolution at any character offset.
- A paint cycle the editor controller can hook into.
- Reducer with `INSERT_TEXT` action.

**What needs to change.** Nothing in core. In editor-controller: composition state machine, composition event handlers, render-pending-text helper.

**Caveat — advanced IME.** Predictive IMEs (e.g., Chinese pinyin where the current word's tail might change as the IME predicts) might want full re-layout during composition rather than just an overlay. That would require composition state to flow through layout, which is a larger change. P17 in the decomposition can ship basic IME first; advanced IME is a follow-up.

**Architectural verdict.** Fully supported for basic IME. Advanced IME deferable as a follow-up (no architectural blocker, just larger scope).

**Estimated scope.** ~1 piece for basic IME (~300-500 lines of editor-controller logic + tests).

---

## 3. Multi-column

**The problem.** CSS Multi-column Module (Level 1): a block with `column-count: 3` (or `column-width: 200px`) creates a multi-column flow where its content fragments across columns. Columns can themselves be paginated — a multi-column block on page 1 might continue on page 2's columns.

**Where it lives.** A new formatting context: `column-fc.ts` in `packages/core/src/layout/`, sibling to `bfc.ts`, `ifc.ts`, `table-fc.ts`. `dispatch.ts` routes a block with `column-count > 1` (or a non-default `column-width`) to Column FC instead of regular BFC.

**The Column FC algorithm.** Same shape as `paginate.ts`'s coordinator loop. The Column FC:
1. Determines available column height (from its parent's `FragmentationContext.availableBlockSize`).
2. Runs an inner BFC for column 0 with `availableBlockSize = columnHeight`.
3. If BFC returns a `breakToken`, advance to column 1, run BFC again with the resume token; repeat.
4. Once all content is placed, emits a column-container BlockBox with N column children.
5. If column count exceeds the configured `column-count`, the WHOLE multi-column block returns a `BlockBreakToken` to its parent — which (in pagination context) means "this multi-column block fragments across pages."

**Nested fragmentation contexts.** Pagination is the outer context; columns are inner. The Column FC's `availableBlockSize` is whatever its parent (the page's BFC) gives it. The Column FC creates a *derived* FragmentationContext (with column-sized `availableBlockSize`) for its inner BFC. When the multi-column block fragments at a page boundary, the resume happens at the column-fc level: the second page's invocation resumes from "column N+1 of the multi-column block."

**`BreakToken` extension (small).** Add a `ColumnBreakToken` variant: `{ type: "column"; resumeAtColumn: number; resumeAtBlockToken: BreakToken | null }`. Mirrors `TableBreakToken`. The Column FC consumes it; BFC propagates it via `BlockBreakToken.resumeChildToken` per the existing recursive pattern.

**What the engine needs to provide.** Already provides:
- Formatting-context dispatch by `display` (extends to consider `column-count`).
- `FragmentationContext` and `BreakToken` machinery.
- BFC's break-aware child-placement loop (used unchanged for the inner per-column passes).
- `paginate.ts` per-page coordinator (Column FC mirrors its shape one level deeper).

**What needs to change.** Schema additions: `column-count`, `column-width`, `column-gap`, `column-rule-*`, `column-span` properties on `Style`. New `BreakToken` variant. New module `column-fc.ts`. Dispatch tweak. Painter knows nothing new (column children render as ordinary BlockBoxes).

**Architectural verdict.** Fully supported. Reuses the formatting-context family pattern, the fragmentation machinery, and the paginator's coordinator-loop shape.

**Estimated scope.** ~1 piece (~600-1000 lines for the Column FC), similar in shape to Table FC.

---

## Verdict

All three are within reach of the current architecture. None requires restructuring; each fits a known slot:
- Accessibility = a new layout-tree consumer in the dom package.
- IME = an editor-controller UI feature.
- Multi-column = a new FC that reuses fragmentation machinery.

**Architectural confidence: 95%.** The remaining 5% is unknown-unknown risk that surfaces only at implementation. Per-piece agents can be dispatched safely, with the standard rule: stop and surface architectural questions to the controller before unilaterally restructuring.
