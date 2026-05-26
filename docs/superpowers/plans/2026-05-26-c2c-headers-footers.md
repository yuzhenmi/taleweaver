# C.2c — Headers & Footers (center, default) Implementation Plan

> **For agentic workers:** subagent-driven-development; one implementer per task; independent
> code-reviewer gate before each commit; TDD (behavior/geometry-level through the real
> render→cascade→layout→paint pipeline; browser smoke for the editable surface). Design spec:
> `docs/superpowers/specs/2026-05-26-c2c-headers-footers-design.md`. Scope: center region, default
> variant. Build order T1→T8 (each task ships independently green).

**Goal:** editable per-page headers/footers (center, default variant) — a `templateContents` body
renders into each page's top/bottom margin, paints, and is click-to-caret + type editable.

---

## T1 — `PageBox.headerSlot` / `footerSlot` fields
**Files:** `packages/core/src/layout/page-box.ts` (+ `page-box.test.ts`).
- Add `readonly headerSlot: BlockBox | null` and `readonly footerSlot: BlockBox | null` to the
  `PageBox` interface; add two params to `createPageBox` (after the existing ones; default callers pass
  `null`, `null`). Freeze as today.
- **TDD:** `createPageBox(..., header, footer)` stores them; omitting/`null` → both null; existing
  PageBox tests still pass (update call sites to pass `null, null`).
- Update the ONE production caller (`virtual-layout-tree.ts materializePage` createPageBox call) to pass
  `null, null` for now (T4 fills them) so the build stays green.

## T2 — section + doc-root header/footer attrs → metadata → plan threading
**Files:** `packages/core/src/cascade/builtin-attrs.ts` (or the section-attrs interpreter location);
`packages/core/src/components/section.ts` + `document.ts` (metadata stamping); `section-plan.ts`
(`SectionBoundary`, `buildSectionPlan`, `sectionStateAt`, `IMPLICIT_SECTION_PLAN`); `measure-pass.ts`
(`PagePlanEntry`). Tests alongside.
- Section + document attrs: `headerBlockId?: BlockId`, `footerBlockId?: BlockId`. Add an AttrRegistry
  interpreter validating they're strings (BlockIds) or absent (the deferred-from-C.1b section-attrs
  interpreter — minimal: just these two keys for now; geometry attrs already flow via metadata).
- `section.ts` render: stamp `headerBlockId`/`footerBlockId` from `view.attrs` into ElementBox metadata
  (alongside the existing pageConfig keys). `document.ts` render: same (the implicit-section default) —
  give the document component the metadata channel (it currently stamps only `{display:"block"}`).
- `SectionBoundary` + `SectionStateAt` gain `headerBlockId?`/`footerBlockId?`; `makeSectionBoundary`
  reads them from the section box metadata; `buildSectionPlan` reads the DOCUMENT-ROOT box metadata for
  the implicit/leading boundary. `sectionStateAt` surfaces them. `PagePlanEntry` gains
  `headerBlockId?`/`footerBlockId?` (set from the active section state per page, like `activeSectionId`).
- **TDD (measure-pass.test / section-plan.test):** a section with `headerBlockId` → its pages'
  `PagePlanEntry.headerBlockId` is set; doc-root default → implicit-section pages carry it; no attr →
  undefined; per-section override (section 2 has a header, section 1 doesn't) → correct per page.
  NO-REGRESSION: docs without header attrs → entries byte-identical (undefined header/footer ids).

## T3 — cascade `templateContents` bodies (close the cascade gap)
**Files:** `packages/core/src/editor/actions/helpers.ts` (`rebuildTrees`); the full `layoutTree`/render
entry the controller uses; `packages/core/src/layout/...` as needed. Tests.
- After `render(...)`, cascade EACH `rendered.templateContents` body (independent context,
  `parentComputed = INITIAL_COMPUTED_STYLE`, matching how render builds them — confirm the exact
  cascade entry the main root uses and apply it per body). Produce a `Map<BlockId, cascadedRoot>` of
  cascaded template bodies available to layout. Incremental: re-cascade only dirty bodies (dirtyIds ∩
  templateContents).
- **TDD:** a templateContents body → its cascaded RenderNode has resolved `computedStyle` (non-null);
  incremental edit to a body re-cascades it (and only it). NO-REGRESSION: main-root cascade unchanged.

## T4 — slot layout in `materializePage` (+ thread cascaded bodies + fingerprint)
**Files:** `packages/core/src/layout/virtual-layout-tree.ts` (`makeVirtualLayoutTree`,
`materializePage`, `PageFingerprint`); the producer that builds the tree (`virtual-producer.ts`). Tests.
- `makeVirtualLayoutTree` gains a `cascadedTemplateContents: ReadonlyMap<BlockId, ElementBox>` param
  (the T3 output); thread from the producer.
- In `materializePage`, after the body `layoutBlock`: if `entry.headerBlockId` resolves to a cascaded
  body, `layoutBlock(headerBody, effMargins.inlineStart, 0, headerCtx, shaper, { availableBlockSize:
  effMargins.blockStart })` (headerCtx = `{...ctx, containingInlineSize: effContentInlineSize}`, no
  fragmentation) → `headerSlot` BlockBox. Footer symmetric at `y = effCfg.pageBlockSize −
  effMargins.blockEnd`, `availableBlockSize = effMargins.blockEnd`. Pass both to `createPageBox`.
- `PageFingerprint` + `fingerprintOf` + `fingerprintsEqual` gain `headerBlockId`/`footerBlockId` (+ the
  cascaded-body ref identity, so a header edit re-materializes affected pages) — mirror the
  `stopBeforeIndex`/`pageConfig` fingerprint discipline (interface + builder + equality, all three).
- **TDD (virtual-layout-tree.test):** an entry with a header body → `getPage(i).headerSlot` is a
  BlockBox at `(inlineStart, 0)` sized to the top margin, containing the body's lines; footer symmetric;
  no header id → slot null. NO-REGRESSION: docs without headers → equivalence harness byte-identical
  (header/footer null; uniform pages unchanged). Fingerprint: changing the header body ref/content
  re-materializes the page (not reused).

## T5 — paint the slots
**Files:** `packages/dom/src/canvas-renderer.ts` (`paintBox` `"page"` arm + `walkAndDetectChanges`
`"page"` arm). dom tests.
- `paintBox` page arm: after painting `children`, paint `page.headerSlot` and `page.footerSlot` (if
  non-null) via `paintBox` at their box coords (page-local → top/bottom margin). `walkAndDetectChanges`
  page arm: visit the two slots so incremental dirty-detection covers them.
- **TDD (dom):** a PageBox with a headerSlot → paint visits it (assert via the paint-cache/scene or a
  spy); slot dims change → repaint. NO-REGRESSION: pages without slots unchanged.

## T6 — hit-test + caret into a slot
**Files:** `packages/core/src/cursor/line-flatten.ts` (`collectLineBoxes` page arm);
`packages/core/src/cursor/hit-test.ts` (`resolvePositionFromPixel` resolveBlock gate);
`packages/core/src/cursor/cursor-position.ts` (`resolveInVirtualTree` slot fast-path);
`measure-pass.ts`/`virtual-layout-tree.ts` for a slot-id→pageIndex map. Tests.
- `collectLineBoxes` `"page"` arm: visit `headerSlot` (before children) + `footerSlot` (after) so
  `getLineIndex.byBlock` includes slot lines.
- `resolvePositionFromPixel` (~101): `getBlock(state, ownerBlockId)` → `resolveBlock(state,
  ownerBlockId) !== null`, so a click in a header resolves to `{blockId, offset}` in the body.
- `cursor-position` `resolveInVirtualTree`: detect a template-content target block (resolveBlock kind ≠
  "block") and route to its page directly (the plan knows which page's header/footer is that block —
  add a `pageIndexOfTemplateBlock(blockId)` from the entries' header/footer ids) → `getPage(p)` →
  per-page LineIndex, NO `materializeAll`.
- **TDD (hit-test.test / cursor-position.test, virtual tree with a header slot):** click in the header
  region → offset in the header body; caret for a position in the header body resolves on the right page
  WITHOUT materializeAll (assert via the driver-count or that only the target page materializes);
  selection-geometry of a header position. NO-REGRESSION: body clicks/caret unchanged.

## T7 — editing into a slot (map-agnostic state write path)
**Files:** `packages/core/src/state/yjs-doc.ts` (`getYBlock` map resolution); the cursor-driven Layer-3
ops (`insert-text.ts`, `delete-range.ts`/delete paths, `split-block`/Enter, …) — switch their
`getBlock` validation to `resolveBlock`; `helpers.ts rebuildTrees` incremental cascade+layout of dirty
template bodies. Tests.
- Make the write path resolve the owning Y.Map from the globally-unique blockId: `getYBlock(doc, id,
  ctx)` resolves block→map (blocks → embed → template) rather than defaulting `kind:"block"`; the ops'
  `getBlock` reads become `resolveBlock(...).block`. Confirm the no-op/dirtyIds contracts hold (dirtyIds
  already cover all three maps, #285/#270). Keep changes minimal + behavior-identical for main-tree
  blocks (resolveBlock's first arm is getBlock).
- `rebuildTrees`: when a dirty id is in templateContents, re-cascade + re-layout that body (the T3+T4
  incremental path) so a header edit reflects.
- **TDD (editor-behavior, through reduceEditor with a cursor in a header body):** INSERT_TEXT into a
  header → the body updates + re-renders; DELETE_BACKWARD; SPLIT (Enter) creates a 2nd header paragraph;
  the change reflects in the page's headerSlot geometry/text (regression-lock the reflow). NO-REGRESSION:
  main-tree editing byte-identical (full suite).
- **NOTE:** T7 is the largest risk — it gets its OWN plan-review before implementing (the exact set of
  ops to touch + the getYBlock resolution design).

## T8 — `INSERT_HEADER` / `INSERT_FOOTER` action + toolbar (browser-verify surface)
**Files:** `packages/core/src/editor/editor-action.ts`, `editor-state.ts`, new
`editor/actions/insert-header-footer.ts`; `examples/react/src/components/toolbar.tsx`. Tests.
- Action: if the active section (or doc root, implicit) has no `headerBlockId`, create a one-paragraph
  body block in `templateContents` (atomic insert), set the active section's/doc-root's
  `headerBlockId`/`footerBlockId` attr (mergeBlockAttrs), place the caret at the start of the new body.
  If one exists, just move the caret into it. No-op-safe; one transaction; correct dirtyIds.
- Toolbar buttons "Insert/edit header" / "Insert/edit footer".
- **TDD (editor-behavior):** INSERT_HEADER on an implicit-section doc → a templateContents body created,
  doc-root `headerBlockId` set, caret in the body; the body renders into every page's headerSlot
  (geometry); INSERT_HEADER again → caret moves into the existing body (no duplicate); undo restores.
- **BROWSER smoke (user):** click Insert header, type → header appears on every page; click into it,
  edit; scroll (repeats per page); undo.

## Status
- [ ] T1 PageBox slots · [ ] T2 attrs→plan · [ ] T3 cascade gap · [ ] T4 slot layout · [ ] T5 paint ·
  [ ] T6 hit-test/caret · [ ] T7 editing-into-slot · [ ] T8 action+toolbar
