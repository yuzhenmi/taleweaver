# P1.C.2 — Section-aware pagination + headers/footers (virtualized-layout re-mapping)

**Date:** 2026-05-25
**Status:** Drafted (autonomous). Design-review-1 (2 Criticals + 7) and re-review-2 (3 new
Importants A/B/C, all in C.2b-2/C.2c) both addressed in-spec. Re-review confirmed both Criticals
genuinely resolved and **C.2a is plan-ready**; A (createPageBox blockSize site) gates C.2b-2, B
(makeVirtualLayoutTree signature) + C (closure-local header memo) gate C.2c — all now written
in. C.2a may proceed to planning.
**Amends:** `2026-05-02-p1c-pagination-templates-design.md` (original C.2–C.5) and
`2026-05-25-p1c-block-model-remapping.md` (the C.1a/C.1b block-model addendum).

## Why this addendum

The original C.2 design predates both the state redesign (Y.Doc block tree) AND the
**virtualized layout** (measure/paginate pass + on-demand `getPage`). C.1a/C.1b shipped
`section` as a `display: contents` block (layout-transparent) + the `SECTION_BREAK` editor
action. This addendum re-maps the original C.2 (paginator section-awareness + headers/footers)
onto the as-built virtualized pipeline and decomposes it into shippable sub-pieces.

The original *concepts* are unchanged: sections group content + page settings; a section
boundary implies a page break; headers/footers are editable content subtrees scoped to a
section + variant + region; `PageContext` feeds dynamic tokens; two-pass for page-count. Only
the *mechanism* changes, driven by two virtualized-pipeline realities (from the C.2 recon):

1. **`PageConfig` is a single doc-wide scalar baked into the pipeline.** `measurePass` uses
   `pageConfig.pageBlockSize` on every iteration; page blockOffset is the arithmetic
   `pageIndex * (pageBlockSize + pageGap)`; `makeVirtualLayoutTree`/`getPage` capture one
   `pageConfig` in a closure; the DOM controller's slot-sizing assumes uniform page height.
2. **`flattenContents` erases sections before the paginator sees them.** A `display: contents`
   section is spliced out of the child list `measurePass` iterates, and `build-fit-metas`
   *throws* on a `display: contents` element. So the paginator currently has no way to know a
   section boundary exists.

## Central decision: sections stay `display: contents`; pagination is layered on TOP

**Rejected — make `section` render `display: block` with `break-before: page`.** This is the
recon's first-suggested path, but it re-introduces exactly the box C.1a/C.1b removed: a block
section would establish its own box with margins and a nested content area, indenting/altering
the body flow — breaking the C.1b transparency invariant (and its passing geometry-equivalence
tests). Word/Docs sections have no visual box. Rejected.

**Chosen — a section-structure pre-pass, keyed on `type === "section"`, layered over the
transparent layout.** Sections remain `display: contents` (zero box, body flows as direct
doc-root children — unchanged from C.1b). A new pure pre-pass walks the **cascaded document
root's children BEFORE `flattenContents`**, and for each top-level `section` child records:
its start position (as an index into the *flattened* child list — the same list the measure
pass + fit-metas iterate) and its resolved per-section `PageConfig` (from `section.attrs`,
defaulting to the doc-wide config). The result is a `SectionPlan`: an ordered list of
`{ startFlattenedIndex, pageConfig }` boundaries. The measure pass consumes the `SectionPlan`
as a side channel: at each section boundary it (a) forces a new page and (b) switches the
active `PageConfig`. This keeps C.1a/C.1b's transparency fully intact and makes
"section-boundary + per-section geometry" a pagination-level concern keyed on the block type —
precisely what the C.1b addendum promised ("layered on TOP of `display: contents`, keyed on
`type === "section"`").

**Flattened-index mapping (robust against nested `display: contents` + empty sections).** The
measure pass iterates `flattenContents(cascadedRoot.children)` — a recursive splice. The
pre-pass must compute each section's `startFlattenedIndex` to match that exact list, NOT by
assuming "1 flattened child per body block." So the pre-pass walks the *unflattened* doc-root
children and, for each, adds its **recursively flattened length** to a running count: a
`section` child contributes `flattenContents(section.children).length` (and opens a boundary at
the count BEFORE adding it); any other child contributes `flattenContents([child]).length`
(normally 1, but a body block that is itself `display: contents` correctly expands). This
makes the mapping correct regardless of nested transparency. (It does NOT depend on an
"body blocks are never `display:contents`" invariant — it flattens for real.)

**Empty sections.** A section with zero body blocks contributes 0 to the flattened count, so
its boundary coincides with the next section's (or end-of-document). `applySectionBreak`'s
no-op-at-container-start guard already prevents creating an empty *leading* section, and the
explicit-split path never produces an empty section (it always moves ≥1 block). So an empty
section is a state the editor does not produce; C.2b-1 nonetheless tolerates it defensively:
coincident boundaries collapse to one forced break (a boundary at an index already starting a
page is a no-op), never an empty page. The pre-pass emits boundaries in order; the measure
pass de-dups boundaries that resolve to the same page start.

## Decomposition (foundations-first; each sub-piece shippable)

- **C.2a — `templateContents` Y.Map + `resolveBlock` (state-layer foundation; inert).**
  Adds the third top-level subtree map for header/footer/footnote bodies (parallel to
  `embedContents`), wires it through every dirty/undo/render/snapshot site (prereq R2/#270),
  and adds a unified `resolveBlock(state, id) → { block, kind }` accessor (prereq R4). No
  block references it yet → zero visible effect. Independently unit-testable. **Build first.**
- **C.2b-1 — section page breaks (uniform geometry).** The section-structure pre-pass
  (boundaries only, doc-wide geometry for every page) + measure-pass forced break at each
  boundary + `activeSectionId` / `sectionPageIndex` on `PagePlanEntry`. Sections become
  *visible*: each section starts on a new page. NO per-section geometry yet (all pages keep
  the doc-wide size). Smaller, contained; ships a real user-visible behavior.
- **C.2b-2 — per-section page geometry.** Section-attrs interpreter/validation
  (`pageInlineSize`/`pageBlockSize`/`pageMargins`); per-page `PageConfig` threading through
  the measure-pass loop (running-sum page blockOffset instead of the constant-arithmetic
  formula), `PagePlanEntry.pageConfig`, `PageFingerprint` geometry variant, `getPage(i)` using
  the entry's geometry, and the DOM controller's per-page slot sizing. The invasive piece —
  isolated so C.2b-1 ships independently.
- **C.2c — headers/footers (default variant, center region).** Section `attrs` reference
  header/footer body subtrees in `templateContents`; `PageBox.headerSlots`/`footerSlots`;
  render + cascade + layout of the header/footer subtree into a slot `BlockBox` positioned in
  the page margin per page; paint; hit-test → cursor into the slot subtree (via `resolveBlock`
  + a scope-aware position); scoped selection (cannot span scopes). Static header content only
  (e.g. "Chapter 1"); dynamic page-number tokens defer to C.5.

C.3 (regions left/right + variants first/even), C.4 (footnotes + iterative footnote slot),
C.5 (`PageContext` two-pass page-count + `page-number-token`/`page-count-token`) follow as in
the original §8, re-mapped when reached.

---

## C.2a — `templateContents` + `resolveBlock` (detail)

A new top-level Y.Map `templateContents` (key `"templateContents"`), structurally identical to
`embedContents`: a `Map<BlockId, Block>` holding detached body subtrees (each rooted at a
block whose `parentId` is `null` or a sentinel; referenced by id from a section block's attrs).

**Exact extension points** (from recon §C — all must change together, or template edits
silently miss dirty-tracking/undo/render):
- `state/yjs-doc.ts`: `TEMPLATE_CONTENTS_KEY`; `getTemplateContentsMap(doc)`; init in
  `createYDoc`; `captureDirtyIds` watches the template map (the `tx.changed` check + the
  `findOwningBlockIdMemoized` parent check both gain a template-map branch); `getYBlock`'s
  `kind` discriminant gains `"templateContent"` AND its internal map-selection switch gains the
  third branch (so Layer-3 ops can write template bodies — needed by C.2c's header-edit ops).
- `state/history.ts`: the `Y.UndoManager` tracked-types array includes
  `getTemplateContentsMap(doc)` — header/footer edits become undoable.
- `state/snapshot.ts`: `SnapshotCache` gains a `templateContents` map + `invalidatedTemplates`
  set (mirroring the embed pair). EVERY cache function is extended, explicitly including:
  `createSnapshotCache`, `createOverlayCache` (seed `invalidatedTemplates` from `dirtyIds`),
  `compactCache` (fold `invalidatedTemplates` into the compacted layer + carry template
  snapshots forward — MISSING this silently drops template snapshots after the chain-depth
  compaction fires), and `invalidateSnapshot` / the layered read path for template ids.
- `state/state.ts`: `getTemplateContent(state, id)`, `getTemplateContentIds(state)`.
- `render/render.ts`: `RenderOutput.templateContents: ReadonlyMap<BlockId, RenderNode>`; the
  embed-contents render loop is mirrored for template contents (both full + incremental).

**`resolveBlock` (R4).** `resolveBlock(state, id): { block: Block; kind: "block" |
"embedContent" | "templateContent" } | null` in `state.ts`, alongside `getBlockFromEither`
(which stays as the value-only shortcut). Consumers that resolve a `{blockId}` whose tree is
not known a priori — cursor-position, hit-test, selection-geometry when a position lands in a
header/footer — use `resolveBlock` so a templateContents position no longer reads `null` from
`getBlock`. (C.2a adds the accessor; C.2c is its first real consumer.)

**Decision — extensibility over speculation.** The C.2a captureDirtyIds change is done by
ADDING the template map to the watched set now (not building a generic registry). The state
review's #270 is resolved by this concrete extension; a general "registry of top-level maps"
is YAGNI until a 4th map appears.

**Cascade-delete.** Removing a section block must cascade-delete its referenced template
bodies (mirror `embed-content-cascade.ts`). Specified in C.2c (when section attrs gain the
body refs), not C.2a.

**Tests (C.2a):** template map round-trips a body subtree; an edit inside a template body
produces correct `dirtyIds` and is undoable; `resolveBlock` returns the right `kind` for ids
in each of the three maps and `null` for unknown; render emits `templateContents` render nodes.

---

## C.2b-1 — section page breaks, uniform geometry (detail)

**Section-structure pre-pass** (`layout/section-plan.ts`, pure): input the cascaded document
root + the doc-wide `PageConfig`; output `SectionPlan = { boundaries: { startFlattenedIndex:
number; sectionId: BlockId | null }[] }`. Walk the *unflattened* root children; each
`type === "section"` child opens a boundary at the current flattened-child count and
contributes its flattened body length; a non-section body block contributes 1. The implicit
(section-less) document yields a single synthetic boundary at index 0 with `sectionId: null`.

**Measure-pass integration.** `measurePass` gains the `SectionPlan` (threaded from
`buildVirtualPaginatedTree`). When the fit loop is about to place the flattened child at a
`startFlattenedIndex` that begins a NEW section, it forces a page break before it (same effect
as a `breakBefore: "page"` meta, but driven by the section boundary, not a meta property).
**The forced break fires only for boundaries at index > 0 in `SectionPlan.boundaries`** — the
first boundary (index 0, whether implicit `sectionId: null` or an explicit single section) does
NOT force a break, so a single-section / section-less document paginates from page 0 normally.
`PagePlanEntry` gains `activeSectionId: BlockId | null` and `sectionPageIndex: number` (0-based
within the section) — needed by C.2c for variant selection + scoped hit-test.

Geometry stays uniform in C.2b-1: every page uses the doc-wide `pageConfig`; the existing
`pageIndex * (pageBlockSize + pageGap)` blockOffset formula is untouched. Only the page-break
points and the per-entry section metadata change.

**Incremental measure carry-forward (the reuse proof — load-bearing).** The forced break is NOT
encoded as a `breakBefore: "page"` on the first block's `BlockFitMeta`: metas are cached keyed
by cascaded `ElementBox` ref (`build-fit-metas`), and a block's section membership is NOT a
property of the block — inserting a `SECTION_BREAK` makes a block the first-of-a-section while
its `ElementBox` (content unchanged) keeps the same ref, so a meta-level break flag would be
stale-reused. Instead the `SectionPlan` is an explicit input to `measurePass` and to
`canReusePage`: a prior page entry is reusable ONLY IF, in addition to the existing match
(`startIndex`, `resumeInto`, child refs, `listCounterAtStart`), **the `SectionPlan`'s
boundary-status for that page's `startIndex` is unchanged** — i.e. the page's `activeSectionId`
matches and whether a forced break applies at `startIndex` matches. `canReusePage` gains a
`SectionPlan` argument and does an O(log boundaries) lookup. Consequence: inserting/removing a
section break, or a `reparentChildren` that moves a body across a boundary, invalidates exactly
the pages from the changed boundary onward (those pages' `startIndex` boundary-status differs),
preserving the O(pages-after) incremental property while never stale-reusing a page across a
section-structure change.

**Tests (C.2b-1):** a 2-section doc breaks at the boundary (section 2's first body block starts
a fresh page even if section 1's last page had room); `sectionPageIndex` resets to 0 per
section; section-less doc paginates identically to today (no behavior change); transparency
(C.1b) still holds within a section's body; incremental edit inside section 2 doesn't
re-measure section 1's pages.

---

## C.2b-2 — per-section page geometry (detail)

Section `attrs` carry optional `pageInlineSize`, `pageBlockSize`, `pageMargins`,
`pageGap` overrides; a **section-attrs interpreter** (the one deferred from C.1b — but NOT a
cascade `Style` interpreter; a pure validator/normalizer that the section-plan pre-pass calls)
resolves each section's effective `PageConfig` = `{ ...docWideConfig, ...sectionOverrides }`.
The `SectionPlan` boundary gains `pageConfig: PageConfig`.

**Per-page geometry threading** (the invasive change — recon tension #1 + #3):
- The measure-pass loop replaces the constant `pageConfig.pageBlockSize` with the active
  section's `pageConfig.pageBlockSize`, and replaces the `pageIndex * (pageBlockSize+pageGap)`
  blockOffset with a **running sum** (`prevPageBlockOffset + prevPageBlockSize + pageGap`).
- `PagePlanEntry` gains `pageConfig` (the geometry for that page).
- `PageFingerprint` includes the entry's geometry so a section-geometry change invalidates only
  that section's pages onward.
- `getPage(i)` uses `entry.pageConfig` for `layoutBlock`'s available size + `createPageBox`'s
  dimensions + margins (instead of the closure's single `pageConfig`).
- `virtual-layout-tree.ts` `materializeAll()` / `totalBlockSize`: the
  `pageCount * pageConfig.pageBlockSize + gaps` formula becomes a running sum over per-page
  heights (the plan exposes a cumulative-offset accessor).
- `virtual-layout-tree.ts` `materializePage`'s `createPageBox(...)` block-size argument
  (review issue A): currently `pageConfig.pageBlockSize` (closure-captured uniform config) →
  `entry.pageConfig.pageBlockSize`. Same for the `pageContentBlockSize` passed to `layoutBlock`.
  (This is a core-layer site, NOT in `packages/dom` — easy to miss; the `PageBox` height would
  otherwise be wrong for every non-default-section page.)
- **DOM controller — every uniform-`pageHeight` assumption (recon enumerated these; ALL must
  switch to the plan's per-page blockOffset/height):**
  - `syncDom` slot sizing (the per-page DOM slot heights).
  - textarea/caret Y positioning (`pageIndex * (pageHeight + pageGap) + cursorPos.y` → page's
    cumulative blockOffset + cursorPos.y).
  - `scrollCursorIntoView` (same `pageIndex * (pageHeight + pageGap)` multiplier).
  - `resolveMouseToLayout`: `pageLocalY = visualY - plan.entries[idx].blockOffset` (NOT
    `idx * (pageHeight + pageGap)`), after `pageIndexAtBlockOffset(visualY)` picks the page.
  - paint-cache invalidation: a section-geometry change keeps the same page indices but changes
    their slot heights; `pageCaches`/canvas-pool must invalidate the affected pages' paint
    caches (the structural-diff walk won't catch a pure geometry change), mirroring the existing
    recycled-canvas stale-pixel handling.
  (`pageIndexAtBlockOffset` already binary-searches `entries[i].blockOffset`, so it works once
  blockOffsets are the running sum — no change there beyond feeding it correct offsets.)

**Tests (C.2b-2):** a section with a larger `pageBlockSize` produces taller pages from its
boundary; page blockOffsets are the running sum; a geometry change on section 2 doesn't shift
section 1's page positions; the DOM slot sizing matches per-page heights.

---

## C.2c — headers/footers (default variant, center region) (detail)

**Section → template refs.** A section block's `attrs` reference header/footer body subtree
roots in `templateContents` (e.g. `attrs.headerCenterBodyId`, `attrs.footerCenterBodyId`). The
bodies are normal block subtrees (paragraphs etc.), edited like document content but scoped to
the header/footer. (Editor actions to CREATE/populate a header — `MOVE_TO_HEADER`-style — and
the cascade-delete of template bodies on section removal land here.)

**Layout: `PageBox` slots.** `PageBox` gains `headerSlots`/`footerSlots`:
`Partial<Record<"center", BlockBox>>` in C.2c (left/right are C.3), and reserve a
`footnoteSlot: BlockBox | null` field shape (populated in C.4).

**`getPage(i)` stays layout-only — template bodies are CASCADED outside it (resolves the
"`getPage` must not run render/cascade" hazard).** `getPage` today is a pure "position one
page" function receiving an already-cascaded `cascadedRoot`; it must NOT gain render/cascade
side effects. So the layout cycle cascades the template bodies ALONGSIDE `cascadedRoot` (in the
same cascade pass that consumes `RenderOutput`), producing a
`cascadedTemplateContents: Map<BlockId, ElementBox>` parallel to `cascadedRoot` (mirroring how
`embedContents` render nodes already flow as a parallel map). This map is threaded into
`makeVirtualLayoutTree` and captured in the `getPage` closure. Then `getPage(i)`: looks up the
page's `activeSectionId` (from the plan), resolves its header/footer body ids, and runs ONLY
`layoutBlock` on the pre-cascaded body `ElementBox` into a slot `BlockBox` sized to the page
content-inline-size and positioned in the top/bottom margin band — no render, no cascade. The
header/footer layout for a given section+region is identical across that section's pages (same
cascaded body, same width) → **memoize keyed on the cascaded body `ElementBox` ref +
contentInlineSize** (the same ref-keyed scheme as the fit-meta cache, so an edit to the header
body changes the `ElementBox` ref → cache miss → re-layout; an unedited header is laid out
once and reused across all the section's pages); only the y-origin (each page's top/bottom
margin) differs. Incremental cascade already reuses unchanged subtree refs, so an unedited
template body keeps a stable `cascadedTemplateContents` entry across keystrokes.

Two concrete wiring points an implementer must not miss (review issues B + C):
- **`makeVirtualLayoutTree` gains a parameter** (signature change, NOT just a closure capture):
  `makeVirtualLayoutTree(plan, cascadedRoot, ctx, shaper, pageConfig, cascadedTemplateContents,
  prevTree?)`. Every call site in the layout coordinator (`virtual-producer.ts` + the
  incremental/full paginated paths) must pass `cascadedTemplateContents` alongside
  `cascadedRoot`. (C.2a/C.2b do not touch this; it is C.2c's API change.)
- **The header/footer slot-layout memo is CLOSURE-LOCAL** — a `Map<ElementBox, { box: BlockBox;
  contentInlineSize: number }>` inside `makeVirtualLayoutTree`, analogous to the existing
  `pageMemo` — NOT a module-level `WeakMap` like `_metaCache`. Closure-local matches the
  per-tree lifetime: a new tree's memo starts cold, the first page of each section lays its
  header out once, later pages of that section hit the memo; whole-`PageBox` reuse across
  keystrokes is still handled by the existing `prevTree` fingerprint carry-forward (the header
  slot rides inside the reused `PageBox`).

**Body-area interaction (deferred-but-noted).** A header taller than the top margin band would
need to reduce the page's body content area (an iteration like footnotes). C.2c scopes to
single-line/within-margin headers and treats the body content area as unchanged by header
height; multi-line-header reflow is a documented follow-up (original §9 "Content reflow on
header height change"), revisited with C.4's footnote iteration machinery.

**Paint.** `canvas-renderer.ts` `paintPage` paints the header/footer slot `BlockBox`es at their
margin y-positions, after the content area (recon §B.2).

**Hit-test + scoped cursor.** A click in the top/bottom margin band routes to the header/footer
slot's `BlockBox` (instead of the content tree); `resolvePositionFromPixel` resolves a
`{blockId, offset}` in the template-body subtree. Because `blockId` is globally unique and now
resolvable via `resolveBlock`, the position needs NO separate `scope` field on the position
itself (the C.1b-addendum simplification) — BUT selection/geometry/paint must know which slot/
page a template position belongs to for rendering (a template body block can appear on multiple
pages). C.2c constraint: **selection cannot span scope boundaries** (a selection is entirely in
the body, or entirely in one header/footer body) — matching Word/Docs (original §9). The
controller tracks the "active edit scope" (which subtree the cursor is in) so subsequent
keystrokes route to the right subtree; resolved via `resolveBlock(state, focus.blockId).kind`.

**Keyboard selection-extension clipping (the enforcement mechanism, not just a stated
constraint).** Line-nav (Up/Down) and selection-extension (Shift+Down, Shift+End) run on the
body's per-page `LineIndex` and don't natively know slot boundaries. Enforce by CLAMPING: a
caret move / selection-extension whose resulting focus would land in a different scope than the
selection's anchor (checked via `resolveBlock(...).kind`, plus "is the pixel/position inside a
header/footer slot region" for the body↔slot case) is clipped to the current scope's boundary —
it behaves like hitting that scope's start/end (the focus stops at the last/first position of
the anchor's scope). Line-nav started in a template body stays within that body's own
`LineIndex`; body line-nav never crosses into a slot. The action handlers clamp the resolved
focus to the anchor's scope, so a `kind === "templateContent"` focus can never pair with a body
anchor. This keeps the editing model coherent (no half-implemented cross-scope selection).

**Tests (C.2c):** a section with a center header lays out a header slot BlockBox at the top
margin on each of its pages; hit-test into the header band yields a position in the header body;
typing in the header edits the header body (not the document body) and is undoable; a body
selection + a header click don't form a cross-scope selection; section-less doc with no header
is unchanged.

---

## Deferred to later sub-pieces (explicit)

- **`PageContext` + dynamic tokens** (`page-number-token`, `page-count-token`) and the
  **two-pass page-count** → C.5. C.2c headers render STATIC content only; no per-page render
  variance is needed yet, so headers render once (like `embedContents`) and lay out per page.
- **Regions left/right + variants first/even** → C.3 (layout/paint already structured for it).
- **Footnotes + iterative footnote slot + `footnoteSlot` population** → C.4.
- **Multi-line-header body-area reflow** → revisited with C.4's iteration machinery.

## Resolved during design review (2026-05-25)

The first design review found the central decision sound but raised 2 design blockers + gaps;
all are now resolved in the body above. For the record:
1. **Flattened-index mapping** (was a Critical) — RESOLVED: the pre-pass flattens for real
   (`flattenContents` per child, recursively), not "1 per body block"; empty/coincident
   boundaries de-dup to one forced break. See "Central decision → Flattened-index mapping".
2. **Carry-forward reuse proof** (was a Critical) — RESOLVED: the `SectionPlan` is an explicit
   input to `canReusePage` (NOT a `breakBefore` meta flag, which would stale-reuse on a
   section-membership change with an unchanged `ElementBox` ref). See C.2b-1 "Incremental
   measure carry-forward".
3. **Template cascade location** (was a blocker) — RESOLVED: template bodies cascade alongside
   `cascadedRoot` into `cascadedTemplateContents`; `getPage` runs layout-only and memoizes on
   the cascaded `ElementBox` ref. See C.2c "`getPage(i)` stays layout-only".
4. **Uniform-page-height assumption sites** — enumerated in C.2b-2 (materializeAll, textarea Y,
   scrollCursorIntoView, resolveMouseToLayout, paint-cache invalidation).
5. **compactCache + getYBlock third branch** — called out explicitly in C.2a.
6. **Keyboard selection-extension scope clipping** — mechanism specified in C.2c.

## Remaining open questions (non-blocking; revisit at plan time)

- **Per-page geometry invalidation granularity (C.2b-2).** Expected O(pages-in-and-after the
  changed section), acceptable; confirm empirically with a measure-pass bench at plan time.
- **`resolveBlock` vs `getBlockFromEither`.** Keep both (value-only shortcut + kinded resolver);
  `getBlockFromEither` has existing call sites that don't need the kind. (Lean: keep both.)
