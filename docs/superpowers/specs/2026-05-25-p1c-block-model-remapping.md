# P1.C re-mapping onto the Y.Doc block-tree model (addendum)

**Date:** 2026-05-25
**Status:** Drafted; awaiting review.
**Amends:** `2026-05-02-p1c-pagination-templates-design.md` (the "original spec").

## Why this addendum

The original P1.C spec was written **before** the state-model redesign
(`2026-05-02-state-model-block-tree-of-ropes-design.md`) was cemented. Its §1
(state-tree extensions) and §6 (editor/selection model) are written against the
now-DELETED path-based model: `StateNode`, `properties`, `Cursor { path:
number[] }`, "subtree by `path`". The current model is the Y.Doc block-tree:

- `Block { id: BlockId, type: string, attrs, parentId, prev/nextSiblingId,
  first/lastChildId, inlineContent }` in a `Map<BlockId, Block>` over a Y.Doc.
- Positions are `{ blockId, offset }` (ID-based, not path-based).
- "Referenced subtrees" already exist: an `EmbedItem` stores
  `properties.contentBlockId` referencing a block in a SEPARATE `embedContents`
  Y.Map; `getEmbedContent` resolves it; `clonePastedSubtree` / `deleteRange`
  cascade across the reference. **This is the precedent for header/footer/footnote
  bodies** — they are referenced subtrees, not inline children.

The original spec's *concepts* (sections group content; headers/footers/footnotes
are editable content subtrees; first/odd/even variants; `PageContext`; PageBox
margin slots; two-pass page count; iterative footnote slot) are all valid and
unchanged. Only the *representation* and *cursor model* are re-mapped here.

## Concept → block-model mapping

| Original-spec concept | Block-model representation |
|---|---|
| `section` `StateNode`, child of doc root, `properties: SectionProperties` | `Block { type: "section", parentId: <docRoot>, attrs: <section settings> }`; its body blocks are its `firstChild…nextSibling` chain |
| header/footer subtree (`SectionProperties.header: StateNode`) | a detached block subtree (root id) referenced from the section block's `attrs` (e.g. `attrs.headerCenterBlockId`), stored in a dedicated `templateContents` Y.Map — same shape as `embedContents` (C.2) |
| `footnote` `StateNode` inline at call site | an `EmbedItem`-like inline item in the paragraph's `inlineContent` whose `properties.contentBlockId` references the footnote body subtree in `templateContents` (C.4) |
| `Cursor { scope, path, offset }` | `{ blockId, offset }` — **`blockId` is globally unique, so it already identifies which subtree a position is in.** No separate `scope` field needed on the position. |
| dynamic tokens (`page-number-token`) | inline items / block types whose component reads `PageContext` (unchanged — component-based, per original §1.3) |

**Key simplification (vs original §6.1):** the original added a `scope` discriminant
to `Cursor` because a path is only meaningful relative to a subtree root. In the
block model a `{ blockId, offset }` position is already unambiguous regardless of
which subtree (`blocks` / `embedContents` / `templateContents`) the block lives
in. So selection/reducer handlers do NOT need a scope field; they resolve
`blockId` → its Block via whichever map holds it. The **region/variant/section
mapping** (original §6.1 steps 1–2) is still needed, but only as a
HIT-TEST → cursor concern (layout records which section+variant+region a slot
came from; clicking it yields a `{blockId, offset}` in that slot's subtree). That
is a C.2 layout/paint concern, not a position-model change.

## Section block: layout transparency (resolves a decomposition tension)

The original §8 says **C.1 has "no layout impact (sections invisible)"**, yet §4.1
says **sections imply page breaks** and carry per-section page geometry. These
conflict. Resolution:

- A `section` block is **transparent to the BFC/IFC** — it is NOT laid out as a
  visible nested box. It is a **pagination-level grouping** only. The paginator
  (measure-pass / paginate) iterates the document root's children; a `section`
  child opens a new section (new page, the section's page geometry + template).
  The BFC that lays out one page's body sees the section's CHILDREN directly, not
  a section wrapper box — so no extra margin/nesting box appears.
- Therefore the layout/paginator change to make sections transparent-but-page-
  breaking is NOT zero-impact. **Revised C.1 scope** (below) keeps the data model
  + reducer in C.1 but moves the paginator's section-awareness into C.2 (where it
  is exercised by real headers/footers). Until C.2, an explicit `section` block is
  treated by the paginator as a transparent passthrough of its children with NO
  page break (so C.1 truly has no visible effect — sections are inert data until
  C.2 wires page-break + template selection). This keeps each sub-piece shippable
  and the engine working, honoring the original §8 intent.

  *(Alternative considered: make sections page-break from C.1. Rejected — it
  would ship a visible behavior with no way to author per-section settings yet,
  and complicates C.1's review surface. Transparent-passthrough-until-C.2 is the
  cleaner increment.)*

## Section properties in `attrs`

`SectionProperties` (original §1.1) map onto the section block's `attrs`:
`pageInlineSize?`, `pageBlockSize?`, `pageMargins?`, `pageNumberStart?`,
`pageNumberFormat?`, `footnoteNumbering?`, `footnoteNumberFormat?`, plus
header/footer body references (`headerCenterBlockId?` … 6 regions × 3 variants —
added in C.2/C.3, not C.1). `attrs` is `ReadonlyAttrs` (a string-keyed bag), so
these are plain attr keys; an `AttrRegistry` interpreter validates/normalizes them
(follows the existing builtin-attr-interpreter pattern). All optional; absent ⇒
inherit document-root defaults (`EditorConfig.pageConfig`).

## Implicit vs explicit sections

- **Implicit (default):** a document with zero `section` blocks behaves as one
  implicit section using `EditorConfig.pageConfig`. No `section` block exists.
  Existing documents are unchanged. The paginator's "active section" defaults to
  this implicit section (a synthetic descriptor, not a block).
- **Explicit:** created by `SECTION_BREAK`. Sections are FLAT children of the
  document root (no nesting — Word/Docs rule). The first break on an
  implicit-section doc creates the structure (below).

## `SECTION_BREAK` reducer (C.1)

Block-tree semantics (one transaction):
1. Resolve the cursor's block and its enclosing top-level container. Find the
   boundary: the document-root child at/under which the cursor sits.
2. If the doc root's children are body blocks directly (implicit section): create
   section block **A** and reparent the body blocks BEFORE the boundary under A;
   create section block **B** and reparent the boundary block + everything after
   under B. Both A and B become the doc root's children (replacing the body blocks
   as direct children). A inherits the document defaults; B inherits A's attrs.
3. If the cursor is already inside an explicit section S: split S — blocks before
   the cursor stay in S; the cursor's block + following siblings move to a new
   section S' (flat sibling of S), inheriting S's attrs.
4. Cursor lands at the start of the new section's first block (`{ firstBlockOf(B
   or S'), 0 }`).

Reuses existing primitives (`insertBlock`, sibling relinking, `removeBlock`-style
reparenting). The reparent must keep `firstChildId`/`lastChildId`/sibling chains
consistent and emit correct `dirtyIds` (the moved blocks + both sections + the
doc root). Sections must never nest (assert in dev).

## Revised decomposition (block-model)

- **C.1** — `section` block type + `block-kinds` registration (container shape) +
  `SECTION_BREAK` action + section-attrs `AttrRegistry` interpreter. Paginator
  treats `section` as a transparent passthrough (NO page break yet). Engine
  behaves identically to today for section-less docs; an explicit section is inert
  data. (This addendum's focus.)
- **C.2** — paginator section-awareness (page break between sections, per-section
  page geometry, active-section tracking) + headers/footers (default variant,
  center region): `templateContents` map, header/footer body references in section
  attrs, PageBox `headerSlots`/`footerSlots`, paint, hit-test → cursor into the
  slot subtree.
- **C.3** — remaining regions (left/right) + variants (first/even).
- **C.4** — footnotes (`templateContents` body, inline call item, `footnoteSlot`
  iterative layout, `INSERT_FOOTNOTE`).
- **C.5** — page-count two-pass + `page-number-token` / `page-count-token`
  components + `PageContext`.

## Review findings & resolution (2026-05-25)

A design review (against the real measure-pass / render / state code) found the
"transparent section, no surgery" claim WRONG and surfaced concrete
prerequisites. Resolutions:

### R1 (critical) — section transparency needs `display: contents`, not "no box by default"
A `section` block renders as an `ElementBox` (via `renderBlock`), and
`buildBlockFitMetas` → `buildMetasForChildren` classifies it as a `kind: "block"`
container with its own margin/break context — i.e. a nested layout box,
indenting its body. There is no existing "splat children into parent" path.

**Resolution — adopt `display: contents`** (CSS Display 3 §3.2: the element
generates no box; its children render as if children of the element's parent).
This is the CSS-faithful mechanism (per CLAUDE.md "use CSS/DOM box-model
semantics faithfully"), it is reusable beyond sections, and it makes "section is
transparent to the BFC" a principled box-tree property rather than a section
special-case. A `section` block computes `display: contents`; render/cascade
keep its `RenderNode` but layout (measure-pass + BFC + virtual `getPage`) treats
a `display: contents` box by splicing its children into the parent's child list
(no box, no margins, no break context of its own). The paginator's
section-boundary + per-section page-geometry logic (a page break at each section
start) is layered on TOP of that, keyed on `type === "section"`.

**Consequence:** `display: contents` support in the layout pipeline is a real
FOUNDATION PREREQUISITE for P1.C, and is its own increment (render keeps the
node; cascade resolves `display: contents`; `build-fit-metas`/`measure-pass`
splice children; BFC/`getPage` emit no box for it). This was not anticipated by
the original (pre-virtualization) spec.

### R2 (important) — `templateContents` third Y.Map needs dirty-tracking wiring (C.2 prereq)
`captureDirtyIds` / `findOwningBlockId` (yjs-doc.ts) watch only `blocks` +
`embedContents`; the `History` UndoManager tracks only those two scopes. Adding
`templateContents` (header/footer/footnote bodies) MUST simultaneously extend
all three, or template-content edits produce empty `dirtyIds` → stale render.
Explicit C.2 prerequisite.

### R3 (moderate) — SECTION_BREAK needs a NEW bulk-reparent primitive
Reparenting N body blocks from doc-root into a new section is NOT expressible
with `insertBlock`/`removeBlock`/`splitBlockAtPosition` (all single-block). C.1
must add a `reparentChildren`/`bulkMoveBlocks` Layer-3 op (relink sibling/child
chains for old+new parents in one transaction; `dirtyIds` = moved blocks + both
sections + doc-root). Do NOT claim "reuses existing primitives."

### R4 (minor) — `{blockId, offset}` subsumes scope BUT needs a unified resolver
True that `blockId` is globally unique, but `getBlock` checks only `blocks` and
`getEmbedContent` only `embedContents`; a position in `templateContents` resolves
to `null` from both. Need a unified `resolveBlock(blockId) → { block, map }`
accessor (C.2 prereq, when `templateContents` lands). For C.1 (no
`templateContents` yet) this doesn't bite.

### Revised buildable order (gated on the foundation prereqs)
1. **C.1a — `display: contents` layout support** (FOUNDATION; independently
   valuable + testable: a `display:contents` wrapper block lays out identically
   to its children spliced into the parent). Deepest prereq; build first.
2. **C.1b — `section` block kind + section-attrs interpreter + `reparentChildren`
   primitive + `SECTION_BREAK` action.** Sections compute `display: contents`, so
   a section in the tree is layout-transparent (no page break yet). Engine
   behaves identically for section-less docs; an explicit section reflows its
   body as if direct doc-root children.
3. **C.2** — paginator section-awareness (page break + per-section geometry +
   active-section) + `templateContents` map (+ R2 dirty wiring + R4 resolver) +
   headers/footers (default/center) + PageBox slots + paint + hit-test.
4. **C.3 / C.4 / C.5** as before (regions/variants; footnotes; two-pass + tokens).

> **USER DECISION POINT (surfaced, not blocking):** P1.C is larger than a
> single feature — it requires a `display: contents` layout foundation, a
> bulk-reparent primitive, a unified block resolver, and `templateContents`
> dirty-tracking, because the original spec predates the state redesign +
> layout virtualization. The recommended path builds the `display: contents`
> foundation first (C.1a). If the user prefers a more self-contained feature
> (e.g. tables EDITING — the Table FC already lays out; the gap is editor
> actions, no new layout foundation), that is a reasonable redirect.

## C.1a + C.1b implementation addendum (2026-05-25, as-built)

C.1a and C.1b are implemented + reviewer-approved on `feature/dom-architecture-redesign`.
As-built reconciliation vs. the buildable order above:

- **C.1a shipped** as the `display: contents` layout foundation: a shared
  `flattenContents` helper wired into `groupChildren`, the intrinsic-sizes pass, the
  measure/paginate fit-meta walk, the IFC inline-token collection, and the layout-reuse
  cache. A `display:contents` wrapper lays out geometry-identically to its children
  spliced into the parent (toggle-verified equivalence tests).
- **C.1b shipped** as: `section` container component (computes `display: contents` via the
  component, NOT an attr interpreter); `reparentChildren` Layer-3 op (R3) realized as a
  pure `computeReparentWrites` builder + `reparentChildrenInTx` applier + validating
  `planReparentChildren`; `applySectionBreak` atomic op; `SECTION_BREAK` editor action;
  and an editor-level transparency + undo/redo integration test.
- **Decision — section-attrs interpreter DEFERRED to C.2.** Section page-geometry settings
  (`pageInlineSize`, `pageMargins`, …) are consumed by the paginator (C.2), are NOT
  `ComputedStyle` properties, and nothing reads them in C.1b. C.1b creates sections with
  empty `attrs` (so the buildable-order line 191 "+ section-attrs interpreter" moves to C.2).
- **Decision — break-at-container-start is a no-op.** Breaking at a container's FIRST child
  would create an empty leading section; `applySectionBreak` returns the input state
  unchanged (uniform for implicit + explicit). Sections are FLAT, never nested (structural —
  `buildYBlock` hardcodes `parentId: rootId`; the boundary resolver only selects root-parented
  sections). C.2 may revisit leading empty sections once a page break makes them meaningful.
- **C.2 prerequisites confirmed** (from the state-module design review): R2 `captureDirtyIds`
  must be extended for the new `templateContents` Y.Map, and R4 needs a unified
  `resolveBlock(blockId) → { block, map }`. Both are C.2's first tasks.

## Open questions for review

1. **Transparent-section model.** Is "section is a pagination-level grouping,
   transparent to the BFC" the right call, vs. a real layout box? (I believe yes —
   a section has no visual box in Word/Docs; it only scopes page settings +
   templates + page breaks.) Confirm this doesn't break the measure-pass's
   per-block `BlockFitMeta` model (a transparent section means the paginator
   iterates section.children for fit-metas, not the section block itself).
2. **C.1 transparent-passthrough vs page-break-from-C.1.** Is deferring the page
   break to C.2 the cleaner increment, or should C.1 page-break immediately?
3. **`templateContents` as a third Y.Map** (alongside `blocks`, `embedContents`)
   vs. reusing `embedContents`. A separate map keeps body/embed/template subtrees
   distinct for cascade + clone logic. (C.2 decision; flagged now for awareness.)
4. **Does `{blockId, offset}` truly subsume `scope`?** Confirm no consumer needs a
   scope discriminant that blockId-lookup can't provide (e.g. selection-geometry
   needing to know "this position is in a header" without a map lookup — it can
   look up the block's map membership / a `block.type` ancestor walk).
