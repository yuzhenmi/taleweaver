# P1.C — Page Templates, Headers, Footers, Footnotes Design

**Date:** 2026-05-02
**Branch:** `feature/dom-architecture-redesign`
**Status:** Drafted; awaiting user review.

## Goal

Complete the pagination feature set by adding editable headers, footers, and footnotes (the items deferred from P1.A and P1.B). Headers and footers are state-tree-backed, scoped to "section" nodes, with first/odd/even page variants. Footnotes are state-tree nodes inserted inline at their call site, with numbering policies configurable per section. Templates select content per page based on the enclosing section's settings.

## Architectural compass

Match Google Docs / Word for the editing model. Headers, footers, and footnote bodies are document content (state-tree nodes), not stylesheet config. Sections are first-class state-tree nodes that group content sharing page-layout settings. Page templates are *derived* from the active section's properties — not configured separately.

CSS Paged Media's `@page` rule shape is the wrong model for in-document editing (it's designed for printable HTML); we borrow only the *concept* of a content-area block + margin boxes, not the stylesheet-rule mechanism.

## Out of scope (recap with reasons)

- **Cross-page floats**: still deferred to a separate piece (P1.D or P12). P1.C's footnote slot affects only the BFC's `availableBlockSize`; cross-page floats are a different problem.
- **Multi-column** (P26): different formatting context; pagination interaction is its own piece.
- **Generated content / `target-counter()`**: full counter machinery is P9a / P9b. P1.C hardcodes only `pageIndex` and `pageCount` in `PageContext`. Chapter numbering, footnote numbering across sections, etc. land with P9a.
- **Print preview / PDF export**: same paginated layout output; no new design needed.
- **All 16 CSS Paged Media margin boxes**: P1.C exposes 6 regions only (`headerLeft`/`Center`/`Right`, `footerLeft`/`Center`/`Right`). Corners and side regions are app-layout features outside word-processor scope.

---

## 1. State-tree extensions

### 1.1 New node type: `section`

```ts
// One section's properties. All optional; unspecified inherits from the
// document-wide defaults set on the document root's properties.
interface SectionProperties {
  // Page geometry — overrides document root's pageConfig within this section.
  readonly pageInlineSize?: number;
  readonly pageBlockSize?:  number;
  readonly pageMargins?:    PageMargins;

  // Header/footer subtrees. Each is a StateNode whose `children` are flow
  // content (paragraphs, runs, etc.) — same vocabulary as document body.
  // null/absent = no header/footer for this region.
  readonly header?:          StateNode | null;   // default header (used when no variant matches)
  readonly footer?:          StateNode | null;
  readonly firstPageHeader?: StateNode | null;   // for the first page of this section
  readonly firstPageFooter?: StateNode | null;
  readonly evenPageHeader?:  StateNode | null;   // for left-side pages in spread layouts
  readonly evenPageFooter?:  StateNode | null;
  // (header/footer above is the "odd" variant when even/first variants exist;
  // this matches Word's model.)

  // Page-numbering policy.
  readonly pageNumberStart?:  number;                 // "restart at N" for this section; default = continue
  readonly pageNumberFormat?: CounterFormat;          // decimal, lower-roman, upper-alpha, etc.

  // Footnote numbering policy.
  readonly footnoteNumbering?:    "continuous" | "restart-per-section" | "restart-per-page";
  readonly footnoteNumberFormat?: CounterFormat;
}

type CounterFormat = "decimal" | "lower-roman" | "upper-roman" | "lower-alpha" | "upper-alpha";
```

A `section` `StateNode` is a child of the document root. Its `children` are the body content of the section (paragraphs, headings, etc.). Its `properties` carry `SectionProperties` above.

**Default section.** Documents that don't declare any sections get a synthetic single section spanning the whole document, populated from the document root's `properties` (which already carry `pageMargins`/etc. via `EditorConfig.pageConfig`). This means existing documents (no section nodes) keep working unchanged — they just have one implicit section.

**Migration path.** When the user inserts a section break, the document's children get split: everything before the break stays under the existing section (or under the implicit section, which becomes explicit); everything after goes into a new section. This is a `SECTION_BREAK` editor action.

### 1.2 New node type: `footnote`

```ts
interface FootnoteProperties {
  // No props on footnote node itself. Body is in `children`. Numbering is
  // computed at layout time based on the enclosing section's policy.
}
```

A `footnote` `StateNode` is inserted inline at its call site (alongside text runs in a paragraph). Its `children` are the footnote body content (paragraphs, runs). The renderer emits a small inline call marker (e.g., superscript "1") at the call site; layout reserves space at the page bottom for the body.

### 1.3 Header/footer content shape

Header/footer subtrees are full state-tree nodes — same node types as the document body. A header can contain paragraphs, headings, inline runs, even tables. Most commonly, a header is a single paragraph with mixed text + inline tokens (page numbers, current date, etc.).

**Inline tokens for dynamic content.** Page numbers and similar dynamic values are *inline element nodes* in the header subtree, not magic strings:

```ts
// Header content for "Page 5 of 12":
{ type: "paragraph", children: [
  { type: "text", text: "Page " },
  { type: "page-number-token", properties: {} },         // resolves to `pageIndex + 1`
  { type: "text", text: " of " },
  { type: "page-count-token", properties: {} },           // resolves to total page count
] }
```

`page-number-token` and `page-count-token` are component types whose `render` functions look up the value from `PageContext` (described below) and emit a TextBox with the resolved string. They're plain components — no special engine machinery.

**Why component-based:** dynamic-content tokens use the same render pipeline as everything else. No new rendering primitive. When P9a ships counter components, they fit the same slot.

---

## 2. PageContext (consumed by header/footer rendering)

```ts
interface PageContext {
  readonly pageIndex:  number;     // 0-based
  readonly pageCount:  number;     // total pages in the document; populated via two-pass (see §5)
  readonly section:    StateNode;  // the section this page belongs to
  readonly sectionPageIndex: number;  // page index within this section (for "restart per section" numbering)
}
```

`PageContext` is passed to the header/footer subtree's render pass. The dynamic-content components (`page-number-token` etc.) read from it.

`PageContext` is NOT a `LayoutContext` extension. It's a separate input to the render pass for header/footer subtrees, on top of the standard `(state, children) → RenderNode` shape that all components use. Component definition gains an optional `renderWithPageContext` variant for components that need it; ordinary components are unaffected.

---

## 3. PageBox extensions (layout output)

```ts
interface PageBox extends LayoutBoxBase {
  readonly type: "page";
  readonly pageIndex: number;

  // The body content area's wrapping BlockBox (set by P1.B's paginate.ts).
  readonly contentArea: BlockBox;       // currently called `children[0]`; rename for clarity

  // New in P1.C — populated when the active section has matching content.
  readonly headerSlots: Partial<Record<MarginRegion, BlockBox>>;
  readonly footerSlots: Partial<Record<MarginRegion, BlockBox>>;
  readonly footnoteSlot: BlockBox | null;

  // ... other PageBox fields ...
}

type MarginRegion = "left" | "center" | "right";
```

`headerSlots.center` is a laid-out `BlockBox` for the center-header region; `footerSlots.right` for the right-footer; etc. Each slot is a fully-laid-out BlockBox positioned in its target margin area. Painted by the canvas-renderer alongside `contentArea`.

`footnoteSlot` is a wrapping BlockBox containing all footnote bodies whose calls landed on this page. Positioned at the bottom of the page's content area, above the bottom margin.

**`PageBox.children` is no longer a flat list.** P1.B made it `[contentAreaBlockBox]`. P1.C extends to: `[contentAreaBlockBox]` plus the slot blocks above. Editor utilities and the painter walk `PageBox.children` and the slot fields together (slots are included in the descend list when populated).

---

## 4. Pagination algorithm extensions

### 4.1 Determining the active section per page

The paginator walks document children in order. Each `section` child marks a section start. The current "active section" is the most-recent section seen during pagination. Whenever a new section starts, the next page begins (sections imply a page break).

**Implicit section.** If the document has zero `section` children, the paginator wraps all body content in a synthetic implicit section using the document root's `properties` for layout settings.

### 4.2 Header/footer rendering per page

For each `PageBox`:
1. Look up the active section.
2. Determine the variant: `firstPage` (if `sectionPageIndex === 0` and a `firstPage*` variant exists), `evenPage` (if `sectionPageIndex` is even — counting from the section's start — and an `evenPage*` variant exists), else default.
3. For each of the 6 regions (3 header + 3 footer): if the section has content for that region+variant, render the subtree against the current `PageContext`, lay out into a `BlockBox`, and store in `headerSlots` / `footerSlots`.

The header/footer rendering uses the SAME render → cascade → layout pipeline as body content. Just with a smaller container width (the page's inline-size minus margins on the relevant axes).

### 4.3 Footnote slot layout

Footnotes are collected during the BFC's body layout. When the BFC encounters a `footnote` `StateNode`'s `RenderNode` during inline layout, it:
1. Emits an inline call marker (e.g., a superscript text run) at the call site.
2. Records the footnote's body subtree in a "pending footnotes" list for this page.

After the BFC finishes a page's body content, the pending list is laid out as a `BlockBox` (the `footnoteSlot`) using a separate IFC pass. The slot's height reduces the available block-axis space for body content on that page — meaning the BFC's `availableBlockSize` must shrink as footnotes accumulate.

**Iterative approach.** Adding a footnote to a page might push body content past the page boundary, which might evict body content + the footnote from this page entirely. P1.C uses a fixed-point iteration:
1. Run BFC with `availableBlockSize = pageContentBlockSize` (no footnotes yet).
2. Collect footnotes encountered. Lay out their bodies. Compute total footnote slot height.
3. If total footnote height > 0: re-run BFC with `availableBlockSize = pageContentBlockSize - footnoteSlotHeight`.
4. Repeat until convergence (footnote count stabilizes), with a safety cap (e.g., 5 iterations).

Most pages converge in 1-2 iterations because adding one footnote rarely changes the body break point enough to evict another. The safety cap prevents pathological loops.

### 4.4 `FragmentationContext` extension

```ts
interface FragmentationContext {
  readonly availableBlockSize: number;
  readonly pageIndex: number;
  readonly resumeFrom: BreakToken | null;
  // New in P1.C:
  readonly footnoteCollector: FootnoteCollector;  // mutable collector for the BFC to push into
}

interface FootnoteCollector {
  collect(node: StateNode): void;     // called by BFC when it encounters a footnote inline node
  drain(): readonly StateNode[];      // called by paginate.ts after the page's BFC pass
}
```

The collector lives for one page's iteration. paginate.ts creates a fresh collector per page, runs BFC, drains it, lays out footnote bodies, re-runs if needed.

---

## 5. Page-count two-pass

Headers using `page-count-token` need the document's total page count. But page count is only known after pagination completes. Solution: two-pass.

1. **First pass.** Paginate with `pageCount = -1` (or some sentinel). Header/footer subtrees containing `page-count-token` render placeholders. Let the pagination produce N pages.
2. **Second pass.** If any rendered header/footer used a `page-count-token`, re-render those subtrees with `pageCount = N` and lay them out again. Re-place into the page's `headerSlots`/`footerSlots`.

This is a small fixed cost (only headers/footers re-render, body content doesn't). When no header uses `page-count-token`, no second pass runs (skip-tracking flag set during first-pass render).

The two-pass pattern is the same one P9b's `target-counter()` will use later. P9b extends it; P1.C builds the foundation.

---

## 6. Editor / selection model

### 6.1 Scoped selection

A `Cursor` (`Span`) currently identifies a position in the document tree by `path`. P1.C extends the model: a cursor now also carries a "scope" identifying which subtree the path is rooted in.

```ts
type Scope =
  | { kind: "body" }                                   // path is rooted in the document body
  | { kind: "header"; sectionKey: string; variant: HeaderFooterVariant; region: MarginRegion }
  | { kind: "footer"; sectionKey: string; variant: HeaderFooterVariant; region: MarginRegion }
  | { kind: "footnote"; footnoteKey: string };         // path is rooted in this footnote's body

type HeaderFooterVariant = "default" | "firstPage" | "evenPage";

interface Cursor {
  readonly scope: Scope;
  readonly path: readonly number[];
  readonly offset: number;
}
```

When the user clicks into a header on the rendered page, the editor controller:
1. Hit-tests the click — finds it's inside a `headerSlots.center` BlockBox, which traces back to the active section + variant + region.
2. Constructs a cursor with `scope: { kind: "header", sectionKey, variant: "default", region: "center" }` and the path/offset within the header subtree.
3. Dispatch flows: subsequent edits stay within the header's subtree.

### 6.2 Reducer / action handler changes

Most action handlers (`INSERT_TEXT`, `DELETE_*`, `MOVE_*`) already operate on a cursor's `path` against an arbitrary state-tree subtree. They become scope-aware: instead of operating on the document body, they operate on the subtree designated by `scope`. Concretely, each handler resolves the scope's root node first, then performs the path-based operation against that root.

New actions:
- `INSERT_FOOTNOTE` — at current body cursor: insert a `footnote` node and move cursor into its body.
- `INSERT_SECTION_BREAK` — split the current section at the cursor; cursor stays in the new section.
- `MOVE_TO_HEADER`/`MOVE_TO_FOOTER` (UI-driven) — change scope to the indicated region of the active section.

### 6.3 Section break

A section break splits the current section into two. The reducer locates the document's children, finds the section containing the cursor, splits it: paragraphs before the cursor stay in the original section; paragraphs at and after move to a new section that inherits the original's properties. Cursor lands in the new section.

Sections must be flat children of the document root — no nested sections. (Word/Docs follow this rule too.)

---

## 7. Paint extensions

`canvas-renderer.ts`'s `paintPage` currently paints `pageBox.children` (the content-area BlockBox). P1.C extends:

```
paintPage(pageBox):
  paint white background
  paint contentArea     // existing
  for region in [left, center, right]:
    if pageBox.headerSlots[region]: paint at top-margin position
    if pageBox.footerSlots[region]: paint at bottom-margin position
  if pageBox.footnoteSlot: paint at bottom-of-content-area position (above bottom margin)
  paint cursor + selection (existing)
```

Hit-test extends symmetrically: a click on the page is tested against contentArea, then each header/footer slot, then the footnote slot. The first match returns a cursor with the corresponding scope.

---

## 8. Decomposition

P1.C is large enough to ship as multiple sub-pieces:

- **P1.C.1 — `section` state-tree node + reducer + section break.** No layout impact yet (sections invisible in render); just the data model and editor commands. Document with one section behaves identically to today.
- **P1.C.2 — Headers + footers (default variant, center region only).** Adds `properties.header`/`properties.footer` on `section`, paint, scoped cursor for header/footer regions. `INSERT_FOOTNOTE` not yet available.
- **P1.C.3 — Multi-region (left/right) and variants (firstPage/evenPage).** Adds remaining 5 region/variant combinations. UI changes only: layout/paint already structured for it from C.2.
- **P1.C.4 — Footnotes.** `footnote` state-tree node, inline call marker, `footnoteSlot` layout with iterative convergence, `INSERT_FOOTNOTE` action.
- **P1.C.5 — Page-count two-pass + `page-number-token`/`page-count-token` components.** Hardcoded counter machinery for these two values; P9a extends to general counters.

Each sub-piece ships independently and leaves the engine in a working state.

## 9. Known architectural risks / open questions

- **Selection-extension across scopes.** What does shift+click from body content to the header do? Most word processors don't support cross-scope selection (you can only select within one scope). P1.C should adopt the same constraint: selection cannot span scope boundaries. Selection geometry treats different scopes as separate selections.

- **Content reflow on header height change.** A header that grows to two lines reduces the available body content area for THIS page (because the first child of the body is at margin-top + header-height instead of margin-top alone). This is an iteration similar to footnotes. Most use cases are single-line headers; multi-line headers add a small amount of pagination retry cost.

- **Footnote-call → footnote-body coupling.** If a footnote call is on page 5 and its body's reserved height pushes page 5's last paragraph to page 6, does the call also move to page 6? Per CSS GCPM and Word: yes, both move together. The convergence loop handles this naturally — when the body doesn't fit on the page where the call lives, both get pushed.

- **Empty header/footer regions.** A section with `header: null` produces no header on the page. When iterating over the 6 regions, regions with no content are simply skipped. No empty-but-rendered regions.
