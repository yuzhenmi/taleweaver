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
export interface LayoutBoxMetadata {
  readonly image?: { readonly src: string; readonly width: number; readonly height: number };
  readonly horizontalLine?: boolean;
  readonly columnWidths?: readonly number[];
  // Table-cell spanning (P8). Structural grid facts (HTML rowspan/colspan model,
  // NOT cascaded style): stamped by the `table-cell` component from the cell's
  // open-schema `attrs`, read raw by the Table FC + intrinsic pass via
  // `cellSpan` (layout/table-grid.ts). Absent ⇒ 1.
  readonly rowSpan?: number;
  readonly colSpan?: number;
  readonly blockType?: "section";
  readonly pageInlineSize?: unknown;
  readonly pageBlockSize?: unknown;
  readonly pageMargins?: unknown;
  readonly pageGap?: unknown;
  readonly headerBlockId?: unknown;
  readonly footerBlockId?: unknown;
  // Embed-anchor markers (FN-2): the embed kind discriminator + the linked
  // embed-content root id. `embedType` is the EmbedItem kind (e.g. the
  // footnote-anchor type); `contentBlockId` rides RAW from the embed's
  // open-schema `properties` bag (read as `unknown`, coerced at the numbering
  // lookup). Carried on the marker box so downstream cursor/hit-test/editing
  // can recognize an embed anchor without re-deriving it from state.
  readonly embedType?: string;
  readonly contentBlockId?: unknown;
}
