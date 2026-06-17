/**
 * Typed metadata bag carried by ElementBox (render) and BlockBox (layout).
 *
 * A typed STRUCT of optional fields (NOT a discriminated union): a section
 * box carries `blockType` alongside optional page-geometry + header/footer
 * keys, so no single field discriminates the shape. Every field is optional.
 *
 * Keys with a KNOWN shape are strongly typed (`image`, `horizontalLine`,
 * `columnWidths`, `blockType`, `embedType`) — this is what
 * removes the previously-unchecked `as {...}` casts at the read sites
 * (canvas-renderer image, table-fc columnWidths). Values stamped RAW from
 * open-schema `attrs` / embed `properties` (which are themselves `unknown`)
 * stay `unknown` here — `pageInlineSize` / `pageBlockSize` / `pageMargins` /
 * `pageGap` / `headerBlockId` / `footerBlockId` / `contentBlockId` — and are
 * validated/coerced at their read boundaries (`resolveSectionPageConfig`,
 * `coerceBlockId`, the footnote numbering lookup). Typing them as `unknown` is
 * honest: over-typing would just push the same validation around.
 *
 * Placement note: this lives in the RENDER layer because both `ElementBox`
 * (render) and `BlockBox` (layout) need it, and the established dependency
 * direction is layout → render (layout imports from render, never the reverse).
 * Putting it under `layout/` and importing it into `render-node.ts` would
 * invert the layering; a render-side leaf keeps the dependency one-directional.
 */
import type { BlockId } from "../state";
import type { PageFieldKind, PageFieldNumberStyle } from "../state/page-field";

export interface LayoutBoxMetadata {
  readonly image?: { readonly src: string; readonly width: number; readonly height: number; readonly alt?: string };
  readonly horizontalLine?: boolean;
  // Table-of-contents anchor marker. Stamped by the `table-of-contents`
  // component onto its placeholder box so the render-core TOC branch (a later
  // slice) can recognize the anchor and synthesize the entry subtree.
  readonly tableOfContents?: true;
  // TOC-entry click-nav markers. Stamped by the render-core TOC branch (a later
  // slice) onto each synthesized entry box so the DOM controller's TOC hit-test
  // can navigate to the heading. `navTarget` is the heading block to scroll the
  // caret to; `tocEntry` marks the box as a clickable entry. NOT a field-kind
  // discriminant (the entry's page number is a normal cross-ref-page field).
  readonly navTarget?: BlockId;
  readonly tocEntry?: true;
  readonly columnWidths?: readonly number[];
  // Table header-row repetition (#487). The number of leading contiguous rows
  // (`[0, headerRowCount)`) that repeat at the top of every page/column fragment
  // the table spans. Stamped RAW from the table block's open-schema
  // `attrs.headerRowCount` by the `table` component (the same path as
  // `columnWidths`; NO cascade interpreter is involved); read by the measure +
  // materialize passes. Absent ⇒ 0 (no repeated header).
  readonly headerRowCount?: number;
  // Table-cell spanning (P8). Structural grid facts (HTML rowspan/colspan model,
  // NOT cascaded style): stamped by the `table-cell` component from the cell's
  // open-schema `attrs`, read raw by the Table FC + intrinsic pass via
  // `cellSpan` (layout/table-grid.ts). Absent ⇒ 1.
  readonly rowSpan?: number;
  readonly colSpan?: number;
  readonly blockType?: "section";
  // Heading level (P-1). Stamped by `components/heading.ts` from
  // `view.attrs.level`. The read-only DOM viewer maps it to `<h1>`…`<h6>`
  // (the render tree's `blockType` only discriminates `"section"`, so the
  // heading level needs its own carrier — mirrors the canvas painter's
  // reliance on typed metadata rather than re-deriving from attrs).
  readonly headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  // List nesting facts (P-5). Stamped by `components/list-item.ts` ONLY when the
  // numbering service resolves a marker (mirrors the `markerText` gate). The flat
  // Google-Docs list model stores list membership per-paragraph (`listId` +
  // `listLevel`); the render tree otherwise exposes only `markerText` + the
  // derived `paddingInlineStart`, so the digital DOM viewer needs these facts to
  // reconstruct semantic `<ul>/<ol>` nesting (a NEW list opens when `listId`
  // changes or `level` increases). `ordered` distinguishes `<ol>` (numbered) from
  // `<ul>` (bullet). The DISPLAYED ordinal lives in `markerText` (e.g. "5."), so no
  // raw integer is carried here: the HTML serializer resolves ordinals via the
  // numbering engine and the a11y dom-mirror numbers native `<ol>` elements.
  // Absent ⇒ render as a plain styled block.
  readonly list?: { readonly level: number; readonly listId: string; readonly ordered: boolean };
  readonly pageInlineSize?: unknown;
  readonly pageBlockSize?: unknown;
  readonly pageMargins?: unknown;
  readonly pageGap?: unknown;
  readonly headerBlockId?: unknown;
  readonly footerBlockId?: unknown;
  // Per-section multi-column overrides (Format ▸ Columns). Stamped RAW from the
  // section's open-schema `attrs` by the `section` component; validated/coerced
  // at the read boundary (`resolveColumnConfig`). `unknown` for the same honesty
  // reason as the page-geometry keys above.
  readonly columnCount?: unknown;
  readonly columnGap?: unknown;
  readonly columnRule?: unknown;
  // Embed-anchor markers (FN-2): the embed kind discriminator + the linked
  // embed-content root id. `embedType` is the EmbedItem kind (e.g. the
  // footnote-anchor type); `contentBlockId` rides RAW from the embed's
  // open-schema `properties` bag (read as `unknown`, coerced at the numbering
  // lookup). Carried on the marker box so downstream cursor/hit-test/editing
  // can recognize an embed anchor without re-deriving it from state.
  readonly embedType?: string;
  readonly contentBlockId?: unknown;
  // Page-field metadata (page-number / page-count). Stamped by the render pass's
  // `page-field` branch from the embed's `properties`; read by the layout
  // field-resolution pass (`collectPageFields`) to know each field's kind +
  // number style without re-deriving from state. Strongly typed (unlike the raw
  // `unknown` embed properties) because the render branch validates them.
  readonly fieldKind?: PageFieldKind;
  readonly numberStyle?: PageFieldNumberStyle;
  // Cross-reference page-mode metadata. A `"page"`-mode cross-ref is a
  // LAYOUT-dependent field (the target's page is only known after pagination), so
  // it renders a PLACEHOLDER atom (mirroring the page-field branch) carrying
  // `refMode: "page"` + the target id + number style. The later layout
  // field-resolution passes (`collectPageFields` / `patchFieldWidths` /
  // `substituteLayoutFields`) discriminate this branch on
  // `embedType === "cross-reference" && refMode === "page"` and bind the real
  // page number late. The `"number"`/`"text"` modes resolve their TEXT at render
  // time and carry `embedType` + `targetId` but NO `refMode` (only `"page"` mode
  // is layout-dependent). `targetId` is stamped in ALL three modes — threaded
  // onto the laid-out atom (`InlineBlockBox.targetId`) so the PDF exporter can
  // emit an internal /GoTo link to the target (#522). `targetId` rides the
  // validated string from the embed's `properties` (the broken-ref case stamps
  // `null`).
  readonly refMode?: "page";
  readonly targetId?: string | null;
  // Marks a REPLACED inline-block (e.g. an inline image — an atomic box with no
  // in-flow text/line boxes). A replaced inline-block aligns its BOTTOM margin
  // edge with the parent's baseline (CSS2 §10.8.1), unlike a text-bearing
  // inline-block which uses the content-baseline (`*0.8`) rule. Threaded onto
  // `InlineBlockBox.isReplaced` so `applyVerticalAlign` picks the bottom-edge
  // baseline. `undefined` for a non-replaced inline-block.
  readonly replacedInline?: boolean;
}
