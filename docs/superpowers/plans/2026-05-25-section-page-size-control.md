# Section page-size control (verification surface for C.2b-2) — Implementation Plan

> **For agentic workers:** subagent-driven-development; one implementer; an independent
> code-reviewer gate before commit; TDD at the editor-behavior level (it touches the
> render→layout reflow path).

**Goal:** Give the example app a way to set a section's page-geometry override so the
already-built per-section page geometry (C.2b-2) can be exercised in the browser. A
toolbar button toggles the section at the cursor between the doc-wide page size and a
**landscape** override (the doc-wide dimensions swapped). This is the Word / Google Docs
"Page Setup → Orientation → Apply to: This section" flow, and the most visually obvious
way to confirm "a section renders different-sized pages from its boundary; caret / click /
scroll land across the boundary; no stale paint after a geometry change."

**Decision (user, 2026-05-25):** picked "Wire a section page-size control" over seeding a
static demo or deferring. Scope is intentionally minimal — a single landscape toggle, not
a full page-setup dialog.

## Why this works end-to-end (already plumbed)
The engine flows a section's page geometry from `attrs` to pixels (C.2b-2, committed):
`section` block `attrs.pageInlineSize` / `attrs.pageBlockSize` → `section.ts` stamps them
into the `ElementBox` metadata → `buildSectionPlan` → `resolveSectionPageConfig` →
`SectionBoundary.pageConfig` → `measurePass` per-page geometry + running-sum offsets →
`virtual-layout-tree` positioning → DOM controller slots / caret / scroll / hit-test /
paint-cache. The ONLY missing piece is an editor action to SET those `attrs` on the
active section. `mergeBlockAttrs` already exists and clears a key when its incoming value
is `undefined` (so the same op both sets and clears the override).

## Active-section resolution
Sections are FLAT under the doc root, holding content blocks directly (they never nest).
The "active section" for the cursor = walk `parentId` up from the focus block to the
doc-root child; if that top-level block is a `section`, it's the active section; otherwise
(bare doc-root content, no section breaks made yet) there is none → the action is a no-op.

---

## Task 1: `TOGGLE_SECTION_LANDSCAPE` action + handler + toolbar button

**Files:**
- Modify: `packages/core/src/editor/editor-action.ts` (add the action to the union).
- Create: `packages/core/src/editor/actions/toggle-section-landscape.ts` (+ test
  `toggle-section-landscape.test.ts` in the same dir).
- Modify: `packages/core/src/editor/editor-state.ts` (wire the reducer case).
- Modify: `examples/react/src/components/toolbar.tsx` (add the button).

**Action:** `| { type: "TOGGLE_SECTION_LANDSCAPE" }` (no payload — the handler decides
set-vs-clear from the active section's current attrs + the doc-wide `config`).

**Handler `handleToggleSectionLandscape(editor: EditorState, config: EditorConfig): EditorState`:**
- **`EditorConfig.pageConfig` is OPTIONAL and NESTED** (`config.pageConfig?: PageConfig`,
  carrying `pageInlineSize`/`pageBlockSize`). If `config.pageConfig === undefined`
  (unpaginated harness) → return `editor` unchanged (can't determine landscape dims).
- Resolve the active section id (the walk above). If none → return `editor` unchanged
  (no-op; toolbar button is still safe to press in a section-less doc). The walk must
  treat a null mid-walk `getBlock` result as "no active section → no-op" (never throw).
- Read the section block's current `attrs.pageInlineSize`. Treat the section as "currently
  landscape" iff it has a `pageInlineSize` override present (`typeof === "number"`). Toggle:
  - currently landscape → merge `{ pageInlineSize: undefined, pageBlockSize: undefined }`
    (clears both keys → falls back to doc-wide).
  - else → merge `{ pageInlineSize: config.pageConfig.pageBlockSize, pageBlockSize: config.pageConfig.pageInlineSize }`
    (the doc-wide dimensions SWAPPED — wider + shorter pages).
- `const result = mergeBlockAttrs(editor.state, sectionId, bag);`
- T7 no-op identity: `if (result.state === editor.state) return editor;` (guards the
  `history.commit` pre-condition).
- Selection is UNCHANGED (a geometry change doesn't move the cursor logically):
  `editor.history.commit({ state: result.state, dirtyIds: result.dirtyIds }, { before: editor.selection, after: editor.selection });`
- `return rebuildTrees({ ...editor, state: result.state }, editor, config, result.dirtyIds);`
- Type safety: no `!`; read attrs via the block's `attrs` bag with proper narrowing
  (`typeof v === "number"`).

**Reducer:** add `case "TOGGLE_SECTION_LANDSCAPE": result = handleToggleSectionLandscape(editor, config); break;`
before the `default`.

**Toolbar:** a `ToolbarButton` next to the section-break button, label
"Toggle section orientation" (pick a sensible lucide icon already imported or import one
like `RectangleHorizontal`), `onAction={() => dispatch({ type: "TOGGLE_SECTION_LANDSCAPE" })}`.

**TDD (editor-behavior level, through `reduceEditor`, mirroring `section-break.test.ts` /
`section-pagination.test.ts` harness so the layout actually runs):**
- Build a doc, `SECTION_BREAK` to create two sections, place the cursor in section 2.
  Dispatch `TOGGLE_SECTION_LANDSCAPE` → section 2's block has `attrs.pageInlineSize ===
  config.pageBlockSize` and `attrs.pageBlockSize === config.pageInlineSize`; **the layout
  tree's pages for section 2 are wider + shorter** than section 1's (assert the geometry,
  not just the attrs — this is what proves the render→layout reflow actually fires on a
  section-attrs change). Section 1's pages keep the doc-wide geometry.
- Dispatch again → the override is CLEARED (`attrs.pageInlineSize === undefined`); section
  2's pages return to doc-wide geometry.
- Cursor in a section-less doc (no `SECTION_BREAK`) → no-op (`result === editor`, no commit).
- `config.pageConfig` absent (unpaginated config) → no-op (same editor ref, no commit).
- Undo after a toggle restores the prior geometry (history integration).
- No-op identity: toggling to a value equal to the current attrs returns the same editor
  ref (covered by the clear-then-clear or the mergeBlockAttrs no-op short-circuit).

## Verify
- `npm run build --workspace=packages/core` clean; FULL `npm test --workspace=packages/core`
  green; `npm test --workspace=packages/dom` green (145/149 unaffected). `examples/react`
  builds clean.
- Reviewer gate, then commit.

## Browser-verify (user, after commit) — closes the C.2b-2 loop
`npm run dev --workspace=examples/react`: type a few pages, Section break, then Toggle
section orientation. Confirm: the new section's pages render WIDER + SHORTER from the
boundary; the caret, mouse clicks, and scrolling all land correctly across the
portrait→landscape boundary; toggling back restores portrait with no stale paint.

## Out of scope
- A full page-setup dialog (custom sizes, margins, per-section gap UI). The engine
  supports `pageMargins` / `pageGap` overrides too; only the landscape toggle is surfaced.
- Setting page geometry on a section-less (bare doc-root) document — make a Section break
  first.

## Status
- [ ] T1 — action + handler + reducer wiring + toolbar button + editor-behavior tests.
