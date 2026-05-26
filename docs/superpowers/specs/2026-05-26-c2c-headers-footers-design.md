# C.2c — Headers & Footers (center region, default variant) Design

**Date:** 2026-05-26 · **Status:** drafted, awaiting user review · **Amends/realizes:**
`2026-05-02-p1c-pagination-templates-design.md` §§1-4 + `2026-05-25-p1c-block-model-remapping.md`
("C.2 headers/footers" bullet), re-derived against the CURRENT block model + virtualized layout.

## Goal & scope
Editable per-page **headers and footers** — **center region, default variant only** — end-to-end:
a small body subtree (in `templateContents`) renders into each page's TOP margin (header) / BOTTOM
margin (footer), painted, and EDITABLE (click to place caret, type). Browser-verifiable by typing in a
header and seeing it repeat on every page.

**OUT (later sub-pieces):** left/right regions + first/odd/even variants (C.3); footnotes + the
content-shrinking slot (C.4); `page-number`/`page-count` tokens + the page-count two-pass + `PageContext`
(C.5). C.2c hardcodes nothing dynamic — a header is static body content for now.

## What already exists (built on)
Sections (`display:contents` blocks, C.1b); per-section page geometry via `SectionBoundary.pageConfig`
threaded through `measurePass` → `PagePlanEntry` → `materializePage` (C.2b); the `templateContents`
Y.Map with dirty-tracking + `resolveBlock` + full & incremental render (C.2a + #285/#313). So header/
footer BODIES already have a home and render to `RenderOutput.templateContents` (keyed by root id).

## Architecture (current model) + integration points (explorer-grounded)

### A. Where the body ref lives (active-section → header/footer body id)
- A `section` block's `attrs.headerBlockId` / `attrs.footerBlockId` reference a body root in
  `templateContents`. The **implicit section** (section-less doc) carries the same on the **document
  root** block's attrs (it already plays "implicit section settings").
- A section-attrs interpreter (deferred from C.1b) validates these; the `section` component (and the
  `document` component, for the implicit case) stamps them into `ElementBox.metadata` — the SAME
  channel C.2b used for `pageConfig`.
- Thread through: `SectionBoundary` + `SectionStateAt` + `PagePlanEntry` gain optional
  `headerBlockId?`/`footerBlockId?` (alongside the existing `pageConfig`/`activeSectionId`).
  `buildSectionPlan`/`sectionStateAt`/`measurePass` carry them so `getPage(i)` knows the active
  section's header/footer body for that page.

### B. PageBox slots + slot layout (in the virtualized `getPage`)
- `PageBox` gains named fields `headerSlot: BlockBox | null` and `footerSlot: BlockBox | null` (NOT in
  `children` — named fields keep "this isn't body content" explicit for paint/line-collection/
  fingerprint). `createPageBox` gains the two params.
- `materializePage` (virtual-layout-tree.ts) — after the body `layoutBlock` — lays out each slot via the
  SAME `layoutBlock` path, no fragmentation: header at origin `(effMargins.inlineStart, 0)`,
  `availableBlockSize = effMargins.blockStart`, width `effContentInlineSize`; footer at
  `(effMargins.inlineStart, effCfg.pageBlockSize − effMargins.blockEnd)`, `availableBlockSize =
  effMargins.blockEnd`. The cascaded template bodies are threaded into `makeVirtualLayoutTree`
  (closure) keyed by root id; `entry.headerBlockId`/`footerBlockId` select which to lay out.
- **Carry-forward fingerprint** (`PageFingerprint`) gains the slot block ids (+ their content/geometry
  signal) so a header edit / geometry change re-materializes the affected pages (mirror the
  `pageConfig`/`stopBeforeIndex` fingerprint discipline from C.2b-2/C.2b-1).

### C. Cascade gap (must close)
`rebuildTrees` (+ the full `layoutTree` path) cascades only the main `rendered.root` — NOT the
`templateContents` bodies. C.2c cascades each template body (independent context, `parentComputed =
INITIAL_COMPUTED_STYLE`, matching how render builds them) before layout, and re-cascades a dirty body
incrementally. Without this, slot content has null `computedStyle` → layout breaks.

### D. Paint
Extend `canvas-renderer.ts` `paintBox`'s `"page"` arm to paint `page.headerSlot`/`page.footerSlot`
(positioned in page-local coords, so they paint at the top/bottom margin); extend `walkAndDetectChanges`
similarly. `paintPage`/`paintPages`/`getPageBox`/`syncDom` need no change (slots ride inside the PageBox).

### E. Hit-test + caret for slot content (the crux)
- `collectLineBoxes` (line-flatten.ts) `"page"` arm: also visit `headerSlot` (before children) +
  `footerSlot` (after). `getLineIndex` + `byBlock` then include slot lines for free (slot block ids are
  globally unique, distinct from body ids).
- `resolvePositionFromPixel` (hit-test.ts ~101): replace the `getBlock(state, ownerBlockId)` defensive
  gate with `resolveBlock(state, ownerBlockId)` (else a click in a header resolves to null). A click in
  the top-margin region (y < blockStart) lands on the header's lines.
- `cursor-position.ts` `resolveInVirtualTree`: `plan.pageIndexOfBlock(blockId)` returns -1 for a
  template block → falls back to `materializeAll()` (O(N_pages) per keystroke — unacceptable). Add a
  fast path: each `PagePlanEntry` knows its `headerBlockId`/`footerBlockId`, so the plan can map a slot
  block id → its page index directly (a `pageIndexOfTemplateBlock` or a slot-id→page index built from
  the plan). Then resolve the caret on that one page.

### F. Editing into a slot (the other hard part)
The state write path assumes the main blocks map: `planInsertText` → `getBlock` throws for a
template-resident cursor block; `insertTextInTx` → `getYBlock(doc, id, …)` defaults `kind:"block"`.
This affects ALL cursor-driven edit ops (insert-text, delete-backward/forward, split/Enter, …), not just
insert-text. **Chosen approach:** make the state write path RESOLVE the owning map for a `{blockId}`
cursor (blockId is globally unique) rather than thread `kind` through every action — i.e. `getYBlock`
(or a thin wrapper the ops call) resolves block→map via the same precedence as `resolveBlock`, so ops
become map-agnostic. Validate this is sound for the no-op/dirtyIds contracts (the dirtyIds already cover
all three maps per #285). `rebuildTrees` must also incrementally cascade + re-layout a dirty template
body (close C's gap on the incremental path too).

### G. Editing surface (browser-verify vehicle)
`INSERT_HEADER` / `INSERT_FOOTER` editor actions: create a one-paragraph body block in
`templateContents` (via the atomic bulk-insert/clone primitive or insertBlock-into-templateContents),
link it via the active section's (or doc-root's) `headerBlockId`/`footerBlockId` attr, place the caret
in it. Toolbar buttons. (Mirrors the C.2b landscape-toggle pattern that made C.2b browser-verifiable.)

## Task decomposition (subagent-driven; each TDD'd + reviewer-gated)
1. **T1** — `PageBox.headerSlot`/`footerSlot` fields + `createPageBox` params (+ box-builder tests).
2. **T2** — section + document-root attrs `headerBlockId`/`footerBlockId`: AttrRegistry interpreter,
   `section.ts`/`document.ts` metadata stamping, `SectionBoundary`/`SectionStateAt`/`PagePlanEntry`
   threading (incl. implicit-section/doc-root path).
3. **T3** — cascade `templateContents` bodies in `rebuildTrees` + full `layoutTree` path (close the
   cascade gap), incremental re-cascade of dirty bodies.
4. **T4** — `materializePage` slot layout (header/footer into margin regions) + thread cascaded bodies
   into `makeVirtualLayoutTree` + carry-forward fingerprint includes slot ids. **Geometry-verifiable**
   (slot box at the right margin origin/size; uniform docs without headers byte-identical).
5. **T5** — paint: `paintBox` "page" arm + `walkAndDetectChanges` for slots.
6. **T6** — hit-test + caret: `collectLineBoxes` slot arm; `resolvePositionFromPixel` `resolveBlock`
   gate; `cursor-position` slot fast-path (no `materializeAll`).
7. **T7** — editing into a slot: map-agnostic state write path (resolve owning map) for the
   cursor-driven ops + incremental cascade/layout of dirty template bodies in `rebuildTrees`.
8. **T8** — `INSERT_HEADER`/`INSERT_FOOTER` action + handler + toolbar; editor-behavior tests; then
   BROWSER smoke (user): type in a header, it repeats on every page, click into it, edit, undo.

Build order T1→T2→T3→T4 (layout+paint visible: a seeded header renders) → T5 → T6 (click/caret) → T7
(type) → T8 (create via UI). T4+T5 give a paintable seeded header; T6+T7+T8 make it editable.

## Risks / decisions surfaced
- **No-page-shrink for headers/footers (C.2c):** the header/footer occupy the EXISTING page margins
  (they don't shrink the body content area — that's the footnote slot's job, C.4). A header taller than
  the top margin is clipped/overflows for now (Google Docs grows the margin; deferred — note it).
- **Implicit-section default header** stored on the document-root block attrs — confirm the document
  component gets a metadata channel (it currently stamps `display:block` only).
- **Editing-path map-resolution** (T7) is the largest single risk; the alternative (thread `kind`
  through every action) is more churn. T7 gets its own plan-review.

## Out of scope / follow-ups
C.3 (regions+variants), C.4 (footnotes + content-shrink slot), C.5 (page-number tokens + two-pass +
PageContext). Header-taller-than-margin growth. textAlign within a header (centered header text) depends
on #312.
